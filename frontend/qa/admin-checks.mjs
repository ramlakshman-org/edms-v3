// Admin QA checks for the round-6 fix list (25 tasks found on the live read-only walk, 2026-10-13).
// One check per task, written BEFORE its fix: a check must fail first (proving it sees the problem),
// pass after the fix, and keep passing while the later tasks are done (regression).
//
// Runs headless Chromium (Playwright) against the local mock only: Vite :5176 -> devmock :5199.
// Never point this at the live site; it presses Approve/Regenerate/Remove to see where errors land.
//
//   node qa/admin-checks.mjs            all checks
//   node qa/admin-checks.mjs 1 3 15     only those tasks
//
// Mock QA knobs used here (cookies, see devmock/server.mjs): edm_fail=bot|flowsim|settings|writes, edm_slow=<ms>.
// Results: qa/out/results.json; a screenshot per failing check in qa/out/.
import { createRequire } from 'module';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'))); }

// Target: the local mock (default), or STAGING (QA_TARGET=staging: https://tnedms.online, a copy of the app DB
// behind a basic-auth wall; see EDM/STAGING.md). Never live. Staging needs QA_WALL=user:pass and QA_USERS=<json>
// with {admin,candidate,ward,mla}:{username,password} — staging-only accounts, never Ram's real login.
const STAGING = process.env.QA_TARGET === 'staging';
const BASE = STAGING ? 'https://tnedms.online' : (process.env.QA_BASE || 'http://localhost:5176');
if (!STAGING && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) { console.error(`Refusing to run against ${BASE}: local mock or staging only.`); process.exit(2); }
const WALL = STAGING ? (() => { const [username, password] = String(process.env.QA_WALL || '').split(':'); if (!username || !password) { console.error('QA_WALL=user:pass required for staging'); process.exit(2); } return { username, password }; })() : null;
const USERS = STAGING ? JSON.parse(fs.readFileSync(process.env.QA_USERS, 'utf8')) : null;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
fs.mkdirSync(OUT, { recursive: true });

const LAPTOP = { width: 1280, height: 800 };
const PHONE = { width: 375, height: 812 };

// ---------- helpers ----------
// QA_SESSIONS=<file> (e2e/run.mjs): share one login per role across all test files — the backend allows 20 logins per 15 min
const SESSIONS_FILE = process.env.QA_SESSIONS || '';
const sessions = SESSIONS_FILE && fs.existsSync(SESSIONS_FILE) ? JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')) : {}; // role -> { cookies, user }: log in once per role (staging allows 10 logins a minute)
async function open(browser, { viewport = LAPTOP, cookies = {}, touch = false, as = 'admin' } = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, ...(WALL ? { httpCredentials: WALL } : {}) });
  // roles: admin, candidate (paid), ward (unpaid candidate), mla — mock logins, or the staging QA accounts
  if (!sessions[as]) {
    const creds = STAGING ? { username: USERS[as].username, password: USERS[as].password } : { username: as, password: 'local' };
    const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: creds });
    const body = await login.json();
    if (!body.success) throw new Error(`login as ${as} failed: ${body.message}`);
    sessions[as] = { cookies: await ctx.cookies(), user: body.user };
    if (SESSIONS_FILE) fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions));
  } else {
    await ctx.addCookies(sessions[as].cookies);
  }
  const { user } = sessions[as];
  const extra = Object.entries(cookies).map(([name, value]) => ({ name, value: String(value), url: BASE }));
  if (extra.length) await ctx.addCookies(extra);
  await ctx.addInitScript((u) => { localStorage.setItem('edm_user', JSON.stringify(u)); localStorage.setItem('edm_last_active', String(Date.now())); }, user);
  const page = await ctx.newPage();
  return { ctx, page };
}
async function go(page, url) {
  await page.goto(BASE + url);
  await page.waitForLoadState('networkidle').catch(() => {});
  await settle(page);
  // A blank page (e.g. a module that doesn't compile) must never pass a "nothing is wrong here" check.
  if (!(await page.locator('.cv-shell .cv-content h1').count())) throw new Error(`page did not render: ${url}`);
}
async function settle(page, ms = 8000) {
  await page.waitForFunction(() => !document.querySelector('.cv-content .cv-skel, .cv-content .cv-spin'), null, { timeout: ms }).catch(() => {});
  await page.waitForTimeout(250);
}
const text = (page, sel = '.cv-content') => page.locator(sel).first().innerText().catch(() => '');
const pass = (detail) => ({ pass: true, detail });
const fail = (detail) => ({ pass: false, detail });
const firstRegId = async (page) => (await (await page.request.get(`${BASE}/api/registrations?page=1&pageSize=1`)).json()).rows?.[0]?._id;
// where an error message is after a failed action in a dialog: inside it, on the page behind, or nowhere
async function errorPlacement(page) {
  return page.evaluate(() => {
    const dlg = document.querySelector('.cv-modal');
    const found = [...document.querySelectorAll('.cv-alert, [role=alert]')].filter((a) => /refused|fail|error|couldn/i.test(a.innerText) && a.getClientRects().length);
    return { dialogOpen: !!dlg, inside: found.some((a) => dlg?.contains(a)), behind: found.some((a) => !dlg?.contains(a)) };
  });
}
async function tooSmall(page, { exemptInline = true } = {}) {
  return page.evaluate((exempt) => [...document.querySelectorAll('.cv-content a, .cv-content button, .cv-content input:not([type=hidden]), .cv-content select, .leaflet-control a')]
    .filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden'; })
    .filter((e) => !(exempt && e.closest('p') && e.tagName === 'A' && !e.classList.contains('cv-back'))) // WCAG 2.5.8 inline-link exception (a stand-alone Back link is not inline)
    .filter((e) => !e.closest('.leaflet-control-attribution'))
    .filter((e) => { const t = e.closest('label') || e; const b = t.getBoundingClientRect(); return b.height < 44 || b.width < 44; })
    .map((e) => `${e.tagName.toLowerCase()}${e.className ? '.' + String(e.className).split(' ')[0] : ''} "${(e.innerText || e.title || e.getAttribute('aria-label') || '').trim().slice(0, 18)}" ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`), exemptInline);
}

