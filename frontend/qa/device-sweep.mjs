// Device sweep (Ram, 2026-10-17: "all device optimization, admin as well as users"): every page for every role at
// seven screen sizes, against the LOCAL MOCK only (http://localhost:5176 — no real data). Measures, per page × size:
//   sideways — the page itself scrolls sideways (the body is wider than the screen)
//   offscreen — elements sticking out past the screen edge that are NOT inside their own scroll box
//   clipped  — text cut off by its box without an ellipsis
//   small    — visible text under 13 px (the project floor)
//   taps     — on touch sizes (≤ 1024 px): buttons/links/fields smaller than 44 × 44 px (inline text links excluded)
//   errors   — console errors on the page
// Usage: node qa/device-sweep.mjs [--shots] [--only=<role>] [--widths=360,768]
// Output: qa/out/devices/results.json + summary.md (+ screenshots with --shots in qa/out/devices/<width>/)
import { createRequire } from 'module';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'))); }

const BASE = process.env.QA_BASE || 'http://localhost:5176';
if (!/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(BASE)) { console.error('local mock only'); process.exit(2); }
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', 'devices');
const ARG = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const SIZES = [
  { name: 'phone-360', width: 360, height: 740, touch: true },
  { name: 'phone-390', width: 390, height: 844, touch: true },
  { name: 'tablet-768', width: 768, height: 1024, touch: true },
  { name: 'tablet-1024', width: 1024, height: 768, touch: true },
  { name: 'laptop-1280', width: 1280, height: 800, touch: false },
  { name: 'desktop-1440', width: 1440, height: 900, touch: false },
  { name: 'wide-1920', width: 1920, height: 1080, touch: false },
].filter((s) => !ARG.widths || String(ARG.widths).split(',').includes(String(s.width)));

const PAGES = {
  public: ['/login', '/register', '/faq', '/terms', '/privacy'], // Tamil (the default for visitors)
  'public-en': ['/login', '/register', '/faq', '/terms', '/privacy'],
  admin: ['/dashboard', '/registrations', '/registrations/view/:reg', '/registrations/edit/:reg', '/incomplete-registrations', '/payments', '/payments/setup',
    '/mla-list', '/mla-list?tab=flags', '/assemblies', '/assemblies/1', '/voters?assemblyId=1', '/booths', '/assembly-analytics', '/booth-report',
    '/candidate-briefing', '/field-operations', '/flow-images', '/flow-simulator', '/whatsapp-features', '/whatsapp-features?tab=activity', '/whatsapp-features?tab=setup', '/ward-logins'],
  candidate: ['/candidate', '/voters', '/performance-report', '/broadcast', '/broadcast/reports', '/assembly-analytics', '/booth-report', '/candidate-briefing', '/field-operations'],
  ward: ['/candidate', '/voters', '/performance-report'],
  mla: ['/assembly-details', '/voters', '/booth-report', '/candidate-briefing', '/field-operations'],
  booth: ['/booth-login'],
};

// runs inside the page
function measure({ width, touch }) {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05; };
  const label = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
  const clippedByScroller = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const ox = getComputedStyle(p).overflowX; if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true; } return false; };
  // intentional, not counted: the closed phone menu (slid off-screen), visually hidden screen-reader text, the skip link
  // until focused, the map library's credit line, and the WhatsApp look-alike in Flow Simulator (copies WhatsApp's sizes)
  const sidebar = document.querySelector('.cv-sidebar');
  const menuClosed = sidebar && getComputedStyle(sidebar).transform !== 'none' && sidebar.getBoundingClientRect().right <= 1;
  const srOnly = (el) => { for (let p = el; p && p !== document.body; p = p.parentElement) { const cs = getComputedStyle(p); if (cs.clip === 'rect(0px, 0px, 0px, 0px)' || cs.clipPath === 'inset(50%)' || (p.getBoundingClientRect().width <= 1 && cs.overflow === 'hidden')) return true; } return false; };
  const skip = (el) => (menuClosed && sidebar.contains(el)) || el.closest('.leaflet-control-attribution, .wa-screen, .sim-phone-col') || (el.matches('.cv-skip, .cv-skip *') && el.getBoundingClientRect().bottom <= 0) || srOnly(el);
  const all = [...document.querySelectorAll('body *')].filter((el) => !el.closest('svg, script, style, noscript, iframe') && !skip(el));
  const out = { sideways: document.documentElement.scrollWidth > width + 1 ? document.documentElement.scrollWidth - width : 0, offscreen: [], clipped: [], small: [], taps: [] };
  const seen = new Set();
  for (const el of all) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if ((r.right > width + 1 || r.left < -1) && !clippedByScroller(el) && getComputedStyle(el).position !== 'fixed') {
      const k = label(el); if (!seen.has('o' + k)) { seen.add('o' + k); out.offscreen.push(`${k} (${Math.round(r.left)}→${Math.round(r.right)})`); }
    }
    const cs = getComputedStyle(el);
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (ownText && parseFloat(cs.fontSize) < 13) { const k = label(el); if (!seen.has('s' + k)) { seen.add('s' + k); out.small.push(`${k} ${cs.fontSize} "${el.textContent.trim().slice(0, 30)}"`); } }
    if (ownText && (cs.overflow === 'hidden' || cs.overflowX === 'hidden') && cs.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 2 && cs.whiteSpace === 'nowrap') {
      const k = label(el); if (!seen.has('c' + k)) { seen.add('c' + k); out.clipped.push(`${k} "${el.textContent.trim().slice(0, 30)}"`); }
    }
  }
  if (touch) {
    const ctl = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=radio]')].filter(vis).filter((el) => !skip(el));
    for (const el of ctl) {
      if (el.closest('.cv-sidebar') && getComputedStyle(el.closest('.cv-sidebar')).transform !== 'none') continue; // closed phone menu
      const cs = getComputedStyle(el);
      if (el.tagName === 'A' && cs.display === 'inline' && el.parentElement && /\S/.test([...el.parentElement.childNodes].filter((n) => n !== el).map((n) => n.textContent).join(''))) continue; // link inside a sentence
      if (el.tagName === 'INPUT' && el.closest('.cv-search') && el.closest('.cv-search').getBoundingClientRect().height >= 44) continue; // the 44px search frame takes the tap
      if (el.type === 'checkbox' || el.type === 'radio') { const lab = el.closest('label'); if (lab && lab.getBoundingClientRect().height >= 44) continue; }
      const r = el.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) { const k = `${label(el)} ${Math.round(r.width)}×${Math.round(r.height)} "${(el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 20)}"`; out.taps.push(k); }
    }
  }
  return out;
}

