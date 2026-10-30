import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { url } = JSON.parse(await readFile('.dev/server.json', 'utf8'));
const browser = await chromium.launch({ channel: 'msedge', headless: true, timeout: 20000 });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) console.log('CONSOLE', message.text().slice(0, 2500)); });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(3000);
  console.log('INITIAL', (await page.locator('body').innerText()).slice(0, 5500));
  await page.screenshot({ path: '.dev/before-panel.png', fullPage: true });
  if (process.argv.includes('--inspect')) { await browser.close(); process.exit(0); }
  const welcome = page.getByRole('button', { name: '继续', exact: true });
  if (await welcome.isVisible()) await welcome.click();
  console.log('AFTER_WELCOME', (await page.locator('body').innerText()).slice(-3500));
  await page.screenshot({ path: '.dev/after-welcome.png', fullPage: true });
  if (process.argv.includes('--welcome')) { await browser.close(); process.exit(0); }
  const close = page.getByRole('button', { name: /^(关闭|Close)$/ });
  if (await close.count()) await close.last().click();
  else await page.keyboard.press('Escape');
  const entry = page.getByRole('button', { name: '任务资料夹', exact: true });
  if (await entry.count()) await entry.click();
  await page.waitForTimeout(1500);
  console.log((await page.locator('body').innerText()).slice(0, 8000));
  console.log('PAGE_ERRORS', JSON.stringify(errors));
  await page.screenshot({ path: '.dev/first-load.png', fullPage: true });
  await writeFile('.dev/browser-errors.json', JSON.stringify(errors));
} finally { await browser.close(); }