// ---------- the checks: one per task, success line from the agreed table ----------
const CHECKS = {
  1: { title: 'Voter mobiles masked; tap reveals; contact buttons work', run: async (b) => {
    const { ctx, page } = await open(b);
    await go(page, '/voters?assemblyId=1');
    const r = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('.cv-content td[data-label="Mobile"]')].map((td) => td.innerText.trim());
      const col = cells.length ? 0 : -1;
      const digits = (c) => c.replace(/\D/g, '').length;
      return { col, full: cells.filter((c) => digits(c) >= 10 && !/[•*x]{3,}/i.test(c)).length, masked: cells.filter((c) => /[•*x]{3,}\s?\d{4}$/i.test(c)).length, contact: document.querySelectorAll('.cv-content a[href^="tel:"], .cv-content a[href^="sms:"], .cv-content a[href*="wa.me"]').length };
    });
    // tap to reveal: the first masked number shows all 10 digits after its reveal button
    const cell = page.locator('.cv-content td[data-label="Mobile"]', { hasText: /[•*x]{3,}/i }).first();
    let revealed = false;
    if (await cell.count()) {
      const h = await cell.elementHandle(); // the same cell after the click (the locator would move on to the next masked one)
      await (await h.$('button'))?.click().catch(() => {}); await page.waitForTimeout(200);
      revealed = (await h.innerText()).replace(/\D/g, '').length >= 10;
    }
    await page.locator('.cv-content button[title="View full record"]').first().click();
    await page.waitForSelector('.cv-modal', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(800);
    const modalFull = /(?:\d[\s-]?){10}/.test((await text(page, '.cv-modal')).replace(/[•*x]{3,}\s?\d{4}/gi, ''));
    await ctx.close();
    const ok = r.col >= 0 && r.full === 0 && r.masked > 0 && r.contact > 0 && revealed && !modalFull;
    return (ok ? pass : fail)(`list: ${r.full} full, ${r.masked} masked, ${r.contact} contact links; tap reveals: ${revealed}; full record shows full number: ${modalFull}`);
  } },
  2: { title: 'Privacy note in the voter full record', run: async (b) => {
    const { ctx, page } = await open(b);
    await go(page, '/voters?assemblyId=1');
    await page.locator('.cv-content button[title="View full record"]').first().click();
    await page.waitForSelector('.cv-modal', { timeout: 5000 }).catch(() => {});
    // wait for the record to load (a fixed 0.8 s wait failed once on staging, 2026-10-17 e2e run); a missing note still fails
    await page.waitForFunction(() => /DPDP|personal data|privacy/i.test(document.querySelector('.cv-modal')?.innerText || ''), null, { timeout: 8000 }).catch(() => {});
    const t = await text(page, '.cv-modal'); await ctx.close();
    return /DPDP|personal data|privacy/i.test(t) ? pass('note present') : fail('no privacy note in the full record');
  } },
  3: { title: 'A failed action shows its error inside the dialog; closing clears it', mockOnly: true, run: async (b) => {
    const out = [];
    const tryIt = async (url, openBtn, confirmName) => {
      const { ctx, page } = await open(b, { cookies: { edm_fail: 'writes' } });
      await go(page, url);
      await openBtn(page);
      await page.waitForSelector('.cv-modal', { timeout: 4000 }).catch(() => {});
      await page.locator('.cv-modal button', { hasText: confirmName }).last().click();
      await page.waitForTimeout(1200);
      const during = await errorPlacement(page);
      await page.keyboard.press('Escape'); await page.waitForTimeout(400);
      const after = await errorPlacement(page);
      await ctx.close();
      return { url, ok: during.inside && !during.behind && !after.behind, during, after };
    };
    out.push(await tryIt('/assemblies', (p) => p.locator('.cv-content tbody tr').first().locator('button', { hasText: 'Regenerate' }).click(), /^Regenerate$/));
    out.push(await tryIt('/mla-list?tab=flags', (p) => p.locator('.cv-content button[title="Remove flag"]').first().click(), /^Remove$/));
    out.push(await tryIt('/flow-images', async (p) => {
      await p.locator('.cv-content .cv-tab').nth(1).click();
      await p.locator('.cv-content button', { hasText: /Older flow assets/ }).click();
      await p.locator('.cv-content button', { hasText: /^Remove$/ }).first().click();
    }, /^Remove$/));
    const bad = out.filter((o) => !o.ok);
    return (bad.length ? fail : pass)(out.map((o) => `${o.url}: inside=${o.during.inside} behind=${o.during.behind} afterClose=${o.after.behind ? 'stale' : 'clear'}`).join(' | '));
  } },
  4: { title: 'Bot Messages: failed load shows "couldn\'t load", no healthy-looking tiles', mockOnly: true, run: async (b) => {
    const { ctx, page } = await open(b, { cookies: { edm_fail: 'bot' } });
    await go(page, '/flow-images');
    const t = await text(page); await ctx.close();
    const healthy = /all on the built-in wording|nothing pending/i.test(t) || /(^|\n)Saved(\n|$)/.test(t);
    const honest = /couldn.t load|could not load/i.test(t);
    // guard: when the wording does load, the page is normal (real counts, no warning)
    const n = await open(b); await go(n.page, '/flow-images'); const tn = await text(n.page); await n.ctx.close();
    const normal = !/couldn.t load/i.test(tn) && /MESSAGES\s*\n?\s*[1-9]/i.test(tn);
    const emptyEditor = /Pick a message on the left/i.test(t); // no editor or preview for wording that isn't there
    return (!healthy && honest && !emptyEditor && normal ? pass : fail)(`failed load - healthy-looking: ${healthy}, says couldn't load: ${honest}, empty editor shown: ${emptyEditor}; normal load fine: ${normal}`);
  } },
  5: { title: 'Flow Simulator says when saved flows could not load', mockOnly: true, run: async (b) => {
    const { ctx, page } = await open(b, { cookies: { edm_fail: 'flowsim' } });
    await go(page, '/flow-simulator');
    const t = await text(page); await ctx.close();
    const n = await open(b); await go(n.page, '/flow-simulator'); const tn = await text(n.page);
    const saved = await n.page.locator('select[aria-label="Saved flow"] option').count(); await n.ctx.close();
    const normal = !/couldn.t load/i.test(tn) && saved > 1;
    return (/couldn.t load|could not load/i.test(t) && normal ? pass : fail)(`failed load says so: ${/couldn.t load/i.test(t)}; normal load: ${saved - 1} saved flows, no warning: ${normal}`);
  } },
  6: { title: '"Route not found." replaced by plain words', mockOnly: true, run: async (b) => {
    const { ctx, page } = await open(b, { cookies: { edm_fail: 'bot,settings' } });
    const res = [];
    for (const u of ['/payments/setup', '/flow-images']) { await go(page, u); const t = await text(page); res.push({ u, raw: t.includes('Route not found.'), plain: /server update|backend update|not on the live site/i.test(t) }); }
    await ctx.close();
    return (res.every((r) => !r.raw && r.plain) ? pass : fail)(res.map((r) => `${r.u}: raw=${r.raw} plain=${r.plain}`).join(' | '));
  } },
  7: { title: 'Nonexistent assembly: only "not found"', run: async (b) => {
    const { ctx, page } = await open(b);
    await go(page, '/assemblies/999'); await page.waitForTimeout(1500);
    const t = await text(page);
    const create = await page.locator('.cv-content button', { hasText: /Create login/ }).count();
    await ctx.close();
    const ok = /not found/i.test(t) && !/Loading…/.test(t) && create === 0;
    return (ok ? pass : fail)(`not found: ${/not found/i.test(t)}; Loading…: ${/Loading…/.test(t)}; Create login buttons: ${create}`);
  } },
  8: { title: 'Payments: no-match search says so (not "queue is clear")', run: async (b) => {
    const { ctx, page } = await open(b);
    await go(page, '/payments');
    await page.locator('.cv-content input[type=search], .cv-content .cv-search input').first().fill('zzqq');
    await page.waitForTimeout(700);
    const t = await text(page); await ctx.close();
    return (!/queue is clear/i.test(t) && /match/i.test(t) ? pass : fail)(`says queue is clear: ${/queue is clear/i.test(t)}; says no match: ${/match/i.test(t)}`);
  } },
  9: { title: 'Bell badge and "to tidy" count people/records', run: async (b) => {
    const { ctx, page } = await open(b);
    await go(page, '/dashboard');
    await page.waitForSelector('.cv-attn-chip', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const sum = (g) => [...document.querySelectorAll(`.cv-attn-group${g} .cv-attn-chip strong`)].reduce((s, e) => s + Number(e.innerText.replace(/\D/g, '')), 0);
      const pipeline = Number(document.querySelector('.cv-attn-chip[href*="booths-not-paid"] strong')?.innerText.replace(/\D/g, '') || 0); // A3: not in the badge
      return { badge: Number(document.querySelector('.cv-bell-badge')?.innerText.replace(/\D/g, '') || 0), waiting: sum(':not(.cv-attn-group--quiet)') - pipeline, pipeline, tidyLabel: document.querySelector('.cv-attn-fold-n')?.innerText || '', cleanup: sum('.cv-attn-group--quiet') };
    });
    await ctx.close();
    const tidy = Number(r.tidyLabel.replace(/\D/g, ''));
    const ok = r.waiting > 0 && r.cleanup > 0 && r.badge === r.waiting && tidy === r.cleanup; // zeros = nothing loaded, not a pass
    return (ok ? pass : fail)(`badge ${r.badge} vs people waiting ${r.waiting} (excl. ${r.pipeline} with booths, not paid); "to tidy" ${tidy} vs records ${r.cleanup}`);
  } },
  10: { title: 'Test-proofs chip opens only the test proofs, heading says so', run: async (b) => {
    const { ctx, page } = await open(b);
    await go(page, '/dashboard');
    const chip = page.locator('.cv-attn-chip', { hasText: /test payment proof/i }).first();
    if (!(await chip.count())) { await ctx.close(); return fail('no test-proofs chip on the dashboard (mock should have all-test pending proofs)'); }
    const n = Number((await chip.locator('strong').innerText()).replace(/\D/g, ''));
    await chip.click(); await settle(page);
    const url = page.url();
    const r = await page.evaluate(() => ({ rows: document.querySelectorAll('.cv-content tbody tr').length, allTest: [...document.querySelectorAll('.cv-content tbody tr')].every((tr) => /test entry/i.test(tr.innerText)), says: /test/i.test([...document.querySelectorAll('.cv-content .cv-subtitle, .cv-content .cv-chip, .cv-content .cv-tab--on, .cv-content h2')].map((e) => e.innerText).join(' ')) }));
    await ctx.close();
    const ok = /test/i.test(url) && r.says && r.allTest && r.rows === n;
    return (ok ? pass : fail)(`url has test filter: ${/test/i.test(url)}; page says "test": ${r.says}; rows ${r.rows} vs chip ${n}`);
  } },
  11: { title: 'Phone: long station name wraps in the report header', run: async (b) => {
    const { ctx, page } = await open(b, { viewport: PHONE });
    await go(page, '/booth-report?ac=27&booth=5');
    const over = await page.evaluate(() => [...document.querySelectorAll('.cv-content .cv-page-head *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).length);
    await ctx.close();
    return (over === 0 ? pass : fail)(`${over} header elements past the right edge`);
  } },
  12: { title: 'Phone: assembly voter-counts table reachable (scrolls in its box)', run: async (b) => {
    const { ctx, page } = await open(b, { viewport: PHONE });
    const res = [];
    // Live AC 27's bigger numbers pushed this table 13px past a 375px screen; the mock's numbers happen to fit.
    // So the check is structural as well: every table sits in a box that scrolls sideways and fits the screen.
    for (const ac of [5, 10, 27]) {
      await go(page, `/assemblies/${ac}`);
      // the scroll box must be the table's own (inside its card), not the page's main area, which clips
      res.push([ac, await page.evaluate(() => [...document.querySelectorAll('.cv-content table')].filter((t) => {
        const card = t.closest('.cv-card') || t.parentElement;
        let p = t.parentElement; while (p && p !== card.parentElement && !['auto', 'scroll'].includes(getComputedStyle(p).overflowX)) p = p.parentElement;
        return !p || p === card.parentElement || p.getBoundingClientRect().right > innerWidth + 1;
      }).length)]);
    }
    await ctx.close();
    return (res.every(([, n]) => n === 0) ? pass : fail)(res.map(([ac, n]) => `AC ${ac}: ${n} tables without a fitting scroll box`).join(' | '));
  } },
  13: { title: 'Phone: every control at least 44px (inline text links exempt)', run: async (b) => {
    const { ctx, page } = await open(b, { viewport: PHONE });
    const id = await firstRegId(page);
    const found = [];
    for (const u of [`/registrations/view/${id}`, `/registrations/edit/${id}`, '/assemblies/1', '/booth-report?ac=1&booth=1', '/assembly-analytics?ac=1', '/assembly-analytics?ac=1&tab=documents', '/flow-images', '/payments?show=test', '/registrations?show=no-booths', '/voters?assemblyId=1&gender=Female']) {
      await go(page, u);
      if (u === '/flow-images') { await page.locator('.cv-content .cv-tab').nth(1).click().catch(() => {}); await page.locator('.cv-content button', { hasText: /Older flow assets/ }).click().catch(() => {}); await page.waitForTimeout(400); }
      for (const s of await tooSmall(page)) found.push(`${u} ${s}`);
    }
    await ctx.close();
    return (found.length ? fail : pass)(found.length ? found.join(" | ") : 'all ≥44px');
  } },
  14: { title: 'Phone: list starts within the first screen (<700px)', run: async (b) => {
    const { ctx, page } = await open(b, { viewport: PHONE });
    const res = [];
    for (const u of ['/mla-list', '/assemblies', '/booths?ac=1', '/voters?assemblyId=1']) { await go(page, u); res.push([u, await page.evaluate(() => Math.round((document.querySelector('.cv-content tbody tr')?.getBoundingClientRect().top ?? 9999) + scrollY))]); }
    await ctx.close();
    return (res.every(([, y]) => y < 700) ? pass : fail)(res.map(([u, y]) => `${u} ${y}px`).join(' | '));
  } },
  15: { title: 'Chart: tap/click on a bar shows its number', run: async (b) => {
    const res = [];
    for (const touch of [false, true]) {
      const { ctx, page } = await open(b, { viewport: touch ? PHONE : LAPTOP, touch });
      await go(page, '/dashboard');
      const bar = page.locator('.cv-bars-col').nth(await page.evaluate(() => { const c = [...document.querySelectorAll('.cv-bars-col')]; let best = 0; c.forEach((e, i) => { if (e.firstChild.getBoundingClientRect().height > c[best].firstChild.getBoundingClientRect().height) best = i; }); return best; }));
      await bar.scrollIntoViewIfNeeded();
      if (touch) await bar.tap(); else { await bar.hover(); await bar.click(); }
      await page.waitForTimeout(300);
      res.push([touch ? 'tap' : 'click', await page.locator('.cv-bars-tip').count() > 0]);
      // the reading is on top: at its centre, the topmost element is the tip itself, not a bar
      // (the tip ignores the pointer by design, so it is made hit-testable just for this measurement)
      res.push(['reading on top', await page.evaluate(() => { const t = document.querySelector('.cv-bars-tip'); if (!t) return false; t.style.pointerEvents = 'auto'; const r = t.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); t.style.pointerEvents = ''; return t.contains(top); })]);
      if (touch) { // tapping elsewhere clears the reading
        await page.locator('.cv-content h1').tap(); await page.waitForTimeout(250);
        res.push(['tap elsewhere clears', await page.locator('.cv-bars-tip').count() === 0]);
      } else { // the keyboard path still reads bars
        await page.locator('.cv-bars-plot').focus(); await page.keyboard.press('End'); await page.waitForTimeout(200);
        res.push(['keyboard End', /registration/.test(await page.locator('.cv-bars-wrap [aria-live]').innerText())]);
      }
      await ctx.close();
    }
    return (res.every(([, v]) => v) ? pass : fail)(res.map(([k, v]) => `${k}: ${v ? 'shows' : 'nothing'}`).join(' | '));
  } },
  16: { title: 'Chart wording: "in <month>" for months', run: async (b) => {
    const { ctx, page } = await open(b);
    await go(page, '/dashboard');
    await page.locator('.cv-seg-btn', { hasText: 'All' }).click(); await page.waitForTimeout(300);
    const s = await text(page, '.cv-bars-summary'); await ctx.close();
    return (!/ on [A-Z][a-z]+ \d{4}/.test(s) ? pass : fail)(`summary: "${s}"`);
  } },
  17: { title: 'Paid bar not green; serious clean-up items keep red', run: async (b) => {
    const { ctx, page } = await open(b);
    await go(page, '/dashboard');
    const r = await page.evaluate(() => {
      const root = getComputedStyle(document.querySelector('.cv-shell') || document.documentElement);
      const okDot = root.getPropertyValue('--cv-ok-dot').trim();
      const toRgb = (c) => { const d = document.createElement('div'); d.style.color = c; document.body.appendChild(d); const v = getComputedStyle(d).color; d.remove(); return v; };
      const last = document.querySelector('.cv-funnel-last'); const bar = last ? getComputedStyle(last).backgroundColor : '';
      const badIcons = [...document.querySelectorAll('.cv-attn-group--quiet .cv-attn-chip--bad svg')].map((s) => getComputedStyle(s).color);
      return { green: bar === toRgb(okDot), bad: toRgb(root.getPropertyValue('--cv-bad-dot').trim()), badIcons };
    });
    await ctx.close();
    // no serious clean-up item at all (clean data, e.g. staging after the paid-status fix) is fine: nothing to colour
    const redKept = r.badIcons.every((c) => c === r.bad);
    return (!r.green && redKept ? pass : fail)(`paid bar green: ${r.green}; clean-up red icons kept: ${redKept} (${r.badIcons.length} bad item${r.badIcons.length === 1 ? '' : 's'}${r.badIcons.length ? '' : ' — nothing to tidy'})`);
  } },
  18: { title: 'Dashboard footer in plain words', run: async (b) => {
    const { ctx, page } = await open(b);
    await go(page, '/dashboard');
    const t = await text(page, '.cv-foot'); await ctx.close();
    return (!/\bAPI\b/.test(t) ? pass : fail)(`footer: "${t.replace(/\s+/g, ' ').slice(0, 90)}"`);
  } },
  19: { title: '"Assign" is a real action to that candidate\'s booth assignment', run: async (b) => {
    const { ctx, page } = await open(b);
    await go(page, '/registrations?show=no-booths');
    const r = await page.evaluate(() => { const cell = document.querySelector('.cv-content tbody tr td[data-label="Booths"]'); const a = cell?.querySelector('a, button'); return { control: a ? a.tagName : null, label: a?.innerText.trim(), href: a?.getAttribute('href') || '' }; });
    // and it really opens that candidate's booth picker
    let opens = false;
    if (r.control) { await page.locator('.cv-content tbody tr td[data-label="Booths"] a, .cv-content tbody tr td[data-label="Booths"] button').first().click(); await page.waitForSelector('.cv-modal', { timeout: 6000 }).catch(() => {}); opens = /Assign booths/i.test(await text(page, '.cv-modal')); }
    await ctx.close();
    const ok = r.control && /assign/i.test(r.label || '') && (r.control === 'BUTTON' || /\/registrations\/view\//.test(r.href)) && opens;
    return (ok ? pass : fail)(`booths cell control: ${r.control || 'none'} "${r.label || ''}" ${r.href}; opens the booth picker: ${opens}`);
  } },
  20: { title: '"With booths, not paid" waiting item opens exactly its rows', run: async (b) => {
    const { ctx, page } = await open(b);
    await go(page, '/dashboard');
    const chip = page.locator('.cv-attn-group:not(.cv-attn-group--quiet) .cv-attn-chip', { hasText: /not paid/i }).first();
    if (!(await chip.count())) { await ctx.close(); return fail('no "not paid" item under Waiting on you'); }
    const n = Number((await chip.locator('strong').innerText()).replace(/\D/g, ''));
    await chip.click(); await settle(page);
    const sub = await text(page, '.cv-subtitle'); await ctx.close();
    const m = Number((sub.match(/^([\d,]+)/) || [])[1]?.replace(/,/g, ''));
    return (m === n ? pass : fail)(`chip ${n}; list says "${sub}"`);
  } },
  21: { title: 'Cloudinary thumbnails requested small (w_ transform)', run: async (b) => {
    const { ctx, page } = await open(b);
    await go(page, '/mla-list');
    const srcs = await page.evaluate(() => [...document.querySelectorAll('.cv-content img')].map((i) => i.getAttribute('src')).filter((s) => /res\.cloudinary\.com/.test(s || '')));
    // and the small version really loads (not a broken image) and really is small
    await page.waitForFunction(() => [...document.querySelectorAll('.cv-content img')].filter((i) => /cloudinary/.test(i.src)).every((i) => i.complete), null, { timeout: 15000 }).catch(() => {});
    const got = await page.evaluate(() => [...document.querySelectorAll('.cv-content img')].filter((i) => /cloudinary/.test(i.src)).map((i) => ({ w: i.naturalWidth, kb: Math.round((performance.getEntriesByName(i.src)[0]?.encodedBodySize || 0) / 1024) })));
    await ctx.close();
    if (!srcs.length) return fail('no Cloudinary image on the page to check');
    const small = srcs.filter((s) => /\/upload\/[^/]*w_\d+/.test(s));
    const loaded = got.every((g) => g.w > 0 && g.w <= 200);
    return (small.length === srcs.length && loaded ? pass : fail)(`${small.length}/${srcs.length} request a small size; loaded: ${got.map((g) => `${g.w}px${g.kb ? ` ${g.kb}KB` : ''}`).join(', ')}`);
  } },
  22: { title: 'Voters: Indian grouping in the pager; loading sign on page change', mockOnly: true, run: async (b) => {
    const { ctx, page } = await open(b, { cookies: { edm_slow: 1500 } });
    await go(page, '/voters?assemblyId=1');
    const pager = await text(page, '.cv-pager');
    const grouped = /of \d{1,2}(,\d{2})*,\d{3}\b/.test(pager);
    await page.locator('.cv-pager button[aria-label*="ext"], .cv-pager button[title*="ext"]').first().click();
    await page.waitForTimeout(400);
    const loading = await page.evaluate(() => !!document.querySelector('.cv-content .cv-skel, .cv-content .cv-spin, .cv-content [aria-busy="true"]'));
    await ctx.close();
    return (grouped && loading ? pass : fail)(`pager "${pager.replace(/\s+/g, ' ').slice(0, 40)}" grouped: ${grouped}; loading sign: ${loading}`);
  } },
  23: { title: 'Labels: "Yes or No" kept; one name for test registrations', run: async (b) => {
    const { ctx, page } = await open(b);
    await go(page, '/registrations?show=invalid-paid');
    const sub = await text(page, '.cv-subtitle');
    const opt = await page.evaluate(() => [...document.querySelectorAll('select[aria-label="Show"] option')].find((o) => o.value === 'test')?.text || '');
    await ctx.close();
    const ok = /Yes or No/.test(sub) && /test registrations/i.test(opt);
    return (ok ? pass : fail)(`subtitle "${sub}"; Show option "${opt}"`);
  } },
  24: { title: 'Booth search "12": booth 12 comes first', run: async (b) => {
    const { ctx, page } = await open(b);
    const res = [];
    await go(page, '/booth-report?ac=27');
    await page.locator('input[aria-label="Search booths"]').fill('12'); await page.waitForTimeout(600);
    res.push(['booth report', await page.evaluate(() => document.querySelector('.cv-content tbody tr td')?.innerText.trim())]);
    await go(page, '/booths?ac=27&q=12');
    res.push(['booths', await page.evaluate(() => document.querySelector('.cv-content tbody tr td')?.innerText.trim())]);
    await ctx.close();
    return (res.every(([, v]) => v === '12') ? pass : fail)(res.map(([k, v]) => `${k}: first row ${v}`).join(' | '));
  } },
  25: { title: 'Accessibility leftovers: skip link, arrow keys, closed menu, one bar colour', run: async (b) => {
    const r = {};
    { const { ctx, page } = await open(b); await go(page, '/dashboard');
      await page.keyboard.press('Tab'); r.skip = /skip/i.test(await page.evaluate(() => document.activeElement?.innerText || ''));
      await page.locator('.cv-seg-btn', { hasText: '30D' }).focus(); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200);
      r.arrows = await page.evaluate(() => document.querySelector('.cv-seg-btn--on')?.innerText === '90D');
      r.colours = await page.evaluate(() => new Set([...document.querySelectorAll('.cv-barlist-track > span')].map((s) => getComputedStyle(s).backgroundColor)).size <= 1);
      await ctx.close(); }
    { const { ctx, page } = await open(b, { viewport: PHONE }); await go(page, '/dashboard');
      r.menu = await page.evaluate(() => { const sb = document.querySelector('.cv-sidebar'); return !!sb && (sb.inert || sb.getAttribute('aria-hidden') === 'true' || getComputedStyle(sb).visibility === 'hidden'); });
      // ...and once opened it works: not inert, and a menu link navigates
      await page.locator('.cv-nav-toggle').click(); await page.waitForTimeout(300);
      const openOk = await page.evaluate(() => !document.querySelector('.cv-sidebar').inert);
      await page.locator('.cv-sidebar a', { hasText: 'Payments' }).first().click(); await page.waitForTimeout(600);
      r.menu = r.menu && openOk && /\/payments/.test(page.url());
      await ctx.close(); }
    const ok = r.skip && r.arrows && r.menu && r.colours;
    return (ok ? pass : fail)(`skip link ${r.skip}; arrow keys ${r.arrows}; closed menu out of Tab order ${r.menu}; one bar colour ${r.colours}`);
  } },
  26: { title: 'Unpaid candidate: Performance report lists booths without numbers; paid sees all', run: async (b) => {
    const look = async (as) => {
      const { ctx, page } = await open(b, { as });
      await go(page, '/performance-report');
      const r = await page.evaluate(() => {
        const cells = (label) => [...document.querySelectorAll(`.cv-content td[data-label="${label}"]`)].map((td) => td.innerText.trim());
        const nums = ['Total', 'Male', 'Female', 'Other'].flatMap(cells).filter((c) => /\d/.test(c)).length;
        const tiles = [...document.querySelectorAll('.cv-content .cv-kpi-value')].map((v) => v.innerText.trim());
        return { rows: document.querySelectorAll('.cv-content tbody tr').length, nums, tileNums: tiles.filter((t) => /\d/.test(t)).length, reports: [...document.querySelectorAll('.cv-content button, .cv-content a')].filter((x) => /Open report/i.test(x.innerText)).length, unlock: /unlock/i.test(document.querySelector('.cv-content').innerText) };
      });
      await ctx.close();
      return r;
    };
    const unpaid = await look('ward'); const paid = await look('candidate');
    const ok = unpaid.rows > 0 && unpaid.nums === 0 && unpaid.tileNums === 0 && unpaid.reports === 0 && unpaid.unlock && paid.rows > 0 && paid.nums > 0 && paid.tileNums > 0;
    return (ok ? pass : fail)(`unpaid: ${unpaid.rows} booths, ${unpaid.nums} numbers in rows, ${unpaid.tileNums} number tiles, ${unpaid.reports} report buttons, says unlock ${unpaid.unlock} | paid: ${paid.rows} booths, ${paid.nums} numbers, ${paid.tileNums} number tiles`);
  } },
  27: { title: 'Activate plan pop-up: civic dialog, nothing cut off, QR + UPI + total visible on a phone', run: async (b) => {
    const look = async (viewport, touch) => {
      const { ctx, page } = await open(b, { as: 'ward', viewport, touch });
      await go(page, '/candidate');
      await page.locator('.cv-content button', { hasText: /Activate plan/i }).first().click();
      await page.waitForSelector('[role=dialog]', { timeout: 5000 }).catch(() => {});
      // the QR comes from Cloudinary: wait for it to load (a slow fetch is not a layout fault)
      await page.waitForFunction(() => { const i = document.querySelector('[role=dialog] img[alt*="QR"]'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => {
        const d = document.querySelector('[role=dialog]');
        if (!d) return { dialog: false };
        const inView = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; };
        const byText = (sel, re) => [...d.querySelectorAll(sel)].find((e) => re.test(e.innerText || e.textContent || ''));
        const qr = d.querySelector('img[alt*="QR"]');
        const box = d.getBoundingClientRect();
        const small = [...d.querySelectorAll('button, input:not([type=hidden]), a')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && !(e.closest('p') && e.tagName === 'A') && (r.height < 44 || r.width < 44); }).map((e) => `${e.tagName.toLowerCase()} "${(e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 16)}" ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
        return {
          dialog: true, civic: d.classList.contains('cv-modal'),
          fits: box.top >= 0 && box.bottom <= innerHeight + 1,
          title: inView(d.querySelector('.cv-modal-head h2')), close: inView(d.querySelector('[aria-label="Close"]')),
          qr: inView(qr) && qr.complete && qr.naturalWidth > 0, qrSmall: /\/upload\/[^/]*w_\d+/.test(qr?.src || ''),
          upi: inView(byText('*', /@okaxis/)), total: inView(byText('*', /^Total/)),
          emoji: /[\u{1F300}-\u{1FAFF}☀-➿]/u.test(d.innerText), small,
        };
      });
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      r.escClosed = !(await page.locator('[role=dialog]').count());
      await ctx.close();
      return r;
    };
    const ph = await look({ width: 390, height: 844 }, true); const lp = await look(LAPTOP, false);
    const okOne = (r) => r.dialog && r.civic && r.fits && r.title && r.close && r.qr && r.qrSmall && r.upi && r.total && !r.emoji && r.escClosed;
    const ok = okOne(ph) && okOne(lp) && ph.small.length === 0;
    const line = (n, r) => `${n}: ${r.dialog ? `civic ${r.civic}, fits ${r.fits}, title ${r.title}, close ${r.close}, QR ${r.qr} (small ${r.qrSmall}), UPI ${r.upi}, total ${r.total}, emoji ${r.emoji}, Esc closes ${r.escClosed}${n === 'phone' ? `, <44px: ${r.small.length ? r.small.join('; ') : 'none'}` : ''}` : 'no dialog'}`;
    return (ok ? pass : fail)(`${line('phone', ph)} | ${line('laptop', lp)}`);
  } },
  28: { title: 'Report files need an app login (C10): no login → refused; admin and assembly login → the report', run: async (b) => {
    const file = `${BASE}/report-files/Booth_Reports/${encodeURIComponent('ASS 1 Booth Reports')}/Booth_1_Report.html`;
    // no app login at all (only the staging wall, when there is one)
    const anon = await b.newContext(WALL ? { httpCredentials: WALL } : {});
    const a = await anon.request.get(file); const anonStatus = a.status(); await anon.close();
    const asRole = async (as) => { const { ctx } = await open(b, { as }); const r = await ctx.request.get(file); const out = { status: r.status(), html: /<html/i.test((await r.text()).slice(0, 2000)) }; await ctx.close(); return out; };
    const admin = await asRole('admin'); const mla = await asRole('mla');
    const ok = anonStatus !== 200 && admin.status === 200 && admin.html && mla.status === 200 && mla.html;
    return (ok ? pass : fail)(`no login → ${anonStatus}; admin → ${admin.status}${admin.html ? ' (report)' : ''}; assembly login → ${mla.status}${mla.html ? ' (report)' : ''}`);
  } },
  29: { title: 'paid_status stored as 1 still counts as paid (B5): login says Yes, Home active, report has numbers', run: async (b) => {
    const { ctx, page } = await open(b, { as: 'legacy' });
    const login = sessions.legacy.user.paid_status;
    await go(page, '/candidate');
    const home = await page.evaluate(() => ({ activate: [...document.querySelectorAll('.cv-shell button')].filter((x) => /Activate plan/i.test(x.innerText)).length, pro: /\bPRO\b/.test(document.querySelector('.cv-shell')?.innerText || '') }));
    await go(page, '/performance-report');
    const nums = await page.evaluate(() => [...document.querySelectorAll('.cv-content td[data-label="Total"]')].filter((td) => /\d/.test(td.innerText)).length);
    await ctx.close();
    const ok = login === 'Yes' && home.activate === 0 && home.pro && nums > 0;
    return (ok ? pass : fail)(`login paid_status "${login}"; Home: Activate buttons ${home.activate}, PRO badge ${home.pro}; Performance report rows with numbers ${nums}`);
  } },
  30: { title: 'Payments › Received lists booth-plan candidates (C11): count ≥ 1, revenue > 0', run: async (b) => {
    const { ctx, page } = await open(b);
    const subs = await (await page.request.get(`${BASE}/api/payments/subscriptions`)).json();
    const rows = subs.subscriptions || [];
    await go(page, '/payments?tab=paid');
    const ui = await page.evaluate(() => ({ kpi: (document.querySelector('.cv-content .cv-kpi-value')?.innerText || '').trim(), rows: document.querySelectorAll('.cv-content tbody tr').length, revenue: /₹\s?[1-9]/.test(document.querySelector('.cv-content')?.innerText || '') }));
    await ctx.close();
    const g11rows = rows.filter((r) => Number(r.user_group_id) === 11); const g11 = g11rows.length;
    const TIERS = [2360, 5900, 11800, 29500, 59000]; // booth plans incl. GST; 25,000 is the MLA fallback and never right for a candidate
    const badAmounts = g11rows.filter((r) => !TIERS.includes(Number(r.amount))).map((r) => r.amount);
    const ok = rows.length >= 1 && g11 >= 1 && ui.rows === rows.length && ui.revenue && badAmounts.length === 0;
    return (ok ? pass : fail)(`API: ${rows.length} received (${g11} booth-plan, amounts ${g11rows.map((r) => `₹${r.amount}/${r.amount_source || '?'}`).join(' ')}${badAmounts.length ? ` — NOT a plan price: ${badAmounts.join(',')}` : ''}); page: ${ui.rows} rows, revenue shown ${ui.revenue}`);
  } },
  31: { title: '"Without mobile" voter filter works (C12): has_mobile=0 → only voters with no mobile', run: async (b) => {
    const { ctx, page } = await open(b);
    const get = async (qs) => (await page.request.get(`${BASE}/api/voters?assemblyId=1&pageSize=50&${qs}`)).json();
    const [all, with_, without] = await Promise.all([get(''), get('has_mobile=1'), get('has_mobile=0')]);
    await ctx.close();
    const has = (v) => String(v.MOBILE_NUMBER ?? v.mobile ?? '').replace(/\D/g, '').length >= 10 || /\*/.test(String(v.MOBILE_NUMBER ?? v.mobile ?? ''));
    const rows = (r) => r.rows || r.voters || [];
    const wrongWithout = rows(without).filter(has).length, wrongWith = rows(with_).filter((v) => !has(v)).length;
    const ok = rows(without).length > 0 && wrongWithout === 0 && wrongWith === 0 && Number(without.total) < Number(all.total) && Number(without.total) + Number(with_.total) === Number(all.total);
    return (ok ? pass : fail)(`all ${all.total}; with mobile ${with_.total} (${wrongWith} wrong); without mobile ${without.total} (${wrongWithout} wrong of ${rows(without).length} on page 1)`);
  } },
  32: { title: 'Server hides voter numbers from unpaid candidates (C13): booth list only, no report links; paid sees all', run: async (b) => {
    const look = async (as) => {
      const { ctx, page } = await open(b, { as });
      const r = await (await page.request.get(`${BASE}/api/reports/booth`)).json();
      const l = await (await page.request.get(`${BASE}/api/reports/booth-report-list`)).json();
      await ctx.close();
      const rows = r.rows || [];
      return { booths: rows.length, nums: rows.filter((x) => ['total', 'male', 'female', 'other'].some((k) => Number.isFinite(x[k]))).length, totals: r.totals ? 'present' : 'none', locked: !!r.locked, reports: (l.booths || []).length };
    };
    const unpaid = await look('ward'); const paid = await look('candidate');
    const ok = unpaid.booths > 0 && unpaid.nums === 0 && unpaid.totals === 'none' && unpaid.locked && unpaid.reports === 0 && paid.booths > 0 && paid.nums === paid.booths && paid.totals === 'present' && !paid.locked;
    return (ok ? pass : fail)(`unpaid: ${unpaid.booths} booths, ${unpaid.nums} with numbers, totals ${unpaid.totals}, locked ${unpaid.locked}, ${unpaid.reports} report links | paid: ${paid.booths} booths, ${paid.nums} with numbers, totals ${paid.totals}, ${paid.reports} report links`);
  } },
  33: { title: 'A1 + Round 1: a booth login lands on a notice page; admin has no Booth logins tab or menu item, page is "Assembly access"', run: async (b) => {
    const { ctx, page } = await open(b, { as: 'booth' });
    await page.goto(`${BASE}/`); await page.waitForLoadState('networkidle').catch(() => {}); await settle(page);
    const landing = page.url().replace(BASE, '');
    const txt = await page.locator('body').innerText();
    const navItems = await page.locator('.cv-nav a').count();
    await page.goto(`${BASE}/candidate`); await page.waitForLoadState('networkidle').catch(() => {}); await settle(page);
    const candidateBlocked = !/Welcome,/.test(await page.locator('body').innerText());
    await ctx.close();
    const { ctx: a, page: ap } = await open(b);
    await go(ap, '/assemblies?tab=booth&ac=1');
    const adminTxt = await ap.locator('.cv-content').innerText();
    const genButtons = await ap.locator('.cv-content button', { hasText: /Generate .*logins/i }).count();
    const boothTab = await ap.locator('.cv-content [role=tab]', { hasText: /Booth logins/i }).count();
    const navBooth = await ap.locator('.cv-nav a', { hasText: /Booth logins/i }).count();
    const titled = /Assembly access/.test(adminTxt);
    await a.close();
    const ok = /booth-login/.test(landing) && /not in use/i.test(txt) && /\+91/.test(txt) && navItems === 0 && candidateBlocked && genButtons === 0 && boothTab === 0 && navBooth === 0 && titled;
    return (ok ? pass : fail)(`lands on ${landing}; says "not in use" ${/not in use/i.test(txt)}, shows a contact number ${/\+91/.test(txt)}; menu items ${navItems}; /candidate blocked ${candidateBlocked}; admin: "Generate … logins" buttons ${genButtons}, Booth logins tab ${boothTab}, Booth logins menu item ${navBooth}, page titled "Assembly access" ${titled}`);
  } },
  34: { title: 'UX1: dashboard says one thing about paid — "Payments received" equals the pipeline\'s Paid', run: async (b) => {
    const { ctx, page } = await open(b);
    await go(page, '/dashboard');
    await page.waitForFunction(() => [...document.querySelectorAll('.cv-content .cv-kpi')].some((k) => /Payments received/i.test(k.innerText) && /\d/.test(k.querySelector('.cv-kpi-value')?.innerText || '')), null, { timeout: 15000 }).catch(() => {});
    const r = await page.evaluate(() => {
      const kpi = [...document.querySelectorAll('.cv-content .cv-kpi')].find((k) => /Payments received/i.test(k.innerText)); // the label is uppercased by CSS
      const received = Number((kpi?.querySelector('.cv-kpi-value')?.innerText || '').replace(/\D/g, ''));
      const step = [...document.querySelectorAll('.cv-content .cv-funnel li')].find((e) => /^\s*Paid/.test(e.innerText));
      const paid = step ? Number((step.querySelector('.cv-funnel-top strong')?.innerText || '').replace(/\D/g, '')) : NaN;
      return { received, paid, stepText: step?.innerText.replace(/\s+/g, ' ').slice(0, 80) || '(no Paid step)' };
    });
    await ctx.close();
    const ok = Number.isFinite(r.paid) && r.received === r.paid;
    return (ok ? pass : fail)(`Payments received ${r.received} vs pipeline Paid ${r.paid} ("${r.stepText}")`);
  } },
  35: { title: 'UX2: a candidate marked paid without a payment record is shown as that, not as a clean "Paid"', run: async (b) => {
    const { ctx, page } = await open(b);
    const list = (await (await page.request.get(`${BASE}/api/registrations?page=1&pageSize=200`)).json()).rows || [];
    let target = null;
    for (const r of list) { if (r.paid_status !== 'Yes') continue; const d = (await (await page.request.get(`${BASE}/api/registrations/${r._id}`)).json()).registration; if (d && d.paid_status === 'Yes' && !d.payment) { target = d; break; } }
    if (!target) { await ctx.close(); return STAGING ? pass('no candidate in this data is marked paid without a payment record — nothing to show (the mock has one)') : fail('no candidate that is paid without a payment record (mock should have one)'); }
    await go(page, `/registrations/view/${target._id}`);
    const r = await page.evaluate(() => { const card = [...document.querySelectorAll('.cv-content .cv-card')].find((c) => /^Payment/.test(c.innerText)); const pill = card?.querySelector('.cv-pill'); return { pill: pill?.innerText.trim() || '', tone: pill?.className || '', access: [...document.querySelectorAll('.cv-content .cv-card')].find((c) => /^Access/.test(c.innerText))?.innerText.replace(/\s+/g, ' ').slice(0, 160) || '' }; });
    await ctx.close();
    const ok = /no payment record/i.test(r.pill) && /warn/.test(r.tone);
    return (ok ? pass : fail)(`Payment pill "${r.pill}" (${/warn/.test(r.tone) ? 'amber' : 'not amber'})`);
  } },
  36: { title: 'UX4/5/10: registrations list without noise (paid only when Yes, no dangling dashes, one row menu, no passcodes, CSV export); voters Part column clean', run: async (b) => {
    const { ctx, page } = await open(b);
    await go(page, '/registrations');
    const r = await page.evaluate(() => {
      const heads = [...document.querySelectorAll('.cv-content thead th')].map((t) => t.innerText.trim());
      const cells = [...document.querySelectorAll('.cv-content tbody td')].map((t) => t.innerText.replace(/\s+/g, ' ').trim());
      const noPills = [...document.querySelectorAll('.cv-content tbody .cv-pill')].filter((p) => /^No$/.test(p.innerText.trim())).length;
      const dangling = cells.filter((c) => /·\s*[-–—]\s*$/.test(c) || /·\s*[-–]\s*·/.test(c)).length;
      const rows = document.querySelectorAll('.cv-content tbody tr').length;
      const menus = document.querySelectorAll('.cv-content tbody .cv-row-menu-btn').length;
      const iconBtns = document.querySelectorAll('.cv-content tbody .cv-row-actions .cv-icon-btn').length;
      const exportBtn = [...document.querySelectorAll('.cv-content button, .cv-content a')].find((x) => /Export/i.test(x.innerText))?.innerText.trim() || '';
      return { heads, noPills, dangling, rows, menus, iconBtns, exportBtn };
    });
    // the row menu opens with the four actions
    let menuItems = [];
    if (r.menus) { await page.locator('.cv-content tbody .cv-row-menu-btn').first().click(); await page.waitForTimeout(200); menuItems = await page.locator('.cv-row-menu a, .cv-row-menu button').allInnerTexts(); await page.keyboard.press('Escape'); }
    await go(page, '/voters?assemblyId=1');
    const partCells = await page.locator('.cv-content tbody td[data-label^="Part"]').allInnerTexts();
    const partDash = partCells.filter((c) => /[-–—]\s*$/.test(c.trim())).length;
    await ctx.close();
    const ok = r.rows > 0 && r.noPills === 0 && r.dangling === 0 && r.menus === r.rows && r.iconBtns === 0 && !r.heads.includes('Passcode') && /CSV/i.test(r.exportBtn) && ['Call', 'WhatsApp', 'View', 'Edit'].every((t) => menuItems.some((m) => new RegExp(t, 'i').test(m))) && partDash === 0;
    return (ok ? pass : fail)(`rows ${r.rows}: "No" pills ${r.noPills}, dangling dashes ${r.dangling}, row menus ${r.menus}, loose icon buttons ${r.iconBtns}, passcode column ${r.heads.includes('Passcode')}, export "${r.exportBtn}", menu items [${menuItems.join(', ')}]; voters Part cells ending in a dash ${partDash}/${partCells.length}`);
  } },
  37: { title: 'UX3/6/9 phone: EPIC search in the first screen; registrations filters folded and cards compact; payment cards compact', run: async (b) => {
    const { ctx, page } = await open(b, { viewport: PHONE, touch: true });
    await go(page, '/dashboard');
    const epicTop = await page.evaluate(() => Math.round(document.querySelector('.cv-content .cv-epic input, .cv-content input[placeholder*="EPIC"]')?.getBoundingClientRect().top ?? 99999));
    await go(page, '/registrations');
    const reg = await page.evaluate(() => ({ visibleSelects: [...document.querySelectorAll('.cv-content select')].filter((s) => s.getBoundingClientRect().height > 0).length, filterBtn: [...document.querySelectorAll('.cv-content .cv-filters-toggle')].some((x) => x.getBoundingClientRect().height > 0), cardHeights: [...document.querySelectorAll('.cv-content tbody tr')].slice(0, 5).map((t) => Math.round(t.getBoundingClientRect().height)) }));
    await go(page, '/payments');
    const pay = await page.evaluate(() => [...document.querySelectorAll('.cv-content tbody tr')].slice(0, 4).map((t) => Math.round(t.getBoundingClientRect().height)));
    await ctx.close();
    const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
    const ok = epicTop < 700 && reg.visibleSelects <= 1 && reg.filterBtn && avg(reg.cardHeights) <= 230 && avg(pay) <= 360; // was ~430 before the fold; real names run longer than the mock's
    return (ok ? pass : fail)(`EPIC search top ${epicTop}px; registrations: visible filter selects ${reg.visibleSelects}, Filters button ${reg.filterBtn}, card height avg ${avg(reg.cardHeights)}px; payment card height avg ${avg(pay)}px`);
  } },
  38: { title: 'UX7/8/10: one broadcast CTA on candidate Home; Logout lives in the account menu; station names not shouting', run: async (b) => {
    const { ctx, page } = await open(b, { as: 'candidate' });
    await go(page, '/candidate');
    const r = await page.evaluate(() => ({
      broadcastLinks: [...document.querySelectorAll('.cv-content a[href="/broadcast"], .cv-content a[href$="/broadcast"]')].length,
      topbarLogout: [...document.querySelectorAll('.cv-topbar button, .cv-topbar a')].filter((x) => /log ?out/i.test(x.innerText)).length,
      accountBtn: !!document.querySelector('.cv-topbar .cv-user-btn, .cv-topbar button.cv-user'),
      caps: [...document.querySelectorAll('.cv-content td[data-label="Polling station"]')].map((t) => t.innerText.trim()).filter((t) => t.length > 8 && t === t.toUpperCase() && /[A-Z]/.test(t)).length,
      stations: document.querySelectorAll('.cv-content td[data-label="Polling station"]').length,
    }));
    let menuLogout = false;
    if (r.accountBtn) { await page.locator('.cv-topbar .cv-user-btn, .cv-topbar button.cv-user').first().click(); await page.waitForTimeout(200); menuLogout = (await page.locator('.cv-user-menu button, .cv-user-menu a').filter({ hasText: /log ?out/i }).count()) > 0; }
    await ctx.close();
    const ok = r.broadcastLinks === 1 && r.topbarLogout === 0 && r.accountBtn && menuLogout && r.caps === 0;
    return (ok ? pass : fail)(`broadcast links on Home ${r.broadcastLinks}; Logout in the top bar ${r.topbarLogout}; account menu ${r.accountBtn} with Logout ${menuLogout}; ALL-CAPS station names ${r.caps}/${r.stations}`);
  } },
  39: { title: 'Bigger picture (Round 1): candidates get Assembly analytics (whole assembly), Booth report, Candidate briefing and Field operations; unpaid keeps the lock', run: async (b) => {
    const { ctx, page } = await open(b, { as: 'candidate' });
    await go(page, '/candidate');
    const navTexts = await page.locator('.cv-nav a').allInnerTexts();
    const wanted = ['Assembly analytics', 'Booth report', 'Candidate briefing', 'Field operations'];
    const navMissing = wanted.filter((w) => !navTexts.some((t) => new RegExp(w, 'i').test(t)));
    const analytics = await (await page.request.get(`${BASE}/api/reports/assembly-analytics`)).json();
    const mine = await (await page.request.get(`${BASE}/api/reports/booth`)).json();
    const mineTotal = Number(mine.totals?.total ?? 0); const mineBooths = (mine.rows || []).length;
    const whole = Number(analytics.total) > mineTotal && (analytics.booths || []).length > mineBooths;
    await go(page, '/assembly-analytics');
    const atxt = await page.locator('.cv-content').innerText();
    const analyticsPage = /voters/i.test(atxt) && !/Select assembly/.test(atxt) && /bigger picture/i.test(atxt);
    const boothsTab = await page.locator('.cv-content [role=tab]', { hasText: /^Booth report/ }).count();
    const adminLinks = await page.locator('.cv-content a[href^="/booths"]').count();
    await go(page, '/candidate-briefing');
    const btxt = await page.locator('.cv-content').innerText();
    const briefOk = ((await page.locator('.cv-content iframe').count()) > 0 || /not been generated|not available/i.test(btxt)) && /bigger picture/i.test(btxt);
    await ctx.close();
    const { ctx: c2, page: p2 } = await open(b, { as: 'ward' });
    await go(p2, '/booth-report');
    const ltxt = await p2.locator('.cv-content').innerText();
    const lockedOk = /with your plan/i.test(ltxt) && !/\d{3,}/.test(ltxt.split('\n').filter((l) => /with your plan/i.test(l)).join(''));
    const unpaidAnalytics = Number((await (await p2.request.get(`${BASE}/api/reports/assembly-analytics`)).json()).total) > 0;
    await c2.close();
    const ok = navMissing.length === 0 && whole && analyticsPage && boothsTab === 0 && adminLinks === 0 && briefOk && lockedOk && unpaidAnalytics;
    return (ok ? pass : fail)(`menu missing [${navMissing.join(', ')}]; analytics whole assembly ${whole} (assembly ${inrN(analytics.total)} voters / ${(analytics.booths || []).length} booths vs mine ${inrN(mineTotal)} / ${mineBooths}); analytics page ok ${analyticsPage}, Booth report tab ${boothsTab}, admin links ${adminLinks}; briefing ok ${briefOk}; unpaid: booth report locked ${lockedOk}, analytics still open ${unpaidAnalytics}`);
  } },
  40: { title: 'UTR wording (Round 1): the Activate plan pop-up and the admin Payments page say "UPI transaction ID (UTR)"', run: async (b) => {
    const { ctx, page } = await open(b, { as: 'ward' });
    await go(page, '/candidate');
    await page.locator('.cv-content button', { hasText: /Activate plan/i }).first().click();
    await page.waitForSelector('[role=dialog]');
    const dlg = await page.locator('[role=dialog]').innerText();
    await ctx.close();
    const { ctx: a, page: ap } = await open(b);
    await go(ap, '/payments');
    await ap.locator('.cv-pay-help summary').click().catch(() => {}); // the explainer is folded by default
    const ptxt = `${await ap.locator('.cv-content').innerText()}
${(await ap.locator('.cv-content thead th').allInnerTexts()).join(' | ')}`;
    await a.close();
    const popup = /UPI transaction ID \(UTR\)/.test(dlg) && !/UTR \/ transaction ID/.test(dlg);
    const admin = /UPI transaction ID \(UTR\)/.test(ptxt) && !/UTR \/ reference/.test(ptxt);
    return ((popup && admin) ? pass : fail)(`pop-up says "UPI transaction ID (UTR)" ${popup}; Payments page says it ${admin}`);
  } },
  41: { title: 'Public pages (EDMS-1, master reference): register in three real steps and sign-in in the same family; Tamil by default; the form validates, registers a test candidate and shows the login', run: async (b) => {
    const ctx = await b.newContext({ viewport: LAPTOP, ...(WALL ? { httpCredentials: WALL } : {}) });
    const page = await ctx.newPage();
    await page.goto(BASE + '/register'); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(800);
    const h1 = (await page.locator('.en h1').first().innerText()).trim();
    const tamilDefault = /[\u0B80-\u0BFF]/.test(h1);
    const oldTells = await page.evaluate(() => document.querySelectorAll('.tricolor-bar, .reg-step-no, .eyebrow, .gov-login-card').length);
    const realLogo = await page.locator('.en-brand img[src="/EDM-fav.png"]').count();
    const tiles = await page.locator('.en-tile').count();
    await page.locator('#lang').selectOption('en'); await page.waitForTimeout(200);
    const h1en = (await page.locator('.en h1').first().innerText()).trim();
    const steps = await page.locator('.en-step').count();
    const stepOn = async () => (await page.locator('.en-step.is-on').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    const s1 = await stepOn();
    const btnColor = await page.locator('.en-card .en-btn').first().evaluate((el) => getComputedStyle(el).color);
    await page.locator('#next').click(); await page.waitForTimeout(200);
    const err1 = (await page.locator('.en-error').innerText().catch(() => '')).trim();
    const mobile = '97' + String(Date.now()).slice(-8);
    await page.locator('#full_name').fill('QA Register Test');
    await page.locator('#mobile').fill(mobile);
    await page.locator('#next').click(); await page.waitForTimeout(250);
    const s2 = await stepOn();
    const roleSelect = await page.locator('#role').count();
    await page.locator('#role').selectOption('confirmed');
    await page.locator('.en-opt', { hasText: /Affiliated with a party/ }).click();
    await page.locator('#party').selectOption('Independent').catch(() => {});
    await page.locator('#next').click(); await page.waitForTimeout(250);
    const s3 = await stepOn();
    await page.locator('.en-opt', { hasText: /Urban local body/ }).click();
    await page.locator('#position').selectOption({ index: 1 }); await page.waitForTimeout(150);
    await page.locator('#district').selectOption({ index: 1 }); await page.waitForTimeout(150);
    await page.locator('#assembly').selectOption({ index: 1 }); await page.waitForTimeout(1500);
    const booths = await page.locator('.en-booth').count();
    if (booths) await page.locator('.en-booth').first().click();
    const mapDots = await page.locator('.en-minimap circle').count();
    await page.locator('button[type=submit]').click();
    await page.waitForSelector('.en-done', { timeout: 15000 }).catch(() => {});
    const done = (await page.locator('.en-done').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const creds = /registered/i.test(done) && done.includes(mobile) && /\b\d{6}\b/.test(done.replace(mobile, ''));
    const allDone = await page.locator('.en-step.is-done').count();
    await page.goto(BASE + '/login'); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(500);
    const loginOk = (await page.locator('.en-login .en-card').count()) === 1 && (await page.locator('.en-login input[type=password]').count()) === 1 && (await page.locator('.en-brand img').count()) === 1;
    await page.locator('.en-login button[type=submit]').click(); await page.waitForTimeout(400);
    const loginErr = (await page.locator('.en-error').innerText().catch(() => '')).trim();
    await ctx.close();
    const ok = tamilDefault && oldTells === 0 && realLogo === 1 && tiles === 4 && /Election Data Management/.test(h1en) && steps === 3 && /Your details/.test(s1) && /Role/.test(s2) && /constituency/i.test(s3) && roleSelect === 1 && btnColor === 'rgb(255, 255, 255)' && /name|mobile/i.test(err1) && booths > 0 && mapDots > 0 && creds && allDone === 3 && loginOk && loginErr.length > 0;
    return (ok ? pass : fail)('Tamil by default ' + tamilDefault + '; old tells ' + oldTells + '; real EDMS mark ' + realLogo + '; tiles ' + tiles + '; English title "' + h1en + '"; steps ' + steps + ' [' + s1 + ' → ' + s2 + ' → ' + s3 + ']; button text ' + btnColor + '; empty step-1 message "' + err1 + '"; booths ' + booths + ', map dots ' + mapDots + '; registered with login shown ' + creds + ', steps done ' + allDone + '; sign-in page ' + loginOk + ', empty sign-in says "' + loginErr + '"', { mobile });
  } },
  42: { title: 'Assembly login (group 3): lands on its assembly, MLA menu only, admin pages and admin APIs refused, voters and reports held to its own assembly, numbers not locked', run: async (b) => {
    const { ctx, page } = await open(b, { as: 'mla' });
    await page.goto(`${BASE}/`); await page.waitForLoadState('networkidle').catch(() => {}); await settle(page);
    const landing = page.url().replace(BASE, '');
    const own = String(sessions.mla.user.assembly_id || '');
    const other = own === '2' ? '3' : '2';
    const nav = await page.locator('.cv-nav a').allInnerTexts();
    const wanted = ['Assembly analytics', 'Voters', 'Booth report', 'Candidate briefing', 'Field operations'];
    const navMissing = wanted.filter((w) => !nav.some((t) => new RegExp(w, 'i').test(t)));
    const navAdmin = nav.filter((t) => /Registrations|Payments|Assembly access|Bot Messages|Flow Simulator/i.test(t)).length;
    await page.goto(`${BASE}/registrations`); await page.waitForLoadState('networkidle').catch(() => {}); await settle(page);
    const regPage = /Registrations/.test(await page.locator('h1').first().innerText().catch(() => ''));
    const status = async (u) => (await page.request.get(`${BASE}/api${u}`)).status();
    const refused = { registrations: await status('/registrations?page=1&pageSize=1'), proofs: await status('/payments/pending-utrs'), creds: await status('/assembly-credentials') };
    const an = await (await page.request.get(`${BASE}/api/reports/assembly-analytics?assemblyId=${other}`)).json();
    const vo = await (await page.request.get(`${BASE}/api/voters?assemblyId=${other}&page=1&pageSize=5`)).json();
    const br = await (await page.request.get(`${BASE}/api/reports/booth?assemblyId=${other}`)).json();
    await ctx.close();
    const heldAn = String(an.assembly_no) === own; const heldVo = String(vo.scope?.assemblyId) === own; const heldBr = String(br.assembly_no) === own;
    const numbers = !br.locked && Number(br.totals?.total) > 0;
    const ok = /assembly-details/.test(landing) && navMissing.length === 0 && navAdmin === 0 && !regPage && Object.values(refused).every((c) => c === 403) && heldAn && heldVo && heldBr && numbers;
    return (ok ? pass : fail)(`lands on ${landing}; menu missing [${navMissing.join(', ')}], admin items ${navAdmin}; /registrations shows the admin page ${regPage}; admin APIs ${JSON.stringify(refused)}; asking for AC ${other} → analytics AC ${an.assembly_no}, voters AC ${vo.scope?.assemblyId}, booth report AC ${br.assembly_no} (own ${own}); booth report numbers ${numbers}`);
  } },
  43: { title: 'Comparison defects (2026-10-14): no text under 13px on the main pages; ward-login passcodes hidden until revealed; register fits a 360px phone', run: async (b) => {
    const small = async (page) => page.evaluate(() => [...document.querySelectorAll('.cv-shell *, .en *')].filter((e) => !e.closest('.leaflet-container, [data-ui], svg') && e.childElementCount === 0 && e.innerText?.trim() && e.getBoundingClientRect().width > 0 && parseFloat(getComputedStyle(e).fontSize) < 13).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} ${getComputedStyle(e).fontSize} "${e.innerText.trim().slice(0, 20)}"`));
    const found = {};
    const { ctx, page } = await open(b);
    for (const u of ['/dashboard', '/registrations', '/payments', '/voters?assemblyId=1', '/assemblies']) { await go(page, u); const s = await small(page); if (s.length) found[u] = s.slice(0, 3); }
    await go(page, '/ward-logins');
    const wardTxt = await page.locator('.cv-content, main, body').first().innerText();
    const wardRows = await page.locator('table tbody tr').filter({ has: page.locator('td:nth-child(3)') }).count(); // data rows only, not the empty-state row
    const wardPlain = await page.evaluate(() => { const heads = [...document.querySelectorAll('th')].map((t) => t.innerText.trim().toLowerCase()); const i = heads.findIndex((h) => /pass/.test(h)); return i < 0 ? -1 : [...document.querySelectorAll('table tbody tr')].filter((tr) => /\b\d{4,8}\b/.test(tr.children[i]?.innerText || '')).length; });
    await ctx.close();
    const c = await open(b, { as: 'candidate' }); await go(c.page, '/candidate'); const sc = await small(c.page); if (sc.length) found['/candidate'] = sc.slice(0, 3); await c.ctx.close();
    const pub = await b.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, ...(WALL ? { httpCredentials: WALL } : {}) }); const pp = await pub.newPage();
    const widths = {};
    for (const u of ['/register', '/login']) { await pp.goto(`${BASE}${u}`); await pp.waitForLoadState('networkidle').catch(() => {}); await pp.waitForTimeout(800); widths[u] = await pp.evaluate(() => document.documentElement.scrollWidth); }
    await pub.close();
    const ok = Object.keys(found).length === 0 && wardRows > 0 && wardPlain === 0 && Object.values(widths).every((w) => w <= 360);
    return (ok ? pass : fail)(`text under 13px: ${Object.keys(found).length ? JSON.stringify(found) : 'none'}; ward logins ${wardRows} rows, passcodes in plain text ${wardPlain}; page width at 360px ${JSON.stringify(widths)}${/\b\d{6}\b/.test(wardTxt) ? ' (a 6-digit number is visible on the ward page)' : ''}`);
  } },
  44: { title: 'CRM removed (Ram, 2026-10-14): CRM and team addresses are gone for every login; no Team or CRM in the admin menu; a CRM agent login is refused', run: async (b) => {
    const codes = {};
    for (const as of ['admin', 'ward']) {
      const { ctx, page } = await open(b, { as });
      for (const u of ['/crm/conversations', '/crm/templates', '/team/members']) codes[`${as} ${u}`] = (await page.request.get(`${BASE}/api${u}`)).status();
      codes[`${as} POST /crm/messages/send`] = (await page.request.post(`${BASE}/api/crm/messages/send`, { data: {} })).status();
      if (as === 'admin') { await go(page, '/dashboard'); codes.menu = (await page.locator('.cv-nav a').allInnerTexts()).filter((t) => /team|crm|inbox/i.test(t)).length; }
      await ctx.close();
    }
    let agent = 'not tested here';
    if (!STAGING) {
      const ctx = await b.newContext(); const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: 'agent', password: 'local' } }); agent = `${r.status()} "${(await r.json()).message}"`; await ctx.close();
    }
    const gone = Object.entries(codes).filter(([k]) => k !== 'menu').every(([, c]) => c === 404);
    const ok = gone && codes.menu === 0 && (STAGING || /^403 .*deactivated/i.test(agent));
    return (ok ? pass : fail)(`answers ${JSON.stringify(codes)}; CRM agent login: ${agent}`);
  } },
  45: { title: 'Re-registering an existing number (Ram, 2026-10-14): refused with nothing changed — the owner keeps their passcode, name, booths and paid status; the page says "already registered"; two same-moment sign-ups for a new number make one account', run: async (b) => {
    const owner = STAGING ? { username: USERS.candidate.username, password: USERS.candidate.password } : { username: '9000000012', password: 'local' };
    const ctx = await b.newContext({ viewport: LAPTOP, ...(WALL ? { httpCredentials: WALL } : {}) });
    const api = ctx.request;
    const snap = async () => {
      const r = await api.post(BASE + '/api/auth/login', { data: owner }); const j = await r.json().catch(() => ({}));
      const paid = await (await api.get(BASE + '/api/payments/check-paid')).json().catch(() => ({}));
      return { status: r.status(), mobile: String(j.user?.mobile || ''), user: JSON.stringify({ name: j.user?.name, group: j.user?.group_id, booths: j.user?.booths }), paid: JSON.stringify(paid) };
    };
    const before = await snap();
    const number = before.mobile; // the account's phone number (the staging QA login signs in with a username)
    const reg = await api.post(BASE + '/api/auth/register', { data: { full_name: 'QA Someone Else', mobile: number, role: 'confirmed', affiliation: 'independent', body_type: 'urban', position: 'Ward Member', district: 'X', assembly_id: 1, assembly_name: 'AC 1', booths: [1, 2] } });
    const regJ = await reg.json().catch(() => ({}));
    const after = await snap();
    const unchanged = before.status === 200 && after.status === 200 && before.user === after.user && before.paid === after.paid;
    // the page: the same number through the three steps, in a signed-out browser (a signed-in one is sent to its home)
    const pageCtx = await b.newContext({ viewport: LAPTOP, ...(WALL ? { httpCredentials: WALL } : {}) });
    const page = await pageCtx.newPage();
    await page.goto(BASE + '/register'); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(500);
    await page.locator('#lang').selectOption('en');
    await page.locator('#full_name').fill('QA Someone Else'); await page.locator('#mobile').fill(number);
    await page.locator('#next').click(); await page.waitForTimeout(200);
    await page.locator('#role').selectOption('confirmed'); await page.locator('.en-opt', { hasText: /^Independent/ }).click();
    await page.locator('#next').click(); await page.waitForTimeout(200);
    await page.locator('.en-opt', { hasText: /Urban local body/ }).click();
    await page.locator('#position').selectOption({ index: 1 }); await page.waitForTimeout(150);
    await page.locator('#district').selectOption({ index: 1 }); await page.waitForTimeout(150);
    await page.locator('#assembly').selectOption({ index: 1 }); await page.waitForTimeout(1500);
    if (await page.locator('.en-booth').count()) await page.locator('.en-booth').first().click();
    await page.locator('button[type=submit]').click();
    await page.waitForSelector('.en-exists, .en-done', { timeout: 15000 }).catch(() => {});
    const shown = (await page.locator('.en-exists').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const noCreds = (await page.locator('.cred').count()) === 0;
    const signInLink = await page.locator('.en-exists a[href="/login"]').count();
    await pageCtx.close();
    const afterUi = await snap();
    // two same-moment sign-ups for one new number
    const fresh = '96' + String(Date.now()).slice(-8);
    const body = { full_name: 'QA Same Moment', mobile: fresh, role: 'confirmed', affiliation: 'independent', body_type: 'urban', position: 'Ward Member', district: 'X', assembly_id: 1, assembly_name: 'AC 1', booths: [1] };
    const both = (await Promise.all([api.post(BASE + '/api/auth/register', { data: body }), api.post(BASE + '/api/auth/register', { data: body })])).map((r) => r.status()).sort();
    const again = (await api.post(BASE + '/api/auth/register', { data: body })).status();
    await ctx.close();
    const ok = /^\d{10}$/.test(number) && reg.status() === 409 && regJ.code === 'ALREADY_REGISTERED' && !regJ.passcode && unchanged && afterUi.user === before.user && afterUi.paid === before.paid
      && /already has an EDMS account/.test(shown) && noCreds && signInLink === 1 && JSON.stringify(both) === '[200,409]' && again === 409;
    return (ok ? pass : fail)('same number again: ' + reg.status() + ' ' + (regJ.code || regJ.message) + ', passcode returned ' + !!regJ.passcode + '; owner before/after (login, name, role, paid) unchanged ' + unchanged + ' and after the page ' + (afterUi.user === before.user && afterUi.paid === before.paid) + '; page says "' + shown.slice(0, 70) + '…", login shown ' + !noCreds + ', sign-in link ' + signInLink + '; same-moment pair ' + JSON.stringify(both) + ', third try ' + again);
  } },
  46: { title: 'Incomplete registrations (Ram, 2026-10-15): the website form keeps name + number from step 1; the admin list shows how far they got, a status change and a note stick, non-admins are refused, an existing account is never listed, finishing moves them to Registered', run: async (b) => {
    const mobile = '93' + String(Date.now()).slice(-8);
    const { ctx: actx, page: admin } = await open(b, { as: 'admin' });
    const leads = async (tab) => (await (await admin.request.get(BASE + '/api/leads', { params: { tab, search: mobile } })).json());
    // 1) a visitor stops after step 2 of the website form
    const vctx = await b.newContext({ viewport: LAPTOP, ...(WALL ? { httpCredentials: WALL } : {}) });
    const v = await vctx.newPage();
    await v.goto(BASE + '/register'); await v.waitForLoadState('networkidle').catch(() => {});
    await v.locator('#lang').selectOption('en');
    const notice = /we keep your name and number/i.test(await v.locator('.en-note').first().innerText().catch(() => ''));
    await v.locator('#full_name').fill('QA Lead Test'); await v.locator('#mobile').fill(mobile);
    await v.locator('#next').click(); await v.waitForTimeout(800);
    const afterStep1 = (await leads('open')).rows?.[0]?.step;
    await v.locator('#role').selectOption('confirmed'); await v.locator('.en-opt', { hasText: /^Independent/ }).click();
    await v.locator('#next').click(); await v.waitForTimeout(800);
    const open1 = await leads('open');
    const row = open1.rows?.[0] || {};
    // 2) the admin page: listed, then marked Interested from the status menu, then a note
    await go(admin, '/incomplete-registrations?search=' + mobile);
    const navLink = await admin.locator('.cv-nav a[href="/incomplete-registrations"]').count();
    const listed = (await text(admin)).includes(mobile);
    await admin.locator('select.lead-status').first().selectOption('interested'); await admin.waitForTimeout(1200);
    const nowInterested = (await leads('interested')).total === 1 && (await leads('open')).total === 0;
    const noteRes = await admin.request.put(BASE + '/api/leads/' + row._id, { data: { note: 'QA: call back on Monday' } });
    const noteSaved = noteRes.status() === 200 && (await leads('interested')).rows?.[0]?.notes?.slice(-1)[0]?.text === 'QA: call back on Monday';
    // 3) a candidate login may not read the list; an existing account's number is never a lead
    const { ctx: cctx, page: cand } = await open(b, { as: 'candidate' });
    const candCode = (await cand.request.get(BASE + '/api/leads')).status();
    const candMobile = String(sessions.candidate.user.mobile || '');
    await vctx.request.post(BASE + '/api/public/lead', { data: { full_name: 'QA Existing', mobile: candMobile, step: 'details' } });
    const existing = await (await admin.request.get(BASE + '/api/leads', { params: { tab: 'open', search: candMobile } })).json();
    const existingListed = Object.values(existing.counts || {}).reduce((n, x) => n + x, 0);
    // 4) the visitor comes back and finishes: Registered tab
    await v.locator('.en-opt', { hasText: /Urban local body/ }).click();
    await v.locator('#position').selectOption({ index: 1 }); await v.waitForTimeout(150);
    await v.locator('#district').selectOption({ index: 1 }); await v.waitForTimeout(150);
    await v.locator('#assembly').selectOption({ index: 1 }); await v.waitForTimeout(1500);
    if (await v.locator('.en-booth').count()) await v.locator('.en-booth').first().click();
    await v.locator('button[type=submit]').click();
    await v.waitForSelector('.en-done', { timeout: 15000 }).catch(() => {});
    const reg = await leads('registered');
    await Promise.all([actx.close(), vctx.close(), cctx.close()]);
    const ok = notice && afterStep1 === 'details' && open1.total === 1 && row.step === 'role' && row.name === 'QA Lead Test' && (row.sources || []).includes('website')
      && navLink === 1 && listed && nowInterested && noteSaved && candCode === 403 && /^\d{10}$/.test(candMobile) && existingListed === 0 && reg.total === 1;
    return (ok ? pass : fail)('notice on step 1 ' + notice + '; after step 1 "' + afterStep1 + '", after step 2 ' + open1.total + ' row, step "' + row.step + '", name ok ' + (row.name === 'QA Lead Test') + ', source ' + JSON.stringify(row.sources) + '; sidebar link ' + navLink + ', listed on the page ' + listed + '; marked Interested from the page ' + nowInterested + '; note saved ' + noteSaved + '; candidate reading the list ' + candCode + '; existing account listed ' + existingListed + '; after finishing, Registered ' + reg.total);
  } },
  47: { title: 'WhatsApp Features (live phase B, ported 2026-10-17; layout A "Tabs" approved by Ram the same day): a plain "right now" line, the 5 switches Off with template readiness in words, no sideways scroll on laptop or phone; a test number + "Test numbers" go out in one Save and show "first turned on"; a test message is sent only to that number and logged; the register page follows the website_login switch (409 and success panels offer the green WhatsApp button, no passcode on screen when on for everyone); candidates are refused', run: async (b) => {
    const { ctx: actx, page: admin } = await open(b);
    const put = (body) => admin.request.put(BASE + '/api/whatsapp-features', { data: body });
    await put({ features: { website_login: { mode: 'off' } }, test_numbers: [] }); // start clean whatever an earlier run left
    await go(admin, '/whatsapp-features');
    const navLink = await admin.locator('.cv-nav a[href="/whatsapp-features"]').count();
    const h1 = (await admin.locator('.cv-content h1').first().innerText()).trim();
    // layout A (Ram, 2026-10-17): a plain "right now" line, tabs, one Off/Practice/Test/Everyone switch per feature
    await admin.waitForTimeout(500);
    const nowLine = (await text(admin, '[data-now]')).replace(/\s+/g, ' ');
    const switches = await admin.locator('[role=radiogroup][data-feature]').count();
    const allOff = (await admin.locator('[role=radiogroup][data-feature] [aria-checked=true]').evaluateAll((els) => els.map((e) => e.dataset.mode))).every((v) => v === 'off');
    const noSideScroll = await admin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    const payRow = (await text(admin, '[data-row="payment_reminders"]')).replace(/\s+/g, ' ');
    const incRow = (await text(admin, '[data-row="incomplete_reminders"]')).replace(/\s+/g, ' ');
    const tplLines = /Template ready in English and Tamil/.test(payRow) && /Tamil template is waiting for Meta/.test(incRow);
    // Setup tab: template status in plain words
    await admin.locator('[data-tab="setup"]').click(); await admin.waitForTimeout(500);
    const statusRows = await admin.locator('.cv-card', { hasText: 'Templates in WACTO' }).locator('tbody tr').count();
    const statusText = await text(admin);
    const statuses = ['Ready', 'Waiting for Meta', 'Rejected by Meta', 'INVALID_FORMAT', 'Not in WACTO'].every((w) => statusText.includes(w));
    // add a test number, set website login to Test numbers, one Save for both
    await admin.locator('input[aria-label="Add a test number"]').fill('9000000011');
    await admin.locator('button', { hasText: /^Add$/ }).click();
    await admin.locator('[data-tab="switches"]').click(); await admin.waitForTimeout(300);
    await admin.locator('[data-feature="website_login"] [data-mode="test"]').click();
    const barText = (await text(admin, '.cv-wf-savebar')).replace(/\s+/g, ' ');
    const bar = /2 changes not saved/.test(barText);
    await admin.locator('.cv-wf-savebar button', { hasText: /Save changes/ }).click(); await admin.waitForTimeout(900);
    const saved = /Saved\. It takes effect/.test(await text(admin));
    const pill = (await text(admin, '[data-row="website_login"] .cv-wf-title')).replace(/\s+/g, ' ');
    const firstOn = /First turned on/.test(await text(admin, '[data-row="website_login"]'));
    // send a test message (Setup): only the saved test number is offered; Activity logs it
    await admin.locator('[data-tab="setup"]').click(); await admin.waitForTimeout(400);
    const toOptions = await admin.locator('select[aria-label="Test number"] option').allInnerTexts();
    await admin.locator('button', { hasText: /Send test message/ }).click(); await admin.waitForTimeout(1200);
    const sent = (await text(admin)).match(/Sent "edms_payment_reminder" \(en\) to \*{6}0011\. Filled in: ([^\n]+)/);
    await admin.locator('[data-tab="activity"]').click(); await admin.waitForTimeout(400);
    const logged = /Test message \(Super Admin\)/.test(await text(admin));
    // phone: no sideways scroll, the switch fits
    const { ctx: pctx, page: ph } = await open(b, { viewport: PHONE, touch: true });
    await go(ph, '/whatsapp-features'); await ph.waitForTimeout(500);
    const phoneFit = await ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    await pctx.close();
    const refused = (await (await admin.request.post(BASE + '/api/whatsapp-features/test-send', { data: { template: 'payment', lang: 'en', mobile: '9000000012' } })).status());
    // the register page: switch in "test" → the form note still says "on screen" for everyone, but the test number's 409 offers WhatsApp
    const vctx = await b.newContext({ viewport: LAPTOP, ...(WALL ? { httpCredentials: WALL } : {}) });
    const v = await vctx.newPage();
    const fill = async (page, mobile) => {
      await page.goto(BASE + '/register'); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(600);
      await page.locator('#lang').selectOption('en'); await page.waitForTimeout(150);
      const note = (await page.locator('#mobile-note').innerText()).replace(/\s+/g, ' ');
      await page.locator('#full_name').fill('QA WhatsApp Login'); await page.locator('#mobile').fill(mobile);
      await page.locator('#next').click(); await page.waitForTimeout(250);
      await page.locator('#role').selectOption('confirmed'); await page.locator('.en-opt', { hasText: /^Independent/ }).click();
      await page.locator('#next').click(); await page.waitForTimeout(250);
      await page.locator('.en-opt', { hasText: /Urban local body/ }).click();
      await page.locator('#position').selectOption({ index: 1 }); await page.waitForTimeout(150);
      await page.locator('#district').selectOption({ index: 1 }); await page.waitForTimeout(150);
      await page.locator('#assembly').selectOption({ index: 1 }); await page.waitForTimeout(1200);
      if (await page.locator('.en-booth').count()) await page.locator('.en-booth').first().click();
      await page.locator('button[type=submit]').click();
      await page.waitForSelector('.en-done', { timeout: 15000 }).catch(() => {});
      const panel = (await page.locator('.en-done').innerText().catch(() => '')).replace(/\s+/g, ' ');
      const wa = await page.locator('#wa-login').getAttribute('href').catch(() => null);
      return { note, panel, wa };
    };
    const t1 = await fill(v, '9000000011'); // the test number already has an account (mock ward user)
    const existsWa = /Already registered/.test(t1.panel) && /green button/.test(t1.panel) && /^https:\/\/wa\.me\/917904759268\?text=Send%20my%20EDMS%20login$/.test(t1.wa || '');
    const noteOffForAll = /shown on screen/.test(t1.note) && !/WhatsApp only/.test(t1.note);
    // everyone: the note changes and a new registration gets the button instead of the passcode
    await put({ features: { website_login: { mode: 'all' } } });
    const fresh = '98' + String(Date.now()).slice(-8);
    const t2 = await fill(v, fresh);
    const noteAll = /WhatsApp only/.test(t2.note);
    const doneWa = /Registered/.test(t2.panel) && t2.panel.includes(fresh) && !/\b\d{6}\b/.test(t2.panel.replace(fresh, '')) && /^https:\/\/wa\.me\/917904759268\?text=Send%20my%20EDMS%20login$/.test(t2.wa || '');
    // a candidate login may not read or change the switches
    const { ctx: cctx, page: cand } = await open(b, { as: 'candidate' });
    const candGet = (await cand.request.get(BASE + '/api/whatsapp-features')).status();
    const candPut = (await cand.request.put(BASE + '/api/whatsapp-features', { data: { features: { pay_buttons: { mode: 'all' } } } })).status();
    await put({ features: { website_login: { mode: 'off' } }, test_numbers: [] }); // leave the mock as the other checks expect it
    await Promise.all([actx.close(), vctx.close(), cctx.close()]);
    const ok = navLink === 1 && /WhatsApp Features/.test(h1) && switches === 5 && allOff && statusRows === 3 && statuses && tplLines && bar && saved && /Test numbers/.test(pill) && firstOn && noSideScroll && phoneFit && /Everything is off\. The bot works as it does today/.test(nowLine)
      && toOptions.length === 1 && toOptions[0] === '9000000011' && !!sent && /Mock · 3 · ₹5,000 \+ 18% GST/.test(sent[1]) && logged && refused === 403
      && existsWa && noteOffForAll && noteAll && doneWa && candGet === 403 && candPut === 403;
    return (ok ? pass : fail)('sidebar link ' + navLink + '; h1 "' + h1 + '"; now "' + nowLine.slice(0, 60) + '"; switches ' + switches + ' all Off ' + allOff + '; template lines ' + tplLines + '; status rows ' + statusRows + ' in plain words ' + statuses + '; save bar ' + bar + ', saved ' + saved + ', pill "' + pill + '", first on ' + firstOn + '; no sideways scroll laptop ' + noSideScroll + ' phone ' + phoneFit + '; test-send options ' + JSON.stringify(toOptions) + ', sent ' + (sent ? '"' + sent[1] + '"' : 'NO') + ', logged ' + logged + ', other number ' + refused + '; register: 409 with WhatsApp button ' + existsWa + ' (note on screen ' + noteOffForAll + '); everyone: note WhatsApp ' + noteAll + ', success panel button and no passcode ' + doneWa + '; candidate ' + candGet + '/' + candPut);
  } },
};

