import { chromium } from 'playwright';

const CHROME_PATH = 'C:\\Users\\zhouz\\AppData\\Local\\ms-playwright\\chromium-1224\\chrome-win64\\chrome.exe';

async function test() {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  let connected = false;
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('Connected')) connected = true;
    if (text.includes('[Zorr Bot]') || text.includes('Connected') || msg.type() === 'error') {
      console.log(`[PAGE] ${text.slice(0, 120)}`);
    }
  });

  await page.goto('https://zorr.pro', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);

  // Try overriding isTrusted
  const result = await page.evaluate(() => {
    try {
      // Attempt to override isTrusted on prototypes
      const descriptors = [];
      
      try {
        Object.defineProperty(Event.prototype, 'isTrusted', {
          get() { return true; },
          configurable: true,
        });
        descriptors.push('Event.prototype.isTrusted - OK');
      } catch(e) {
        descriptors.push(`Event.prototype.isTrusted - FAIL: ${e.message}`);
      }

      try {
        Object.defineProperty(KeyboardEvent.prototype, 'isTrusted', {
          get() { return true; },
          configurable: true,
        });
        descriptors.push('KeyboardEvent.prototype.isTrusted - OK');
      } catch(e) {
        descriptors.push(`KeyboardEvent.prototype.isTrusted - FAIL: ${e.message}`);
      }

      try {
        Object.defineProperty(MouseEvent.prototype, 'isTrusted', {
          get() { return true; },
          configurable: true,
        });
        descriptors.push('MouseEvent.prototype.isTrusted - OK');
      } catch(e) {
        descriptors.push(`MouseEvent.prototype.isTrusted - FAIL: ${e.message}`);
      }

      // Test if the override worked
      const testEvent = new KeyboardEvent('keydown', { key: 'w' });
      const testClick = new MouseEvent('click', { bubbles: true });

      descriptors.push(`Test keyboard isTrusted: ${testEvent.isTrusted}`);
      descriptors.push(`Test mouse isTrusted: ${testClick.isTrusted}`);

      return descriptors;
    } catch(e) {
      return [`Error: ${e.message}`];
    }
  });

  console.log('isTrusted override results:');
  result.forEach(r => console.log(`  ${r}`));

  // If override worked, try typing nickname
  const canOverride = result.some(r => r.includes('isTrusted: true'));
  
  if (canOverride) {
    console.log('\nisTrusted override WORKED! Trying to start game...');
    
    // Focus the nickname input and type
    await page.evaluate(() => {
      const input = document.querySelector('input.nickname-input');
      if (input) {
        input.focus();
        input.value = 'Bot1234';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await page.waitForTimeout(500);

    // Press Enter
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
      }));
      document.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
      }));
    });
    await page.waitForTimeout(3000);

    // Check if menu is gone
    const state = await page.evaluate(() => ({
      menuCSS: window.getComputedStyle(document.querySelector('.menu')).display,
      canvasActive: (() => {
        const cv = document.getElementById('canvas');
        if (!cv) return false;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        if (!ctx) return false;
        for (let x = 500; x < 780; x += 20) {
          for (let y = 250; y < 470; y += 20) {
            const d = ctx.getImageData(x, y, 1, 1).data;
            if (Math.abs(d[0] - 30) + Math.abs(d[1] - 167) + Math.abs(d[2] - 97) > 40) return true;
          }
        }
        return false;
      })(),
    }));
    console.log('After Enter:', JSON.stringify(state));
  } else {
    console.log('\nisTrusted override FAILED. Trying alternative approach...');
    
    // Try using canvas click followed by keyboard
    await page.evaluate(() => {
      const canvas = document.getElementById('canvas');
      if (canvas) {
        canvas.focus();
        canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 640, clientY: 400 }));
      }
    });
    await page.waitForTimeout(2000);

    const state = await page.evaluate(() => ({
      menuCSS: window.getComputedStyle(document.querySelector('.menu')).display,
    }));
    console.log('After canvas click:', JSON.stringify(state));
  }

  await browser.close();
}

test().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
