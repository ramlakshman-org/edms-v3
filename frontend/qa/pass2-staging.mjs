// Pass 2 (D15): the first real ACTIONS of the new admin panel against a real server — STAGING only
// (https://tnedms.online, a copy of the live app DB behind a basic-auth wall; see EDM/STAGING.md).
// Each action: read the record before (API), do it in the browser exactly as the admin would, read it after,
// and compare with what the screen said. Never run this against live: it approves, rejects, assigns, deletes.
//
//   QA_WALL=user:pass QA_USERS=<qa-users.json> node qa/pass2-staging.mjs [action ids]
// Results: qa/out/pass2.json (+ a screenshot per action in qa/out/pass2-<id>.png; staging pages carry real
// names, so the screenshots stay on this PC).
import { createRequire } from 'module';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'))); }

const BASE = 'https://tnedms.online';
const [wu, wp] = String(process.env.QA_WALL || '').split(':');
if (!wu || !wp || !process.env.QA_USERS) { console.error('QA_WALL=user:pass and QA_USERS=<json> are required'); process.exit(2); }
const WALL = { username: wu, password: wp };
const USERS = JSON.parse(fs.readFileSync(process.env.QA_USERS, 'utf8'));
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
fs.mkdirSync(OUT, { recursive: true });

// QA_SESSIONS=<file> (e2e/run.mjs): share one login per role across all test files — the backend allows 20 logins per 15 min
const SESSIONS_FILE = process.env.QA_SESSIONS || '';
const sessions = SESSIONS_FILE && fs.existsSync(SESSIONS_FILE) ? JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')) : {};
async function open(browser, { as = 'admin', viewport = { width: 1366, height: 860 } } = {}) {
  const ctx = await browser.newContext({ viewport, httpCredentials: WALL });
  if (!sessions[as]) {
    const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: USERS[as].username, password: USERS[as].password } });
    const body = await r.json();
    if (!body.success) throw new Error(`login as ${as} failed: ${body.message}`);
    sessions[as] = { cookies: await ctx.cookies(), user: body.user };
    if (SESSIONS_FILE) fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions));
  } else await ctx.addCookies(sessions[as].cookies);
  await ctx.addInitScript((u) => { localStorage.setItem('edm_user', JSON.stringify(u)); localStorage.setItem('edm_last_active', String(Date.now())); }, sessions[as].user);
  const page = await ctx.newPage();
  const api = async (p) => (await ctx.request.get(`${BASE}/api${p}`)).json();
  return { ctx, page, api };
}
const settle = async (page, ms = 8000) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForFunction(() => !document.querySelector('.cv-content .cv-skel, .cv-content .cv-spin'), null, { timeout: ms }).catch(() => {}); await page.waitForTimeout(300); };
const shot = (page, id) => page.screenshot({ path: path.join(OUT, `pass2-${id}.png`) });
const pass = (detail, data) => ({ pass: true, detail, data });
const fail = (detail, data) => ({ pass: false, detail, data });
const isTestUtr = (u) => !u || /^(\d)\1{5,}$|^(1234|0000|9999|test)/i.test(String(u));

