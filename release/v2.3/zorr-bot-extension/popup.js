// Zorr Bot Popup Controller

let isRunning = false;

// DOM refs
const statusIndicator = document.getElementById('statusIndicator');
const statusText = document.getElementById('statusText');
const toggleBtn = document.getElementById('toggleBtn');
const logArea = document.getElementById('logArea');
const biomeArea = document.getElementById('biomeArea');
const autoAttack = document.getElementById('autoAttack');
const autoCollect = document.getElementById('autoCollect');
const avoidDamage = document.getElementById('avoidDamage');
const followPlayer = document.getElementById('followPlayer');
const followTarget = document.getElementById('followTarget');
const followStatus = document.getElementById('followStatus');
const attackRange = document.getElementById('attackRange');
const farmRadius = document.getElementById('farmRadius');
const attackRangeValue = document.getElementById('attackRangeValue');
const farmRadiusValue = document.getElementById('farmRadiusValue');

const STORAGE_KEY = 'zorr_bot_settings';

function log(msg) {
  logArea.textContent = msg;
}

function updateBiome(biome) {
  if (biomeArea && biome) {
    biomeArea.textContent = '区域: ' + biome;
  }
}

function updateUI(enabled) {
  isRunning = enabled;
  if (enabled) {
    statusIndicator.classList.add('active');
    statusText.textContent = '运行中';
    toggleBtn.textContent = '停止挂机';
    toggleBtn.className = 'btn btn-stop';
  } else {
    statusIndicator.classList.remove('active');
    statusText.textContent = '已停止';
    toggleBtn.textContent = '启动挂机';
    toggleBtn.className = 'btn btn-start';
  }
}

// ── Settings persistence ─────────────────────────────
function saveSettings() {
  const settings = {
    autoAttack: autoAttack.checked,
    autoCollect: autoCollect.checked,
    avoidDamage: avoidDamage.checked,
    followPlayer: followPlayer.checked,
    followTarget: followTarget.value || '',
    attackRange: parseInt(attackRange.value),
    farmRadius: parseInt(farmRadius.value),
  };
  chrome.storage.local.set({ [STORAGE_KEY]: settings }).catch(() => {});
}

function restoreSettings() {
  chrome.storage.local.get(STORAGE_KEY).then((result) => {
    const s = result[STORAGE_KEY];
    if (!s) return;
    autoAttack.checked = s.autoAttack !== undefined ? s.autoAttack : true;
    autoCollect.checked = s.autoCollect !== undefined ? s.autoCollect : true;
    avoidDamage.checked = s.avoidDamage !== undefined ? s.avoidDamage : true;
    followPlayer.checked = s.followPlayer === true;
    followTarget.value = s.followTarget || '';
    attackRange.value = s.attackRange || 150;
    farmRadius.value = s.farmRadius || 300;
    attackRangeValue.textContent = attackRange.value;
    farmRadiusValue.textContent = farmRadius.value;
  }).catch(() => {});
}

function sendToContent(action, value) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.url?.includes('zorr.pro')) {
      log('Open zorr.pro in the active tab');
      return;
    }
    chrome.tabs.sendMessage(tab.id, {
      source: 'zorr-bot-popup', action, value,
    });
  });
}

// Listen for responses from content script (forwarded by bridge.js)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.source === 'zorr-bot-content') {
    if (msg.action === 'status') {
      updateUI(msg.value.enabled);
    } else if (msg.action === 'log') {
      log(msg.value);
    } else if (msg.action === 'biome') {
      updateBiome(msg.value);
    } else if (msg.action === 'followStatus') {
      if (followStatus) {
        followStatus.textContent = msg.value;
        followStatus.style.display = 'block';
      }
    }
  }
});

// Toggle bot
toggleBtn.addEventListener('click', () => {
  sendToContent(isRunning ? 'stop' : 'start');
});

// Settings (save + sync on change)
autoAttack.addEventListener('change', () => {
  saveSettings();
  sendToContent('updateSettings', { autoAttack: autoAttack.checked });
});
autoCollect.addEventListener('change', () => {
  saveSettings();
  sendToContent('updateSettings', { autoCollect: autoCollect.checked });
});
avoidDamage.addEventListener('change', () => {
  saveSettings();
  sendToContent('updateSettings', { avoidDamage: avoidDamage.checked });
});
attackRange.addEventListener('input', () => {
  attackRangeValue.textContent = attackRange.value;
  saveSettings();
  sendToContent('updateSettings', { attackRange: parseInt(attackRange.value) });
});
farmRadius.addEventListener('input', () => {
  farmRadiusValue.textContent = farmRadius.value;
  saveSettings();
  sendToContent('updateSettings', { farmRadius: parseInt(farmRadius.value) });
});

// Follow player controls
followPlayer.addEventListener('change', () => {
  saveSettings();
  sendToContent('updateSettings', {
    followPlayer: followPlayer.checked,
    followTarget: followTarget.value || null,
  });
});
followTarget.addEventListener('change', () => {
  saveSettings();
  sendToContent('updateSettings', {
    followPlayer: followPlayer.checked,
    followTarget: followTarget.value || null,
  });
});

// Initialize
restoreSettings();
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  if (tab?.url?.includes('zorr.pro')) {
    sendToContent('getStatus');
  } else {
    log('请在 zorr.pro 页面使用此扩展');
  }
});
