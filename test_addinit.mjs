import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const CHROME_PATH = 'C:\\Users\\zhouz\\AppData\\Local\\ms-playwright\\chromium-1224\\chrome-win64\\chrome.exe';

async function testInit() {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });

  const interceptScript = readFileSync('zorr-bot-extension/intercept.js', 'utf-8');

  // Create a new context and add init script BEFORE navigation
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  
  // Add init script that runs before any page script
  await context.addInitScript(interceptScript);

  const page = await context.newPage();

  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[Zorr Bot]') || text.includes('Connected') || text.includes('intercept')) {
      console.log(`[PAGE] ${text.slice(0, 150)}`);
    }
  });

  console.log('1. Navigating to zorr.pro with interceptor pre-loaded...');
  await page.goto('https://zorr.pro', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);

  // Check captured handlers
  const handlerCount = await page.evaluate(() => {
    return Object.fromEntries(
      Object.entries(window.__zorrBotHandlers || {}).map(([k, v]) => [k, v.length])
    );
  });
  console.log('2. Captured handlers:', JSON.stringify(handlerCount));

  // Check individual handler targets
  const handlerDetails = await page.evaluate(() => {
    const details = {};
    for (const [type, handlers] of Object.entries(window.__zorrBotHandlers)) {
      if (handlers.length > 0) {
        details[type] = handlers.map(h => ({
          target: h.target ? (h.target.id || h.target.tagName || h.target.className || 'unknown') : 'null',
        }));
      }
    }
    return details;
  });
  console.log('3. Handler details:', JSON.stringify(handlerDetails, null, 2));

  // Check if the game has an isTrusted check by examining the keyDown handler
  const trustCheck = await page.evaluate(() => {
    const handlers = window.__zorrBotHandlers.keydown;
    if (handlers.length > 0) {
      const fnStr = handlers[0].handler.toString();
      return {
        hasTrustedCheck: fnStr.includes('isTrusted'),
        snippet: fnStr.slice(0, 300),
        length: fnStr.length,
      };
    }
    return null;
  });
  if (trustCheck) {
    console.log('4. Key handler analysis:');
    console.log(JSON.stringify(trustCheck, null, 2));
  }

  // Try starting game via intercepted Enter key
  console.log('\n5. Trying to start game...');
  await page.evaluate(() => {
    const input = document.querySelector('input.nickname-input');
    if (input) {
      input.focus();
      input.value = 'ProBot999';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // Type letters
    if (window.__zorrBotDispatchKey) {
      window.__zorrBotDispatchKey('KeyP', 'keydown');
      window.__zorrBotDispatchKey('KeyP', 'keyup');
      window.__zorrBotDispatchKey('Keyr', 'keydown');
      window.__zorrBotDispatchKey('Keyr', 'keyup');
      window.__zorrBotDispatchKey('Keyo', 'keydown');
      window.__zorrBotDispatchKey('Keyo', 'keyup');
    }
    // Press Enter
    window.__zorrBotDispatchKey('Enter', 'keydown');
    window.__zorrBotDispatchKey('Enter', 'keyup');
  });
  await page.waitForTimeout(3000);

  // Check state
  let state = await page.evaluate(() => {
    const menu = document.querySelector('.menu');
    return {
      menuCSS: window.getComputedStyle(menu).display,
      menuDisp: menu.style.display,
    };
  });
  console.log('6. After Enter:', JSON.stringify(state));

  // If still blocked, try clicking play button
  if (state.menuCSS !== 'none') {
    console.log('7. Trying play button click via intercept...');
    await page.evaluate(() => {
      const btn = document.querySelector('.play-btn');
      if (btn && window.__zorrBotDispatchMouse) {
        window.__zorrBotDispatchMouse(btn, 'mousedown');
        window.__zorrBotDispatchMouse(btn, 'mouseup');
        window.__zorrBotDispatchMouse(btn, 'click');
        window.__zorrBotDispatchMouse(btn, 'pointerdown');
        window.__zorrBotDispatchMouse(btn, 'pointerup');
      }
    });
    await page.waitForTimeout(3000);

    state = await page.evaluate(() => ({
      menuCSS: window.getComputedStyle(document.querySelector('.menu')).display,
    }));
    console.log('8. After click:', JSON.stringify(state));
  }

  // If still blocked, try Playwright click (CDP trusted) for comparison
  if (state.menuCSS !== 'none') {
    console.log('9. Fallback: Clicking play with Playwright (CDP)...');
    const btn = await page.$('.play-btn');
    if (btn) await btn.click();
    await page.waitForTimeout(3000);

    state = await page.evaluate(() => ({
      menuCSS: window.getComputedStyle(document.querySelector('.menu')).display,
    }));
    console.log('10. After CDP click:', JSON.stringify(state));
  }

  await browser.close();
}

testInit().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
