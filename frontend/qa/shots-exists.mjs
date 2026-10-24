// The "already registered" panel on the MOCK (sample account number 9000000012, not a real person), desktop and phone.
// node qa/shots-exists.mjs  → qa/out/edms1/exists-*.png
import { createRequire } from 'module';
import { execSync } from 'child_process';
import path from 'path';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'))); }
const BASE = process.env.QA_BASE || 'http://[::1]:5176';
const b = await chromium.launch();
for (const [name, viewport, lang] of [['1440-en', { width: 1440, height: 900 }, 'en'], ['390-ta', { width: 390, height: 844 }, 'ta']]) {
  const ctx = await b.newContext({ viewport, reducedMotion: 'reduce' });
  await ctx.addInitScript((l) => localStorage.setItem('edm_lang', l), lang);
  const page = await ctx.newPage();
  await page.goto(BASE + '/register'); await page.waitForLoadState('networkidle').catch(() => {});
  await page.locator('#full_name').fill('Sample Name'); await page.locator('#mobile').fill('9000000012');
  await page.locator('#next').click(); await page.locator('#role').selectOption('confirmed');
  await page.locator('.en-opt').nth(1).click(); await page.locator('#next').click();
  await page.locator('.en-opt').nth(1).click();
  await page.locator('#position').selectOption({ index: 1 }); await page.locator('#district').selectOption({ index: 1 });
  await page.locator('#assembly').selectOption({ index: 1 }); await page.waitForTimeout(1200);
  if (await page.locator('.en-booth').count()) await page.locator('.en-booth').first().click();
  await page.locator('button[type=submit]').click(); await page.waitForSelector('.en-exists');
  await page.locator('.en-card').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `qa/out/edms1/exists-${name}.png` });
  await ctx.close();
}
await b.close();
console.log('ok');
