import { chromium } from 'playwright';

const CHROME_PATH = 'C:\\Users\\zhouz\\AppData\\Local\\ms-playwright\\chromium-1224\\chrome-win64\\chrome.exe';

async function test() {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  await page.goto('https://zorr.pro', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);

  // Start game via Playwright CDP (works)
  await page.evaluate(() => {
    const input = document.querySelector('input.nickname-input');
    if (input) {
      input.value = 'TesterX';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  const playBtn = await page.$('.play-btn');
  if (playBtn) await playBtn.click();
  await page.waitForTimeout(4000);

  // Now we're in-game
  console.log('Game started! Testing keyboard input...');

  // Step 1: Test dispatchEvent keyboard (non-trusted)
  console.log('\n1. Testing dispatchEvent keyboard (non-trusted)...');
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'KeyW', key: 'w', keyCode: 87, bubbles: true
    }));
  });
  await page.waitForTimeout(100);

  // Capture canvas state before
  const beforeState = await page.evaluate(() => {
    const cv = document.getElementById('canvas');
    if (!cv) return null;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const samples = [];
    for (let x = 500; x < 780; x += 20) {
      for (let y = 250; y < 470; y += 20) {
        const d = ctx.getImageData(x, y, 1, 1).data;
        const diff = Math.abs(d[0] - 30) + Math.abs(d[1] - 167) + Math.abs(d[2] - 97);
        if (diff > 40) samples.push({ x, y, r: d[0], g: d[1], b: d[2] });
      }
    }
    return samples.slice(0, 5);
  });

  // Send many W keys via dispatchEvent
  for (let i = 0; i < 30; i++) {
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        code: 'KeyW', key: 'w', keyCode: 87, bubbles: true
      }));
    });
    await page.waitForTimeout(16);
  }
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keyup', {
      code: 'KeyW', key: 'w', keyCode: 87, bubbles: true
    }));
  });

  await page.waitForTimeout(500);

  // Capture canvas state after dispatchEvent
  const afterDispatchEvent = await page.evaluate(() => {
    const cv = document.getElementById('canvas');
    if (!cv) return null;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const samples = [];
    for (let x = 500; x < 780; x += 20) {
      for (let y = 250; y < 470; y += 20) {
        const d = ctx.getImageData(x, y, 1, 1).data;
        const diff = Math.abs(d[0] - 30) + Math.abs(d[1] - 167) + Math.abs(d[2] - 97);
        if (diff > 40) samples.push({ x, y, r: d[0], g: d[1], b: d[2] });
      }
    }
    return samples.slice(0, 5);
  });

  // Step 2: Test Playwright CDP keyboard (trusted)
  console.log('2. Testing Playwright CDP keyboard (trusted)...');
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyD');
  await page.waitForTimeout(500);

  const afterTrusted = await page.evaluate(() => {
    const cv = document.getElementById('canvas');
    if (!cv) return null;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const samples = [];
    for (let x = 500; x < 780; x += 20) {
      for (let y = 250; y < 470; y += 20) {
        const d = ctx.getImageData(x, y, 1, 1).data;
        const diff = Math.abs(d[0] - 30) + Math.abs(d[1] - 167) + Math.abs(d[2] - 97);
        if (diff > 40) samples.push({ x, y, r: d[0], g: d[1], b: d[2] });
      }
    }
    return samples.slice(0, 5);
  });

  console.log(`Before: ${JSON.stringify(beforeState)}`);
  console.log(`After dispatchEvent: ${JSON.stringify(afterDispatchEvent)}`);
  console.log(`After CDP trusted: ${JSON.stringify(afterTrusted)}`);

  await page.screenshot({ path: 'screenshots/trusted_test.png' });
  await browser.close();
}

test().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
