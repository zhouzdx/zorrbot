import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const CHROME_PATH = 'C:\\Users\\zhouz\\AppData\\Local\\ms-playwright\\chromium-1224\\chrome-win64\\chrome.exe';

async function finalTest() {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const contentScript = readFileSync('zorr-bot-extension/content.js', 'utf-8');

  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[Zorr Bot]') || msg.type() === 'error') {
      console.log(`[PAGE] ${text.slice(0, 200)}`);
    }
  });

  console.log('1. Navigating to zorr.pro...');
  await page.goto('https://zorr.pro', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);

  console.log('2. Injecting bot...');
  await page.evaluate(contentScript);

  // Wait for lobby handling
  await page.waitForTimeout(3000);

  // Check if we got past lobby
  let menuState = await page.evaluate(() => {
    const menu = document.querySelector('.menu');
    return {
      menuDisplay: menu?.style.display,
      menuExists: !!menu,
    };
  });
  console.log(`3. Menu state: ${JSON.stringify(menuState)}`);

  if (menuState.menuDisplay !== 'none') {
    console.log('4. Menu still visible, forcing play click...');
    await page.evaluate(() => {
      const input = document.querySelector('input.nickname-input');
      if (input) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value'
        );
        nativeInputValueSetter.set.call(input, 'TestBot999');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const playBtn = document.querySelector('.play-btn');
      if (playBtn) playBtn.click();
    });
    await page.waitForTimeout(3000);
  }

  // Now check game state
  const gameState = await page.evaluate(() => {
    const menu = document.querySelector('.menu');
    const canvas = document.getElementById('canvas');
    let canvasActive = false;
    if (canvas) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        const sample = ctx.getImageData(620, 340, 40, 40);
        for (let i = 0; i < sample.data.length; i += 16) {
          const d = Math.abs(sample.data[i] - 30) + Math.abs(sample.data[i+1] - 167) + Math.abs(sample.data[i+2] - 97);
          if (d > 40) { canvasActive = true; break; }
        }
      }
    }
    return {
      menuDisplay: menu?.style.display,
      canvasActive,
      deathElExists: !!document.querySelector('.death'),
      petalsCollectedExists: !!document.querySelector('.petals-collected'),
      playerName: document.querySelector('.nickname-input')?.value || 'unknown',
    };
  });
  console.log(`5. Game state: ${JSON.stringify(gameState)}`);

  // Start the bot
  console.log('6. Starting bot...');
  await page.evaluate(() => {
    window.postMessage({
      source: 'zorr-bot-popup',
      action: 'start',
    }, '*');
  });

  // Let it run for 10 seconds
  await page.waitForTimeout(10000);

  // Check bot state
  const botState = await page.evaluate(() => {
    // Check if canvas is active and has changing content
    const canvas = document.getElementById('canvas');
    let hasActivity = false;
    if (canvas) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        // Sample two frames
        const s1 = ctx.getImageData(600, 300, 20, 20).data.slice(0, 20).join(',');
        const s2 = ctx.getImageData(600, 300, 20, 20).data.slice(0, 20).join(',');
        hasActivity = s1 !== s2;
      }
    }
    const death = document.querySelector('.death');
    return {
      hasActivity,
      deathDisplay: death?.style.display,
      running: true,
    };
  });
  console.log(`7. After 10s bot run: ${JSON.stringify(botState)}`);

  await page.screenshot({ path: 'screenshots/final_bot_run.png' });
  console.log('8. Screenshot saved.');

  await browser.close();
  console.log('Done!');
}

finalTest().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
