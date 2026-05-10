import { chromium } from 'playwright';

const CHROME_PATH = 'C:\\Users\\zhouz\\AppData\\Local\\ms-playwright\\chromium-1224\\chrome-win64\\chrome.exe';

async function testExtension() {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: false });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`[ERR] ${msg.text().slice(0, 200)}`);
    }
  });

  await page.goto('https://zorr.pro', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);

  // Look for the "io dialog" - this might be the main game canvas area
  // Let's find what's actually in the viewport
  const viewportContent = await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    
    const visible = [];
    const all = document.querySelectorAll('*');
    for (const el of all) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 && 
          rect.left < vw && rect.top < vh &&
          rect.right > 0 && rect.bottom > 0) {
        visible.push({
          tag: el.tagName,
          id: el.id,
          class: (typeof el.className === 'string' ? el.className : '').slice(0, 60),
          text: (el.textContent || '').trim().slice(0, 100),
          rect: { l: Math.round(rect.left), t: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) },
        });
      }
    }
    return visible.slice(0, 50);
  });

  console.log('=== Visible Elements in Viewport ===');
  viewportContent.forEach(el => {
    console.log(`  <${el.tag}> ${el.rect.l},${el.rect.t} ${el.rect.w}x${el.rect.h} "${el.text.slice(0, 60)}" ${el.class}`);
  });

  // Find all keyboard shortcut buttons
  const shortcuts = await page.evaluate(() => {
    const info = {};
    
    // Find elements with keyboard-related classes or text
    const all = document.querySelectorAll('*');
    const keys = new Set();
    all.forEach(el => {
      const text = (el.textContent || '').trim();
      if (text.length <= 3 && /^[A-Z+\-]$/.test(text.replace(/\s/g, ''))) {
        if (el.offsetParent !== null || true) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            keys.add({
              text: text.trim(),
              rect: { l: Math.round(rect.left), t: Math.round(rect.top) },
            });
          }
        }
      }
    });
    info.shortcutLabels = Array.from(keys);

    // Find keyboard hint areas
    info.keyHints = [];
    all.forEach(el => {
      const text = (el.textContent || '').trim();
      if (text.includes('Press') || text.includes('press') || text.includes('Enter') || text.includes('Space')) {
        if (el.offsetParent !== null) {
          info.keyHints.push(text.slice(0, 100));
        }
      }
    });

    return info;
  });

  console.log('\n=== Shortcut Keys ===');
  (shortcuts.shortcutLabels || []).forEach(k => console.log(`  "${k.text}" at (${k.rect.l}, ${k.rect.t})`));

  console.log('\n=== Key Hints ===');
  (shortcuts.keyHints || []).forEach(h => console.log(`  "${h}"`));

  // Interact with the game
  // Try different approaches to start
  
  // 1. Click on the canvas to give it focus
  console.log('\n=== Trying to start game ===');
  await page.click('#canvas', { position: { x: 640, y: 360 } });
  await page.waitForTimeout(500);

  // 2. Type a name  
  await page.keyboard.type('TestBot123');
  await page.waitForTimeout(500);

  // 3. Press Enter
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);

  // Check if game state changed
  const afterState = await page.evaluate(() => {
    const info = {};
    const dc = document.querySelector('.death');
    info.deathDisplay = dc?.style.display;
    info.deathText = dc?.textContent?.trim().slice(0, 200);
    
    const canvas = document.getElementById('canvas');
    if (canvas) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        const center = ctx.getImageData(640, 360, 1, 1).data;
        info.canvasCenter = `rgba(${center[0]},${center[1]},${center[2]},${center[3]})`;
      }
    }

    return info;
  });

  console.log('\n=== After Interaction ===');
  console.log(JSON.stringify(afterState, null, 2));

  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'screenshots/final_test3.png' });

  await browser.close();
}

testExtension().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
