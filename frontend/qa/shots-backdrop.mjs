// Backdrop review (Ram, 2026-10-14): login and register at desktop, tablet and phone on the MOCK, plus the layout facts
// the brief asks for — no sideways scroll, art not behind the words or the card's form, FAQ untouched, nothing loaded on phones.
// node qa/shots-backdrop.mjs  → qa/out/edms1/backdrop-*.png
import { createRequire } from 'module';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'))); }
const BASE = process.env.QA_BASE || 'http://[::1]:5176';
const OUT = 'qa/out/edms1'; fs.mkdirSync(OUT, { recursive: true });
const sizes = [['1440', { width: 1440, height: 900 }], ['1024', { width: 1024, height: 900 }], ['768', { width: 768, height: 1024 }], ['390', { width: 390, height: 844 }]];
const b = await chromium.launch();
let bad = 0;
for (const pg of ['login', 'register']) for (const [name, viewport] of sizes) for (const lang of name === '1440' ? ['en', 'ta'] : ['en']) {
  const ctx = await b.newContext({ viewport, deviceScaleFactor: name === '390' ? 3 : 1, reducedMotion: 'reduce' });
  await ctx.addInitScript((l) => localStorage.setItem('edm_lang', l), lang);
  const page = await ctx.newPage();
  const art = []; page.on('request', (r) => { if (r.url().includes('/entry/temple-town-')) art.push(r.url().split('/').pop()); });
  await page.goto(`${BASE}/${pg}`); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(600);
  const shot = async () => { await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: `${OUT}/backdrop-${pg}-${name}-${lang}.png`, fullPage: true }); if (name === '1440') await page.screenshot({ path: `${OUT}/backdrop-${pg}-${name}-${lang}-fold.png` }); };
  const m = await page.evaluate(() => {
    const box = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left, right: r.right }; };
    const bd = document.querySelector('.en-backdrop'); const cs = bd && getComputedStyle(bd);
    return { sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth, art: box('.en-backdrop'), shown: cs && cs.display !== 'none', pe: cs && cs.pointerEvents, z: cs && cs.zIndex,
      tiles: box('.en-tiles'), lead: box('.en-lead'), form: box('.en-card form') || box('.en-card'), more: box('.en-more'), split: box('.en-split'),
      hit: (() => { const t = [...document.querySelectorAll('.en-tile')].pop(); if (!t) return null; t.scrollIntoView({ block: 'center' }); const r = t.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return e && e.closest('.en-tile') ? 'tile' : e?.className; })() };
  });
  // the picture is "contain"ed in the box, anchored bottom-left; the tallest tower's tip is 27% down the picture (above is sky)
  const artTop = m.art ? (() => { const w = m.art.right - m.art.left, h = m.art.bottom - m.art.top, ih = Math.min(w / 2, h); return m.art.bottom - ih * 0.73; })() : null;
  const facts = { page: pg, size: name, lang, sideways: m.sideways, shown: m.shown, pointerEvents: m.pe, z: m.z, files: art,
    clearOfTiles: m.shown && viewport.width <= 1080 ? artTop >= m.tiles.bottom - 2 : true, inFirstScreen: m.art ? m.art.top < viewport.height - 120 || viewport.width <= 1080 : false, insideSplit: m.shown ? m.art.bottom <= m.split.bottom + 1 : true, faqBelow: m.more ? (!m.shown || m.art.bottom <= m.more.top + 1) : 'n/a', tileOnTop: m.hit };
  const ok = facts.sideways === 0 && facts.clearOfTiles && facts.inFirstScreen && facts.insideSplit && facts.faqBelow !== false && facts.tileOnTop === 'tile' && facts.shown && facts.pointerEvents === 'none' && art.length === 1;
  if (!ok) bad++;
  console.log((ok ? 'ok   ' : 'FAIL ') + JSON.stringify(facts));
  await shot();
  await ctx.close();
}
await b.close();
console.log(bad ? `${bad} failed` : 'all ok');
process.exit(bad ? 1 : 0);
