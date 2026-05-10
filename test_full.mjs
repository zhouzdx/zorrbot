import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const CHROME_PATH = 'C:\\Users\\zhouz\\AppData\\Local\\ms-playwright\\chromium-1224\\chrome-win64\\chrome.exe';

async function testFull() {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const interceptScript = readFileSync('zorr-bot-extension/intercept.js', 'utf-8');
  const contentScript = readFileSync('zorr-bot-extension/content.js', 'utf-8');

  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[Zorr Bot]') || text.includes('Connected') || text.includes('intercept')) {
      console.log(`[PAGE] ${text.slice(0, 150)}`);
    }
  });

  console.log('1. Navigating to zorr.pro...');
  await page.goto('https://zorr.pro', { waitUntil: 'networkidle', timeout: 60000 });

  // Inject intercept script BEFORE page scripts run
  // Since we navigate and wait for networkidle, the page scripts have already run.
  // To properly test, we'd need to inject at document_start. But for testing, we can
  // inject the intercept script first, then the content script.
  
  console.log('2. Injecting intercept script...');
  await page.evaluate(interceptScript);
  await page.waitForTimeout(500);

  // Check if handlers were captured
  const handlerCount = await page.evaluate(() => {
    return Object.fromEntries(
      Object.entries(window.__zorrBotHandlers || {}).map(([k, v]) => [k, v.length])
    );
  });
  console.log('3. Captured handlers:', JSON.stringify(handlerCount));

  // Try to start game via intercepted handlers
  console.log('4. Trying to start game via intercepted handlers...');
  const result = await page.evaluate(() => {
    // Fill nickname
    const input = document.querySelector('input.nickname-input');
    if (input) {
      input.focus();
      input.value = 'TestBot5000';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Press Enter via intercepted keyboard handler
    if (window.__zorrBotDispatchKey) {
      window.__zorrBotDispatchKey('Enter', 'keydown');
      window.__zorrBotDispatchKey('Enter', 'keyup');
    }

    return { inputValue: input?.value };
  });
  console.log('After Enter:', JSON.stringify(result));

  await page.waitForTimeout(3000);

  // Check state
  const state = await page.evaluate(() => {
    const menu = document.querySelector('.menu');
    const canvas = document.getElementById('canvas');
    let canvasActive = false;
    if (canvas) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        for (let x = 400; x < 880; x += 30) {
          for (let y = 200; y < 520; y += 30) {
            const d = ctx.getImageData(x, y, 1, 1).data;
            if (Math.abs(d[0] - 30) + Math.abs(d[1] - 167) + Math.abs(d[2] - 97) > 40) {
              canvasActive = true;
              break;
            }
          }
          if (canvasActive) break;
        }
      }
    }
    return {
      menuCSS: window.getComputedStyle(menu).display,
      canvasActive,
    };
  });
  console.log('5. State:', JSON.stringify(state));

  // If game still not started, also try clicking play button via intercepted mouse
  if (state.menuCSS !== 'none') {
    console.log('6. Menu still visible, trying click play...');
    await page.evaluate(() => {
      const btn = document.querySelector('.play-btn');
      if (btn && window.__zorrBotDispatchMouse) {
        window.__zorrBotDispatchMouse(btn, 'pointerdown');
        window.__zorrBotDispatchMouse(btn, 'mousedown');
        window.__zorrBotDispatchMouse(btn, 'mouseup');
        window.__zorrBotDispatchMouse(btn, 'click');
      }
    });
    await page.waitForTimeout(3000);

    const retryState = await page.evaluate(() => ({
      menuCSS: window.getComputedStyle(document.querySelector('.menu')).display,
    }));
    console.log('7. After click:', JSON.stringify(retryState));
  }

  // Try sending WASD via intercepted handlers  
  console.log('8. Testing WASD via intercept...');
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => {
      window.__zorrBotDispatchKey('KeyW', 'keydown');
    });
  }
  await page.evaluate(() => {
    window.__zorrBotDispatchKey('KeyW', 'keyup');
  });
  await page.waitForTimeout(500);

  // Try Space
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => {
      window.__zorrBotDispatchKey('Space', 'keydown');
      window.__zorrBotDispatchKey('Space', 'keyup');
    });
    await page.waitForTimeout(200);
  }

  await page.waitForTimeout(2000);

  // Try the full content script
  console.log('9. Injecting full content script...');
  await page.evaluate(contentScript);
  await page.waitForTimeout(2000);

  // Start the bot
  await page.evaluate(() => {
    window.postMessage({ source: 'zorr-bot-popup', action: 'start' }, '*');
  });
  console.log('10. Bot started, waiting 8s...');
  await page.waitForTimeout(8000);

  await page.screenshot({ path: 'screenshots/test_full.png' });
  console.log('11. Done!');

  await browser.close();
}

testFull().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
