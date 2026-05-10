import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const CHROME_PATH = 'C:\\Users\\zhouz\\AppData\\Local\\ms-playwright\\chromium-1224\\chrome-win64\\chrome.exe';

async function understand() {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  await page.goto('https://zorr.pro', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  // Try to extract game state from the canvas indirectly
  // First, get pixel data from the canvas to understand what we see
  const pixelData = await page.evaluate(() => {
    const canvas = document.getElementById('canvas');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    
    // Sample pixels from different regions to understand the scene
    const regions = {
      top: Array.from({ length: 10 }, (_, i) => {
        const data = ctx.getImageData(i * 128, 0, 1, 1).data;
        return `x=${i*128} rgba(${data[0]},${data[1]},${data[2]},${data[3]})`;
      }),
      center: Array.from({ length: 10 }, (_, i) => {
        const data = ctx.getImageData(i * 128, 360, 1, 1).data;
        return `x=${i*128} rgba(${data[0]},${data[1]},${data[2]},${data[3]})`;
      }),
      bottom: Array.from({ length: 10 }, (_, i) => {
        const data = ctx.getImageData(i * 128, 700, 1, 1).data;
        return `x=${i*128} rgba(${data[0]},${data[1]},${data[2]},${data[3]})`;
      }),
    };

    return regions;
  });

  console.log('=== Canvas Pixel Samples ===');
  console.log('Top row:');
  pixelData?.top?.forEach(p => console.log(`  ${p}`));
  console.log('Center row:');
  pixelData?.center?.forEach(p => console.log(`  ${p}`));
  console.log('Bottom row:');
  pixelData?.bottom?.forEach(p => console.log(`  ${p}`));

  // Get the game's main code to understand the API
  // Check for any exposed game objects/functions
  const exposedFunctions = await page.evaluate(() => {
    const result = {};
    
    // Check for common game patterns
    // Check if there's an animation loop
    const raf = window.requestAnimationFrame;
    
    // Get the interval timers that might be the game loop
    // We can check if there are canvas draw calls
    
    // Try to find the main game loop function
    const funcs = [];
    for (const key of Object.getOwnPropertyNames(window).slice(0, 100)) {
      try {
        const val = window[key];
        if (typeof val === 'function' && val.toString().length > 50) {
          funcs.push({
            name: key,
            body: val.toString().slice(0, 300)
          });
        }
        if (typeof val === 'object' && val !== null) {
          // Check for useful properties
          for (const k of Object.getOwnPropertyNames(val).slice(0, 30)) {
            try {
              const v = val[k];
              if (typeof v === 'number' && (k.toLowerCase().includes('hp') || k.toLowerCase().includes('health') || k.toLowerCase().includes('level') || k.toLowerCase().includes('damage'))) {
                result[`window.${key}.${k}`] = v;
              }
              if (typeof v === 'number' && (k.toLowerCase().includes('x') || k.toLowerCase().includes('y') || k.toLowerCase().includes('pos'))) {
                result[`window.${key}.${k}`] = v;
              }
            } catch(e) {}
          }
        }
      } catch(e) {}
    }
    
    return { result, functionCount: funcs.length };
  });

  console.log('\n=== Exposed Game State ===');
  if (exposedFunctions?.result) {
    Object.entries(exposedFunctions.result).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  }
  console.log(`  Global functions found: ${exposedFunctions?.functionCount}`);

  // Try to interact with the game lobby/start screen
  // Click on the canvas to start/play
  console.log('\n--- Clicking to start game ---');
  
  // Try pressing Enter and other common game start keys
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);
  
  // Try pressing Space
  await page.keyboard.press('Space');
  await page.waitForTimeout(1000);

  // Try clicking various positions on the canvas
  for (const [x, y] of [[640, 360], [640, 400], [640, 500], [640, 200], [200, 360], [1060, 360]]) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(200);
  }
  
  await page.waitForTimeout(2000);

  // Check for canvas changes after interaction
  const afterPixels = await page.evaluate(() => {
    const canvas = document.getElementById('canvas');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    
    // Check if the canvas content changed
    const center = ctx.getImageData(640, 360, 1, 1).data;
    return `center rgba(${center[0]},${center[1]},${center[2]},${center[3]})`;
  });

  console.log(`After interaction canvas center: ${afterPixels}`);

  await page.screenshot({ path: 'screenshots/after_interaction.png' });
  console.log('Screenshot saved.');

  await browser.close();
  console.log('Done!');
}

understand().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