const browser = await chromium.launch();
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const sessions = {};
async function contextFor(role, size) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch, isMobile: size.touch && size.width < 700, deviceScaleFactor: 1 });
  if (!role.startsWith('public')) {
    if (!sessions[role]) {
      const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: role, password: 'local' } });
      const j = await r.json();
      if (!j.success) throw new Error(`mock login ${role}: ${j.message}`);
      sessions[role] = { cookies: await ctx.cookies(), user: j.user };
    } else await ctx.addCookies(sessions[role].cookies);
    await ctx.addInitScript((u) => { localStorage.setItem('edm_user', JSON.stringify(u)); localStorage.setItem('edm_last_active', String(Date.now())); }, sessions[role].user);
  } else if (role === 'public-en') await ctx.addInitScript(() => { localStorage.setItem('edm_lang', 'en'); });
  return ctx;
}

let regId = null;
for (const [role, pages] of Object.entries(PAGES)) {
  if (ARG.only && ARG.only !== role) continue;
  for (const size of SIZES) {
    const ctx = await contextFor(role, size);
    if (!regId && role === 'admin') regId = (await (await ctx.request.get(`${BASE}/api/registrations?page=1&pageSize=1`)).json()).rows?.[0]?._id;
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 140)));
    for (const p of pages) {
      const url = p.replace(':reg', regId || 'x');
      errors.length = 0;
      await page.goto(BASE + url).catch(() => {});
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForFunction(() => !document.querySelector('.cv-skel, .cv-spin'), null, { timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(400);
      const m = await page.evaluate(measure, { width: size.width, touch: size.touch }).catch((e) => ({ error: e.message }));
      results.push({ role, page: p, size: size.name, width: size.width, ...m, errors: [...new Set(errors)].filter((e) => !/favicon|DevTools/.test(e)) });
      if (ARG.shots) {
        const dir = path.join(OUT, String(size.width));
        fs.mkdirSync(dir, { recursive: true });
        await page.screenshot({ path: path.join(dir, `${role}${p.replace(/[/?=:]/g, '_')}.png`), fullPage: true }).catch(() => {});
      }
    }
    await ctx.close();
    process.stdout.write(`${role} @ ${size.name} done\n`);
  }
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), base: BASE, results }, null, 1));

// summary: one line per problem kind per page, with the widths it happens at
const kinds = ['sideways', 'offscreen', 'clipped', 'small', 'taps', 'errors'];
const lines = [];
const byPage = {};
for (const r of results) {
  const key = `${r.role} ${r.page}`;
  for (const k of kinds) {
    const v = r[k];
    const bad = k === 'sideways' ? v > 0 : Array.isArray(v) && v.length > 0;
    if (!bad) continue;
    ((byPage[key] ||= {})[k] ||= []).push({ w: r.width, n: k === 'sideways' ? `${v}px` : v.length, sample: k === 'sideways' ? '' : v.slice(0, 3).join(' | ') });
  }
}
const totals = Object.fromEntries(kinds.map((k) => [k, results.filter((r) => (k === 'sideways' ? r[k] > 0 : r[k]?.length)).length]));
lines.push(`# Device sweep — ${new Date().toISOString().slice(0, 16)} UTC (mock)`, '', `${results.length} page × size views. Views with a problem: ${kinds.map((k) => `${k} ${totals[k]}`).join(', ')}.`, '');
for (const [key, ks] of Object.entries(byPage).sort()) {
  lines.push(`## ${key}`);
  for (const [k, list] of Object.entries(ks)) lines.push(`- **${k}** at ${list.map((x) => `${x.w}${x.n !== 1 ? ` (${x.n})` : ''}`).join(', ')} — ${list[0].sample}`);
  lines.push('');
}
fs.writeFileSync(path.join(OUT, 'summary.md'), lines.join('\n'));
console.log(`\n${results.length} views. Views with a problem: ${kinds.map((k) => `${k} ${totals[k]}`).join(', ')}`);
console.log(`Summary: ${path.join(OUT, 'summary.md')}`);
