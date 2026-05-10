import { chromium } from 'playwright';

const CHROME_PATH = 'C:\\Users\\zhouz\\AppData\\Local\\ms-playwright\\chromium-1224\\chrome-win64\\chrome.exe';

async function test() {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: false });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  page.on('console', msg => console.log(`[PAGE] ${msg.text().slice(0, 150)}`));

  await page.goto('https://zorr.pro', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);

  // Method 1: Try clicking play using Playwright's native click
  console.log('Trying Playwright click on play button...');
  const playBtn = await page.$('.play-btn');
  if (playBtn) {
    await playBtn.click();
    console.log('Clicked!');
  }
  await page.waitForTimeout(3000);

  let state = await page.evaluate(() => ({
    menuCSS: window.getComputedStyle(document.querySelector('.menu')).display,
    canvasActive: (() => {
      const canvas = document.getElementById('canvas');
      if (!canvas) return false;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return false;
      const d = ctx.getImageData(640, 360, 1, 1).data;
      return d[0] !== 30 || d[1] !== 167 || d[2] !== 97;
    })(),
  }));
  console.log('After click:', JSON.stringify(state));

  if (state.menuCSS === 'block') {
    // Method 2: Just hide the menu and see if game works
    console.log('Play click via dispatchEvent did not close menu. Trying to force hide...');
    await page.evaluate(() => {
      const menu = document.querySelector('.menu');
      if (menu) menu.style.display = 'none';
    });
    await page.waitForTimeout(3000);

    state = await page.evaluate(() => ({
      canvasActive: (() => {
        const canvas = document.getElementById('canvas');
        if (!canvas) return false;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return false;
        const sample = ctx.getImageData(400, 200, 400, 400);
        for (let i = 0; i < sample.data.length; i += 100) {
          if (Math.abs(sample.data[i] - 30) + Math.abs(sample.data[i+1] - 167) + Math.abs(sample.data[i+2] - 97) > 40) {
            return true;
          }
        }
        return false;
      })(),
    }));
    console.log('After hiding menu:', JSON.stringify(state));
  }

  // Test if keyboard works with WASD
  console.log('Testing WASD...');
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyD');
  await page.waitForTimeout(500);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyW');

  // Test Space
  console.log('Testing Space...');
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
  }

  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/hidden_menu.png' });

  await browser.close();
}

test().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
