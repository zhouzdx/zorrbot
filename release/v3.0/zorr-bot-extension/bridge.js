// Zorr Bot - Bridge (ISOLATED world)
// Routes messages between:
//   - Popup ↔ Background (via chrome.runtime)
//   - Content script (MAIN) ↔ Background (via window.postMessage)

(function () {
  'use strict';

  // ── Popup ↔ Bridge: Forward to Content ──
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Messages from popup
    if (message.source === 'zorr-bot-popup') {
      // Forward to MAIN world content script
      window.postMessage({
        source: 'zorr-bot-popup',
        action: message.action,
        value: message.value,
      }, '*');

      // Wait for response from content script with 8s timeout
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        sendResponse({ error: 'timeout' });
      }, 8000);

      const handler = (event) => {
        if (event.source !== window) return;
        if (event.data?.source !== 'zorr-bot-content') return;
        if (timedOut) return;
        clearTimeout(timer);
        window.removeEventListener('message', handler);
        sendResponse(event.data);
      };
      window.addEventListener('message', handler);
      return true; // Keep channel open
    }
  });

  // ── Content (MAIN) ↔ Bridge: Forward to Background ──
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== 'zorr-bot-content') return;

    // Requests that need background (debugger) service
    if (msg.target === 'background') {
      msg.source = 'zorr-bot-bridge';
      chrome.runtime.sendMessage(msg, (response) => {
        // Forward response back to content script
        window.postMessage({
          source: 'zorr-bot-bridge',
          action: msg.action + 'Response',
          value: response,
          requestId: msg.requestId,
        }, '*');
      });
    }

    // Status broadcasts to popup
    if (msg.action === 'status' || msg.action === 'log') {
      chrome.runtime.sendMessage(msg).catch(() => {});
    }
  });

  // ── Background ↔ Bridge: Forward to Content ──
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Background responses for content script
    if (msg.source === 'zorr-bot-bridge' && msg.action?.endsWith('Response')) {
      window.postMessage(msg, '*');
    }
  });

  console.log('[Zorr Bot Bridge] Initialized');
})();
