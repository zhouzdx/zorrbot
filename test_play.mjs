import { chromium } from 'playwright';

const CHROME_PATH = 'C:\\Users\\zhouz\\AppData\\Local\\ms-playwright\\chromium-1224\\chrome-win64\\chrome.exe';

async function testPlay() {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  await page.goto('https://zorr.pro', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);

  // Use the lobby HTML elements to start the game
  console.log('=== Starting game via lobby ===');

  // 1. Focus the nickname input and type
  const nickname = 'FarmBot007';
  const inputHandle = await page.$('input.nickname-input');
  if (inputHandle) {
    await inputHandle.click();
    await inputHandle.fill(nickname);
    console.log(`Typed nickname: ${nickname}`);
  } else {
    console.log('No nickname input found, trying keyboard approach');
    await page.keyboard.type(nickname);
  }
  await page.waitForTimeout(500);

  // 2. Check if the play button is clickable and visible
  const playBtn = await page.$('.play-btn');
  if (playBtn) {
    const visible = await playBtn.isVisible();
    console.log(`Play button visible: ${visible}`);
    await playBtn.click();
    console.log('Clicked play button');
  } else {
    console.log('No play button found, pressing Enter');
    await page.keyboard.press('Enter');
  }

  await page.waitForTimeout(3000);

  // 3. Check if we're now in-game
  let inGame = await page.evaluate(() => {
    const canvas = document.getElementById('canvas');
    if (!canvas) return false;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    // Check if canvas has more than just the green background
    const data = ctx.getImageData(600, 300, 80, 80).data;
    let hasVariation = false;
    for (let i = 0; i < data.length; i += 16) {
      if (data[i] !== 30 || data[i+1] !== 167 || data[i+2] !== 97) {
        hasVariation = true;
        break;
      }
    }
    return hasVariation;
  });
  console.log(`In-game (canvas has content): ${inGame}`);

  // 4. Check DOM state
  const domAfter = await page.evaluate(() => {
    const menu = document.querySelector('.menu');
    const death = document.querySelector('.death');
    const petals = document.querySelector('.petals-collected');
    
    // Check if game canvas has content
    const canvas = document.getElementById('canvas');
    let canvasContent = 'empty';
    if (canvas) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        const sample = ctx.getImageData(640, 360, 5, 5).data;
        let nonBg = 0;
        for (let i = 0; i < sample.length; i += 4) {
          if (Math.abs(sample[i] - 30) + Math.abs(sample[i+1] - 167) + Math.abs(sample[i+2] - 97) > 30) {
            nonBg++;
          }
        }
        canvasContent = `5x5 sample: ${nonBg}/25 non-bg pixels`;
      }
    }
    
    return {
      menuDisplay: menu?.style.display,
      deathDisplay: death?.style.display,
      hasPetalsCollected: !!petals,
      canvasContent,
      url: window.location.href,
    };
  });
  console.log('\n=== DOM State After ===');
  console.log(JSON.stringify(domAfter, null, 2));

  // 5. Try WASD and Space
  console.log('\n=== Sending game inputs ===');
  for (let i = 0; i < 20; i++) {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(100);
  }
  await page.keyboard.up('KeyW');

  // Press Space multiple times
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
  }

  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/ingame.png' });

  // 6. Final canvas check
  const finalState = await page.evaluate(() => {
    const info = {};
    const canvas = document.getElementById('canvas');
    if (canvas) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        // Sample multiple points
        const points = [];
        for (let x = 100; x < 1180; x += 200) {
          for (let y = 50; y < 670; y += 200) {
            const d = ctx.getImageData(x, y, 1, 1).data;
            points.push({ x, y, color: `rgb(${d[0]},${d[1]},${d[2]})` });
          }
        }
        info.points = points;
        
        // Check for non-green elements
        const nonBg = [];
        for (let x = 300; x < 980; x += 15) {
          for (let y = 100; y < 620; y += 15) {
            const d = ctx.getImageData(x, y, 1, 1).data;
            const diff = Math.abs(d[0] - 30) + Math.abs(d[1] - 167) + Math.abs(d[2] - 97);
            if (diff > 50 && d[3] > 100) {
              nonBg.push({ x, y, r: d[0], g: d[1], b: d[2] });
              if (nonBg.length >= 20) break;
            }
          }
          if (nonBg.length >= 20) break;
        }
        info.nonBgElements = nonBg;
        info.nonBgCount = nonBg.length;
      }
    }
    return info;
  });
  console.log('\n=== Final Canvas State ===');
  console.log(JSON.stringify(finalState, null, 2));

  await browser.close();
  console.log('\nDone!');
}

testPlay().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
