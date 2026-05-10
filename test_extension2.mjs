import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const CHROME_PATH = 'C:\\Users\\zhouz\\AppData\\Local\\ms-playwright\\chromium-1224\\chrome-win64\\chrome.exe';

async function testExtension() {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  page.on('console', msg => {
    if (msg.text().includes('[Zorr Bot]') || msg.type() === 'error') {
      console.log(`[PAGE] ${msg.text().slice(0, 150)}`);
    }
  });

  await page.goto('https://zorr.pro', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);

  // Check what dialogs are visible
  const initialDialogs = await page.evaluate(() => {
    const dialogs = document.querySelectorAll('.dialog, .overlay, .overlay-dialog');
    return Array.from(dialogs).map(d => ({
      class: d.className,
      display: window.getComputedStyle(d).display,
      text: d.textContent?.trim().slice(0, 300).replace(/\s+/g, ' '),
      rect: d.getBoundingClientRect(),
    }));
  });
  console.log('=== Initial Dialogs ===');
  initialDialogs.forEach((d, i) => {
    console.log(`Dialog ${i}: class="${d.class}" display=${d.display}`);
    console.log(`  Text: ${d.text?.slice(0, 200)}`);
    console.log(`  Rect: (${d.rect.x}, ${d.rect.y}, ${d.rect.w}x${d.rect.h})`);
  });

  // Check the large HTML inline script for game initialization
  const initScript = await page.evaluate(() => {
    // Find scripts with game initialization code
    for (const script of document.scripts) {
      if (script.innerHTML && script.innerHTML.includes('start') && script.innerHTML.length < 50000) {
        return script.innerHTML.slice(0, 3000);
      }
    }
    return null;
  });
  if (initScript) {
    console.log('\n=== Init Script ===');
    console.log(initScript);
  }

  // Try to find the game start mechanism
  const gameStartInfo = await page.evaluate(() => {
    // Check what's preventing the game from starting
    const info = {};

    // Is there a name input?
    const inputs = document.querySelectorAll('input');
    info.inputs = Array.from(inputs).map(i => ({
      type: i.type,
      placeholder: i.placeholder,
      id: i.id,
      display: window.getComputedStyle(i).display,
    }));

    // Check all overlays
    const overlays = document.querySelectorAll('[class*="overlay"], [class*="modal"], [class*="dialog"]');
    info.overlays = Array.from(overlays)
      .filter(el => el.offsetParent !== null) // visible
      .map(el => ({
        tag: el.tagName,
        class: el.className?.slice(0, 100),
        text: el.textContent?.trim().slice(0, 100),
      }));

    // Check if there's a play button
    const buttons = document.querySelectorAll('button, [class*="btn"], [class*="button"], [class*="play"]');
    info.buttons = Array.from(buttons)
      .filter(el => el.offsetParent !== null)
      .map(el => ({
        tag: el.tagName,
        text: el.textContent?.trim().slice(0, 50),
        class: el.className?.slice(0, 80),
      }));

    // What's the main visible area?
    const bodyChildren = Array.from(document.body.children)
      .filter(el => el.offsetParent !== null && el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE' && el.tagName !== 'LINK')
      .map(el => ({
        tag: el.tagName,
        id: el.id,
        class: el.className?.slice(0, 80),
        text: el.textContent?.trim().slice(0, 80),
      }));
    info.visibleNodes = bodyChildren.slice(0, 20);

    return info;
  });

  console.log('\n=== Game Start Info ===');
  console.log('Inputs:', JSON.stringify(gameStartInfo.inputs));
  console.log('Overlays:', JSON.stringify(gameStartInfo.overlays));
  console.log('Buttons:', JSON.stringify(gameStartInfo.buttons));
  console.log('Visible nodes:', JSON.stringify(gameStartInfo.visibleNodes));

  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/game_ui.png' });

  await browser.close();
}

testExtension().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
