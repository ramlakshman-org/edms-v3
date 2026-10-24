// Incomplete registrations page on the MOCK (fictional sample people), laptop and phone.
// node qa/shots-leads.mjs  → qa/out/leads/*.png
import { createRequire } from 'module';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'))); }
const BASE = process.env.QA_BASE || 'http://[::1]:5176';
const OUT = 'qa/out/leads'; fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
for (const [name, viewport] of [['laptop', { width: 1366, height: 820 }], ['phone', { width: 390, height: 844 }]]) {
  const ctx = await b.newContext({ viewport, hasTouch: name === 'phone', reducedMotion: 'reduce' });
  const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'admin', password: 'local' } });
  const { user } = await login.json();
  await ctx.addInitScript((u) => { localStorage.setItem('edm_user', JSON.stringify(u)); localStorage.setItem('edm_last_active', String(Date.now())); }, user);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/incomplete-registrations`); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: name === 'phone' });
  await ctx.close();
}
await b.close();
console.log('ok');
