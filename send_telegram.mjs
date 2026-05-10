import { chromium } from 'playwright';
import { existsSync } from 'fs';

const CHROME_PATH = 'C:\\Users\\zhouz\\AppData\\Local\\ms-playwright\\chromium-1224\\chrome-win64\\chrome.exe';
const ZIP_PATH = 'D:\\Z计划\\zorr-bot-extension.zip';

async function sendToTelegram() {
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: false,
  });

  let contextOptions = { viewport: { width: 1280, height: 800 } };
  if (existsSync('telegram_auth.json')) {
    contextOptions.storageState = 'telegram_auth.json';
  }
  const context = await browser.newContext(contextOptions);

  const page = await context.newPage();

  try {
    console.log('Opening Telegram Web...');
    await page.goto('https://web.telegram.org/a/', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(5000);

    // Check if we're logged in
    const currentUrl = page.url();
    if (currentUrl.includes('login') || currentUrl === 'https://web.telegram.org/a/') {
      // Might need to wait for QR scan or phone login
      console.log('Login may be required. Please scan QR code or log in.');
      console.log('Waiting for login...');
      
      // Wait for the main chat area to appear (user logged in)
      console.log('请在打开的浏览器窗口中扫描二维码登录 Telegram...');
      try {
        await page.waitForSelector('.chat-list, .dialogs, .Chat', { timeout: 180000 });
        console.log('Login detected!');
      } catch {
        console.log('Login timeout. Trying to proceed...');
      }
    }

    await page.waitForTimeout(2000);

    // Search for "小南梁"
    console.log('Searching for 小南梁...');
    
    // Try to click the search input
    const searchInput = await page.$('input[type="text"], input.search, .search input, [placeholder*="Search"]');
    if (searchInput) {
      await searchInput.click();
      await searchInput.fill('小南梁');
    } else {
      // Try pressing Ctrl+K or clicking search icon
      await page.keyboard.press('Control+k');
      await page.waitForTimeout(500);
      await page.keyboard.type('小南梁');
    }
    
    await page.waitForTimeout(2000);

    // Click on the chat result
    const chatResult = await page.$(`text=小南梁`);
    if (chatResult) {
      await chatResult.click();
      console.log('Chat opened!');
    } else {
      // Try finding by selector
      const chatItems = await page.$$('.chat-item, .dialog, .ChatListItem');
      for (const item of chatItems) {
        const text = await item.textContent();
        if (text.includes('小南梁')) {
          await item.click();
          console.log('Chat found and opened!');
          break;
        }
      }
    }

    await page.waitForTimeout(2000);

    // Send the file
    console.log('Sending file...');
    
    // Find the file attachment button
    const attachBtn = await page.$('button[title*="Attach"], button[title*="attachment"], .attach, [title*="Attach"]');
    if (attachBtn) {
      await attachBtn.click();
      await page.waitForTimeout(1000);
    }

    // Try to find file input
    const fileInput = await page.$('input[type="file"]');
    if (fileInput) {
      await fileInput.setInputFiles(ZIP_PATH);
      console.log('File selected!');
      await page.waitForTimeout(2000);

      // Send (press Enter or click send)
      const sendBtn = await page.$('button[title*="Send"], button[aria-label*="Send"], .send');
      if (sendBtn) {
        await sendBtn.click();
      } else {
        await page.keyboard.press('Enter');
      }
      
      console.log('File sent!');
    } else {
      console.log('Could not find file input. Trying drag and drop...');
      
      // Try to find the message input area for drag and drop
      const messageArea = await page.$('.message-input, .input-message, [contenteditable]');
      if (messageArea) {
        const box = await messageArea.boundingBox();
        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await page.waitForTimeout(500);
          
          // Use file chooser
          const [fileChooser] = await Promise.all([
            page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null),
            page.keyboard.press('Control+Shift+o'), // Some shortcut
          ]);
          
          if (fileChooser) {
            await fileChooser.setFiles(ZIP_PATH);
            await page.waitForTimeout(1000);
            await page.keyboard.press('Enter');
            console.log('File sent via file chooser!');
          }
        }
      }
    }

    // Save auth state for next time
    await context.storageState({ path: 'telegram_auth.json' });
    console.log('Auth state saved.');

    await page.waitForTimeout(3000);
  } catch (err) {
    console.error('Error:', err.message);
    await page.screenshot({ path: 'screenshots/telegram_error.png' });
  } finally {
    await browser.close();
  }
}

sendToTelegram().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