const inrN = (n) => Number(n || 0).toLocaleString('en-IN');

// ---------- runner ----------
const only = process.argv.slice(2).map(Number).filter(Boolean);
const ids = Object.keys(CHECKS).map(Number).filter((id) => !only.length || only.includes(id));
const browser = await chromium.launch();
const results = [];
for (const id of ids) {
  const c = CHECKS[id];
  const t0 = Date.now();
  let r;
  if (STAGING && c.mockOnly) { r = { pass: true, skipped: true, detail: 'skipped on staging: needs a mock-only failure/slowness knob' }; }
  else try { r = await c.run(browser); } catch (e) { r = fail(`check crashed: ${e.message.split('\n')[0]}`); }
  results.push({ id, title: c.title, ...r, ms: Date.now() - t0 });
  console.log(`${r.skipped ? 'SKIP' : r.pass ? 'PASS' : 'FAIL'}  ${String(id).padStart(2)}  ${c.title}\n        ${r.detail}`);
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), base: BASE, results }, null, 2));
const failed = results.filter((r) => !r.pass).length;
const skipped = results.filter((r) => r.skipped).length;
console.log(`
${results.length - failed - skipped} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''} — ${STAGING ? 'STAGING' : 'mock'}`);
process.exit(failed ? 1 : 0);
