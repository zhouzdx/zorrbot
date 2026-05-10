import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const CHROME_PATH = 'C:\\Users\\zhouz\\AppData\\Local\\ms-playwright\\chromium-1224\\chrome-win64\\chrome.exe';

async function explore() {
  mkdirSync('screenshots', { recursive: true });

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: false,
  });

  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });

  console.log('Navigating to zorr.pro...');
  await page.goto('https://zorr.pro', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);

  // Capture full page info
  await page.screenshot({ path: 'screenshots/initial.png', fullPage: true });
  console.log('Saved initial screenshot');

  // Get page title and content info
  const title = await page.title();
  console.log('Page title:', title);

  const url = page.url();
  console.log('Current URL:', url);

  // Analyze the page structure
  const pageInfo = await page.evaluate(() => {
    const info = {
      buttons: [],
      links: [],
      inputs: [],
      text: [],
      canvas: [],
      gameElements: [],
    };

    // Get all buttons
    document.querySelectorAll('button').forEach(el => {
      info.buttons.push({
        text: el.textContent?.trim().slice(0, 50),
        id: el.id,
        class: el.className?.slice(0, 100),
        visible: el.offsetParent !== null,
      });
    });

    // Get all links
    document.querySelectorAll('a').forEach(el => {
      info.links.push({
        text: el.textContent?.trim().slice(0, 50),
        href: el.getAttribute('href')?.slice(0, 100),
        id: el.id,
      });
    });

    // Get all input elements
    document.querySelectorAll('input, select, textarea').forEach(el => {
      info.inputs.push({
        type: el.getAttribute('type') || el.tagName,
        name: el.getAttribute('name'),
        placeholder: el.getAttribute('placeholder'),
        id: el.id,
      });
    });

    // Get all canvas elements (game likely uses canvas)
    document.querySelectorAll('canvas').forEach(el => {
      info.canvas.push({
        id: el.id,
        class: el.className?.slice(0, 100),
        width: el.width,
        height: el.height,
        rect: el.getBoundingClientRect(),
      });
    });

    // Get main visible text content
    const bodyText = document.body?.textContent?.trim().slice(0, 2000) || '';
    info.text = bodyText;

    // Check for game containers
    document.querySelectorAll('[id*="game"], [class*="game"], [id*="app"], [class*="app"]').forEach(el => {
      info.gameElements.push({
        tag: el.tagName,
        id: el.id,
        class: el.className?.slice(0, 100),
      });
    });

    return info;
  });

  console.log('\n=== Buttons ===');
  pageInfo.buttons.forEach(b => console.log(`  [${b.visible ? 'visible' : 'hidden'}] "${b.text}" id="${b.id}" class="${b.class}"`));

  console.log('\n=== Canvas Elements ===');
  pageInfo.canvas.forEach(c => console.log(`  id="${c.id}" size=${c.width}x${c.height}`));

  console.log('\n=== Game Elements ===');
  pageInfo.gameElements.forEach(g => console.log(`  <${g.tag}> id="${g.id}" class="${g.class}"`));

  console.log('\n=== Links ===');
  pageInfo.links.forEach(l => console.log(`  "${l.text}" -> ${l.href}`));

  console.log('\n=== Text Content (first 1000 chars) ===');
  console.log(pageInfo.text.slice(0, 1000));

  await browser.close();
}

explore().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
