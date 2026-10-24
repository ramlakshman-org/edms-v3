// First-screen views (no scrolling) of login and register at common laptop sizes, on the MOCK.
// node qa/shots-fold.mjs  → qa/out/edms1/fold-*.png
import { createRequire } from 'module';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'))); }
const BASE = process.env.QA_BASE || 'http://[::1]:5176';
const OUT = 'qa/out/edms1'; fs.mkdirSync(OUT, { recursive: true });
// browser window inner sizes: 1366x768 and 1536x864 laptops (≈110px of browser bars), 1440x900, 1920x1080
const sizes = [[1366, 657], [1536, 754], [1440, 790], [1920, 970]];
const b = await chromium.launch();
for (const pg of ['login', 'register']) for (const [w, h] of sizes) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  await ctx.addInitScript(() => localStorage.setItem('edm_lang', 'en'));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/${pg}`); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(500);
  const m = await page.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const a = r('.en-backdrop'); return { artTop: Math.round(a.top), artH: Math.round(a.height), towersFrom: Math.round(a.bottom - a.height * 0.73), lead: Math.round(r('.en-lead').bottom), tiles: Math.round(r('.en-tiles').bottom), view: innerHeight, sideways: document.documentElement.scrollWidth - innerWidth }; });
  console.log(pg, `${w}x${h}`, JSON.stringify(m));
  await page.screenshot({ path: `${OUT}/fold-${pg}-${w}x${h}.png` });
  await ctx.close();
}
await b.close();
