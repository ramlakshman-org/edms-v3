// Screenshots of the WhatsApp Features page (layout A) on the mock: laptop + phone, each tab.
import { createRequire } from 'module';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'))); }
const BASE = process.env.QA_BASE || 'http://localhost:5176';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', 'wf-layout-a');
const b = await chromium.launch();
for (const [name, viewport] of [['laptop', { width: 1280, height: 800 }], ['phone', { width: 375, height: 812 }]]) {
  const ctx = await b.newContext({ viewport, deviceScaleFactor: 1 });
  const body = await (await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'admin', mobile: 'admin', password: 'admin', passcode: 'admin' } })).json();
  await ctx.addInitScript((u) => { localStorage.setItem('edm_user', JSON.stringify(u)); localStorage.setItem('edm_last_active', String(Date.now())); }, body.user);
  const p = await ctx.newPage();
  for (const tab of ['switches', 'activity', 'setup']) {
    await p.goto(`${BASE}/whatsapp-features${tab === 'switches' ? '' : `?tab=${tab}`}`); await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(700);
    if (tab === 'switches') { const how = p.locator('.cv-wf-how summary').first(); await how.click(); }
    await p.screenshot({ path: path.join(OUT, `${name}-${tab}.png`), fullPage: true });
  }
  // an unsaved change shows the save bar
  await p.goto(`${BASE}/whatsapp-features`); await p.waitForTimeout(700);
  await p.locator('[data-feature="payment_reminders"] [data-mode="all"]').click();
  await p.screenshot({ path: path.join(OUT, `${name}-unsaved.png`), fullPage: false });
  console.log(name, 'scrollWidth', await p.evaluate(() => document.documentElement.scrollWidth), 'viewport', viewport.width);
  await ctx.close();
}
await b.close();