const ACTIONS = {
  1: { title: 'Reject a payment proof (with a reason)', run: async (b) => {
    const { ctx, page, api } = await open(b);
    const before = (await api('/payments/pending-utrs?status=pending&limit=100')).rows || [];
    const target = before.find((r) => isTestUtr(r.utr)) || before[0];
    if (!target) { await ctx.close(); return fail('no pending proof to reject'); }
    await page.goto(`${BASE}/payments`); await settle(page);
    // the row for this proof → its Reject button
    const row = page.locator('.cv-content tbody tr', { hasText: target.mobile_no }).first();
    await row.getByRole('button', { name: /Reject/ }).click();
    await page.waitForSelector('[role=dialog]');
    await page.locator('[role=dialog] textarea').fill('QA pass 2 on staging: screenshot unreadable — please send a clearer one.');
    await page.locator('[role=dialog] button', { hasText: /^Reject & notify$/ }).click();
    await page.waitForSelector('[role=dialog] .cv-done', { timeout: 15000 }).catch(() => {});
    const screen = await page.locator('[role=dialog]').innerText().catch(() => '');
    await shot(page, 1);
    const after = (await api('/payments/pending-utrs?status=all&limit=100')).rows || [];
    const doc = after.find((r) => String(r._id) === String(target._id));
    const stillPending = ((await api('/payments/pending-utrs?status=pending&limit=100')).rows || []).length;
    await ctx.close();
    const ok = /Payment rejected/.test(screen) && doc?.status === 'rejected' && !!doc?.reviewed_at && stillPending === before.length - 1;
    return (ok ? pass : fail)(`screen said "${/Payment rejected/.test(screen) ? 'Payment rejected' : screen.slice(0, 60)}"; record status ${doc?.status}, reviewed_at ${doc?.reviewed_at ? 'set' : 'missing'}, reason ${doc?.reject_reason || doc?.reason ? 'stored' : 'not stored'}; pending ${before.length} → ${stillPending}`, { utr_id: String(target._id), mobile_last4: String(target.mobile_no || '').slice(-4) });
  } },
  2: { title: 'Approve a payment proof (candidate becomes paid, ledger row written)', run: async (b) => {
    const { ctx, page, api } = await open(b);
    const before = (await api('/payments/pending-utrs?status=pending&limit=100')).rows || [];
    const target = before[0];
    if (!target) { await ctx.close(); return fail('no pending proof to approve'); }
    const subsBefore = ((await api('/payments/subscriptions')).subscriptions || []).length;
    await page.goto(`${BASE}/payments`); await settle(page);
    const row = page.locator('.cv-content tbody tr', { hasText: target.mobile_no }).first();
    await row.getByRole('button', { name: /Approve/ }).click();
    await page.waitForSelector('[role=dialog]');
    const tick = page.locator('[role=dialog] input[type=checkbox]');
    if (await tick.count()) await tick.check();
    await page.locator('[role=dialog] button', { hasText: /^Approve & mark paid$/ }).click();
    await page.waitForSelector('[role=dialog] .cv-done', { timeout: 20000 }).catch(() => {});
    const screen = await page.locator('[role=dialog]').innerText().catch(() => '');
    await shot(page, 2);
    const after = (await api('/payments/pending-utrs?status=all&limit=100')).rows || [];
    const doc = after.find((r) => String(r._id) === String(target._id));
    const subs = (await api('/payments/subscriptions')).subscriptions || [];
    const mob = String(target.mobile_no || '').replace(/\D/g, '').slice(-10);
    const sub = subs.find((s) => String(s.mobile_no || '').replace(/\D/g, '').slice(-10) === mob);
    await ctx.close();
    const ok = /Payment approved/.test(screen) && doc?.status === 'approved' && !!sub && Number(sub.amount) > 100;
    return (ok ? pass : fail)(`screen said "${/Payment approved/.test(screen) ? 'Payment approved' : screen.slice(0, 80)}"; record status ${doc?.status}; Received list: ${subsBefore} → ${subs.length}, this candidate ${sub ? `listed, ₹${sub.amount} (${sub.amount_source}), ${sub.booth_count} booths, txn ${sub.transaction_id}` : 'NOT listed'}`, { utr_id: String(target._id), mobile_last4: mob.slice(-4), booth_count: target.booth_count, amount_expected: target.expected_amount || target.amount });
  } },
  3: { title: 'Assign booths to a registration (booth picker → Save)', run: async (b) => {
    const { ctx, page, api } = await open(b);
    const list = (await api('/registrations?page=1&pageSize=200')).rows || [];
    const target = list.find((r) => /^test( \(QA edited.*\))?$/i.test(String(r.full_name || '').trim()) && r.assembly_id);
    if (!target) { await ctx.close(); return fail('the "Test" registration (with an assembly) is not there — refusing to use a real candidate’s row'); }
    const before = (await api(`/registrations/${target._id}`)).registration;
    await page.goto(`${BASE}/registrations/view/${target._id}?assign=1`); await settle(page);
    await page.waitForSelector('[role=dialog] .cv-booth-opt input', { timeout: 20000 });
    const boxes = page.locator('[role=dialog] .cv-booth-opt input');
    const n = await boxes.count();
    await boxes.nth(0).check(); await boxes.nth(1).check();
    const picked = await page.locator('[role=dialog] .cv-booth-opt--on .cv-booth-no').allInnerTexts();
    await page.locator('[role=dialog] button', { hasText: /^Save 2 booths$/ }).click();
    await page.waitForSelector('[role=dialog]', { state: 'detached', timeout: 15000 }).catch(() => {});
    await settle(page);
    const card = await page.locator('.cv-content .cv-card-title', { hasText: /^Booths/ }).first().innerText().catch(() => '');
    await shot(page, 3);
    const after = (await api(`/registrations/${target._id}`)).registration;
    await ctx.close();
    const got = (after.booths || []).map((x) => Number(x.part_no ?? x));
    const want = picked.map((t) => Number(t.replace('#', '')));
    const ok = n > 2 && got.length === 2 && want.every((w) => got.includes(w)) && /Booths · 2/.test(card);
    return (ok ? pass : fail)(`picker listed ${n} booths; picked ${picked.join(' ')}; card says "${card}"; record booths before ${(before.booths || []).length} → after ${got.length} (${got.join(',')}), assembly ${after.assembly_id}`, { reg_id: String(target._id), booths: got });
  } },
  4: { title: 'Mark a registration paid and unpaid (round trip from whichever state it is in)', run: async (b) => {
    const { ctx, page, api } = await open(b);
    const list = (await api('/registrations?page=1&pageSize=200')).rows || [];
    const target = list.find((r) => /^test( \(QA edited.*\))?$/i.test(String(r.full_name || '').trim()));
    if (!target) { await ctx.close(); return fail('the "Test" registration is not there — refusing to use a real candidate’s row'); }
    await page.goto(`${BASE}/registrations/view/${target._id}`); await settle(page);
    // on a clean copy this candidate's paid_status is the number 1, which now means paid (B5): start from either state
    const startsPaid = (await page.getByRole('button', { name: 'Mark as unpaid', exact: true }).count()) > 0;
    const toggle = async (toPaid) => {
      await page.getByRole('button', { name: toPaid ? 'Mark as paid' : 'Mark as unpaid', exact: true }).click();
      await page.waitForSelector('[role=dialog]');
      if (toPaid) await page.locator('[role=dialog] textarea').fill('QA pass 2 on staging: UTR checked in statement (test).');
      await page.getByRole('dialog').getByRole('button', { name: toPaid ? 'Confirm paid' : 'Confirm unpaid', exact: true }).click();
      await page.waitForSelector('[role=dialog]', { state: 'detached', timeout: 15000 }).catch(() => {});
      await settle(page);
      const pill = await page.locator('.cv-content .cv-card', { hasText: /^Payment/ }).locator('.cv-pill').first().innerText().catch(() => '');
      const rec = (await api(`/registrations/${target._id}`)).registration;
      return { pill, rec };
    };
    const first = await toggle(!startsPaid);
    await shot(page, 4);
    const second = await toggle(startsPaid);
    await ctx.close();
    const paidStep = startsPaid ? second : first; const unpaidStep = startsPaid ? first : second;
    const ok = paidStep.rec.paid_status === 'Yes' && !!paidStep.rec.transaction_id && /^paid$/i.test(paidStep.pill.trim()) && unpaidStep.rec.paid_status === 'No' && !unpaidStep.rec.transaction_id && /unpaid/i.test(unpaidStep.pill);
    return (ok ? pass : fail)(`started ${startsPaid ? 'paid' : 'unpaid'}; after Mark as paid: screen "${paidStep.pill}", record ${paidStep.rec.paid_status}, txn ${paidStep.rec.transaction_id || 'none'}, ledger ${paidStep.rec.payment ? `₹${paidStep.rec.payment.amount} ${paidStep.rec.payment.status}` : 'none'}; after Mark as unpaid: screen "${unpaidStep.pill}", record ${unpaidStep.rec.paid_status}, txn ${unpaidStep.rec.transaction_id || 'none'}`, { reg_id: String(target._id) });
  } },
  5: { title: 'Edit a registration (name + role) and save', run: async (b) => {
    const { ctx, page, api } = await open(b);
    const list = (await api('/registrations?page=1&pageSize=200')).rows || [];
    const target = list.find((r) => /^test( \(QA edited.*\))?$/i.test(String(r.full_name || '').trim()));
    if (!target) { await ctx.close(); return fail('the "Test" registration is not there — refusing to use a real candidate’s row'); }
    const before = (await api(`/registrations/${target._id}`)).registration;
    await page.goto(`${BASE}/registrations/edit/${target._id}`); await settle(page);
    const newName = `${String(before.full_name).replace(/ \(QA edited.*\)$/, '')} (QA edited ${new Date().toISOString().slice(11, 16)})`;
    await page.getByLabel('Full name').fill(newName);
    await page.getByLabel('Role').selectOption('confirmed');
    await page.locator('.cv-content button[type=submit]', { hasText: /Save changes/ }).click();
    await page.waitForURL(/\/registrations\/view\//, { timeout: 15000 }).catch(() => {});
    await settle(page);
    const h1 = await page.locator('.cv-content h1').first().innerText().catch(() => '');
    await shot(page, 5);
    const after = (await api(`/registrations/${target._id}`)).registration;
    await ctx.close();
    const ok = after.full_name === newName && after.role === 'confirmed' && h1 === newName;
    return (ok ? pass : fail)(`saved name "${after.full_name}" (wanted "${newName}"), role ${before.role || '-'} → ${after.role}; page title "${h1}"`, { reg_id: String(target._id) });
  } },
  6: { title: 'Delete a registration (confirm dialog → gone from the list)', run: async (b) => {
    const { ctx, page, api } = await open(b);
    const list = (await api('/registrations?page=1&pageSize=200')).rows || [];
    const target = list.find((r) => /wacto test/i.test(String(r.full_name || '')));
    if (!target) { await ctx.close(); return fail('no "WACTO Test" registration to delete'); }
    const countBefore = list.length;
    await page.goto(`${BASE}/registrations/edit/${target._id}`); await settle(page);
    await page.locator('.cv-content button', { hasText: /^Delete registration$/ }).click();
    await page.waitForSelector('[role=dialog]');
    await page.locator('[role=dialog] button', { hasText: /^Delete permanently$/ }).click();
    await page.waitForURL((u) => /\/registrations\/?(\?|$)/.test(u.pathname + u.search), { timeout: 15000 }).catch(() => {});
    await settle(page);
    await shot(page, 6);
    const detail = await ctx.request.get(`${BASE}/api/registrations/${target._id}`);
    const listAfter = (await api('/registrations?page=1&pageSize=200')).rows || [];
    await ctx.close();
    const gone = detail.status() === 404 || !((await detail.json()).success);
    const ok = gone && listAfter.length === countBefore - 1 && !listAfter.some((r) => String(r._id) === String(target._id)) && /\/registrations/.test(page.url());
    return (ok ? pass : fail)(`detail after delete → ${detail.status()}; list ${countBefore} → ${listAfter.length}; landed on ${page.url().replace(BASE, '')}`, { reg_id: String(target._id) });
  } },
  7: { title: 'Assembly access: regenerate an assembly login; booth-login generation is gone (Round 1)', run: async (b) => {
    const { ctx, page, api } = await open(b);
    const AC = 1;
    const credsBefore = ((await api('/assembly-credentials')).rows || []).find((r) => Number(r.assembly_no) === AC) || {};
    await page.goto(`${BASE}/assemblies?q=${AC}`); await settle(page);
    const row = page.locator('.cv-content tbody tr').filter({ has: page.locator('td[data-label="AC"]', { hasText: new RegExp(`^\\s*${AC}\\s*$`) }) }).first();
    const rowButtons = await row.locator('button').allInnerTexts();
    const existing = rowButtons.some((t) => /Regenerate/.test(t));
    await row.getByRole('button', { name: existing ? 'Regenerate' : 'Create login' }).click();
    await page.waitForSelector('[role=dialog]');
    await page.getByRole('dialog').getByRole('button', { name: existing ? 'Regenerate' : 'Create', exact: true }).click();
    await page.waitForSelector('[role=dialog]', { state: 'detached', timeout: 20000 }).catch(() => {});
    await settle(page);
    const flash = await page.locator('.cv-content .cv-flash, .cv-content .cv-alert--ok, .cv-content [role=status]').first().innerText().catch(() => '');
    const flashUser = (/Username ([^;\s]+)/.exec(flash) || [])[1] || '';
    const rowsAfter = ((await api('/assembly-credentials')).rows || []).filter((r) => Number(r.assembly_no) === AC);
    const credsAfter = rowsAfter.find((r) => r.username === flashUser) || rowsAfter.find((r) => r.passcode && r.passcode !== '-') || {};
    const passBefore = (credsBefore.username === credsAfter.username ? credsBefore.passcode : null);
    // Round 1 (Ram, 2026-10-14): booth logins are not generated any more — the tab and its button must be gone
    await page.goto(`${BASE}/assemblies?tab=booth&ac=${AC}`); await settle(page);
    const boothUi = await page.locator('.cv-content [role=tab], .cv-content button').filter({ hasText: /Booth logins|Generate .*logins/i }).count();
    await shot(page, 7);
    await ctx.close();
    const changed = !!credsAfter.passcode && credsAfter.passcode !== '-' && credsAfter.passcode !== passBefore;
    const ok = changed && boothUi === 0;
    return (ok ? pass : fail)(`AC ${AC}: assembly login ${existing ? 'regenerated' : 'created'} (a real passcode now ${changed}, username ${credsAfter.username || '-'}${flashUser && flashUser !== credsAfter.username ? ` — page said ${flashUser}` : ''}); flash "${flash.slice(0, 70)}"; booth-login tab or generate button still present: ${boothUi}`, { ac: AC });
  } },
  8: { title: 'Bot Messages: edit one text, Save, then put it back', run: async (b) => {
    const { ctx, page, api } = await open(b);
    const cat = await api('/flow-images/bot');
    const item = (cat.texts || [])[0];
    if (!item) { await ctx.close(); return fail('no bot texts listed'); }
    const original = item.en;
    await page.goto(`${BASE}/flow-images`); await settle(page);
    await page.locator('.cv-bot-item').first().click();
    const ta = page.locator('.cv-content textarea[lang=en]').first();
    await ta.fill(`${original} (QA)`);
    await page.getByRole('button', { name: /^Save 1 change$/ }).click();
    await settle(page);
    const flash1 = await page.locator('.cv-content').innerText().then((t) => /Saved|new wording/i.test(t));
    const mid = ((await api('/flow-images/bot')).texts || []).find((t) => t.key === item.key);
    await shot(page, 8);
    // back to the original (equal to the default → the override is removed)
    await ta.fill(original);
    await page.getByRole('button', { name: /^Save 1 change$/ }).click();
    await settle(page);
    const end = ((await api('/flow-images/bot')).texts || []).find((t) => t.key === item.key);
    await ctx.close();
    const ok = mid?.en === `${original} (QA)` && end?.en === original && flash1;
    return (ok ? pass : fail)(`"${item.key}": saved with " (QA)" → server has it: ${mid?.en === `${original} (QA)`}; restored → server back to original: ${end?.en === original}; page confirmed save: ${flash1}`, { key: item.key });
  } },
  9: { title: 'Uploads to the staging Cloudinary: an MLA photo and a bot image', run: async (b) => {
    const { ctx, page, api } = await open(b);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    // MLA photo: the first directory row's Upload/Replace button opens the file chooser
    await page.goto(`${BASE}/mla-list`); await settle(page);
    const before = await api('/mla/images');
    const firstRow = page.locator('.cv-content tbody tr').first();
    const no = Number((await firstRow.locator('td[data-label="AC"]').innerText()).replace(/\D/g, ''));
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), firstRow.getByRole('button', { name: /Upload|Replace/ }).click()]);
    await chooser.setFiles({ name: 'qa-photo.png', mimeType: 'image/png', buffer: png });
    await page.waitForFunction(() => ![...document.querySelectorAll('.cv-content button')].some((x) => /Uploading/.test(x.innerText)), null, { timeout: 30000 }).catch(() => {});
    await settle(page);
    const after = await api('/mla/images');
    const url = (after.profiles || after.images?.profiles || {})[no] || (after.images || []).find?.((x) => Number(x.constituency_no) === no)?.url || '';
    await shot(page, 9);
    // bot image
    await page.goto(`${BASE}/flow-images`); await settle(page);
    const imgTab = page.getByRole('tab', { name: /images|media/i }).first();
    if (await imgTab.count()) await imgTab.click();
    const botBefore = await api('/flow-images/bot');
    const imgBtn = page.locator('.cv-content button', { hasText: /^(Upload|Replace)$/ }).first();
    let botUrl = '';
    if (await imgBtn.count()) {
      const [ch2] = await Promise.all([page.waitForEvent('filechooser'), imgBtn.click()]);
      await ch2.setFiles({ name: 'qa-bot.png', mimeType: 'image/png', buffer: png });
      await page.waitForFunction(() => ![...document.querySelectorAll('.cv-content button')].some((x) => /Uploading/.test(x.innerText)), null, { timeout: 30000 }).catch(() => {});
      await settle(page);
      const botAfter = await api('/flow-images/bot');
      const changed = (botAfter.images || []).find((im, i) => im.url !== (botBefore.images || [])[i]?.url);
      botUrl = changed?.url || '';
    }
    await ctx.close();
    const stagingCloud = (u) => /res\.cloudinary\.com\/zl15weql\//.test(u);
    const ok = stagingCloud(url) && stagingCloud(botUrl);
    return (ok ? pass : fail)(`MLA ${no} photo → ${url ? (stagingCloud(url) ? 'staging Cloudinary' : url.slice(0, 60)) : 'no url'}; bot image → ${botUrl ? (stagingCloud(botUrl) ? 'staging Cloudinary' : botUrl.slice(0, 60)) : 'no url'}`, { mla: no });
  } },
  10: { title: 'Candidate side: submit a payment proof (unpaid), request an SMS broadcast (paid)', run: async (b) => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    // unpaid candidate: Activate plan → upload → submit
    let w = await open(b, { as: 'ward' });
    await w.page.goto(`${BASE}/candidate`); await settle(w.page);
    const activate = w.page.getByRole('button', { name: /Activate plan/ }).first();
    const alreadyPending = !(await activate.count());
    if (!alreadyPending) {
      await activate.click();
      await w.page.waitForSelector('[role=dialog]');
      await w.page.setInputFiles('[role=dialog] input[type=file]', { name: 'upi.png', mimeType: 'image/png', buffer: png });
      await w.page.waitForTimeout(600);
      await w.page.getByRole('dialog').getByRole('button', { name: /Submit payment proof/ }).click();
    } else {
      await w.page.getByRole('button', { name: /View status/ }).first().click(); // a proof from an earlier run is already pending
    }
    await w.page.waitForFunction(() => /Verifying your payment|proof is received/i.test(document.querySelector('[role=dialog]')?.innerText || ''), null, { timeout: 20000 }).catch(() => {});
    const dlg = await w.page.locator('[role=dialog]').innerText().catch(() => '');
    await shot(w.page, 10);
    const status = await w.api('/payments/check-paid');
    await w.ctx.close();
    // admin sees it in the queue
    const a = await open(b);
    const queue = (await a.api('/payments/pending-utrs?status=pending&limit=100')).rows || [];
    const mine = queue.find((r) => String(r.mobile_no || '').endsWith('9000000003'));
    await a.ctx.close();
    // paid candidate: SMS broadcast request
    const c = await open(b, { as: 'candidate' });
    await c.page.goto(`${BASE}/broadcast`); await settle(c.page);
    const smsBtn = c.page.locator('.cv-service', { hasText: /SMS broadcast/ });
    const smsDisabled = await smsBtn.isDisabled().catch(() => true);
    let flash = '', reqAfter = null;
    if (!smsDisabled) {
      await smsBtn.click();
      await c.page.getByLabel('Audience').selectOption('all');
      await c.page.locator('.cv-content textarea').first().fill('QA pass 2: vote on polling day.');
      await c.page.getByRole('button', { name: /Submit request/ }).click();
      await settle(c.page);
      const txt = await c.page.locator('.cv-content').innerText();
      flash = /Request submitted|within 4 hours/i.test(txt) ? 'Request submitted' : (await smsBtn.locator('.cv-pill', { hasText: /Requested/ }).count()) ? 'service shows Requested' : '';
      reqAfter = await c.api('/ward/social-media');
    }
    await c.ctx.close();
    const smsRequested = !!(reqAfter && JSON.stringify(reqAfter).includes('"sms"'));
    const ok = /Verifying your payment/i.test(dlg) && status.pending === true && !!mine && !!mine.screenshot_url && (smsDisabled || (flash && smsRequested));
    return (ok ? pass : fail)(`proof${alreadyPending ? ' (already pending from an earlier run)' : ''}: dialog "${/Verifying your payment/i.test(dlg) ? 'Verifying your payment' : dlg.slice(0, 50)}", check-paid pending ${status.pending}, in admin queue ${!!mine}${mine ? ` with screenshot ${mine.screenshot_url ? 'on ' + (/zl15weql/.test(mine.screenshot_url) ? 'staging Cloudinary' : 'another host') : 'missing'}` : ''}; SMS request: ${smsDisabled ? 'already requested earlier (button disabled)' : `${flash || 'no confirmation'}, recorded ${smsRequested}`}`);
  } },
};

const only = process.argv.slice(2).map(Number).filter(Boolean);
const ids = Object.keys(ACTIONS).map(Number).filter((id) => !only.length || only.includes(id));
const browser = await chromium.launch();
const results = [];
for (const id of ids) {
  const a = ACTIONS[id]; const t0 = Date.now(); let r;
  try { r = await a.run(browser); } catch (e) { r = fail(`action crashed: ${e.message.split('\n')[0]}`); }
  results.push({ id, title: a.title, ...r, ms: Date.now() - t0 });
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${String(id).padStart(2)}  ${a.title}\n        ${r.detail}`);
}
await browser.close();
const prev = fs.existsSync(path.join(OUT, 'pass2.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'pass2.json'), 'utf8')).results || [] : [];
fs.writeFileSync(path.join(OUT, 'pass2.json'), JSON.stringify({ at: new Date().toISOString(), base: BASE, results: [...prev.filter((p) => !ids.includes(p.id)), ...results].sort((x, y) => x.id - y.id) }, null, 2));
console.log(`\n${results.filter((r) => r.pass).length} passed, ${results.filter((r) => !r.pass).length} failed`);
