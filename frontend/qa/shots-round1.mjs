// Round 1 screenshots on the MOCK only (no real names): candidate "Bigger picture" + admin "Assembly access".
// node qa/shots-round1.mjs  → qa/out/round1/*.png
import { createRequire } from 'module';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'))); }
const BASE = 'http://localhost:5176';
const OUT = 'qa/out/round1'; fs.mkdirSync(OUT, { recursive: true });
const LAPTOP = { width: 1366, height: 820 }, PHONE = { width: 390, height: 844 };
const settle = async (p) => { await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForFunction(() => !document.querySelector('.cv-content .cv-skel, .cv-content .cv-spin'), null, { timeout: 8000 }).catch(() => {}); await p.waitForTimeout(400); };
async function open(browser, as, viewport) {
  const ctx = await browser.newContext({ viewport, hasTouch: viewport === PHONE });
  const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: as, password: 'local' } });
  const { user } = await login.json();
  await ctx.addInitScript((u) => { localStorage.setItem('edm_user', JSON.stringify(u)); localStorage.setItem('edm_last_active', String(Date.now())); }, user);
  return { ctx, page: await ctx.newPage() };
}
const b = await chromium.launch();
let { ctx, page } = await open(b, 'candidate', LAPTOP);
await page.goto(`${BASE}/assembly-analytics`); await settle(page);
await page.screenshot({ path: `${OUT}/laptop-candidate-assembly-analytics.png` });
await page.goto(`${BASE}/candidate-briefing`); await settle(page);
await page.screenshot({ path: `${OUT}/laptop-candidate-briefing.png` });
await ctx.close();
({ ctx, page } = await open(b, 'candidate', PHONE));
await page.goto(`${BASE}/candidate`); await settle(page);
await page.locator('.cv-topbar button[aria-label*="menu" i], .cv-topbar .cv-burger, .cv-topbar button').first().click().catch(() => {});
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/phone-candidate-menu.png` });
await ctx.close();
({ ctx, page } = await open(b, 'ward', PHONE));
await page.goto(`${BASE}/candidate`); await settle(page);
await page.locator('.cv-content button', { hasText: /Activate plan/i }).first().click();
await page.waitForSelector('[role=dialog]'); await page.waitForTimeout(300);
await page.locator('[role=dialog] input[inputmode="numeric"]').scrollIntoViewIfNeeded().catch(() => {});
await page.screenshot({ path: `${OUT}/phone-activate-utr-label.png` });
await ctx.close();
({ ctx, page } = await open(b, 'admin', LAPTOP));
await page.goto(`${BASE}/assemblies`); await settle(page);
await page.screenshot({ path: `${OUT}/laptop-admin-assembly-access.png` });
await ctx.close();
await b.close();
console.log(fs.readdirSync(OUT).join('\n'));
