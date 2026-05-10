import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const CHROME_PATH = 'C:\\Users\\zhouz\\AppData\\Local\\ms-playwright\\chromium-1224\\chrome-win64\\chrome.exe';

async function testControls() {
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  console.log('Navigating to zorr.pro...');
  await page.goto('https://zorr.pro', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);

  // Log all console messages from the page
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`[PAGE ${msg.type().toUpperCase()}] ${msg.text().slice(0, 200)}`);
    }
  });

  // Step 1: Try to see if there's a name/prompt dialog
  console.log('\n--- Checking for prompts and dialogs ---');
  
  page.on('dialog', async dialog => {
    console.log(`Dialog appeared: ${dialog.type()} - ${dialog.message().slice(0, 200)}`);
    await dialog.accept('botplayer');
  });

  // Step 2: Try pressing Enter to start
  console.log('Pressing Enter...');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);

  // Step 3: Click on the canvas repeatedly
  console.log('Clicking canvas at various positions...');
  for (let i = 0; i < 5; i++) {
    await page.mouse.click(640, 360);
    await page.waitForTimeout(300);
  }

  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/after_enter.png' });

  // Step 4: Try typing text (for name input)
  console.log('Typing nickname...');
  await page.keyboard.type('botplayer');
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/after_nickname.png' });

  // Step 5: Try WASD movement
  console.log('Testing WASD movement...');
  for (let i = 0; i < 3; i++) {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(300);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(100);
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(300);
    await page.keyboard.up('KeyD');
    await page.waitForTimeout(100);
    await page.keyboard.down('KeyS');
    await page.waitForTimeout(300);
    await page.keyboard.up('KeyS');
    await page.waitForTimeout(100);
    await page.keyboard.down('KeyA');
    await page.waitForTimeout(300);
    await page.keyboard.up('KeyA');
  }
  
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/after_wasd.png' });

  // Step 6: Try Space to attack
  console.log('Testing Space attack...');
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/after_space.png' });

  // Step 7: Try mouse click to attack
  console.log('Testing mouse attack at center...');
  await page.mouse.click(640, 360, { button: 'left' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/after_click_attack.png' });

  // Step 8: Check canvas for any changes/drawing
  console.log('\n--- Analyzing canvas state ---');
  const canvasAnalysis = await page.evaluate(() => {
    const canvas = document.getElementById('canvas');
    if (!canvas) return 'No canvas found';
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'No 2D context';

    // Get image data from the center of the canvas
    const centerRegion = ctx.getImageData(580, 300, 120, 120);
    const pixels = centerRegion.data;
    
    // Count unique colors
    const colorMap = new Map();
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i], g = pixels[i+1], b = pixels[i+2], a = pixels[i+3];
      if (a < 10) continue; // Skip transparent
      // Quantize colors
      const key = `${Math.round(r/32)*32},${Math.round(g/32)*32},${Math.round(b/32)*32}`;
      colorMap.set(key, (colorMap.get(key) || 0) + 1);
    }

    // Sort by frequency
    const sorted = [...colorMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
    
    // Also check if the canvas is mostly a solid color
    const firstPixel = ctx.getImageData(0, 0, 1, 1).data;
    const lastPixel = ctx.getImageData(1279, 719, 1, 1).data;
    
    return {
      dominantColors: sorted.map(([color, count]) => `${color}: ${count}`),
      topLeft: `${firstPixel[0]},${firstPixel[1]},${firstPixel[2]}`,
      bottomRight: `${lastPixel[0]},${lastPixel[1]},${lastPixel[2]}`,
      canvasSize: `${canvas.width}x${canvas.height}`,
    };
  });

  console.log('Canvas analysis:');
  console.log(JSON.stringify(canvasAnalysis, null, 2));

  // Step 9: Check for any rendered game UI
  const domState = await page.evaluate(() => {
    return {
      visibleElements: Array.from(document.querySelectorAll('*')).filter(el => {
        return el.offsetParent !== null && el.textContent?.trim();
      }).slice(0, 30).map(el => ({
        tag: el.tagName,
        id: el.id,
        class: el.className?.slice(0, 60) || '',
        text: el.textContent?.trim().slice(0, 100) || '',
        rect: el.getBoundingClientRect(),
      })),
      scriptCount: document.scripts.length,
    };
  });

  console.log('\n=== Visible DOM Elements ===');
  domState.visibleElements.forEach(el => {
    console.log(`  <${el.tag}> id="${el.id}" class="${el.class}" rect=(${el.rect.x},${el.rect.y},${el.rect.w}x${el.rect.h}) text="${el.text.slice(0, 50)}"`);
  });

  console.log(`\nScript count: ${domState.scriptCount}`);

  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/final_state.png' });

  await browser.close();
  console.log('\nDone!');
}

testControls().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
