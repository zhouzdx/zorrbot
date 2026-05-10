import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const CHROME_PATH = 'C:\\Users\\zhouz\\AppData\\Local\\ms-playwright\\chromium-1224\\chrome-win64\\chrome.exe';

async function testDecode() {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

  const interceptScript = readFileSync('zorr-bot-extension/intercept.js', 'utf-8');
  await context.addInitScript(interceptScript);

  const page = await context.newPage();

  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('Connected') || text.includes('intercept') || text.includes('decode')) {
      console.log(`[PAGE] ${text.slice(0, 200)}`);
    }
  });

  await page.goto('https://zorr.pro', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);

  // Try to decode what the handler checks
  const decoded = await page.evaluate(() => {
    const handlers = window.__zorrBotHandlers?.keydown;
    if (!handlers || handlers.length === 0) return 'No handlers';

    const results = [];

    for (let i = 0; i < handlers.length; i++) {
      const fn = handlers[i].handler;
      const target = handlers[i].target;
      const fnStr = fn.toString();

      results.push({
        index: i,
        target: target?.id || target?.tagName || 'unknown',
        fnStr: fnStr.slice(0, 100),
        length: fnStr.length,
      });

      // Try to find what property the handler accesses on the event
      // by executing it with mock events and seeing if it throws
      try {
        fn.call(target, { code: 'Enter', key: 'Enter', type: 'keydown' });
        results[i].handledNormally = true;
      } catch (e) {
        results[i].error = e.message?.slice(0, 200);
      }

      // Try calling the inner function n(2344) if it exists
      try {
        // Check what O5 contains
        if (typeof O5 !== 'undefined') {
          // Try decoding a few indices
          const testIndices = [4268, 647, 792, 2344];
          testIndices.forEach(idx => {
            try {
              const decoded = O5(idx);
              results[i][`O5(${idx})`] = typeof decoded === 'string' ? decoded.slice(0, 50) : JSON.stringify(decoded).slice(0, 50);
            } catch(e) {
              results[i][`O5(${idx})`] = `error: ${e.message}`;
            }
          });
        } else {
          results[i].O5 = 'undefined';
        }
      } catch(e) {
        results[i].O5error = e.message;
      }
    }

    return results;
  });

  console.log('Decoded handlers:', JSON.stringify(decoded, null, 2));

  // Also try to find what property the handler is accessing
  // by checking all properties that are strings or have a 'length' property
  const propCheck = await page.evaluate(() => {
    const handlers = window.__zorrBotHandlers?.keydown;
    if (!handlers || handlers.length === 0) return [];

    const results = [];
    for (const entry of handlers) {
      const fnStr = entry.handler.toString();
      // Check what properties of the event the handler accesses
      // by creating a Proxy that logs all property access
      const handlerFn = entry.handler;
      const proxyTarget = entry.target;

      const accessLog = [];
      const proxy = new Proxy({}, {
        get(target, prop) {
          // Map numeric properties to their decoded strings
          const numProp = Number(prop);
          if (!isNaN(numProp) && typeof O5 !== 'undefined') {
            try { accessLog.push(`prop[${prop}] = ${O5(numProp)}`); } catch(e) {}
          }
          accessLog.push(`prop: ${String(prop)}`);
          return undefined;
        }
      });

      try {
        handlerFn.call(proxyTarget, proxy);
      } catch(e) {
        results.push({ accessLog, error: e.message?.slice(0, 200) });
      }
    }
    return results;
  });

  console.log('Prop access:', JSON.stringify(propCheck, null, 2));

  await browser.close();
}

testDecode().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
