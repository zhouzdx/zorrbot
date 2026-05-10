import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';

const CHROME_PATH = 'C:\\Users\\zhouz\\AppData\\Local\\ms-playwright\\chromium-1224\\chrome-win64\\chrome.exe';

async function interact() {
  mkdirSync('screenshots', { recursive: true });

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: false, // Visible browser so we can see what's happening
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  console.log('Navigating to zorr.pro...');
  await page.goto('https://zorr.pro', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(8000);

  console.log('Page loaded. Analyzing game state...');

  // Get detailed game info from the page
  const gameInfo = await page.evaluate(() => {
    // Try to find game object in various locations
    const findGameObject = (obj, depth = 0, maxDepth = 5, path = 'window') => {
      const results = [];
      if (depth > maxDepth || !obj || typeof obj !== 'object') return results;
      try {
        const keys = Object.getOwnPropertyNames(obj).filter(k => {
          try {
            const val = obj[k];
            if (k === 'game' || k === 'Game' || k === 'app' || k === 'App' || 
                k === 'engine' || k === 'Engine' || k === 'world' || k === 'World' ||
                k === 'scene' || k === 'Scene' || k === 'player' || k === 'Player') {
              return true;
            }
            return false;
          } catch(e) { return false; }
        });
        keys.forEach(k => {
          try {
            results.push({ path: `${path}.${k}`, type: typeof obj[k] });
          } catch(e) {}
        });
        // Also check deeper
        for (const k of Object.keys(obj).slice(0, 20)) {
          try {
            const val = obj[k];
            if (val && typeof val === 'object') {
              results.push(...findGameObject(val, depth + 1, maxDepth, `${path}.${k}`));
            }
          } catch(e) {}
        }
      } catch(e) {}
      return results.slice(0, 30);
    };

    const gameObjects = findGameObject(window, 0, 4);
    
    // Try to get canvas rendering context info
    const canvas = document.getElementById('canvas');
    let canvasInfo = null;
    if (canvas) {
      const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
      canvasInfo = {
        hasWebGL: !!gl,
        width: canvas.width,
        height: canvas.height,
      };
    }

    // Listen for keyboard events on the page
    const listeners = [];
    // Check what events the game listens to
    ['keydown', 'keyup', 'mousedown', 'mouseup', 'mousemove', 'click', 'touchstart'].forEach(eventType => {
      const handler = window[`on${eventType}`];
      if (handler) {
        listeners.push(`${eventType}: ${handler.toString().slice(0, 100)}`);
      }
    });

    return { gameObjects, canvasInfo, listeners };
  });

  console.log('\n=== Game Objects Found ===');
  gameInfo.gameObjects.forEach(g => console.log(`  ${g.path}: ${g.type}`));
  
  console.log('\n=== Canvas Info ===');
  console.log(`  WebGL: ${gameInfo.canvasInfo?.hasWebGL}`);
  console.log(`  Size: ${gameInfo.canvasInfo?.width}x${gameInfo.canvasInfo?.height}`);
  
  console.log('\n=== Event Listeners ===');
  gameInfo.listeners.forEach(l => console.log(`  ${l}`));

  // Try pressing keys to see what happens
  console.log('\n--- Trying keyboard interactions ---');

  // Press W to move up
  await page.keyboard.press('KeyW');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/after_w.png' });

  // Try pressing Space to attack
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/after_space.png' });

  // Try clicking on the canvas
  await page.mouse.click(640, 360);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/after_click.png' });

  // Try WASD movement sequence
  for (const key of ['KeyA', 'KeyS', 'KeyD', 'KeyW']) {
    await page.keyboard.down(key);
    await page.waitForTimeout(200);
    await page.keyboard.up(key);
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/after_wasd.png' });

  console.log('Screenshots taken.');
  
  // Try to examine the game loop and internal state
  const runtimeState = await page.evaluate(() => {
    // Try to find keys related to game state
    const allKeys = [];
    const checkKeys = (obj, path, seen) => {
      if (!obj || typeof obj !== 'object' || seen.has(obj)) return;
      seen.add(obj);
      
      const keys = Object.keys(obj).slice(0, 30);
      for (const k of keys) {
        try {
          const val = obj[k];
          const fullPath = `${path}.${k}`;
          
          // Look for interesting values
          if (typeof val === 'number' && val > 0 && val < 100000) {
            allKeys.push({ path: fullPath, value: val, type: 'number' });
          } else if (typeof val === 'string' && val.length > 0 && val.length < 200) {
            allKeys.push({ path: fullPath, value: `"${val.slice(0, 100)}"`, type: 'string' });
          } else if (Array.isArray(val) && val.length > 0 && val.length < 10) {
            allKeys.push({ path: fullPath, value: `Array(${val.length})`, type: 'array' });
          }
          
          if (allKeys.length > 100) return;
        } catch(e) {}
      }
    };
    
    // Check window for game state
    const seen = new Set();
    for (const k of Object.keys(window).slice(0, 30)) {
      try {
        const val = window[k];
        if (val && typeof val === 'object') {
          checkKeys(val, `window.${k}`, seen);
        }
      } catch(e) {}
    }
    
    return allKeys.slice(0, 50);
  });
  
  console.log('\n=== Runtime Game State ===');
  runtimeState.forEach(s => console.log(`  ${s.path} = ${s.value}`));

  await browser.close();
  console.log('\nDone!');
}

interact().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
