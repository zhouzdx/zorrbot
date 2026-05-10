import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const CHROME_PATH = 'C:\\Users\\zhouz\\AppData\\Local\\ms-playwright\\chromium-1224\\chrome-win64\\chrome.exe';

async function testExtension() {
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  // Load the content script code
  const contentScript = readFileSync('zorr-bot-extension/content.js', 'utf-8');

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  // Collect console messages
  page.on('console', msg => {
    if (msg.text().includes('[Zorr Bot]') || msg.type() === 'error') {
      console.log(`[PAGE ${msg.type()}] ${msg.text()}`);
    }
  });

  console.log('1. Navigating to zorr.pro...');
  await page.goto('https://zorr.pro', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);

  console.log('2. Injecting bot content script...');
  await page.evaluate(contentScript);

  await page.waitForTimeout(3000);
  console.log('3. Content script loaded and auto-started.');

  // Check the game state
  const state = await page.evaluate(() => {
    const canvas = document.getElementById('canvas');
    if (!canvas) return { error: 'No canvas found' };

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { error: 'No 2D context' };

    // Sample various regions
    const samples = {
      topLeft: [...ctx.getImageData(10, 10, 1, 1).data],
      center: [...ctx.getImageData(640, 360, 1, 1).data],
      bottomRight: [...ctx.getImageData(1270, 710, 1, 1).data],
      topRightCorner: [...ctx.getImageData(1200, 10, 1, 1).data],
    };

    // Check DOM state
    const deathEl = document.querySelector('.death');
    const petalsEl = document.querySelector('.petals-collected');
    const dialog = document.querySelector('.dialog');

    return {
      canvasSize: { w: canvas.width, h: canvas.height },
      pixels: samples,
      domElements: {
        hasDeath: !!deathEl,
        deathDisplay: deathEl?.style.display,
        hasPetals: !!petalsEl,
        hasDialog: !!dialog,
        dialogClass: dialog?.className,
      },
      focus: document.activeElement?.id || document.activeElement?.tagName,
    };
  });

  console.log('\n4. Game State:');
  console.log(JSON.stringify(state, null, 2));

  // Wait longer for game to load
  await page.waitForTimeout(5000);

  const state2 = await page.evaluate(() => {
    const canvas = document.getElementById('canvas');
    if (!canvas) return { error: 'No canvas' };
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { error: 'No context' };

    // Check if canvas content is changing (game is running)
    const mid1 = [...ctx.getImageData(640, 360, 1, 1).data];
    const mid2 = [...ctx.getImageData(600, 300, 1, 1).data];
    const mid3 = [...ctx.getImageData(700, 400, 1, 1).data];

    // Check for non-green pixels (game elements)
    const bgR = 30, bgG = 167, bgB = 97;
    const nonBg = [];
    for (let x = 300; x < 980; x += 20) {
      for (let y = 100; y < 620; y += 20) {
        const d = ctx.getImageData(x, y, 1, 1).data;
        const diff = Math.abs(d[0] - bgR) + Math.abs(d[1] - bgG) + Math.abs(d[2] - bgB);
        if (diff > 40 && d[3] > 100) {
          nonBg.push({ x, y, r: d[0], g: d[1], b: d[2] });
        }
      }
    }

    return {
      centerSamples: [mid1, mid2, mid3],
      nonBgElements: nonBg.slice(0, 20),
      nonBgCount: nonBg.length,
    };
  });

  console.log('\n5. Canvas Analysis (after waiting):');
  console.log(JSON.stringify(state2, null, 2));

  await page.screenshot({ path: 'screenshots/test_extension.png' });
  console.log('\n6. Screenshot saved.');

  await browser.close();
  console.log('\nDone!');
}

testExtension().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
