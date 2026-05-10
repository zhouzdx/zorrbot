// Zorr Bot - Background Service Worker
// Manages chrome.debugger for sending trusted CDP events

let debuggerAttached = false;
let targetTabId = null;

// Attach debugger to a tab
async function attachDebugger(tabId) {
  if (debuggerAttached && targetTabId === tabId) return true;
  
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    debuggerAttached = true;
    targetTabId = tabId;
    console.log(`[Zorr Bot BG] Debugger attached to tab ${tabId}`);
    return true;
  } catch (e) {
    console.error(`[Zorr Bot BG] Failed to attach debugger: ${e.message}`);
    return false;
  }
}

// Detach debugger
async function detachDebugger() {
  if (!debuggerAttached || !targetTabId) return;
  try {
    await chrome.debugger.detach({ tabId: targetTabId });
  } catch (e) {
    // Ignore detach errors
  }
  debuggerAttached = false;
  targetTabId = null;
  console.log('[Zorr Bot BG] Debugger detached');
}

// Complete virtual key code map
const KEY_MAP = {
  // Movement
  'KeyW': { key: 'w', text: 'w', code: 'KeyW', windowsVirtualKeyCode: 0x57 },
  'KeyA': { key: 'a', text: 'a', code: 'KeyA', windowsVirtualKeyCode: 0x41 },
  'KeyS': { key: 's', text: 's', code: 'KeyS', windowsVirtualKeyCode: 0x53 },
  'KeyD': { key: 'd', text: 'd', code: 'KeyD', windowsVirtualKeyCode: 0x44 },
  // Digits
  'Digit0': { key: '0', text: '0', code: 'Digit0', windowsVirtualKeyCode: 0x30 },
  'Digit1': { key: '1', text: '1', code: 'Digit1', windowsVirtualKeyCode: 0x31 },
  'Digit2': { key: '2', text: '2', code: 'Digit2', windowsVirtualKeyCode: 0x32 },
  'Digit3': { key: '3', text: '3', code: 'Digit3', windowsVirtualKeyCode: 0x33 },
  'Digit4': { key: '4', text: '4', code: 'Digit4', windowsVirtualKeyCode: 0x34 },
  'Digit5': { key: '5', text: '5', code: 'Digit5', windowsVirtualKeyCode: 0x35 },
  'Digit6': { key: '6', text: '6', code: 'Digit6', windowsVirtualKeyCode: 0x36 },
  'Digit7': { key: '7', text: '7', code: 'Digit7', windowsVirtualKeyCode: 0x37 },
  'Digit8': { key: '8', text: '8', code: 'Digit8', windowsVirtualKeyCode: 0x38 },
  'Digit9': { key: '9', text: '9', code: 'Digit9', windowsVirtualKeyCode: 0x39 },
  // Special
  'Space': { key: ' ', text: ' ', code: 'Space', windowsVirtualKeyCode: 0x20 },
  'Enter': { key: 'Enter', text: '\r', code: 'Enter', windowsVirtualKeyCode: 0x0D },
  'ShiftLeft':  { key: 'Shift', text: undefined, code: 'ShiftLeft',  windowsVirtualKeyCode: 0xA0 },
  'ShiftRight': { key: 'Shift', text: undefined, code: 'ShiftRight', windowsVirtualKeyCode: 0xA1 },
  'ControlLeft':  { key: 'Control', text: undefined, code: 'ControlLeft',  windowsVirtualKeyCode: 0x11 },
  'ControlRight': { key: 'Control', text: undefined, code: 'ControlRight', windowsVirtualKeyCode: 0x12 },
  'Tab': { key: 'Tab', text: '\t', code: 'Tab', windowsVirtualKeyCode: 0x09 },
  'Escape': { key: 'Escape', text: undefined, code: 'Escape', windowsVirtualKeyCode: 0x1B },
  'Backspace': { key: 'Backspace', text: undefined, code: 'Backspace', windowsVirtualKeyCode: 0x08 },
  // Function keys
  'F1': { key: 'F1', text: undefined, code: 'F1', windowsVirtualKeyCode: 0x70 },
  'F2': { key: 'F2', text: undefined, code: 'F2', windowsVirtualKeyCode: 0x71 },
  'F3': { key: 'F3', text: undefined, code: 'F3', windowsVirtualKeyCode: 0x72 },
  'F4': { key: 'F4', text: undefined, code: 'F4', windowsVirtualKeyCode: 0x73 },
  'F5': { key: 'F5', text: undefined, code: 'F5', windowsVirtualKeyCode: 0x74 },
};

