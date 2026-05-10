import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';

const CHROME_PATH = 'C:\\Users\\zhouz\\AppData\\Local\\ms-playwright\\chromium-1224\\chrome-win64\\chrome.exe';

async function analyze() {
  mkdirSync('screenshots', { recursive: true });

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  // Collect network requests
  const resources = [];
  page.on('response', response => {
    resources.push({
      url: response.url().slice(0, 150),
      status: response.status(),
      type: response.request().resourceType(),
    });
  });

  console.log('Navigating to zorr.pro...');
  await page.goto('https://zorr.pro', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  // Save HTML
  const html = await page.content();
  writeFileSync('screenshots/page.html', html);

  // Save scripts
  const scripts = await page.evaluate(() => {
    return Array.from(document.scripts).map(s => ({
      src: s.src,
      type: s.type,
      innerHTML: s.innerHTML?.slice(0, 10000) || '',
    }));
  });

  scripts.forEach((s, i) => {
    if (s.innerHTML) {
      writeFileSync(`screenshots/script_${i}.js`, s.innerHTML);
    }
  });

  // Analyze resource types
  const resourceTypes = {};
  resources.forEach(r => {
    resourceTypes[r.type] = (resourceTypes[r.type] || 0) + 1;
  });
  console.log('Resource types:', JSON.stringify(resourceTypes, null, 2));

  // Key resources
  console.log('\nKey resources loaded:');
  resources.filter(r => r.type === 'document' || r.type === 'script' || r.type === 'fetch' || r.type === 'xhr' || r.type === 'websocket')
    .forEach(r => console.log(`  [${r.type}] ${r.status} ${r.url}`));

  // Try to interact - click on canvas center to start
  const canvas = await page.$('#canvas');
  if (canvas) {
    const box = await canvas.boundingBox();
    console.log(`\nMain canvas bounds:`, box);
  }

  // Check for WebSocket connections (real-time game)
  const wsResources = resources.filter(r => r.url.startsWith('ws:') || r.url.startsWith('wss:'));
  console.log('\nWebSocket connections:', wsResources.map(r => r.url));

  // Get game variables from window
  const gameVars = await page.evaluate(() => {
    const keys = Object.keys(window).filter(k => 
      !k.startsWith('__') && 
      k !== 'performance' && 
      k !== 'location' && 
      k !== 'navigator' && 
      k !== 'document' &&
      k !== 'window'
    );
    return keys.slice(0, 50);
  });
  console.log('\nNotable window globals:', gameVars);

  // Try to find game state by inspecting global variables
  const gameState = await page.evaluate(() => {
    const state = {};
    // Check for common game frameworks/engines
    if (typeof Phaser !== 'undefined') state.phaser = true;
    if (typeof PixiJS !== 'undefined') state.pixi = true;
    if (typeof THREE !== 'undefined') state.three = true;
    if (typeof Matter !== 'undefined') state.matter = true;
    if (typeof io !== 'undefined') state.socketio = true;
    if (typeof Game !== 'undefined') state.game = true;

    // Package.json / app info
    const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute('content');
    if (metaDescription) state.metaDescription = metaDescription;

    return state;
  });
  console.log('\nGame framework detection:', JSON.stringify(gameState, null, 2));

  // Take screenshot
  await page.screenshot({ path: 'screenshots/game.png', fullPage: false });
  console.log('\nScreenshot saved to screenshots/game.png');

  await browser.close();
  console.log('Done!');
}

analyze().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
