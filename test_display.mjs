import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const CHROME_PATH = 'C:\\Users\\zhouz\\AppData\\Local\\ms-playwright\\chromium-1224\\chrome-win64\\chrome.exe';

async function test() {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  await page.goto('https://zorr.pro', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(4000);

  const displayInfo = await page.evaluate(() => {
    const menu = document.querySelector('.menu');
    const main = document.querySelector('.main');
    const canvas = document.getElementById('canvas');
    
    return {
      menuExists: !!menu,
      menuCSSDisplay: menu ? window.getComputedStyle(menu).display : 'N/A',
      menuStyleAttr: menu ? menu.getAttribute('style') : 'N/A',
      menuStyleObj: menu ? menu.style.display : 'N/A',
      mainDisplay: main ? window.getComputedStyle(main).display : 'N/A',
      canvasDisplay: canvas ? window.getComputedStyle(canvas).display : 'N/A',
    };
  });

  console.log('Display info:', JSON.stringify(displayInfo, null, 2));
  
  // Also check the loader visibility
  const loader = await page.evaluate(() => {
    const loader = document.querySelector('.loader');
    return {
      exists: !!loader,
      display: loader ? window.getComputedStyle(loader).display : 'N/A',
      visibility: loader ? window.getComputedStyle(loader).visibility : 'N/A',
    };
  });
  console.log('Loader:', JSON.stringify(loader, null, 2));

  // Try clicking play button the Playwright way (native CDP click)
  const playBtn = await page.$('.play-btn');
  if (playBtn) {
    console.log(`Play button visible: ${await playBtn.isVisible()}`);
    console.log(`Play button bounding box: ${JSON.stringify(await playBtn.boundingBox())}`);
  }

  await page.waitForTimeout(1000);

  // Now inject content script and see if it can click play
  const contentScript = readFileSync('zorr-bot-extension/content.js', 'utf-8');
  await page.evaluate(contentScript);
  
  await page.waitForTimeout(4000);

  const afterState = await page.evaluate(() => {
    const menu = document.querySelector('.menu');
    const death = document.querySelector('.death');
    const canvas = document.getElementById('canvas');
    let canvasActive = false;
    if (canvas) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        for (let x = 300; x < 980; x += 50) {
          for (let y = 100; y < 620; y += 50) {
            const d = ctx.getImageData(x, y, 1, 1).data;
            if (Math.abs(d[0] - 30) + Math.abs(d[1] - 167) + Math.abs(d[2] - 97) > 50) {
              canvasActive = true;
              break;
            }
          }
          if (canvasActive) break;
        }
      }
    }
    return {
      menuCSSDisplay: window.getComputedStyle(menu).display,
      deathCSSDisplay: death ? window.getComputedStyle(death).display : 'N/A',
      canvasActive,
      canvasCSSDisplay: window.getComputedStyle(canvas).display,
    };
  });
  console.log('After state:', JSON.stringify(afterState, null, 2));

  await browser.close();
}

test().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