// Letters A-Z (not already in map)
for (let i = 0; i < 26; i++) {
  const ch = String.fromCharCode(0x41 + i);
  if (!KEY_MAP['Key' + ch]) {
    KEY_MAP['Key' + ch] = {
      key: ch.toLowerCase(),
      text: ch.toLowerCase(),
      code: 'Key' + ch,
      windowsVirtualKeyCode: 0x41 + i,
    };
  }
}

// Send trusted CDP keyboard event
async function sendKeyEvent(tabId, code, type, modifiers = 0) {
  const info = KEY_MAP[code];
  if (!info) {
    console.warn(`[Zorr Bot BG] Unknown key code: ${code}`);
    return;
  }

  const isKeyUp = type === 'keyup' || type === 'rawkeyup';

  try {
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
      type: isKeyUp ? 'keyUp' : 'rawKeyDown',
      modifiers: modifiers,
      windowsVirtualKeyCode: info.windowsVirtualKeyCode,
      code: info.code,
      key: info.key,
      text: !isKeyUp && info.text !== undefined ? info.text : undefined,
      unmodifiedText: !isKeyUp && info.text !== undefined ? info.text : undefined,
      isKeypad: false,
    });
  } catch (e) {
    console.error(`[Zorr Bot BG] Key event error: ${e.message}`);
  }
}

// Send trusted CDP mouse click at element position
async function clickElement(tabId, selector) {
  try {
    // Get element position via runtime evaluation
    const result = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: `(function(){
        const el = document.querySelector('${selector}');
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          width: rect.width,
          height: rect.height
        };
      })()`,
      returnByValue: true,
    });

    if (!result?.result?.value) {
      console.error(`[Zorr Bot BG] Element not found: ${selector}`);
      return false;
    }

    const { x, y } = result.result.value;

    // Send mouse events (pointerdown, mousedown, pointerup, mouseup, click)
    const clickTypes = [
      { type: 'mousePressed', button: 'left', x, y },
      { type: 'mouseReleased', button: 'left', x, y },
    ];

    for (const cmd of clickTypes) {
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
        type: cmd.type,
        button: cmd.button,
        x: Math.round(x),
        y: Math.round(y),
        clickCount: 1,
      });
    }

    console.log(`[Zorr Bot BG] Clicked element: ${selector} at (${Math.round(x)}, ${Math.round(y)})`);
    return true;
  } catch (e) {
    console.error(`[Zorr Bot BG] Click error: ${e.message}`);
    return false;
  }
}

// Type text via CDP using Input.insertText for efficiency
async function typeText(tabId, text) {
  try {
    // Focus the active element first
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: `document.activeElement?.focus()`,
    });
    // Insert text in one shot
    await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', {
      text: text,
    });
  } catch (e) {
    // Fallback: character-by-character
    console.warn(`[Zorr Bot BG] insertText failed, using fallback: ${e.message}`);
    for (const char of text) {
      const code = (char >= '0' && char <= '9') ? 'Digit' + char : 'Key' + char.toUpperCase();
      await sendKeyEvent(tabId, code, 'keydown');
      await sendKeyEvent(tabId, code, 'keyup');
    }
  }
}

// ── Message Handlers ──────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.source !== 'zorr-bot-bridge') return false;

  const tabId = sender.tab?.id;
  if (!tabId) {
    sendResponse({ error: 'No tab ID' });
    return false;
  }

  const handle = async () => {
    switch (msg.action) {
      case 'attach':
        const ok = await attachDebugger(tabId);
        sendResponse({ attached: ok });
        break;

      case 'detach':
        await detachDebugger();
        sendResponse({ detached: true });
        break;

      case 'click':
        await attachDebugger(tabId);
        const clicked = await clickElement(tabId, msg.selector);
        sendResponse({ clicked });
        break;

      case 'keyEvent':
        await attachDebugger(tabId);
        await sendKeyEvent(tabId, msg.code, msg.type);
        sendResponse({ sent: true });
        break;

      case 'typeText':
        await attachDebugger(tabId);
        await typeText(tabId, msg.text);
        sendResponse({ sent: true });
        break;

      case 'ping':
        sendResponse({ pong: debuggerAttached });
        break;

      default:
        sendResponse({ error: `Unknown action: ${msg.action}` });
    }
  };

  handle().catch(e => sendResponse({ error: e.message }));
  return true; // Keep channel open for async response
});

// Clean up on extension unload
chrome.runtime.onSuspend?.addListener(() => {
  detachDebugger();
});

console.log('[Zorr Bot BG] Service worker started');
