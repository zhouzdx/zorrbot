// Zorr Bot 3.0 - Reinforcement Learning Engine
// Q-Learning with epsilon-greedy exploration
// Injects into MAIN world, used by content.js

(function () {
  'use strict';

  // ── RL Configuration ──────────────────────────────
  const RL_CFG = {
    alpha: 0.15,        // learning rate
    gamma: 0.9,         // discount factor
    epsilon: 0.4,       // exploration rate (decays)
    epsilonMin: 0.05,
    epsilonDecay: 0.9995,
    storageKey: 'zorr_rl_qtable',
    statsKey: 'zorr_rl_stats',
  };

  // ── Actions ──────────────────────────────────────
  // The bot can choose one primary action per tick
  const ACTIONS = [
    'MOVE_N', 'MOVE_S', 'MOVE_E', 'MOVE_W',   // movement
    'ATTACK_N', 'ATTACK_S', 'ATTACK_E', 'ATTACK_W', // attack + direction
    'FLEE',        // run away from nearest threat
    'STOP',        // stay still
    'COLLECT',     // move toward nearest loot
    'RANDOM',      // random explore
  ];
  const N_ACTIONS = ACTIONS.length;

  // ── State discretization ─────────────────────────
  // Convert continuous game observations into a discrete state key
  // State components (each discretized into buckets):
  //   [threatDist, threatCount, lootNear, isStuck, biome]
  function discretizeState(world) {
    if (!world) return 'NO_WORLD';

    const threatDist = world.threats.length > 0 ? world.threats[0].dist : 999;
    const threatCount = Math.min(world.threats.length, 3); // 0,1,2,3+
    const lootNear = world.loot.length > 0 ? 1 : 0;
    const stuck = (typeof window.__zorrStuck !== 'undefined' && window.__zorrStuck) ? 1 : 0;

    // Threat distance buckets
    let tdBucket;
    if (threatDist < 80) tdBucket = 0;      // very close
    else if (threatDist < 200) tdBucket = 1; // close
    else if (threatDist < 400) tdBucket = 2; // medium
    else tdBucket = 3;                        // far or none

    // Combined state key
    return `T${tdBucket}_C${threatCount}_L${lootNear}_S${stuck}`;
  }

  // ── Q-Table ──────────────────────────────────────
  let Q = {}; // { stateKey: [qValues for each action] }

  function getQ(state) {
    if (!Q[state]) {
      Q[state] = new Float64Array(N_ACTIONS);
      // Slight positive bias for MOVE actions to encourage exploration
      Q[state][ACTIONS.indexOf('MOVE_N')] = 0.1;
      Q[state][ACTIONS.indexOf('MOVE_S')] = 0.1;
      Q[state][ACTIONS.indexOf('MOVE_E')] = 0.1;
      Q[state][ACTIONS.indexOf('MOVE_W')] = 0.1;
    }
    return Q[state];
  }

  // ── Action selection (epsilon-greedy) ────────────
  function selectAction(state) {
    const q = getQ(state);
    if (Math.random() < RL_CFG.epsilon) {
      // Explore: pick random action
      return Math.floor(Math.random() * N_ACTIONS);
    } else {
      // Exploit: pick best action
      let bestIdx = 0;
      let bestVal = q[0];
      for (let i = 1; i < N_ACTIONS; i++) {
        if (q[i] > bestVal) { bestVal = q[i]; bestIdx = i; }
      }
      return bestIdx;
    }
  }

  // ── Learning ─────────────────────────────────────
  function learn(state, action, reward, nextState) {
    const q = getQ(state);
    const nextQ = getQ(nextState);
    // Find max Q for next state
    let maxNext = nextQ[0];
    for (let i = 1; i < N_ACTIONS; i++) {
      if (nextQ[i] > maxNext) maxNext = nextQ[i];
    }
    // Q-learning update: Q(s,a) += alpha * (reward + gamma * max(Q(s')) - Q(s,a))
    const td = reward + RL_CFG.gamma * maxNext - q[action];
    q[action] += RL_CFG.alpha * td;

    // Decay epsilon
    if (RL_CFG.epsilon > RL_CFG.epsilonMin) {
      RL_CFG.epsilon *= RL_CFG.epsilonDecay;
    }
  }

  // ── Convert action index to bot commands ─────────
  function actionToCommands(actionIdx, world) {
    const action = ACTIONS[actionIdx];
    // Returns: { moveX, moveY, attack, space }
    const cmd = { moveX: 0, moveY: 0, attack: false, space: false };

    switch (action) {
      case 'MOVE_N': cmd.moveY = -1; break;
      case 'MOVE_S': cmd.moveY = 1; break;
      case 'MOVE_E': cmd.moveX = 1; break;
      case 'MOVE_W': cmd.moveX = -1; break;
      case 'ATTACK_N': cmd.moveY = -1; cmd.attack = true; cmd.space = true; break;
      case 'ATTACK_S': cmd.moveY = 1; cmd.attack = true; cmd.space = true; break;
      case 'ATTACK_E': cmd.moveX = 1; cmd.attack = true; cmd.space = true; break;
      case 'ATTACK_W': cmd.moveX = -1; cmd.attack = true; cmd.space = true; break;
      case 'FLEE':
        if (world && world.threats.length > 0) {
          const t = world.threats[0];
          const dx = t.x - 640, dy = t.y - 360;
          const len = Math.hypot(dx, dy) || 1;
          cmd.moveX = -dx / len;
          cmd.moveY = -dy / len;
        } else {
          cmd.moveY = -1; // default flee north
        }
        break;
      case 'STOP': break; // no movement
      case 'COLLECT':
        if (world && world.loot.length > 0) {
          const l = world.loot[0];
          const dx = l.x - 640, dy = l.y - 360;
          const len = Math.hypot(dx, dy) || 1;
          cmd.moveX = dx / len;
          cmd.moveY = dy / len;
        } else {
          cmd.moveX = 1; // default move east
        }
        break;
      case 'RANDOM':
        const dirs = [[0,-1],[1,0],[0,1],[-1,0]];
        const d = dirs[Math.floor(Math.random() * 4)];
        cmd.moveX = d[0]; cmd.moveY = d[1];
        break;
    }
    return cmd;
  }

  // ── Reward calculation ──────────────────────────
  // Reward is computed from tick delta:
  //   +1 per tick alive (survival)
  //   +5 loot collected (when loot count decreases)
  //   +10 threat killed (when threat disappears)
  //   -10 damage taken (estimated from visual changes)
  //   -50 death
  //   -2 stuck against wall

  let prevLootCount = 0;
  let prevThreatCount = 0;
  let prevAlive = true;

  function calculateReward(world, died, stuck) {
    let reward = 0;

    // Survival reward (per tick)
    if (world) reward += 0.5;

    // Death penalty
    if (died) { reward -= 50; prevAlive = false; return reward; }
    if (!prevAlive && !died) { prevAlive = true; reward += 10; } // respawn bonus

    // Loot collected
    const currentLoot = world ? world.loot.length : 0;
    if (currentLoot < prevLootCount) {
      reward += 5 * (prevLootCount - currentLoot);
    }
    prevLootCount = currentLoot;

    // Threat killed
    const currentThreats = world ? world.threats.length : 0;
    if (currentThreats < prevThreatCount) {
      reward += 10 * (prevThreatCount - currentThreats);
    }
    prevThreatCount = currentThreats;

    // Stuck penalty
    if (stuck) reward -= 2;

    // Encourage engaging threats (being near them is good for XP)
    if (world && world.threats.length > 0) {
      const nearest = world.threats[0];
      if (nearest.dist < 200) reward += 1; // near a threat = fighting = good
    }

    // Clamp
    return Math.max(-50, Math.min(50, reward));
  }

  // ── Persistence ────────────────────────────────
  function saveModel() {
    try {
      const data = {};
      for (const [state, qvals] of Object.entries(Q)) {
        data[state] = Array.from(qvals);
      }
      localStorage.setItem(RL_CFG.storageKey, JSON.stringify(data));
      localStorage.setItem(RL_CFG.statsKey, JSON.stringify({
        epsilon: RL_CFG.epsilon,
        states: Object.keys(Q).length,
        updated: Date.now(),
      }));
    } catch (e) { /* storage full or unavailable */ }
  }

  function loadModel() {
    try {
      const raw = localStorage.getItem(RL_CFG.storageKey);
      if (raw) {
        const data = JSON.parse(raw);
        for (const [state, qvals] of Object.entries(data)) {
          Q[state] = new Float64Array(qvals);
        }
      }
      const statsRaw = localStorage.getItem(RL_CFG.statsKey);
      if (statsRaw) {
        const stats = JSON.parse(statsRaw);
        if (stats.epsilon) RL_CFG.epsilon = stats.epsilon;
      }
    } catch (e) { /* ignore */ }
  }

  // ── Demonstration Learning (Imitation) ──────────
  // Records (state, action) from user playing, trains Q-table.
  let demoBuffer = [];           // [{state, action, reward}...]
  let isLearning = false;        // set true to record user actions
  let lastUserKey = null;        // last WASD key pressed
  let userHoldingSpace = false;  // whether user is holding space

  // Map DOM key codes to RL actions
  function keyToAction(key) {
    if (key === 'KeyW' || key === 'ArrowUp') return 'MOVE_N';
    if (key === 'KeyS' || key === 'ArrowDown') return 'MOVE_S';
    if (key === 'KeyA' || key === 'ArrowLeft') return 'MOVE_W';
    if (key === 'KeyD' || key === 'ArrowRight') return 'MOVE_E';
    return null;
  }

  // Install keyboard capture for imitation learning
  function installLearningCapture() {
    if (isLearning) return;
    isLearning = true;
    lastUserKey = null;
    userHoldingSpace = false;

    document.addEventListener('keydown', function (e) {
      if (!isLearning) return;
      const action = keyToAction(e.code);
      if (action) {
        lastUserKey = e.code;
      }
      if (e.code === 'Space') {
        userHoldingSpace = true;
      }
    }, true); // capture phase

    document.addEventListener('keyup', function (e) {
      if (!isLearning) return;
      if (keyToAction(e.code)) {
        // Key released - record STOP if no movement keys held
        // We'll record on the next poll instead
      }
      if (e.code === 'Space') {
        userHoldingSpace = false;
      }
    }, true);

    console.log('[Zorr RL] Learning capture installed');
  }

  // Called every tick during learning mode to record user's action
  function recordUserAction(world) {
    if (!isLearning) return null;
    const state = discretizeState(world);

    // Determine the RL action from current keyboard state
    let actionIdx;
    if (lastUserKey) {
      const actionName = keyToAction(lastUserKey);
      if (actionName) {
        if (userHoldingSpace) {
          // Space + direction = ATTACK_*
          if (actionName === 'MOVE_N') actionIdx = ACTIONS.indexOf('ATTACK_N');
          else if (actionName === 'MOVE_S') actionIdx = ACTIONS.indexOf('ATTACK_S');
          else if (actionName === 'MOVE_E') actionIdx = ACTIONS.indexOf('ATTACK_E');
          else if (actionName === 'MOVE_W') actionIdx = ACTIONS.indexOf('ATTACK_W');
        } else {
          actionIdx = ACTIONS.indexOf(actionName);
        }
      }
    } else if (userHoldingSpace) {
      // Just Space, no direction = STOP + attack
      actionIdx = ACTIONS.indexOf('STOP');
    }

    if (actionIdx === undefined || actionIdx < 0) {
      actionIdx = ACTIONS.indexOf('STOP');
    }

    // Store demonstration
    demoBuffer.push({ state, action: actionIdx });
    if (demoBuffer.length > 5000) demoBuffer.shift(); // limit buffer

    // Train Q-table from recent demonstrations (imitation learning)
    // For each demo, slightly increase Q(state, action) = positive reward
    // This is behavioral cloning: Q(s,a) += alpha * (imitationReward - Q(s,a))
    const demoReward = 3.0; // positive reward for matching human action
    for (const demo of demoBuffer.slice(-10)) { // use last 10 demos
      const q = getQ(demo.state);
      q[demo.action] += RL_CFG.alpha * (demoReward - q[demo.action]);
    }

    return actionIdx;
  }

  // ── Public API ──────────────────────────────────
  window.__ZORR_RL = {
    CFG: RL_CFG,
    ACTIONS: ACTIONS,
    discretizeState,
    selectAction,
    learn,
    actionToCommands,
    calculateReward,
    saveModel,
    loadModel,
    getQTable: () => Q,
    getStats: () => ({
      epsilon: RL_CFG.epsilon,
      states: Object.keys(Q).length,
      demos: demoBuffer.length,
      learning: isLearning,
      actions: N_ACTIONS,
    }),
    resetEpsilon: () => { RL_CFG.epsilon = 0.4; },
    // Demonstration learning API
    isLearning: () => isLearning,
    startLearning: () => {
      installLearningCapture();
      demoBuffer = [];
      console.log('[Zorr RL] Learning mode STARTED');
    },
    stopLearning: () => {
      isLearning = false;
      lastUserKey = null;
      userHoldingSpace = false;
      saveModel();
      console.log('[Zorr RL] Learning mode STOPPED. Demos:', demoBuffer.length, 'States:', Object.keys(Q).length);
    },
    recordUserAction,
    getDemoCount: () => demoBuffer.length,
    clearDemos: () => { demoBuffer = []; },
  };

  // Load saved model on startup
  loadModel();

  // Auto-save every 30 seconds
  setInterval(saveModel, 30000);

  // Expose stuck state for RL
  let stuckState = false;
  Object.defineProperty(window, '__zorrStuck', {
    get: () => stuckState,
    set: (v) => { stuckState = v; },
  });

  console.log('[Zorr RL] Engine loaded. States:', Object.keys(Q).length, 'Epsilon:', RL_CFG.epsilon.toFixed(3));
})();
