// Zorr Bot v1.0 - Auto Farming (MAIN world)
// Canvas analysis + decision engine. Sends trusted events via background debugger.

(function () {
  'use strict';

  const CFG = {
    autoAttack: true,
    autoCollect: true,
    avoidDamage: true,
    attackRange: 150,
    farmRadius: 350,
    tickMs: 80,
    died: false,
    followPlayer: false,
    followTarget: null,
  };

  let running = false;
  let tickTimer = null;
  let safetyTimer = null;
  let exploreCount = 0;
  let dirCycle = 0;
  let reqId = 0;
  let pendingResponses = {};
  let debuggerReady = false;

  // ── Movement state (2.0: smooth tracking) ──────────
  let currentMoveDir = null;        // currently held direction code
  let stuckTimer = 0;               // ticks without canvas change
  let stuckRecoveryDir = 0;         // which recovery direction we're trying
  let lastMoveSignature = null;     // pixel fingerprint for stuck detection
  let lastKnownEnemyPos = null;     // last seen enemy position
  let spawnTick = 0;                // tick counter since last spawn/respawn
  const SPAWN_SAFETY_TICKS = 75;    // ~6 seconds of safe flee mode
  const STUCK_THRESHOLD = 15;       // ticks of same signature = stuck
  const STUCK_CHECK_RADIUS = 90;    // how far from center to check for progress

  // ── Bridge communication ────────────────────────────
  function sendToBackground(action, payload) {
    return new Promise((resolve) => {
      reqId++;
      const requestId = 'req_' + reqId + '_' + Date.now();
      pendingResponses[requestId] = resolve;
      window.postMessage({
        source: 'zorr-bot-content',
        target: 'background',
        action,
        ...payload,
        requestId,
      }, '*');
      // Timeout after 5s
      setTimeout(() => {
        if (pendingResponses[requestId]) {
          delete pendingResponses[requestId];
          resolve(null);
        }
      }, 5000);
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (msg?.source === 'zorr-bot-bridge' && msg.requestId && pendingResponses[msg.requestId]) {
      pendingResponses[msg.requestId](msg.value);
      delete pendingResponses[msg.requestId];
    }
  });

  async function initDebugger() {
    const result = await sendToBackground('attach');
    debuggerReady = result?.attached === true;
    return debuggerReady;
  }

  // ── CDP Input helpers ───────────────────────────────
  async function dispatchKeyEvent(code, type) {
    await sendToBackground('keyEvent', { code, type });
  }

  async function clickElement(selector) {
    return await sendToBackground('click', { selector });
  }

  // ── Keyboard state tracking ────────────────────────
  let held = {};

  async function hold(code) {
    if (!held[code]) {
      held[code] = true;
      await dispatchKeyEvent(code, 'keydown');
    }
  }

  async function release(code) {
    if (held[code]) {
      held[code] = false;
      await dispatchKeyEvent(code, 'keyup');
    }
  }

  async function releaseAll() {
    for (const k of Object.keys(held)) await release(k);
    held = {};
  }

  async function press(code) {
    await dispatchKeyEvent(code, 'keydown');
    await dispatchKeyEvent(code, 'keyup');
  }

  // 2.0: Smooth movement - only change keys when direction actually changes
  function angleToDir(angle) {
    if (angle > -Math.PI / 4 && angle <= Math.PI / 4) return 'KeyD'; // East
    if (angle > Math.PI / 4 && angle <= 3 * Math.PI / 4) return 'KeyS'; // South
    if (angle > 3 * Math.PI / 4 || angle <= -3 * Math.PI / 4) return 'KeyA'; // West
    return 'KeyW'; // North
  }

  async function moveToward(dx, dy) {
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
    const angle = Math.atan2(dy, dx);
    const dir = angleToDir(angle);
    if (dir !== currentMoveDir) {
      await releaseAll();
      currentMoveDir = dir;
      lastMoveSignature = null;   // reset stuck detection on direction change
      stuckTimer = 0;
      await hold(dir);
    }
  }

  async function moveAwayFrom(dx, dy) {
    await moveToward(-dx, -dy);
  }

  async function moveStop() {
    if (currentMoveDir) {
      await releaseAll();
      currentMoveDir = null;
      lastMoveSignature = null;
      stuckTimer = 0;
    }
  }

  async function moveRandom() {
    await releaseAll();
    currentMoveDir = null;
    lastMoveSignature = null;
    stuckTimer = 0;
    dirCycle = (dirCycle + 1 + Math.floor(Math.random() * 3)) % 4;
    const dir = ['KeyW', 'KeyD', 'KeyS', 'KeyA'][dirCycle];
    currentMoveDir = dir;
    await hold(dir);
  }

  // ── Wall detection (2.0) ──────────────────────────
  // Samples 8 points in a ring around center to detect if we're making progress.
  // If the pixel fingerprint stays the same while trying to move, we're stuck.
  function sampleMoveSignature() {
    const cv = document.getElementById('canvas');
    if (!cv) return null;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const R = STUCK_CHECK_RADIUS;
    const positions = [
      [0, -R], [R*0.7, -R*0.7], [R, 0], [R*0.7, R*0.7],
      [0, R], [-R*0.7, R*0.7], [-R, 0], [-R*0.7, -R*0.7]
    ];
    const sig = [];
    for (const [dx, dy] of positions) {
      const x = Math.round(CX + dx), y = Math.round(CY + dy);
      if (x < 0 || y < 0 || x >= cv.width || y >= cv.height) { sig.push(-1); continue; }
      const d = ctx.getImageData(x, y, 1, 1).data;
      // Compact the RGB into a single number for comparison
      sig.push(((d[0] << 16) | (d[1] << 8) | d[2]));
    }
    return sig.join(',');
  }

  // Returns the perpendicular directions (for wall sliding)
  function getPerpDirs(dir) {
    const dirs = ['KeyW', 'KeyD', 'KeyS', 'KeyA'];
    const idx = dirs.indexOf(dir);
    if (idx === -1) return ['KeyA', 'KeyD']; // default
    return [dirs[(idx + 1) % 4], dirs[(idx + 3) % 4]]; // clockwise, counter-clockwise
  }

  // Check if stuck by comparing current signature with last known
  function checkStuck() {
    const sig = sampleMoveSignature();
    if (!sig || !currentMoveDir) return false;
    if (lastMoveSignature === null) {
      lastMoveSignature = sig;
      stuckTimer = 0;
      return false;
    }
    const same = (sig === lastMoveSignature);
    if (same) {
      stuckTimer++;
      if (stuckTimer >= STUCK_THRESHOLD) return true;
    } else {
      // Made progress! Reset
      lastMoveSignature = sig;
      stuckTimer = 0;
      stuckRecoveryDir = 0;
    }
    return false;
  }

  // Recover from being stuck - try sliding along the wall
  async function recoverStuck() {
    const perp = getPerpDirs(currentMoveDir);
    // Cycle through recovery directions: perp1, perp2, perp1, perp2, then all 4 cardinal
    const recoveryDirs = [perp[0], perp[1], perp[0], perp[1], 'KeyA', 'KeyD', 'KeyW', 'KeyS'];
    const dir = recoveryDirs[stuckRecoveryDir % recoveryDirs.length];
    stuckRecoveryDir++;
    // Release old direction and try new one
    await releaseAll();
    currentMoveDir = dir;
    lastMoveSignature = null;  // force fresh signature on next tick
    stuckTimer = 0;
    await hold(dir);
  }

  // ── Lobby ──────────────────────────────────────────
  let lobbyStarted = false;

  async function handleLobby() {
    const menu = document.querySelector('.menu');
    if (!menu || menu.style.display === 'none') return false;
    if (lobbyStarted) return false;
    lobbyStarted = true;

    console.log('[Zorr Bot] Handling lobby...');

    // Fill nickname
    const input = document.querySelector('input.nickname-input');
    if (input) {
      input.focus();
      input.value = 'Bot' + Math.floor(Math.random() * 9000 + 1000);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Click play button via CDP (trusted)  
    await new Promise(r => setTimeout(r, 300));
    const clicked = await clickElement('.play-btn');
    console.log('[Zorr Bot] Play button click result:', clicked);

    return true;
  }

  // ── Death / Respawn ────────────────────────────────
  async function checkDeath() {
    const el = document.querySelector('.death');
    if (!el || el.style.display === 'none') {
      CFG.died = false;
      return false;
    }
    if (!CFG.died) {
      CFG.died = true;
      await releaseAll();
      currentMoveDir = null;
      setTimeout(async () => {
        const clicked = await clickElement('.continue-btn');
        if (!clicked) {
          await press('Escape');
        }
        // Reset spawn safety on respawn
        spawnTick = 0;
      }, 2000);
    }
    return true;
  }

  // ── Color classification presets ────────────────────
  // Based on actual canvas pixel sampling from zorr.pro gameplay:
  //   Grass green:  (30,167,97) dominant, ±small variations
  //   Stone paths:  (145-169, 145-169, 145-169) ~45% of canvas!
  //   Gold loot:    (255,231,99), (207,187,80)
  //   White petals: (255,255,255), (238,238,238)
  //   Dark text:    (34,34,34), (0,0,0)
  const COLORS = {
    // Background: grass green
    GRASS: { r: [18, 55], g: [145, 185], b: [75, 118] },
    // Background: stone/dirt paths (gray, all channels roughly equal)
    STONE: { r: [120, 185], g: [120, 185], b: [120, 185] },
    // Background: brown dirt/forest terrain (104,69,45)
    DIRT: { r: [90, 115], g: [55, 80], b: [30, 55] },
    // Background: dark green bushes/walls/obstacles (7,73,7), (19,106,60), (76,115,46)
    BUSH: { r: [5, 80], g: [60, 120], b: [5, 65] },
    // Red/orange mobs (ladybug, etc.)
    MOB_RED:   { r: [150, 255], g: [25, 120], b: [25, 95] },
    // Brown/dark mobs (ants, spiders)
    MOB_BROWN: { r: [60, 150], g: [30, 100], b: [20, 80] },
    // Gold/yellow = loot drops, bees, petals on ground
    LOOT_GOLD: { r: [180, 255], g: [150, 255], b: [25, 135] },
    // Bright green mobs (beetles, plants)
    MOB_GREEN: { r: [5, 55], g: [170, 235], b: [5, 65] },
    // Blue = player/ally
    ALLY_BLUE: { r: [25, 110], g: [90, 210], b: [170, 255] },
    // White/light gray = petals, effects
    FX_WHITE:  { r: [200, 255], g: [200, 255], b: [200, 255] },
    // Very dark = UI text, outlines, shadows (ignore)
    UI_DARK:   { r: [0, 50], g: [0, 50], b: [0, 50] },
  };

  function inRange(v, range) { return v >= range[0] && v <= range[1]; }

  function classifyPixel(r, g, b) {
    // Background first (fast reject)
    if (inRange(r, COLORS.GRASS.r) && inRange(g, COLORS.GRASS.g) && inRange(b, COLORS.GRASS.b)) return null;
    if (inRange(r, COLORS.STONE.r) && inRange(g, COLORS.STONE.g) && inRange(b, COLORS.STONE.b)) return null;
    if (inRange(r, COLORS.DIRT.r) && inRange(g, COLORS.DIRT.g) && inRange(b, COLORS.DIRT.b)) return null;
    if (inRange(r, COLORS.BUSH.r) && inRange(g, COLORS.BUSH.g) && inRange(b, COLORS.BUSH.b)) return null;
    if (inRange(r, COLORS.UI_DARK.r) && inRange(g, COLORS.UI_DARK.g) && inRange(b, COLORS.UI_DARK.b)) return null;
    // Now classify foreground
    if (inRange(r, COLORS.MOB_RED.r) && inRange(g, COLORS.MOB_RED.g) && inRange(b, COLORS.MOB_RED.b)) return 'threat';
    if (inRange(r, COLORS.MOB_BROWN.r) && inRange(g, COLORS.MOB_BROWN.g) && inRange(b, COLORS.MOB_BROWN.b)) return 'threat';
    if (inRange(r, COLORS.MOB_GREEN.r) && inRange(g, COLORS.MOB_GREEN.g) && inRange(b, COLORS.MOB_GREEN.b)) return 'threat';
    if (inRange(r, COLORS.LOOT_GOLD.r) && inRange(g, COLORS.LOOT_GOLD.g) && inRange(b, COLORS.LOOT_GOLD.b)) return 'loot';
    if (inRange(r, COLORS.ALLY_BLUE.r) && inRange(g, COLORS.ALLY_BLUE.g) && inRange(b, COLORS.ALLY_BLUE.b)) return 'ally';
    if (inRange(r, COLORS.FX_WHITE.r) && inRange(g, COLORS.FX_WHITE.g) && inRange(b, COLORS.FX_WHITE.b)) return 'effect';
    // Unclassified colored pixel - could be a mob, mark as potential threat
    // Only if it has enough saturation (not fully gray)
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max - min > 30) return 'threat'; // saturated = likely a mob
    return null; // low saturation = noise/terrain detail
  }

  // ── Dynamic biome detection ────────────────────────
  function detectBiome(ctx, w, h) {
    // Sample pixels across the canvas to find the dominant terrain color
    const counts = { grass: 0, stone: 0, dirt: 0, other: 0, total: 0 };
    for (let i = 0; i < 60; i++) {
      const x = Math.floor(Math.random() * w);
      const y = Math.floor(Math.random() * h);
      const d = ctx.getImageData(x, y, 1, 1).data;
      if (d[3] < 30) continue;
      const r = d[0], g = d[1], b = d[2];
      if (inRange(r, COLORS.GRASS.r) && inRange(g, COLORS.GRASS.g) && inRange(b, COLORS.GRASS.b)) counts.grass++;
      else if (inRange(r, COLORS.STONE.r) && inRange(g, COLORS.STONE.g) && inRange(b, COLORS.STONE.b)) counts.stone++;
      else if (inRange(r, COLORS.DIRT.r) && inRange(g, COLORS.DIRT.g) && inRange(b, COLORS.DIRT.b)) counts.dirt++;
      else counts.other++;
      counts.total++;
    }
    // Determine dominant biome
    const grassPct = counts.grass / counts.total * 100;
    const stonePct = counts.stone / counts.total * 100;
    const dirtPct = counts.dirt / counts.total * 100;
    if (grassPct > 40) return 'Plains';
    if (dirtPct > 40) return 'Forest/Dirt';
    if (stonePct > 40) return 'Rocky';
    return 'Unknown';
  }

  // ── Canvas Analysis ────────────────────────────────
  function scanCanvas() {
    const cv = document.getElementById('canvas');
    if (!cv) return null;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    const w = cv.width, h = cv.height;
    const cx = w / 2, cy = h / 2;
    const R = CFG.farmRadius;
    const step = 4; // smaller step for better detection
    const L = Math.max(0, Math.floor(cx - R));
    const Rw = Math.min(w, Math.ceil(cx + R)) - L;
    const T = Math.max(0, Math.floor(cy - R));
    const Rh = Math.min(h, Math.ceil(cy + R)) - T;

    if (Rw <= 0 || Rh <= 0) return null;

    // Bulk read the entire region ONCE
    let imageData;
    try {
      imageData = ctx.getImageData(L, T, Rw, Rh);
    } catch (_) { return null; }
    const buf = imageData.data;

    // Collect non-grass sample points
    const dots = [];
    for (let row = 0; row < Rh; row += step) {
      for (let col = 0; col < Rw; col += step) {
        const idx = (row * Rw + col) * 4;
        const r = buf[idx], g = buf[idx + 1], b = buf[idx + 2], a = buf[idx + 3];
        if (a < 100) continue;
        const cls = classifyPixel(r, g, b);
        if (!cls) continue; // background (grass, stone, dark) - skip
        dots.push({ x: L + col, y: T + row, r, g, b, cls });
      }
    }

    if (dots.length < 2) return { threats: [], loot: [], allies: [], effects: [] };

    // Grid-based clustering: group adjacent non-background pixels
    // Use a simple merge: sort by proximity, then greedily group
    const sorted = [...dots].sort((a, b) => a.x - b.x);
    const used = new Uint8Array(sorted.length);
    const clusters = [];

    for (let i = 0; i < sorted.length; i++) {
      if (used[i]) continue;
      const group = [sorted[i]];
      used[i] = 1;
      for (let j = i + 1; j < sorted.length; j++) {
        if (used[j]) continue;
        if (Math.abs(sorted[j].x - sorted[i].x) > 40) break; // x-sorted, too far
        if (Math.hypot(sorted[j].x - sorted[i].x, sorted[j].y - sorted[i].y) < 35) {
          group.push(sorted[j]);
          used[j] = 1;
        }
      }
      if (group.length < 2) continue;
      const avgX = Math.round(group.reduce((a, p) => a + p.x, 0) / group.length);
      const avgY = Math.round(group.reduce((a, p) => a + p.y, 0) / group.length);
      const dc = Math.hypot(avgX - cx, avgY - cy);

      // Determine cluster type by majority color
      const counts = { threat: 0, loot: 0, ally: 0, effect: 0 };
      let maxCount = 0, majorityCls = 'threat';
      for (const p of group) {
        counts[p.cls] = (counts[p.cls] || 0) + 1;
        if (counts[p.cls] > maxCount) { maxCount = counts[p.cls]; majorityCls = p.cls; }
      }
      // Small unclassified groups default to loot
      if (!majorityCls && group.length < 4) majorityCls = 'loot';

      clusters.push({ x: avgX, y: avgY, count: group.length, dist: dc, cls: majorityCls });
    }

    // Sort by distance (closest first)
    clusters.sort((a, b) => a.dist - b.dist);

    const playerClusters = clusters.filter(c => {
      // A player flower has: central colored body + orbiting petals
      // Detect by looking for medium-sized clusters with mixed 'ally'/'effect' classification
      // or any cluster that has a ring-like shape (high count, central point, mixed colors)
      if (c.cls === 'ally' && c.count >= 3) return true;
      // Also detect as player if it's a large cluster that's not clearly a threat or loot
      if (c.cls === 'effect' && c.count >= 6 && c.dist < 400) return true;
      return false;
    });

    const biome = detectBiome(ctx, w, h);

    return {
      threats: clusters.filter(c => c.cls === 'threat' && c.count >= 2),
      loot:    clusters.filter(c => c.cls === 'loot' && c.count >= 2),
      players: playerClusters,
      allies:  clusters.filter(c => c.cls === 'ally'),
      effects: clusters.filter(c => c.cls === 'effect'),
      biome: biome,
    };
  }

  function getClosestPlayer(world) {
    if (!world.players || world.players.length === 0) return null;
    return world.players[0]; // already sorted by distance
  }

  // ── Bot Tick 2.0 ───────────────────────────────────
  let tickBusy = false;
  let wasInGame = false;
  const CX = 640, CY = 360;

  async function tick() {
    if (!running || tickBusy) return;
    tickBusy = true;
    spawnTick++;
    try {
      // ── Death / Lobby handling ──
      if (await checkDeath()) return;
      const menu = document.querySelector('.menu');
      const menuVisible = menu && menu.style.display !== 'none';
      if (!menuVisible && !wasInGame) { wasInGame = true; spawnTick = 0; }
      if (menuVisible && wasInGame) { lobbyStarted = false; wasInGame = false; spawnTick = 0; }
      if (await handleLobby()) return;

      const cv = document.getElementById('canvas');
      if (cv && document.activeElement !== cv) cv.focus();

      const world = scanCanvas();
      if (world && world.biome) broadcastBiome(world.biome);

      // ── 2.0: Spawn safety - first 6s only flee ──
      if (spawnTick < SPAWN_SAFETY_TICKS && world) {
        if (world.threats.length > 0) {
          const nearest = world.threats[0];
          await moveAwayFrom(nearest.x - CX, nearest.y - CY);
          exploreCount = 0;
          // Stuck check while fleeing
          if (checkStuck()) { await recoverStuck(); }
          return;
        }
        if (world.loot.length > 0) {
          // Don't collect during spawn safety, just move away
          await moveRandom();
          exploreCount = 0;
          return;
        }
        // Spawn safety with no threats: random move with stuck check
        if (currentMoveDir && checkStuck()) {
          await recoverStuck();
          return;
        }
      }

      if (!world) {
        exploreCount++;
        if (exploreCount > 20) { await moveRandom(); exploreCount = 0; } else { checkStuck(); }
        return;
      }

      // ── 2.0: Progress check (wall detection) ──
      // If we're trying to move but the canvas isn't changing, we're stuck on a wall
      if (currentMoveDir && checkStuck()) {
        await recoverStuck();
        return;
      }

      // ── 2.0: Follow player mode ──
      if (CFG.followPlayer) {
        const target = getClosestPlayer(world);
        if (target) {
          const dx = target.x - CX, dy = target.y - CY;
          if (target.dist > 60) {
            await moveToward(dx, dy);
          } else {
            await moveStop();
          }
          if (CFG.autoAttack && world.threats.length > 0) {
            const t = world.threats[0];
            if (t.dist < CFG.attackRange) await hold('Space');
          }
          exploreCount = 0;
          return;
        }
      }

      // ── 2.0: Smart threat response ──
      // Priority: flee > fight > collect > explore
      if (world.threats.length > 0) {
        const nearest = world.threats[0];
        const dx = nearest.x - CX, dy = nearest.y - CY;

        // If threat is VERY close, always flee
        if (nearest.dist < 100) {
          await moveAwayFrom(dx, dy);
          exploreCount = 0;
          return;
        }

        // If in attack range and not in spawn safety, attack
        if (CFG.autoAttack && nearest.dist < CFG.attackRange) {
          await hold('Space');
          // Strafe perpendicular (orbit around threat)
          await moveToward(-dy, dx);
          exploreCount = 0;
          return;
        }

        // Threat is visible but out of range: move toward it
        if (CFG.autoAttack) {
          await moveToward(dx, dy);
          exploreCount = 0;
          return;
        }
      }

      // ── 2.0: Collect loot ──
      if (CFG.autoCollect && world.loot.length > 0) {
        const l = world.loot[0];
        const dx = l.x - CX, dy = l.y - CY;
        if (l.dist > 50) {
          await moveToward(dx, dy);
        } else {
          await moveRandom();
        }
        exploreCount = 0;
        return;
      }

      // ── 2.0: Wander / explore ──
      exploreCount++;
      if (exploreCount > 30) {
        await moveRandom();
        exploreCount = 0;
      } else if (exploreCount > 20 && currentMoveDir === null) {
        await moveRandom();
      }

      // ── 2.0: Final stuck check ──
      // Catches any case where we're holding a direction but not progressing
      if (currentMoveDir && checkStuck()) {
        await recoverStuck();
      }
    } finally {
      tickBusy = false;
    }
  }

  // ── Controls ───────────────────────────────────────
  async function start() {
    if (tickTimer) return;
    running = true;
    spawnTick = 0;
    stuckTimer = 0;
    currentMoveDir = null;

    // Ensure debugger is attached (retry up to 3 times)
    if (!debuggerReady) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const ok = await initDebugger();
        if (ok) break;
        await new Promise(r => setTimeout(r, 500));
      }
    }

    const cv = document.getElementById('canvas');
    if (cv) cv.focus();
    await handleLobby();

    // Periodic tick
    tickTimer = setInterval(() => tick(), CFG.tickMs);

    // Safety checks + debugger heartbeat
    safetyTimer = setInterval(async () => {
      if (!running) { clearInterval(safetyTimer); return; }
      checkDeath();
      // Periodically verify debugger is still attached
      if (debuggerReady) {
        const result = await sendToBackground('ping');
        if (result?.pong !== true) {
          debuggerReady = false;
          // Re-attach
          await initDebugger();
        }
      }
    }, 10000);

    broadcast({ enabled: true });
  }

  function stop() {
    running = false;
    if (tickTimer)   { clearInterval(tickTimer);   tickTimer = null; }
    if (safetyTimer) { clearInterval(safetyTimer); safetyTimer = null; }
    releaseAll();
    broadcast({ enabled: false });
  }

  // ── IPC ────────────────────────────────────────────
  window.addEventListener('message', e => {
    if (e.source !== window || e.data?.source !== 'zorr-bot-popup') return;
    const { action, value } = e.data;
    if (action === 'start') start();
    else if (action === 'stop') stop();
    else if (action === 'getStatus') broadcast({ enabled: running });
    else if (action === 'updateSettings' && value) Object.assign(CFG, value);
  });

  function broadcast(state) {
    window.postMessage({ source: 'zorr-bot-content', action: 'status', value: state }, '*');
  }

  function broadcastBiome(biome) {
    window.postMessage({ source: 'zorr-bot-content', action: 'biome', value: biome }, '*');
  }

  // ── Init ───────────────────────────────────────────
  setTimeout(async () => {
    await initDebugger();
    console.log('[Zorr Bot] Debugger ready:', debuggerReady);
    // Auto-handle lobby with retries
    for (let attempt = 0; attempt < 5; attempt++) {
      const menu = document.querySelector('.menu');
      if (!menu || menu.style.display === 'none') break;
      lobbyStarted = false;
      await handleLobby();
      await new Promise(r => setTimeout(r, 2000));
    }
  }, 2000);

  console.log('[Zorr Bot] Loaded');
})();
