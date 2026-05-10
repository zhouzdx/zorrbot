import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const CHROME_PATH = 'C:\\Users\\zhouz\\AppData\\Local\\ms-playwright\\chromium-1224\\chrome-win64\\chrome.exe';

async function test() {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

  const interceptScript = readFileSync('zorr-bot-extension/intercept.js', 'utf-8');
  const contentScript = readFileSync('zorr-bot-extension/content.js', 'utf-8');

  // Load interceptor at page creation (before navigation)
  await context.addInitScript(interceptScript);

  const page = await context.newPage();

  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('Connected') || text.includes('[Zorr Bot]')) {
      console.log(`[PAGE] ${text.slice(0, 150)}`);
    }
  });

  await page.goto('https://zorr.pro', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);

  // Inject the dispatchKey and dispatchMouse functions into the page context
  // Since they're defined inside intercept.js IIFE, we need to expose them
  // Let's test by adding the dispatch calls directly in page.evaluate but using
  // the actual stored handlers (not via serialization)

  // Check handler count first
  const handlerCount = await page.evaluate(() => ({
    keydown: window.__zorrBotHandlers?.keydown?.length || 0,
    keyup: window.__zorrBotHandlers?.keyup?.length || 0,
    mousedown: window.__zorrBotHandlers?.mousedown?.length || 0,
  }));
  console.log('Handler count:', JSON.stringify(handlerCount));

  // Test: Use addInitScript to also inject a test function that can access
  // the handlers in their original closure scope
  await context.addInitScript(() => {
    // Monkey-patch the handlers to log what they receive
    // Wait for the intercept to capture handlers, then test
    const origPush = Array.prototype.push;
    Array.prototype.push = function(...args) {
      // Check if this is a __zorrBotHandlers array
      if (this === window.__zorrBotHandlers?.keydown) {
        const entry = args[0];
        if (entry?.handler) {
          const origHandler = entry.handler;
          entry.handler = function(t) {
            // Log what the handler received before executing
            try {
              const O5available = typeof O5 !== 'undefined';
              console.log(`[Intercept Test] keydown handler called with code=${t?.code} O5=${O5available} target=${t?.target?.tagName || t?.target?.id || 'unknown'}`);
            } catch(e) {}
            return origHandler.call(this, t);
          };
        }
      }
      return origPush.apply(this, args);
    };
  });

  // Reload the page with the test instrumentation
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);

  // Now test keyboard dispatching via the stored handlers
  console.log('\nTesting key dispatch via intercept handler (in page context)...');
  
  // This time we define the dispatch function in the page and call it
  await page.evaluate(() => {
    // Manually call the Enter key via the captured handlers
    const keydownHandlers = window.__zorrBotHandlers?.keydown || [];
    console.log(`[Test] Calling ${keydownHandlers.length} keydown handlers with Enter`);

    const mockEvent = {
      type: 'keydown',
      code: 'Enter',
      key: 'Enter',
      keyCode: 13,
      which: 13,
      target: document.body,
      currentTarget: document.body,
      preventDefault: () => {},
      stopPropagation: () => {},
      bubbles: true,
      cancelable: true,
      timeStamp: Date.now(),
    };

    keydownHandlers.forEach((entry, i) => {
      try {
        entry.handler.call(entry.target, mockEvent);
        console.log(`[Test] Handler ${i} executed OK`);
      } catch(e) {
        console.log(`[Test] Handler ${i} error: ${e.message?.slice(0, 100)}`);
      }
    });
  });

  await page.waitForTimeout(2000);

  // Check if anything changed
  const state = await page.evaluate(() => {
    const menu = document.querySelector('.menu');
    return {
      menuCSS: window.getComputedStyle(menu).display,
      canvasActive: (() => {
        const cv = document.getElementById('canvas');
        if (!cv) return false;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        if (!ctx) return false;
        for (let x = 400; x < 880; x += 40) {
          for (let y = 200; y < 520; y += 40) {
            const d = ctx.getImageData(x, y, 1, 1).data;
            if (Math.abs(d[0] - 30) + Math.abs(d[1] - 167) + Math.abs(d[2] - 97) > 40) return true;
          }
        }
        return false;
      })(),
    };
  });
  console.log('\nState after Enter dispatch:', JSON.stringify(state));

  // Also test mouse dispatch on play button
  if (state.menuCSS !== 'none') {
    console.log('\nTrying play button click...');
    await page.evaluate(() => {
      const btn = document.querySelector('.play-btn');
      if (!btn) return;

      const mouseHandlers = window.__zorrBotHandlers?.mousedown || [];
      const clickHandlers = window.__zorrBotHandlers?.click || [];
      const rect = btn.getBoundingClientRect();

      console.log(`[Test] Play button at (${rect.left}, ${rect.top}, ${rect.width}x${rect.height})`);
      console.log(`[Test] ${mouseHandlers.length} mousedown, ${clickHandlers.length} click handlers`);

      const mockMouse = {
        type: 'mousedown',
        target: btn,
        currentTarget: btn,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        button: 0,
        buttons: 1,
        preventDefault: () => {},
        stopPropagation: () => {},
        bubbles: true,
        cancelable: true,
        timeStamp: Date.now(),
      };

      mouseHandlers.forEach((entry, i) => {
        try {
          entry.handler.call(entry.target, { ...mockMouse });
          console.log(`[Test] Mouse handler ${i} OK`);
        } catch(e) {
          console.log(`[Test] Mouse handler ${i} error: ${e.message?.slice(0, 100)}`);
        }
      });
    });

    await page.waitForTimeout(2000);

    const state2 = await page.evaluate(() => ({
      menuCSS: window.getComputedStyle(document.querySelector('.menu')).display,
    }));
    console.log('After click:', JSON.stringify(state2));
  }

  await browser.close();
}

test().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
