import { chromium } from 'playwright';

const CHROME_PATH = 'C:\\Users\\zhouz\\AppData\\Local\\ms-playwright\\chromium-1224\\chrome-win64\\chrome.exe';

async function test() {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  await page.goto('https://zorr.pro', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);

  // Method: Click the input to focus it, type text, then dispatch events on the input
  console.log('Method: Direct input manipulation + native Playwright keyboard');

  // Fill nickname
  await page.evaluate(() => {
    const input = document.querySelector('input.nickname-input');
    if (input) {
      input.focus();
      input.value = 'TestBot007';
      // Dispatch input event
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await page.waitForTimeout(500);

  // Press Enter via Playwright (CDP trusted event)
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);

  // Check result
  let state = await page.evaluate(() => ({
    menuCSS: window.getComputedStyle(document.querySelector('.menu')).display,
    inputValue: document.querySelector('input.nickname-input')?.value,
  }));
  console.log(`After Enter via CDP: menu=${state.menuCSS}, input=${state.inputValue}`);

  // If game didn't start, try clicking play via Playwright CDP
  if (state.menuCSS !== 'none') {
    console.log('Clicking play via Playwright CDP...');
    const playBtn = await page.$('.play-btn');
    if (playBtn) await playBtn.click();
    await page.waitForTimeout(3000);

    state = await page.evaluate(() => ({
      menuCSS: window.getComputedStyle(document.querySelector('.menu')).display,
    }));
    console.log(`After play click: menu=${state.menuCSS}`);
  }

  await browser.close();
}

test().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
