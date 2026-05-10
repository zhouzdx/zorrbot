import { chromium } from 'playwright';

const CHROME_PATH = 'C:\\Users\\zhouz\\AppData\\Local\\ms-playwright\\chromium-1224\\chrome-win64\\chrome.exe';

async function test() {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('Connected') || text.includes('connecting') || text.includes('sprite') || text.includes('index')) {
      console.log(`[PAGE] ${text.slice(0, 100)}`);
    }
  });

  await page.goto('https://zorr.pro', { waitUntil: 'networkidle', timeout: 60000 });
  
  // Wait for game to connect (from console output - it auto-connects)
  await page.waitForTimeout(5000);

  // Check if game is already connected and rendering
  const preState = await page.evaluate(() => {
    const canvas = document.getElementById('canvas');
    if (!canvas) return { error: 'no canvas' };
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { error: 'no ctx' };
    
    // Check multiple samples
    const samples = [];
    for (let x = 200; x < 1080; x += 100) {
      for (let y = 100; y < 620; y += 100) {
        const d = ctx.getImageData(x, y, 1, 1).data;
        const diff = Math.abs(d[0] - 30) + Math.abs(d[1] - 167) + Math.abs(d[2] - 97);
        if (diff > 30) {
          samples.push({ x, y, rgba: [d[0], d[1], d[2], d[3]], diff });
        }
      }
    }
    return {
      canvasSize: `${canvas.width}x${canvas.height}`,
      nonBgSamples: samples.slice(0, 10),
      nonBgCount: samples.length,
      menuCSS: window.getComputedStyle(document.querySelector('.menu')).display,
    };
  });
  console.log('Pre-state:', JSON.stringify(preState, null, 2));

  // Try hiding the menu 
  await page.evaluate(() => {
    const menu = document.querySelector('.menu');
    if (menu) {
      menu.style.setProperty('display', 'none', 'important');
    }
  });
  await page.waitForTimeout(2000);

  // Check canvas and try keyboard
  const postState = await page.evaluate(() => {
    const canvas = document.getElementById('canvas');
    if (!canvas) return { error: 'no canvas' };
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { error: 'no ctx' };
    
    const samples = [];
    for (let x = 300; x < 980; x += 40) {
      for (let y = 100; y < 620; y += 40) {
        const d = ctx.getImageData(x, y, 1, 1).data;
        const diff = Math.abs(d[0] - 30) + Math.abs(d[1] - 167) + Math.abs(d[2] - 97);
        if (diff > 30) {
          samples.push({ x, y, rgba: [d[0], d[1], d[2], d[3]] });
        }
      }
    }
    return {
      nonBgCount: samples.length,
      samples: samples.slice(0, 10),
    };
  });
  console.log('\nAfter hiding menu:', JSON.stringify(postState, null, 2));

  // Try sending keyboard events via document.dispatchEvent
  console.log('\nTrying keyboard events...');
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        code: 'KeyW', key: 'w', keyCode: 87, bubbles: true
      }));
    });
    await page.waitForTimeout(50);
  }
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keyup', {
      code: 'KeyW', key: 'w', keyCode: 87, bubbles: true
    }));
  });
  await page.waitForTimeout(1000);

  // Try Space attacks
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        code: 'Space', key: ' ', keyCode: 32, bubbles: true
      }));
      document.dispatchEvent(new KeyboardEvent('keyup', {
        code: 'Space', key: ' ', keyCode: 32, bubbles: true
      }));
    });
    await page.waitForTimeout(300);
  }

  await page.waitForTimeout(2000);
  
  const finalState = await page.evaluate(() => {
    const canvas = document.getElementById('canvas');
    if (!canvas) return { error: 'no canvas' };
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { error: 'no ctx' };
    const samples = [];
    for (let x = 300; x < 980; x += 30) {
      for (let y = 100; y < 620; y += 30) {
        const d = ctx.getImageData(x, y, 1, 1).data;
        const diff = Math.abs(d[0] - 30) + Math.abs(d[1] - 167) + Math.abs(d[2] - 97);
        if (diff > 40) {
          samples.push({ x, y, rgba: [d[0], d[1], d[2], d[3]] });
        }
      }
    }
    return { nonBgCount: samples.length, samples: samples.slice(0, 15) };
  });
  console.log('\nFinal:', JSON.stringify(finalState, null, 2));

  await page.screenshot({ path: 'screenshots/no_click.png' });
  await browser.close();
}

test().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
