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

  // ── Player tracking (cross-frame) ─────────────────
  let trackedPlayers = [];          // [{x, y, vx, vy, age, name}...]
  let followTargetPos = null;       // {x, y} last known position of followed player
  let followTargetLost = 0;         // ticks since target lost (for recovery)
  let followSearchDir = 0;          // spiral search direction
  const PLAYER_LOST_TIMEOUT = 50;   // ticks before giving up search (~4s)
  const FOLLOW_TARGET_DIST = 120;   // desired follow distance
  const FOLLOW_MIN_DIST = 70;       // minimum follow distance
  const PLAYER_RING_RADIUS_MIN = 40;   // min petal orbit radius
  const PLAYER_RING_RADIUS_MAX = 120;  // max petal orbit radius

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
  // Based on zorr.pro wiki rarity colors:
  //   Common=#33FF33, Unusual=#FFFF33, Rare=#3333FF
  //   Epic=#9900CC, Legendary=#FF0033, Mythic=#33FFFF
  //   Ultra=#FF0099, Super=#33FF99, Omega=#FF00FF, Unique=#555555
  //
  // Mobs and dropped petals use these rarity colors as glows/outlines.
  // Background: grass green (30,167,97), stone paths (145-169 gray),
  //             dirt brown (104,69,45), bushes dark green (7,73,7)

  // Rarity color definitions (mobs + dropped petals share these)
  const RARITY = {
    COMMON:   { r: [40,62],   g: [240,255], b: [40,62] },    // #33FF33
    UNUSUAL:  { r: [245,255], g: [245,255], b: [40,62] },    // #FFFF33
    RARE:     { r: [40,62],   g: [40,62],   b: [240,255] },  // #3333FF
    EPIC:     { r: [140,165], g: [0,15],    b: [195,215] },  // #9900CC
    LEGENDARY:{ r: [245,255], g: [0,15],    b: [40,62] },    // #FF0033
    MYTHIC:   { r: [40,62],   g: [240,255], b: [240,255] },  // #33FFFF
    ULTRA:    { r: [245,255], g: [0,15],    b: [140,165] },  // #FF0099
    SUPER:    { r: [40,62],   g: [240,255], b: [140,165] },  // #33FF99
    OMEGA:    { r: [245,255], g: [0,15],    b: [240,255] },  // #FF00FF
    UNIQUE:   { r: [75,95],   g: [75,95],   b: [75,95] },    // #555555
  };

  const COLORS = {
    // Background terrain
    GRASS: { r: [18, 55], g: [145, 185], b: [75, 118] },
    STONE: { r: [120, 185], g: [120, 185], b: [120, 185] },
    DIRT:  { r: [90, 115], g: [55, 80], b: [30, 55] },
    BUSH:  { r: [5, 80], g: [60, 120], b: [5, 65] },
    DARK:  { r: [0, 50], g: [0, 50], b: [0, 50] },
    // Effects (white petals, particles)
    WHITE: { r: [200, 255], g: [200, 255], b: [200, 255] },
  };

  function inRange(v, range) { return v >= range[0] && v <= range[1]; }

  // Check if color matches a rarity tier, return its name or null
  function matchRarity(r, g, b) {
    for (const [name, range] of Object.entries(RARITY)) {
      if (inRange(r, range.r) && inRange(g, range.g) && inRange(b, range.b)) return name;
    }
    return null;
  }

  function classifyPixel(r, g, b) {
    // Background terrain (fast reject)
    if (inRange(r, COLORS.GRASS.r) && inRange(g, COLORS.GRASS.g) && inRange(b, COLORS.GRASS.b)) return null;
    if (inRange(r, COLORS.STONE.r) && inRange(g, COLORS.STONE.g) && inRange(b, COLORS.STONE.b)) return null;
    if (inRange(r, COLORS.DIRT.r) && inRange(g, COLORS.DIRT.g) && inRange(b, COLORS.DIRT.b)) return null;
    if (inRange(r, COLORS.BUSH.r) && inRange(g, COLORS.BUSH.g) && inRange(b, COLORS.BUSH.b)) return null;
    if (inRange(r, COLORS.DARK.r) && inRange(g, COLORS.DARK.g) && inRange(b, COLORS.DARK.b)) return null;
    // Effects
    if (inRange(r, COLORS.WHITE.r) && inRange(g, COLORS.WHITE.g) && inRange(b, COLORS.WHITE.b)) return 'effect';
    // Rarity-colored pixel = mob or dropped petal
    const rarity = matchRarity(r, g, b);
    if (rarity) {
      // mobs glow with rarity colors (they are bigger clusters)
      // dropped petals also glow with rarity colors (small clusters)
      // We'll distinguish by CLUSTER SIZE later in scanCanvas
      return 'object'; // generic game object, classify by cluster analysis
    }
    // Saturated non-rarity colors = likely mob body/effect
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max - min > 50) return 'object';
    return null;
  }

  // ── Dynamic biome detection ────────────────────────
  function detectBiome(ctx, w, h) {
    // Sample pixels across the canvas to find the dominant terrain color
    const counts = { grass: 0, stone: 0, dirt: 0, bush: 0, other: 0, total: 0 };
    for (let i = 0; i < 60; i++) {
      const x = Math.floor(Math.random() * w);
      const y = Math.floor(Math.random() * h);
      const d = ctx.getImageData(x, y, 1, 1).data;
      if (d[3] < 30) continue;
      const r = d[0], g = d[1], b = d[2];
      if (inRange(r, COLORS.GRASS.r) && inRange(g, COLORS.GRASS.g) && inRange(b, COLORS.GRASS.b)) counts.grass++;
      else if (inRange(r, COLORS.STONE.r) && inRange(g, COLORS.STONE.g) && inRange(b, COLORS.STONE.b)) counts.stone++;
      else if (inRange(r, COLORS.DIRT.r) && inRange(g, COLORS.DIRT.g) && inRange(b, COLORS.DIRT.b)) counts.dirt++;
      else if (inRange(r, COLORS.BUSH.r) && inRange(g, COLORS.BUSH.g) && inRange(b, COLORS.BUSH.b)) counts.bush++;
      else counts.other++;
      counts.total++;
    }
    const pct = (k) => counts[k] / counts.total * 100;
    if (pct('grass') > 40) return 'Plains';
    if (pct('dirt') > 40) return 'Forest/Dirt';
    if (pct('stone') > 40) return 'Rocky';
    if (pct('bush') > 30) return 'Forest';
    return 'Mixed';
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

      // Determine cluster type by size and content
      // Rarity-colored clusters:
      //   - Large cluster (>5 dots) = mob (threat)
      //   - Medium cluster (3-5 dots) = could be mob or player petal
      //   - Small cluster (2-3 dots) = dropped petal (loot)
      let cls = 'object';
      const rCount = group.length;
      if (rCount >= 6) cls = 'threat';
      else if (rCount >= 4) cls = 'threat'; // small mob or petal cluster
      else cls = 'loot';

      clusters.push({ x: avgX, y: avgY, count: rCount, dist: dc, cls });
    }

    // Sort by distance (closest first)
    clusters.sort((a, b) => a.dist - b.dist);

    // Player detection: ring pattern analysis on larger clusters
    // Players = flower body + orbiting petals = dots spread in a ring
    const detectedPlayers = [];
    for (const c of clusters) {
      if (c.count < 4 || c.dist < 50 || c.dist > 450) continue;
      // Get the dots belonging to this cluster from our sorted array
      // Since we sorted by x, find the range of dots that could belong
      const memberDots = [];
      for (const d of sorted) {
        if (Math.hypot(d.x - c.x, d.y - c.y) > PLAYER_RING_RADIUS_MAX) continue;
        memberDots.push(d);
      }
      if (memberDots.length < 4) continue;

      // Radial spread analysis: compute distances from center
      const dists = memberDots.map(d => Math.hypot(d.x - c.x, d.y - c.y));
      const avgDist = dists.reduce((a, b) => a + b, 0) / dists.length;
      if (avgDist < 12 || avgDist > 150) continue;

      // A ring has uniform radii (low stddev/avg ratio)
      const variance = dists.reduce((sum, d) => sum + (d - avgDist) ** 2, 0) / dists.length;
      if (Math.sqrt(variance) / avgDist > 0.55) continue;

      // Angular coverage check
      const angles = memberDots.map(d => Math.atan2(d.y - c.y, d.x - c.x));
      angles.sort((a, b) => a - b);
      let maxGap = angles[0] + 2 * Math.PI - angles[angles.length - 1];
      for (let i = 1; i < angles.length; i++) {
        maxGap = Math.max(maxGap, angles[i] - angles[i - 1]);
      }
      if (2 * Math.PI - maxGap < Math.PI) continue; // less than 180° coverage

      detectedPlayers.push(c);
    }

    const biome = detectBiome(ctx, w, h);

    return {
      threats: clusters.filter(c => (c.cls === 'threat' || c.cls === 'object') && c.count >= 4),
      loot:    clusters.filter(c => c.cls === 'loot' && c.count <= 3),
      players: detectedPlayers,
      effects: clusters.filter(c => c.cls === 'effect'),
      biome: biome,
    };
  }

  // ── Player detection: ring pattern analysis ──────
  // In zorr.pro, players are flowers with petals orbiting in a ring.
  // We detect this by checking if a cluster's dots form a circular arc.
  function isPlayerRing(cluster, dots) {
    if (dots.length < 4) return false;
    // Compute radial distances from cluster center
    const dists = dots.map(d => Math.hypot(d.x - cluster.x, d.y - cluster.y));
    const avgDist = dists.reduce((a, b) => a + b, 0) / dists.length;
    if (avgDist < 8 || avgDist > 160) return false; // too tight or too spread
    // Check radial uniformity: stddev / avg should be low (<0.5) for a ring
    const variance = dists.reduce((sum, d) => sum + (d - avgDist) ** 2, 0) / dists.length;
    const stddev = Math.sqrt(variance);
    if (stddev / avgDist > 0.55) return false; // non-uniform = blob, not ring

    // Check angular coverage: compute angles of all dots
    const angles = dots.map(d => Math.atan2(d.y - cluster.y, d.x - cluster.x));
    angles.sort((a, b) => a - b);
    // Find max gap between consecutive angles
    let maxGap = 0;
    for (let i = 1; i < angles.length; i++) {
      maxGap = Math.max(maxGap, angles[i] - angles[i - 1]);
    }
    // Also check wrap-around gap
    maxGap = Math.max(maxGap, angles[0] + 2 * Math.PI - angles[angles.length - 1]);
    const coverage = 2 * Math.PI - maxGap; // radians of coverage
    // Players have petals distributed around the flower (>180° coverage)
    if (coverage < Math.PI) return false; // less than 180° = partial arc = unlikely player

    return true;
  }

  // ── Cross-frame player tracking ──────────────────
  function updateTrackedPlayers(currentPlayers) {
    // Match current detections to tracked players
    const matched = new Set();
    for (const cp of currentPlayers) {
      let found = false;
      for (const tp of trackedPlayers) {
        const dist = Math.hypot(cp.x - tp.x, cp.y - tp.y);
        if (dist < 80) { // same player within 80px
          // Update velocity
          tp.vx = cp.x - tp.x;
          tp.vy = cp.y - tp.y;
          tp.x = cp.x;
          tp.y = cp.y;
          tp.age++;
          tp.lostTicks = 0;
          found = true;
          matched.add(tp);
          break;
        }
      }
      if (!found) {
        // New player detected
        trackedPlayers.push({ x: cp.x, y: cp.y, vx: 0, vy: 0, age: 1, lostTicks: 0 });
      }
    }
    // Age unmatched tracks
    for (const tp of trackedPlayers) {
      if (!matched.has(tp)) {
        tp.lostTicks++;
      }
    }
    // Remove stale tracks (lost for > 2 seconds)
    trackedPlayers = trackedPlayers.filter(tp => tp.lostTicks < 25);
  }

  function getClosestPlayer(world) {
    if (!world.players || world.players.length === 0) return null;
    const CX = 640, CY = 360;
    let closest = null, minDist = Infinity;
    for (const p of world.players) {
      const dist = Math.hypot(p.x - CX, p.y - CY);
      // Prefer players with tracking history (they're more stable detections)
      const tracked = trackedPlayers.find(t => Math.hypot(t.x - p.x, t.y - p.y) < 60);
      const score = tracked ? dist * 0.8 : dist * 1.2; // favor tracked
      if (score < minDist) {
        minDist = score;
        closest = { x: p.x, y: p.y, dist: dist, tracked: tracked || null };
      }
    }
    return closest;
  }

  // Predict where a player will be based on their velocity
  function predictPlayerPos(player) {
    if (!player || !player.tracked) return player;
    const t = player.tracked;
    if (t.age < 3) return { x: t.x, y: t.y }; // not enough data
    // Predict 5 ticks ahead
    return { x: t.x + t.vx * 3, y: t.y + t.vy * 3 };
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

      // ── 2.0: Update player tracking (all modes) ──
      updateTrackedPlayers(world.players || []);

      // ── 2.0: Progress check (wall detection) ──
      if (currentMoveDir && checkStuck()) {
        await recoverStuck();
        return;
      }

      // ── 2.0: Enhanced follow player mode ──
      if (CFG.followPlayer) {
        // Update cross-frame player tracking
        updateTrackedPlayers(world.players || []);

        const target = getClosestPlayer(world);
        if (target) {
          // Player found: reset lost counter, update position
          followTargetPos = { x: target.x, y: target.y };
          followTargetLost = 0;

          // Predict target's future position for smoother following
          const predicted = predictPlayerPos(target);
          if (predicted) {
            // Use predicted position for movement
            const pdx = predicted.x - CX;
            const pdy = predicted.y - CY;
            const pDist = Math.hypot(pdx, pdy);

            if (pDist > FOLLOW_TARGET_DIST) {
              // Far: move toward predicted position (not current)
              await moveToward(pdx, pdy);
            } else if (pDist > FOLLOW_MIN_DIST) {
              // Good distance: match target's movement direction
              // If target is moving, move same way to maintain formation
              if (target.tracked && target.tracked.age > 5) {
                const tvx = target.tracked.vx || 0;
                const tvy = target.tracked.vy || 0;
                const tSpeed = Math.hypot(tvx, tvy);
                if (tSpeed > 5) {
                  // Move in same direction as target (formation keeping)
                  await moveToward(pdx * 0.3 + tvx * 0.7, pdy * 0.3 + tvy * 0.7);
                } else {
                  await moveStop();
                }
              } else {
                await moveStop();
              }
            } else {
              // Too close: back off
              await moveAwayFrom(pdx, pdy);
            }
          }

          // Defend the player we're following: attack threats near them
          if (CFG.autoAttack && world.threats.length > 0) {
            // Find threats near the target player
            const nearbyThreats = world.threats.filter(t =>
              Math.hypot(t.x - target.x, t.y - target.y) < CFG.attackRange * 1.5
            );
            if (nearbyThreats.length > 0) {
              const nearestToTarget = nearbyThreats.sort((a, b) =>
                Math.hypot(a.x - target.x, a.y - target.y) -
                Math.hypot(b.x - target.x, b.y - target.y)
              )[0];
              const tDist = Math.hypot(nearestToTarget.x - CX, nearestToTarget.y - CY);
              if (tDist < CFG.attackRange) {
                await hold('Space');
              }
            }
          }

          exploreCount = 0;
          return;
        } else {
          // Player lost: use recovery strategy
          followTargetLost++;
          if (followTargetPos && followTargetLost < PLAYER_LOST_TIMEOUT) {
            // Move toward last known position
            const dx = followTargetPos.x - CX;
            const dy = followTargetPos.y - CY;
            const dist = Math.hypot(dx, dy);
            if (dist > 30) {
              await moveToward(dx, dy);
            } else {
              // Reached last known position but player not found: spiral search
              followSearchDir = (followSearchDir + 1) % 4;
              await moveRandom();
            }
          } else {
            // Lost for too long: clear target
            followTargetPos = null;
            // Fall through to normal behavior
          }
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
