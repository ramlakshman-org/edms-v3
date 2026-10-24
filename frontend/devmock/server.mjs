// Local mock of the EDMS API for building the new admin offline.
// Run: node devmock/server.mjs   (port 5199)  — then start Vite with
// EDM_API_TARGET=http://localhost:5199. Never talks to the real server.
// Login: any username/password logs in as Super Admin (local only).
import http from 'node:http';
import { URL } from 'node:url';
import { REGISTRATIONS, UTR_PAYMENTS, CRM_TEAM_STATS, TEAM_STATS, VOTER_TOTALS, EPIC_SAMPLE, ADMIN_USER } from './data.mjs';
import { votersFor, filterVoters, ASSEMBLY_LIST } from './voters.mjs';
import { BOT_TEXTS, BOT_IMAGES, BOT_GROUPS } from '../../backend/src/constants/botContent.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Real assembly outlines (frontend/public), used only to place fake booth GPS sensibly.
const BOUNDARIES = (() => { try { return JSON.parse(fs.readFileSync(new URL('../public/tn_assembly_boundaries.json', import.meta.url), 'utf8')); } catch { return {}; } })();
const polyOf = (ac) => BOUNDARIES[String(ac)]?.polygon || null;
function inPoly(lat, lng, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]; const [xj, yj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}
const bboxOf = (poly) => { const xs = poly.map((p) => p[0]); const ys = poly.map((p) => p[1]); return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; };
const rnd = (seed) => { const x = Math.sin(seed) * 10000; return x - Math.floor(x); };
function insidePoint(ac, i) {
  const poly = polyOf(ac);
  if (!poly) return [12.8 + (ac % 9) * 0.18 + Math.sin(i * 1.7) * 0.06, 79.6 + (ac % 7) * 0.22 + Math.cos(i * 1.3) * 0.08];
  const b = bboxOf(poly);
  for (let k = 0; k < 200; k++) {
    const lng = b.x0 + rnd(ac * 977 + i * 131 + k * 7.3) * (b.x1 - b.x0);
    const lat = b.y0 + rnd(ac * 613 + i * 89 + k * 3.1) * (b.y1 - b.y0);
    if (inPoly(lat, lng, poly)) return [lat, lng];
  }
  return [(b.y0 + b.y1) / 2, (b.x0 + b.x1) / 2];
}
function outsidePoint(ac) { const poly = polyOf(ac); if (!poly) return [10.5, 77.5]; const b = bboxOf(poly); return [b.y1 + (b.y1 - b.y0) * 0.4, b.x1 + (b.x1 - b.x0) * 0.4]; }
const WACTO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'wacto');
// The real pre-built reports, when a copy is on this PC (same folder the backend serves at /report-files).
const REPORTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend', 'reports');
const realBoothReports = (ac) => { try { return fs.readdirSync(path.join(REPORTS_DIR, 'Booth_Reports', `ASS ${ac} Booth Reports`)).map((f) => /^Booth_(\d+)_Report\.html$/.exec(f)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b); } catch { return fs.existsSync(path.join(REPORTS_DIR, 'Booth_Reports')) ? [] : null; } }; // real folder present: a missing assembly has none

const PORT = Number(process.env.MOCK_PORT || 5199);
let loggedIn = false;
let currentUser = ADMIN_USER;

// Customer logins (any password): ward = older ward login, payment pending ·
// candidate = booth-plan candidate, paid · mla = assembly login · agent = CRM agent.
const WARD_USER = { sub: 'u11', name: 'Mock Candidate', first_name: 'Mock', last_name: 'Candidate', group_id: 6, role: 'Ward Agent', home: '/candidate', mobile: '9000000011', mobile_no: '9000000011', paid_status: 'No', booths: [12, 15, 20], booth_count: 3, assembly_id: '86', assembly_name: 'Salem (North)', district_id: 'Salem', category_name: 'Municipality', ward_id: '4', candidate_type: 'urban', position: 'Councillor' };
const CANDIDATE_USER = { sub: 'u12', name: 'Selvi Mock', first_name: 'Selvi', last_name: 'Mock', group_id: 11, role: 'Booth Agent', home: '/candidate', mobile: '9000000012', mobile_no: '9000000012', paid_status: 'Yes', transaction_id: '412398765432', booths: [{ assembly_no: 86, part_no: 3 }, { assembly_no: 86, part_no: 7 }, { assembly_no: 86, part_no: 11 }, { assembly_no: 86, part_no: 18 }, { assembly_no: 86, part_no: 24 }], booth_count: 5, assembly_id: '86', district_id: 'Salem', category_name: 'Town Panchayat', ward_id: '2', candidate_type: 'urban', position: 'Town Panchayat' };
const MLA_USER = { sub: 'u13', name: 'Assembly 86', first_name: 'Assembly 86', group_id: 3, role: 'MLA / Assembly', home: '/assembly-details', mobile: '', mobile_no: '', paid_status: 'Yes', booths: [], assembly_id: '86' };
const AGENT_USER = { sub: 'u14', name: 'Priya Mock', first_name: 'Priya', group_id: 12, role: 'CRM Team Member', home: '/team/dashboard', mobile: '9000000101', mobile_no: '9000000101', paid_status: 'No', booths: [] };
// one real candidate has paid_status stored as the NUMBER 1 (2026-10-14): the backend must treat it as paid
const LEGACY_USER = { sub: 'u15', name: 'Kumar Legacy', first_name: 'Kumar', last_name: 'Legacy', group_id: 11, role: 'Booth Agent', home: '/candidate', mobile: '9000000015', mobile_no: '9000000015', paid_status: 1, transaction_id: 'QR-LEGACY1', booths: [{ assembly_no: 86, part_no: 12 }, { assembly_no: 86, part_no: 15 }, { assembly_no: 86, part_no: 20 }], booth_count: 3, assembly_id: '86', district_id: 'Salem', category_name: 'Municipality', ward_id: '4', candidate_type: 'urban', position: 'Councillor' };
// a generated per-booth login (group 4, 30,538 on live): lands on the notice page in the new frontend (A1)
const BOOTH_USER = { sub: 'u16', name: 'Booth 12 login', first_name: 'Booth 12 login', group_id: 4, role: 'Booth Agent', home: '/booth/dashboard', mobile: '', mobile_no: '', paid_status: 'Yes', booth_id: 12, assembly_id: '86', booths: [] };
// Incomplete registrations (2026-10-15), as backend/src/services/leads.js: fictional people, numbers 90000003xx
const LEAD_STEPS = { contacted: [0, 'Messaged the bot'], language: [1, 'Chose a language'], details: [1, 'Gave name and number'], role: [2, 'Chose their role'], body_type: [3, 'Chose rural or urban'], position: [4, 'Chose the position'], district: [5, 'Chose the district'], assembly: [6, 'Chose the assembly'], booth_numbers: [7, 'Asked for booth numbers'] };
const LEADS = [
  ['Sample Lead One', 'booth_numbers', ['whatsapp'], 1], ['Sample Lead Two', 'district', ['whatsapp'], 2], ['', 'contacted', ['whatsapp'], 3],
  ['Sample Lead Four', 'details', ['website'], 5], ['Sample Lead Five', 'role', ['website', 'whatsapp'], 8], ['Sample Lead Six', 'language', ['whatsapp'], 12],
].map(([name, step, sources, daysAgo], i) => { const at = new Date(Date.now() - daysAgo * 864e5).toISOString(); return { _id: `lead${i + 1}`, mobile: `90000003${String(i + 1).padStart(2, '0')}`, wa_name: sources.includes('whatsapp') ? name : '', web_name: sources.includes('website') ? name : '', sources, first_seen: at, last_seen: at, step, step_rank: LEAD_STEPS[step][0], step_at: at, status: 'new', status_at: null, status_by: '', notes: [], history: [], registered_at: null }; });
function touchMockLead(mobile, name, source, step) {
  if (Object.values(MOCK_USERS).some((u) => u.mobile_no === mobile) || REGISTRATIONS.some((r) => r.mobile === mobile)) return;
  const now = new Date().toISOString(); let l = LEADS.find((x) => x.mobile === mobile);
  if (!l) { l = { _id: `lead${Date.now().toString(36)}`, mobile, wa_name: '', web_name: '', sources: [], first_seen: now, step: 'contacted', step_rank: -1, status: 'new', status_at: null, status_by: '', notes: [], history: [], registered_at: null }; LEADS.unshift(l); }
  l.last_seen = now; if (!l.sources.includes(source)) l.sources.push(source); if (name) l[source === 'website' ? 'web_name' : 'wa_name'] = name;
  if (LEAD_STEPS[step][0] > l.step_rank) Object.assign(l, { step, step_rank: LEAD_STEPS[step][0], step_at: now });
}
const LEAD_TABS = { open: (l) => !l.registered_at && ['new', 'contacted'].includes(l.status), interested: (l) => !l.registered_at && l.status === 'interested', not_interested: (l) => !l.registered_at && l.status === 'not_interested', registered: (l) => !!l.registered_at };
const MOCK_USERS = { ward: WARD_USER, candidate: CANDIDATE_USER, mla: MLA_USER, agent: AGENT_USER, legacy: LEGACY_USER, booth: BOOTH_USER };
const SUB_GROUPS = [3, 6, 11]; // as the backend's /payments/subscriptions after C11 (live still has [3, 6])
const isPaidValue = (v) => /^(yes|y|1|true|paid)$/i.test(String(v ?? '').trim()); // = backend utils/paid.js
const isCandidateUser = (u) => [4, 6, 11].includes(u.group_id);
const userBooths = (u) => (u.booths || []).map((b) => (typeof b === 'object' ? { assembly_no: b.assembly_no, part_no: b.part_no } : { assembly_no: Number(u.assembly_id), part_no: b }));
const SOCIAL_REQUESTS = {};
const MESSAGING_REPORTS = [
  { _id: 'r1', message_type: 'Text', message: 'Vote for Selvi on 14 Oct. Booth 7, symbol: lamp.', sender_id: 'EDMSTN', total_number: 1240, status: 'Delivered', created_at: '2026-10-08T10:20:00.000Z' },
  { _id: 'r2', message_type: 'WhatsApp', message: 'Town Panchayat ward 2 — our 5 promises (image)', sender_id: '+91 79047 59268', total_number: 860, status: 'Sent', created_at: '2026-10-09T15:05:00.000Z' },
  { _id: 'r3', message_type: 'Audio', message: '42-second appeal in Tamil', sender_id: 'IVR', total_number: 1240, status: 'Queued', created_at: '2026-10-10T09:30:00.000Z' },
];

// Payment setup (in memory). Same defaults as backend paymentSettings.js.
const PAYMENT_SETTINGS = {
  upi_id: 'senthilsky2301@okaxis', payee_name: 'senthilkumar nagendren',
  qr_url: 'https://res.cloudinary.com/ajp3dslc/image/upload/v1791377127/payment-qr.jpg', qr_public_id: '',
  proof_mode: 'chat', proof_number: '917092800426', bot_number: '917904759268', support_phone: '+91 79047 59268',
  activation_minutes: 30, gst_rate: 18,
  tiers: [{ max_booths: 1, base: 2000, label: '1 booth' }, { max_booths: 5, base: 5000, label: '2–5 booths' }, { max_booths: 10, base: 10000, label: '6–10 booths' }, { max_booths: 25, base: 25000, label: '11–25 booths' }, { max_booths: 100, base: 50000, label: '26–100 booths' }],
  updated_at: null, updated_by: null,
};
const tierTotal = (n) => { const t = PAYMENT_SETTINGS.tiers.find((x) => n <= x.max_booths) || PAYMENT_SETTINGS.tiers.at(-1); return t.base + Math.round(t.base * 0.18); };

// WhatsApp features (Ram, 2026-10-16), as backend/src/services/features.js + reminders.js: switches, test numbers,
// template names, a few synthetic reminder rows and a log. Everything starts Off, like a fresh live database.
const FEATURES = {
  pay_buttons: { label: 'Pay Now / Pay Later buttons', modes: ['off', 'test', 'all'] },
  stop_optout: { label: 'Reply STOP to stop reminders', modes: ['off', 'test', 'all'] },
  website_login: { label: 'Website login sent on WhatsApp', modes: ['off', 'test', 'all'] },
  payment_reminders: { label: 'Payment reminders (5)', modes: ['off', 'dry', 'test', 'all'] },
  incomplete_reminders: { label: 'Complete-your-registration reminders', modes: ['off', 'dry', 'test', 'all'] },
};
const FEATURE_SETTINGS = {
  features: Object.fromEntries(Object.keys(FEATURES).map((k) => [k, { mode: 'off', since: null }])),
  test_numbers: [],
  templates: { payment: { name: 'edms_payment_reminder', en: 'en', ta: 'ta' }, incomplete: { name: 'edms_complete_registration', en: 'en', ta: 'ta' }, activated: { name: 'edms_account_activated', en: 'en', ta: 'ta' } },
  updated_at: null, updated_by: '',
};
const WEBSITE_LOGIN_TEXT = { en: 'Send my EDMS login', ta: 'எனது EDMS உள்நுழைவு' };
const BOT_NUMBER = '917904759268';
const ten = (m) => String(m || '').replace(/\D/g, '').slice(-10);
const featureOnFor = (key, mobile) => { const f = FEATURE_SETTINGS.features[key]; return f.mode === 'all' || (f.mode === 'test' && FEATURE_SETTINGS.test_numbers.includes(ten(mobile))); };
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const REMINDERS = [
  { kind: 'payment', mobile: '9000000011', name: 'Mock Candidate', lang: 'en', booth_count: 3, registered_at: hoursAgo(20), count: 0, next_at: new Date(Date.now() + 4 * 3600e3).toISOString(), pay_later: [], done_at: null, stopped_at: null },
  { kind: 'payment', mobile: '9000000302', name: 'Sample Lead Two', lang: 'ta', booth_count: 1, registered_at: hoursAgo(50), count: 1, next_at: new Date(Date.now() + 22 * 3600e3).toISOString(), pay_later: [{ text: 'Monday evening', at: hoursAgo(3) }], done_at: null, stopped_at: null },
];
const REMINDER_LOG = [
  { _id: 'log1', kind: 'payment', mobile: '9000000302', step: 1, of: 5, template: 'edms_payment_reminder', lang: 'ta', mode: 'dry', ok: true, dry: true, at: hoursAgo(26) },
  { _id: 'log2', kind: 'pay_later', mobile: '9000000302', text: 'Monday evening', mode: 'reply', ok: true, at: hoursAgo(3) },
  { _id: 'log3', kind: 'incomplete', mobile: '9000000301', step: 'nudge', of: 2, template: '(free message)', lang: 'both', mode: 'dry', ok: true, dry: true, at: hoursAgo(1) },
];
const WACTO_TEMPLATES = [
  { name: 'edms_payment_reminder', language: 'en', status: 'APPROVED', category: 'UTILITY', rejected_reason: '' },
  { name: 'edms_payment_reminder', language: 'ta', status: 'APPROVED', category: 'UTILITY', rejected_reason: '' },
  { name: 'edms_complete_registration', language: 'en', status: 'APPROVED', category: 'UTILITY', rejected_reason: '' },
  { name: 'edms_complete_registration', language: 'ta', status: 'PENDING', category: 'UTILITY', rejected_reason: '' },
  { name: 'edms_account_activated', language: 'en', status: 'REJECTED', category: 'MARKETING', rejected_reason: 'INVALID_FORMAT' },
];
const templateParams = (key, mobile) => {
  const u = Object.values(MOCK_USERS).find((x) => x.mobile_no === ten(mobile));
  const name = (u?.first_name || 'there').split(' ')[0]; const booths = u ? (Array.isArray(u.booths) && u.booths.length) || u.booth_count || 1 : 1;
  return key === 'payment' ? [name, String(booths), `₹${Math.round(tierTotal(booths) / 1.18).toLocaleString('en-IN')} + 18% GST`] : key === 'activated' ? [name, String(booths)] : [name];
};

// Fictional UPI receipt as an inline SVG (no real screenshots in the mock).
const receipt = (amt, utr, name) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='360' height='640' viewBox='0 0 360 640'><rect width='360' height='640' fill='#f6f7fb'/><rect width='360' height='88' fill='#1a73e8'/><text x='24' y='52' font-family='Arial' font-size='18' fill='#fff' font-weight='700'>Payment successful</text><circle cx='180' cy='190' r='44' fill='#34a853'/><path d='M158 190l16 16 30-34' stroke='#fff' stroke-width='8' fill='none'/><text x='180' y='290' text-anchor='middle' font-family='Arial' font-size='34' font-weight='700' fill='#111'>Rs ${amt}</text><text x='180' y='322' text-anchor='middle' font-family='Arial' font-size='14' fill='#555'>to senthilkumar nagendren</text><text x='24' y='400' font-family='Arial' font-size='12' fill='#777'>UPI transaction ID</text><text x='24' y='424' font-family='Arial' font-size='16' fill='#111' font-weight='600'>${utr}</text><text x='24' y='470' font-family='Arial' font-size='12' fill='#777'>From</text><text x='24' y='494' font-family='Arial' font-size='16' fill='#111'>${name}</text><text x='24' y='600' font-family='Arial' font-size='11' fill='#999'>Local mock receipt - not a real payment</text></svg>`);
const PROOF_META = {
  utr1: { source: 'whatsapp', shot: true, caption: 'Paid for 2 booths' },
  utr2: { source: 'website', shot: true },
  utr3: { source: 'whatsapp', shot: false, wa_media_id: 'wamid.MOCK.3' },
  utr4: { source: 'utr-form', shot: false },
  utr5: { source: 'whatsapp', shot: true },
};
for (const p of UTR_PAYMENTS) {
  const m = PROOF_META[p._id] || {};
  p.source = m.source || 'utr-form';
  p.expected_amount = tierTotal(p.booth_count);
  p.caption = m.caption || '';
  p.wa_media_id = m.wa_media_id || '';
  p.screenshot_url = m.shot ? receipt(p.amount.toLocaleString('en-IN'), p.utr, p.user_name) : '';
  p.screenshots = m.shot ? [{ url: p.screenshot_url, source: p.source, received_at: p.submitted_at }] : [];
  if (p.status === 'approved') p.reviewed_by = 'Super Admin';
}
let proofSeq = 100;

// CRM team (fictional agents; stats match the live 12-lead / 1-call picture)
const ST = (o = {}) => ({ interested: 0, not_interested: 0, first_call_complete: 0, second_call_complete: 0, third_call_complete: 0, switch_off: 0, not_answered: 0, will_call_back: 0, calls_completed: 0, pro_users: 0, total_handled: 0, ...o });
const TEAM = [
  { id: 't1', user_id: 901, name: 'Priya Mock', username: 'priya.crm', mobile: '9000000101', password_str: '482913', is_active: true, created_at: '2026-09-28T09:00:00.000Z', last_login: '2026-10-10T16:20:00.000Z', stats: ST({ total_handled: 5, interested: 2, switch_off: 2, not_answered: 1, calls_completed: 1 }) },
  { id: 't2', user_id: 902, name: 'Arun Mock', username: 'arun.crm', mobile: '9000000102', password_str: '715204', is_active: true, created_at: '2026-09-28T09:05:00.000Z', last_login: '2026-10-09T11:00:00.000Z', stats: ST({ total_handled: 4, not_interested: 1, switch_off: 1, not_answered: 1 }) },
  { id: 't3', user_id: 903, name: 'Kavitha Mock', username: 'kavitha.crm', mobile: '9000000103', password_str: '930117', is_active: false, created_at: '2026-10-02T10:30:00.000Z', last_login: null, stats: ST() },
];
let teamSeq = 3;

// Bot Messages & Media — overrides kept in memory (local only)
const BOT_OVERRIDES = { bot_menu_support_intro_ta: 'உங்கள் சந்தேகத்தை கீழே தட்டச்சு செய்யவும்; 2 மணி நேரத்தில் பதில் தருகிறோம்! (local edit)' };
const BOT_IMG_OVERRIDES = {};
const LEGACY_ASSETS = [
  { key: 'register_header', name: 'Registration Flow Header (Video/Image)', type: 'image', url: 'https://res.cloudinary.com/ajp3dslc/image/upload/v1791185739/edms-bot/edms-brand.jpg' },
  { key: 'svc_welcome_banner', name: 'Services: Welcome Banner', type: 'image', url: 'https://res.cloudinary.com/ajp3dslc/image/upload/v1791185741/edms-bot/edms-plans.jpg' },
  { key: 'svc_icon_register', name: 'Services Icon: Register', type: 'image', url: null },
  { key: 'flag_dmk', name: 'DMK Flag', type: 'image', url: null },
  { key: 'flag_tvk', name: 'TVK Flag', type: 'image', url: null },
];
const botCatalog = () => ({
  success: true, groups: BOT_GROUPS, payment_qr_url: PAYMENT_SETTINGS.qr_url,
  texts: Object.entries(BOT_TEXTS).map(([key, d]) => ({ key, group: d.group, name: d.name, when: d.when, vars: d.vars || [], image: d.image || null, max: d.image ? 1024 : 4096, default_en: d.en, default_ta: d.ta, en: BOT_OVERRIDES[`bot_${key}_en`] ?? d.en, ta: BOT_OVERRIDES[`bot_${key}_ta`] ?? d.ta, custom_en: BOT_OVERRIDES[`bot_${key}_en`] !== undefined, custom_ta: BOT_OVERRIDES[`bot_${key}_ta`] !== undefined })),
  images: Object.entries(BOT_IMAGES).map(([key, d]) => ({ key, asset_key: `bot_img_${key}`, name: d.name, when: d.when, default_url: d.url, url: BOT_IMG_OVERRIDES[`bot_img_${key}`] || d.url, custom: !!BOT_IMG_OVERRIDES[`bot_img_${key}`] })),
});

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};
const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } }); });

const routes = {
  'POST /api/auth/login': async (req, res, q, body) => {
    const key = String(body.username || '').trim().toLowerCase();
    const digits = key.replace(/\D/g, '').slice(-10);
    const user = key === 'admin' ? ADMIN_USER : MOCK_USERS[key] || (digits.length === 10 ? Object.values(MOCK_USERS).find((u) => u.mobile_no === digits) : null);
    if (!user) return send(res, 401, { success: false, message: 'Local test server: real accounts are not available offline. Log in as admin, candidate, ward, mla or agent (any password).' });
    if (user === AGENT_USER) return send(res, 403, { success: false, message: 'Your account is deactivated.' }); // as the backend after scripts/deactivate-crm-agents.mjs (CRM removed 2026-10-14)
    loggedIn = true; currentUser = user;
    user.paid_status = isPaidValue(user.paid_status) ? 'Yes' : 'No'; // the backend's login does the same (B5)
    // the cookie names the login, so localhost and 127.0.0.1 can hold two roles side by side
    send(res, 200, { success: true, user: currentUser }, { 'Set-Cookie': `edm_mock=${user === ADMIN_USER ? 'admin' : Object.keys(MOCK_USERS).find((k) => MOCK_USERS[k] === user)}; Path=/; HttpOnly` });
  },
  'POST /api/auth/logout': (req, res) => { loggedIn = false; send(res, 200, { success: true }); },
  'POST /api/auth/refresh': (req, res) => send(res, 200, { success: true }),
  'GET /api/auth/me': (req, res) => send(res, 200, { success: true, user: currentUser }),
  'GET /api/dashboard/stats': (req, res) => send(res, 200, { success: true, voterDbOnline: true, stats: VOTER_TOTALS }),
  'GET /api/dashboard/search-epic': (req, res, q) => {
    const epic = String(q.get('epic') || '').trim().toUpperCase();
    if (epic === EPIC_SAMPLE.EPIC_NO) return send(res, 200, { success: true, voter: EPIC_SAMPLE, assembly_name: 'Chepauk-Thiruvallikeni', elapsed_ms: 42 });
    send(res, 200, { success: false, elapsed_ms: 38, message: `Voter not found with EPIC number: ${epic}` });
  },
  'GET /api/registrations': (req, res, q) => {
    const page = Math.max(1, Number(q.get('page') || 1));
    const pageSize = Math.min(200, Math.max(1, Number(q.get('pageSize') || 25)));
    let rows = REGISTRATIONS;
    const s = (q.get('search') || '').toLowerCase();
    if (s) rows = rows.filter((r) => r.full_name.toLowerCase().includes(s) || r.mobile.includes(s));
    for (const k of ['district', 'position', 'body_type']) if (q.get(k)) rows = rows.filter((r) => r[k].toLowerCase() === q.get(k).toLowerCase());
    send(res, 200, { success: true, total: rows.length, page, pageSize, rows: rows.slice((page - 1) * pageSize, page * pageSize) });
  },
  'GET /api/payments/pending-utrs': (req, res, q) => {
    const st = q.get('status') || 'pending';
    const rows = st === 'all' ? UTR_PAYMENTS : UTR_PAYMENTS.filter((p) => p.status === st);
    send(res, 200, { success: true, rows, total: rows.length, page: 1, limit: 100 });
  },
  // Paid list: live has 0 today; the mock derives it from approved UTRs so the tab isn't empty.
  'GET /api/payments/subscriptions': (req, res) => send(res, 200, { success: true, page: 1, limit: 100, subscriptions: UTR_PAYMENTS.filter((p) => p.status === 'approved' && SUB_GROUPS.includes(Number(Object.values(MOCK_USERS).find((u) => u.mobile_no === p.mobile_no)?.group_id ?? 11))).map((p) => ({ name: p.user_name, mobile_no: p.mobile_no, user_group_id: Object.values(MOCK_USERS).find((u) => u.mobile_no === p.mobile_no)?.group_id ?? 11, role_label: 'Candidate', local_body_type: p.candidate_type, assembly_name: `${p.district_id} (AC)`, district: p.district_id, booth_count: p.booth_count, transaction_id: p.utr, amount: p.amount, payment_date: p.reviewed_at })) }),
  'GET /api/payments/ledger': (req, res) => send(res, 200, { success: true, page: 1, limit: 100, payments: UTR_PAYMENTS.filter((p) => p.status === 'approved').map((p) => ({ payment_id: p.utr, user_name: p.user_name, mobile_no: p.mobile_no, amount: p.amount, status: 'Paid', source: 'qr-utr', booth_count: p.booth_count, created_at: p.reviewed_at })) }),
  'GET /api/flow-images/bot': (req, res) => send(res, 200, botCatalog()),
  'POST /api/flow-images/bot/texts': (req, res, q, body) => {
    // same checks as the backend's saveBotTexts: limit per message type, no unknown {placeholder}
    for (const [field, value] of Object.entries(body)) {
      const m = /^(.+)_(en|ta)$/.exec(field); const d = m && BOT_TEXTS[m[1]]; if (!d) continue;
      const text = String(value ?? ''); const label = `${d.name} (${m[2] === 'ta' ? 'Tamil' : 'English'})`; const max = d.image ? 1024 : 4096;
      if (text.length > max) return send(res, 400, { success: false, message: `${label} is longer than ${max} characters.` });
      const unknown = [...text.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).filter((v) => !(d.vars || []).includes(v));
      if (unknown.length) return send(res, 400, { success: false, message: `${label} uses {${unknown[0]}}, which the bot does not fill in.` });
    }
    let saved = 0, reset = 0;
    for (const [field, value] of Object.entries(body)) {
      const m = /^(.+)_(en|ta)$/.exec(field); if (!m || !BOT_TEXTS[m[1]]) continue;
      const k = `bot_${m[1]}_${m[2]}`; const text = String(value ?? '');
      if (!text.trim() || text === BOT_TEXTS[m[1]][m[2]]) { if (k in BOT_OVERRIDES) { delete BOT_OVERRIDES[k]; reset++; } } else { BOT_OVERRIDES[k] = text; saved++; }
    }
    send(res, 200, { success: true, saved, reset, message: saved || reset ? `Saved ${saved} text${saved === 1 ? '' : 's'}${reset ? `, ${reset} back to default` : ''}. The bot uses the new wording within a minute.` : 'Nothing to save.' });
  },
  'GET /api/flow-images': (req, res) => send(res, 200, { success: true, assets: [...Object.entries(BOT_IMAGES).map(([key, d]) => ({ key: `bot_img_${key}`, name: `Bot: ${d.name}`, type: 'image', url: BOT_IMG_OVERRIDES[`bot_img_${key}`] || null })), ...LEGACY_ASSETS] }),
  'POST /api/flow-images/upload': (req, res, q, body) => {
    const url = `data:${body.mime || 'image/jpeg'};base64,${body.fileBase64 || ''}`;
    if (String(body.key).startsWith('bot_img_')) BOT_IMG_OVERRIDES[body.key] = url; else { const a = LEGACY_ASSETS.find((x) => x.key === body.key); if (a) a.url = url; }
    send(res, 200, { success: true, message: 'Asset uploaded successfully!', url });
  },
  'GET /api/flow-sim/flows': (req, res) => {
    const flows = fs.readdirSync(WACTO_DIR).filter((f) => /^[\w .()-]+\.json$/.test(f)).map((name) => { const st = fs.statSync(path.join(WACTO_DIR, name)); let title = '', nodes = 0; try { const j = JSON.parse(fs.readFileSync(path.join(WACTO_DIR, name), 'utf8')); title = j.chatbot?.name || ''; nodes = j.nodes?.length || 0; } catch {} return { name, title, nodes, size: st.size, modified: st.mtime.toISOString() }; }).sort((a, b) => (a.modified < b.modified ? 1 : -1));
    send(res, 200, { success: true, dir: WACTO_DIR, flows });
  },
  'GET /api/payments/settings': (req, res) => send(res, 200, { success: true, settings: PAYMENT_SETTINGS }),
  'PUT /api/payments/settings': (req, res, q, body) => {
    for (const k of ['upi_id', 'payee_name', 'proof_mode', 'proof_number', 'bot_number', 'support_phone', 'activation_minutes']) if (body[k] !== undefined) PAYMENT_SETTINGS[k] = body[k];
    if (body.qr_base64) PAYMENT_SETTINGS.qr_url = body.qr_base64;
    PAYMENT_SETTINGS.updated_at = new Date().toISOString(); PAYMENT_SETTINGS.updated_by = 'Super Admin';
    send(res, 200, { success: true, settings: PAYMENT_SETTINGS, message: 'Payment setup saved. The website and the bot use it from now on.' });
  },
  // WhatsApp features (admin) — as backend featureController.js
  'GET /api/public/whatsapp-login': (req, res) => send(res, 200, { success: true, all: FEATURE_SETTINGS.features.website_login.mode === 'all' }),
  'GET /api/whatsapp-features': (req, res) => {
    const upcoming = REMINDERS.filter((r) => !r.done_at && !r.stopped_at && r.next_at).map((r) => ({ kind: 'payment', mobile: r.mobile, name: r.name, step: r.count + 1, of: 5, due_at: r.next_at, mode: FEATURE_SETTINGS.features.payment_reminders.mode === 'off' ? 'off' : featureOnFor('payment_reminders', r.mobile) ? 'send' : 'dry', pay_later: r.pay_later.at(-1) || null }));
    send(res, 200, { success: true, features: FEATURES, settings: FEATURE_SETTINGS, counts: { payment_active: upcoming.length, payment_done: 0, opted_out: 0 }, upcoming, log: [...REMINDER_LOG].sort((a, b) => String(b.at).localeCompare(a.at)).slice(0, 100) });
  },
  'PUT /api/whatsapp-features': (req, res, q, body) => {
    const now = new Date().toISOString();
    for (const [k, v] of Object.entries(body.features || {})) {
      if (!FEATURES[k]) return send(res, 422, { success: false, message: `Unknown feature ${k}.` });
      const mode = String(v?.mode || '');
      if (!FEATURES[k].modes.includes(mode)) return send(res, 422, { success: false, message: `${FEATURES[k].label}: "${mode}" is not a valid setting.` });
      if (FEATURE_SETTINGS.features[k].mode === 'off' && mode !== 'off' && !FEATURE_SETTINGS.features[k].since) FEATURE_SETTINGS.features[k].since = now;
      FEATURE_SETTINGS.features[k].mode = mode;
    }
    if (Array.isArray(body.test_numbers)) {
      const nums = [...new Set(body.test_numbers.map(ten))];
      if (nums.some((m) => !/^[6-9]\d{9}$/.test(m))) return send(res, 422, { success: false, message: 'Test numbers must be 10-digit mobile numbers.' });
      if (nums.length > 5) return send(res, 422, { success: false, message: 'At most 5 test numbers.' });
      FEATURE_SETTINGS.test_numbers = nums;
    }
    for (const key of Object.keys(FEATURE_SETTINGS.templates)) { const t = body.templates?.[key]; if (!t) continue; for (const f of ['name', 'en', 'ta']) if (t[f] != null) FEATURE_SETTINGS.templates[key][f] = String(t[f]).trim(); }
    FEATURE_SETTINGS.updated_at = now; FEATURE_SETTINGS.updated_by = 'Super Admin';
    send(res, 200, { success: true, settings: FEATURE_SETTINGS });
  },
  'POST /api/whatsapp-features/test-send': (req, res, q, body) => {
    const m = ten(body.mobile); const key = body.template; const lang = body.lang === 'ta' ? 'ta' : 'en';
    if (!FEATURE_SETTINGS.templates[key]) return send(res, 422, { success: false, message: 'Choose a template.' });
    if (!FEATURE_SETTINGS.test_numbers.includes(m)) return send(res, 403, { success: false, message: 'Test messages go only to a saved test number. Add the number under Test numbers and save first.' });
    const tpl = FEATURE_SETTINGS.templates[key]; const params = templateParams(key, m);
    REMINDER_LOG.unshift({ _id: `log${REMINDER_LOG.length + 1}`, kind: 'test', mobile: m, step: key, template: tpl.name, lang: tpl[lang], mode: 'send', ok: true, message_id: 'wamid.MOCK', at: new Date().toISOString(), by: 'Super Admin' });
    send(res, 200, { success: true, message: `Sent "${tpl.name}" (${tpl[lang]}) to ******${m.slice(-4)}.`, params });
  },
  'GET /api/whatsapp-features/templates': (req, res) => send(res, 200, { success: true, templates: WACTO_TEMPLATES }),
  'POST /api/payments/submit-utr': (req, res, q, body) => {
    const shot = /^data:image\//.test(String(body.screenshot || '')) ? String(body.screenshot) : '';
    const utr = String(body.utr || '').trim();
    if (!shot && utr.length < 6) return send(res, 400, { success: false, message: 'Upload the payment screenshot or enter the UTR / transaction ID.' });
    if (utr && UTR_PAYMENTS.some((p) => p.utr === utr && p.mobile_no !== currentUser.mobile_no)) return send(res, 400, { success: false, message: 'This UTR has already been submitted from another account.' });
    const now = new Date().toISOString();
    let row = UTR_PAYMENTS.find((p) => p.mobile_no === currentUser.mobile_no && p.status === 'pending');
    let outcome = 'attached';
    if (!row) {
      outcome = 'created';
      row = { _id: `utr${++proofSeq}`, utr: '', user_id: currentUser.sub, user_name: currentUser.name, mobile_no: currentUser.mobile_no, district_id: currentUser.district_id, category_name: currentUser.category_name, ward_id: currentUser.ward_id, candidate_type: currentUser.candidate_type, booth_count: 3, amount: tierTotal(3), expected_amount: tierTotal(3), source: 'website', screenshot_url: '', screenshots: [], wa_media_id: '', caption: '', status: 'pending', submitted_at: now, reviewed_at: null };
      UTR_PAYMENTS.unshift(row);
    }
    if (shot) { row.screenshots.push({ url: shot, source: 'website', received_at: now }); if (!row.screenshot_url) row.screenshot_url = shot; }
    if (utr && !row.utr) row.utr = utr;
    row.updated_at = now;
    send(res, 200, { success: true, outcome, pending_since: row.submitted_at, expected_amount: row.expected_amount, message: `Payment proof received. We verify it within ${PAYMENT_SETTINGS.activation_minutes} minutes and activate your account.` });
  },
  'GET /api/ward/home': (req, res) => {
    const u = currentUser; const booths = userBooths(u);
    const account = { ward_login: u.name, body_type: u.candidate_type || '-', position: u.position || '-', district: u.district_id || '-', local_body: u.category_name || '-', ward_number: u.ward_id ?? '-', username: u.mobile_no || '-', paid_status: u.paid_status || 'No', transaction_id: u.transaction_id || null };
    if (!booths.length) return send(res, 200, { success: true, isSample: true, account, sample: { booths: 47, voters: 705 } });
    if (u.paid_status !== 'Yes') return send(res, 200, { success: true, isSample: false, paymentPending: true, account, boothCount: booths.length });
    const rows = booths.map((b) => { const vs = votersFor(b.assembly_no).filter((v) => v.PART_NO === b.part_no); return { assembly_no: b.assembly_no, assembly_name: ASSEMBLY_LIST[b.assembly_no - 1]?.assembly_name || `Assembly ${b.assembly_no}`, part_no: b.part_no, booth_name: vs[0]?.BOOTH_NAME || `Booth ${b.part_no}`, voter_count: vs.length }; });
    send(res, 200, { success: true, isSample: false, account, booths: rows });
  },
  'GET /api/ward/sample-voters': (req, res, q) => { const page = Number(q.get('page') || 1), ps = Number(q.get('pageSize') || 10); const all = votersFor(1).slice(0, 705); send(res, 200, { success: true, total: all.length, page, pageSize: ps, rows: all.slice((page - 1) * ps, page * ps) }); },
  'GET /api/ward/social-media': (req, res) => { const booths = userBooths(currentUser); send(res, 200, { success: true, isSample: !booths.length, boothList: booths.length ? booths.map((b) => ({ ...b, assembly_name: ASSEMBLY_LIST[b.assembly_no - 1]?.assembly_name, booth_name: votersFor(b.assembly_no).find((v) => v.PART_NO === b.part_no)?.BOOTH_NAME || `Booth ${b.part_no}` })) : Array.from({ length: 5 }, (_, i) => ({ assembly_no: 0, assembly_name: 'Sample Assembly', part_no: i + 1, booth_name: `Sample Booth ${i + 1}` })), existingRequests: SOCIAL_REQUESTS[currentUser.sub] || {} }); },
  'GET /api/ward/social-media/booth-sections': (req, res, q) => send(res, 200, q.get('is_sample') === '1' ? [1, 2, 3, 4] : [1, 2, 3, 4, 5, 6]),
  'POST /api/ward/social-media/request': (req, res, q, body) => {
    if (!['sms', 'voice', 'whatsapp'].includes(body.service_type)) return send(res, 400, { success: false, message: 'Invalid service type.' });
    if (body.all_voters !== '1' && !body.booth) return send(res, 400, { success: false, message: 'Select a booth or choose All Voters.' });
    (SOCIAL_REQUESTS[currentUser.sub] ||= {})[body.service_type] = true;
    send(res, 200, { success: true, message: 'Your request has been submitted successfully.' });
  },
  'GET /api/messaging/reports': (req, res, q) => send(res, 200, { success: true, rows: MESSAGING_REPORTS.filter((r) => !q.get('type') || r.message_type === q.get('type')) }),
  'POST /api/payments/approve-utr': (req, res, q, body) => {
    const row = UTR_PAYMENTS.find((p) => p._id === String(body.utr_id));
    if (!row) return send(res, 404, { success: false, message: 'UTR record not found.' });
    if (row.status !== 'pending') return send(res, 400, { success: false, message: `This UTR is already ${row.status}.` });
    if (!['approve', 'reject'].includes(body.action)) return send(res, 400, { success: false, message: 'utr_id and action (approve/reject) are required.' });
    row.status = body.action === 'approve' ? 'approved' : 'rejected';
    row.reviewed_by = 'Super Admin';
    if (body.action === 'reject') row.reject_reason = String(body.reason || '');
    if (body.action === 'approve') { row.amount = row.expected_amount || row.amount; row.transaction_id = row.utr || `QR-${row._id.toUpperCase()}`; const payer = Object.values(MOCK_USERS).find((u) => u.mobile_no === row.mobile_no); if (payer) { payer.paid_status = 'Yes'; payer.transaction_id = row.transaction_id; } const reg = REGISTRATIONS.find((r) => r.mobile === row.mobile_no); if (reg) { reg.paid_status = 'Yes'; reg.transaction_id = row.transaction_id; } /* as live: the list reads the account flag */ }
    row.reviewed_at = new Date().toISOString();
    send(res, 200, { success: true, message: body.action === 'approve' ? 'Payment approved. User marked as PAID.' : 'UTR rejected.' });
  },
  'GET /api/payments/check-paid': (req, res) => {
    if (!isCandidateUser(currentUser)) return send(res, 200, { success: true, paid: true });
    if (currentUser.paid_status === 'Yes') return send(res, 200, { success: true, paid: true, transaction_id: currentUser.transaction_id });
    const pending = UTR_PAYMENTS.find((p) => p.mobile_no === currentUser.mobile_no && p.status === 'pending');
    send(res, 200, { success: true, paid: false, pending: !!pending, pending_since: pending?.submitted_at || null, pending_has_screenshot: !!pending?.screenshot_url });
  },
  // MLA photos / party flags: uploads are kept in memory as data URLs (local only).
  'GET /api/mla/images': (req, res) => send(res, 200, { success: true, profiles: MLA_PROFILES, flags: MLA_FLAGS }),
  'POST /api/mla/profile-upload': (req, res, q, body) => {
    if (!body.constituency_no || !body.fileBase64) return send(res, 400, { success: false, message: 'constituency_no and fileBase64 are required.' });
    MLA_PROFILES[body.constituency_no] = `data:${body.mime || 'image/png'};base64,${body.fileBase64}`;
    send(res, 200, { success: true, url: MLA_PROFILES[body.constituency_no] });
  },
  'POST /api/mla/flag-upload': (req, res, q, body) => {
    if (!body.party || !body.fileBase64) return send(res, 400, { success: false, message: 'party and fileBase64 are required.' });
    MLA_FLAGS[body.party] = `data:${body.mime || 'image/png'};base64,${body.fileBase64}`;
    send(res, 200, { success: true, url: MLA_FLAGS[body.party] });
  },
  'GET /api/assemblies': (req, res) => send(res, 200, { success: true, assemblies: ASSEMBLY_LIST }),
  // Public registration (the website form): the real route creates the user, sends the login over WACTO and returns
  // { username: mobile, passcode }. The mock adds a registration row so the admin list and the sign-up check see it.
  // Ward logins (group 6): one sample row so the list's hidden passcodes are tested on the mock too (check 43)
  'GET /api/ward-logins': (req, res) => send(res, 200, { success: true, rows: [{ _id: 'w1', id: 1, candidate_type: 'urban', position: 'Councillor', district: 'Salem', local_body: 'Salem Corporation', ward_id: 4, username: 'salem_w4', passcode: '482915', description: 'Ward 4', booths: [12, 15, 20] }] }),
  'GET /api/public/assemblies': (req, res) => send(res, 200, { success: true, assemblies: ASSEMBLY_LIST }),
  'POST /api/public/lead': (req, res, q, body) => {
    const mobile = String(body.mobile || '').replace(/\D/g, ''); const name = String(body.full_name || '').replace(/[0-9]/g, '').trim().slice(0, 80);
    if (/^[6-9]\d{9}$/.test(mobile) && name) touchMockLead(mobile, name, 'website', body.step === 'role' ? 'role' : 'details');
    send(res, 200, { success: true });
  },
  'GET /api/leads': (req, res, q) => {
    const tab = LEAD_TABS[q.get('tab')] ? q.get('tab') : 'open'; const src = q.get('source'); const s = String(q.get('search') || '').toLowerCase();
    const extra = (l) => (!src || l.sources.includes(src)) && (!s || [l.mobile, l.wa_name, l.web_name].some((v) => String(v).toLowerCase().includes(s)));
    const counts = Object.fromEntries(Object.entries(LEAD_TABS).map(([k, f]) => [k, LEADS.filter((l) => f(l) && extra(l)).length]));
    const page = Math.max(1, Number(q.get('page')) || 1), size = Math.min(200, Number(q.get('pageSize')) || 25);
    const rows = LEADS.filter((l) => LEAD_TABS[tab](l) && extra(l)).sort((a, b) => (tab === 'open' ? b.step_rank - a.step_rank || String(b.last_seen).localeCompare(a.last_seen) : String(b.registered_at || b.status_at).localeCompare(a.registered_at || a.status_at)));
    send(res, 200, { success: true, tab, page, pageSize: size, total: counts[tab], counts, last_rank: 7, rows: rows.slice((page - 1) * size, page * size).map((l) => ({ ...l, name: l.web_name || l.wa_name || '', step_label: LEAD_STEPS[l.step][1] })) });
  },
  'POST /api/auth/register': (req, res, q, body) => {
    const fullName = String(body.full_name || '').trim(); const mobile = String(body.mobile || '').replace(/\D/g, '');
    if (!fullName || !mobile) return send(res, 400, { success: false, message: 'Full name and mobile number are required.' });
    if (!/^\d{10}$/.test(mobile)) return send(res, 400, { success: false, message: 'Enter a valid 10-digit mobile number.' });
    // as the backend (2026-10-14): a number with an account is refused with 409 and nothing changes
    if (REGISTRATIONS.some((r) => r.mobile === mobile) || Object.values(MOCK_USERS).some((u) => u.mobile_no === mobile)) return send(res, 409, { success: false, code: 'ALREADY_REGISTERED', message: 'This number is already registered. Sign in with your passcode, or WhatsApp us on +91 79047 59268 to get your login.', ...(featureOnFor('website_login', mobile) ? { whatsapp: { number: BOT_NUMBER, text: WEBSITE_LOGIN_TEXT.en, text_ta: WEBSITE_LOGIN_TEXT.ta } } : {}) });
    const passcode = String(100000 + Math.floor(Math.random() * 900000));
    const booths = Array.isArray(body.booths) ? body.booths.map(Number).filter(Boolean) : [];
    REGISTRATIONS.unshift({ _id: `mock${Date.now().toString(36)}`, id: null, full_name: fullName, mobile, district: body.district || '', position: body.position || '', body_type: body.body_type || '', local_body: '', ward_number: '', assembly_id: Number(body.assembly_id) || null, assembly_name: body.assembly_name || '', booths, booth_count: booths.length, passcode, paid_status: 'No', transaction_id: null, created_at: new Date().toISOString(), requests: [], source: 'website', role: body.role || '', affiliation: body.affiliation || '', party: body.party || '', union_or_municipality: '', panchayat_or_corporation: '' });
    const lead = LEADS.find((l) => l.mobile === mobile); if (lead && !lead.registered_at) lead.registered_at = new Date().toISOString(); // as the backend: leaves the open list
    // website_login switch on for this number: no passcode on screen, the bot sends it on request (as the backend)
    if (featureOnFor('website_login', mobile)) return send(res, 200, { success: true, message: 'Registration successful!', username: mobile, via: 'whatsapp', whatsapp: { number: BOT_NUMBER, text: WEBSITE_LOGIN_TEXT[body.lang === 'ta' ? 'ta' : 'en'] } });
    send(res, 200, { success: true, message: 'Registration successful!', username: mobile, passcode });
  },
  // Electoral data (step 7): booths, analytics, booth report, documents.
  'GET /api/booths': (req, res, q) => {
    const ac = Number(q.get('assemblyId') || 0);
    if (!ac) return send(res, 200, { success: true, booths: [] });
    send(res, 200, { success: true, booths: boothSummary(ac).map((b, i) => ({ part_no: b.part_no, booth_name: b.booth_name, section_name: b.section_name, has_coords: i % 5 !== 2 })) });
  },
  'GET /api/reports/assembly-analytics': (req, res, q) => {
    const ac = reportScope(q).ac; // as the backend: non-admin logins get their own assembly whatever they ask for
    const rows = votersFor(ac);
    const by = (f) => rows.filter(f).length;
    // fake booth GPS inside the real assembly outline; every 5th booth has none, every 13th sits just outside
    const pt = (i) => (i % 5 === 2 ? [null, null] : i % 13 === 7 ? outsidePoint(ac) : insidePoint(ac, i));
    send(res, 200, { success: true, assembly_no: ac, assembly_name: ASSEMBLY_LIST[ac - 1]?.assembly_name, district: ASSEMBLY_LIST[ac - 1]?.district, total: rows.length, male: by((v) => v.GENDER === 'Male'), female: by((v) => v.GENDER === 'Female'), other: by((v) => v.GENDER === 'Other'), youth: by((v) => v.AGE <= 35), middle: by((v) => v.AGE > 35 && v.AGE < 60), senior: by((v) => v.AGE >= 60), booths: boothSummary(ac).map((b, i) => { const [lat, lng] = pt(i); return { ...b, lat, lng }; }) });
  },
  'GET /api/reports/booth': (req, res, q) => {
    const { ac, parts, locked } = reportScope(q);
    let rows = boothSummary(ac).filter((b) => !parts || parts.includes(Number(b.part_no))).map((b) => ({ part_no: b.part_no, booth_name: b.booth_name, total: b.voter_count, male: b.male_voters, female: b.female_voters, other: b.other_voters }));
    let totals = rows.reduce((t, r) => ({ total: t.total + r.total, male: t.male + r.male, female: t.female + r.female, other: t.other + r.other }), { total: 0, male: 0, female: 0, other: 0 });
    if (locked) { rows = rows.map((r) => ({ part_no: r.part_no, booth_name: r.booth_name, total: null, male: null, female: null, other: null })); totals = null; } // C13
    send(res, 200, { success: true, assembly_no: ac, assembly_name: ASSEMBLY_LIST[ac - 1]?.assembly_name, district: ASSEMBLY_LIST[ac - 1]?.district, locked: !!locked, totals, rows });
  },
  'GET /api/reports/booth-report-list': (req, res, q) => { const { ac, locked } = reportScope(q); if (locked) return send(res, 200, { success: true, assemblyNo: ac, booths: [], locked: true }); send(res, 200, { success: true, assemblyNo: ac, booths: realBoothReports(ac) ?? boothSummary(ac).map((b) => b.part_no).filter((n) => n % 3 !== 0) }); },
  'GET /api/reports/documents': (req, res, q) => {
    const { ac } = reportScope(q);
    const real = fs.existsSync(path.join(REPORTS_DIR, 'Assembly_Reports'));
    const doc = (file) => { const rel = `Assembly_Reports/ASS ${ac} Reports/Main Deliverables/${file}`; const has = real ? fs.existsSync(path.join(REPORTS_DIR, rel)) : ac % 4 !== 3; return { url: has ? `/report-files/${rel}` : null, exists: has }; };
    send(res, 200, { success: true, assemblyNo: ac, booth: null, forced: false, documents: [
      { key: 'candidate-briefing', label: 'Candidate Briefing', kind: 'assembly', ...doc('CANDIDATE_BRIEFING.html') },
      { key: 'field-operations', label: 'Field Operations Manual', kind: 'assembly', ...doc('FIELD_OPERATIONS_MANUAL.html') },
    ] });
  },
  // Assembly (MLA) logins: one per AC. Mock: 230 of 234 have credentials.
  'GET /api/assembly-credentials': (req, res) => send(res, 200, { success: true, rows: Object.values(ASSEMBLY_CREDS) }),
  // Booth logins: one per PART_NO of the assembly, passcode = assembly passcode + booth no (as live).
  'GET /api/booth-logins': (req, res, q) => {
    const ac = Number(q.get('assembly_id') || 0);
    if (!ac) return send(res, 200, { success: true, rows: [] });
    if (!BOOTH_LOGINS.has(ac)) return send(res, 200, { success: true, rows: [] });
    send(res, 200, { success: true, rows: BOOTH_LOGINS.get(ac) });
  },
  'POST /api/booth-logins/generate': (req, res, q, body) => {
    const ac = Number(body.assembly_id || q.get('assembly_id') || 0);
    if (!ac) return send(res, 400, { success: false, message: 'assembly_id is required.' });
    const booths = new Set(votersFor(ac).map((v) => v.PART_NO));
    const base = ASSEMBLY_CREDS[ac]?.passcode || '000000';
    const slug = (ASSEMBLY_LIST[ac - 1]?.assembly_name || `ac${ac}`).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const rows = [...booths].sort((a, b) => a - b).map((b) => ({ assembly_no: ac, booth_no: b, username: `${slug}-${b}`, passcode: `${base}${b}` }));
    BOOTH_LOGINS.set(ac, rows);
    send(res, 200, { success: true, message: `Successfully generated ${rows.length} new booth logins.`, created: rows.length });
  },
  'GET /api/voters': (req, res, q) => {
    // as the backend: an assembly login (group 3) is held to its own assembly whatever it asks for
    const assemblyId = Number(currentUser !== ADMIN_USER && Number(currentUser.group_id) === 3 && currentUser.assembly_id ? currentUser.assembly_id : (q.get('assemblyId') || 1));
    const page = Math.max(1, Number(q.get('page') || 1));
    const pageSize = Math.min(200, Math.max(1, Number(q.get('pageSize') || 25)));
    const f = Object.fromEntries(['gender', 'has_mobile', 'min_age', 'max_age', 'boothId', 'search_text'].map((k) => [k, q.get(k) || '']));
    let all = filterVoters(votersFor(assemblyId), f);
    const cand = isCandidateUser(currentUser);
    if (cand) { const parts = new Set(userBooths(currentUser).filter((b) => b.assembly_no === assemblyId).map((b) => b.part_no)); all = all.filter((v) => parts.has(v.PART_NO)); }
    const locked = cand && currentUser.paid_status !== 'Yes';
    // as the backend's free view: mobile + EPIC masked, only FREE_PAGES (2) pages, no export
    const mask = (x) => { const d = String(x ?? ''); return d.length > 5 ? `${d.slice(0, 3)}${'*'.repeat(d.length - 5)}${d.slice(-2)}` : d; };
    const rows = locked && page > 2 ? [] : all.slice((page - 1) * pageSize, page * pageSize).map((v) => (locked ? { ...v, MOBILE_NUMBER: v.MOBILE_NUMBER ? mask(v.MOBILE_NUMBER) : v.MOBILE_NUMBER, EPIC_NO: mask(v.EPIC_NO) } : v));
    send(res, 200, { success: true, rows, total: all.length, page, pageSize, isPro: !locked, locked, ...(locked ? { freePages: 2 } : {}), scope: { assemblyId } });
  },
  'GET /api/voters/detail': (req, res, q) => {
    const v = votersFor(Number(q.get('assemblyId') || 1)).find((x) => x._id === q.get('id'));
    if (!v) return send(res, 404, { success: false, message: 'Voter not found.' });
    send(res, 200, { success: true, voter: v, isPro: true });
  },
  'GET /api/voters/export': (req, res, q) => {
    const f = Object.fromEntries(['gender', 'has_mobile', 'min_age', 'max_age', 'boothId', 'search_text'].map((k) => [k, q.get(k) || '']));
    const rows = filterVoters(votersFor(Number(q.get('assemblyId') || 1)), f);
    const cols = ['EPIC_NO', 'PART_NO', 'VOTER_NAME_EN', 'VOTER_NAME', 'RELATION_NAME_EN', 'RELATION_NAME', 'MOBILE_NUMBER', 'AGE', 'GENDER', 'SECTION_NAME', 'BOOTH_NAME'];
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="voters-mock.csv"' });
    res.end(csv);
  },
  'GET /api/public/booths': (req, res, q) => {
    const ac = Number(q.get('assemblyId') || 0);
    const booths = Array.from({ length: 60 }, (_, i) => ({ part_no: i + 1, ...(i % 5 === 2 ? { has_coords: false, latitude: null, longitude: null } : (() => { const [lat, lng] = insidePoint(ac || 1, i); return { has_coords: true, latitude: lat, longitude: lng }; })()), booth_name: `${['Panchayat Union Primary School', 'Govt. High School', 'Govt. Hr. Sec. School', 'Corporation Middle School'][i % 4]}, Booth ${i + 1}${ac ? ` (AC ${ac})` : ''}` }));
    send(res, 200, { success: true, booths });
  },
  'GET /health': (req, res) => send(res, 200, { ok: true, mock: true }),
};

// Routes with an :id. Registration actions only change the in-memory mock.
const findReg = (id) => REGISTRATIONS.find((r) => r._id === id);
// A few tiny placeholder images so the directory isn't empty: 1px SVG data URLs per party colour.
const svgFlag = (fill) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="40"><rect width="64" height="40" fill="${fill}"/></svg>`)}`;
const MLA_FLAGS = { DMK: svgFlag('#dc2626'), AIADMK: svgFlag('#16a34a'), BJP: svgFlag('#f97316'), INC: svgFlag('#2563eb'), PMK: svgFlag('#facc15'), TVK: svgFlag('#7c3aed') };
const MLA_PROFILES = Object.fromEntries([1, 2, 3, 19, 20, 24, 118, 129, 189].map((n) => [n, svgFlag('#94a3b8')]));
// Live photos are full-size Cloudinary originals; one public Cloudinary demo image stands in for them, so
// the thumbnail-size check (qa task 21) has a real Cloudinary URL to look at.
MLA_PROFILES[1] = 'https://res.cloudinary.com/demo/image/upload/sample.jpg';
// Per-booth summary of the fictional roll (used by booths, analytics and booth report).
const boothCache = new Map();
// As the backend's reportScope: admin picks the assembly; other logins get their own assembly,
// and candidates only their own booths (the HTML report list stays assembly-wide, as on the server).
function reportScope(q) {
  if (currentUser === ADMIN_USER) return { ac: Number(q.get('assemblyId') || q.get('assembly_no') || 1), parts: null, locked: false };
  const own = userBooths(currentUser).map((b) => Number(b.part_no));
  // C13: an unpaid candidate gets the booth list without numbers or report links (as the backend)
  return { ac: Number(currentUser.assembly_id || 1), parts: isCandidateUser(currentUser) && own.length ? own : null, locked: isCandidateUser(currentUser) && currentUser.paid_status !== 'Yes' };
}
function boothSummary(ac) {
  if (boothCache.has(ac)) return boothCache.get(ac);
  const m = new Map();
  for (const v of votersFor(ac)) {
    const b = m.get(v.PART_NO) || { part_no: v.PART_NO, booth_name: v.BOOTH_NAME, section_name: v.SECTION_NAME, voter_count: 0, male_voters: 0, female_voters: 0, other_voters: 0 };
    b.voter_count++;
    if (v.GENDER === 'Male') b.male_voters++; else if (v.GENDER === 'Female') b.female_voters++; else b.other_voters++;
    m.set(v.PART_NO, b);
  }
  const out = [...m.values()].sort((a, b) => a.part_no - b.part_no);
  boothCache.set(ac, out);
  return out;
}
const ASSEMBLY_CREDS = Object.fromEntries(ASSEMBLY_LIST.filter((a) => ![7, 58, 141, 203].includes(a.assembly_no)).map((a) => [a.assembly_no, { assembly_no: a.assembly_no, username: a.assembly_name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), passcode: String(100000 + ((a.assembly_no * 7919) % 900000)) }]));
const BOOTH_LOGINS = new Map();
BOOTH_LOGINS.set(1, [...new Set(votersFor(1).map((v) => v.PART_NO))].sort((a, b) => a - b).map((b) => ({ assembly_no: 1, booth_no: b, username: `gummidipoondi-${b}`, passcode: `${ASSEMBLY_CREDS[1].passcode}${b}` })));
const paramRoutes = [
  ['PUT', /^\/api\/leads\/([^/]+)$/, (req, res, q, [id], body) => {
    const l = LEADS.find((x) => x._id === id); if (!l) return send(res, 404, { success: false, message: 'Not found.' });
    const { status, note } = body || {}; const text = String(note || '').trim();
    if (status != null && !['new', 'contacted', 'interested', 'not_interested'].includes(status)) return send(res, 422, { success: false, message: 'Unknown status.' });
    if (status == null && !text) return send(res, 422, { success: false, message: 'Nothing to save.' });
    const at = new Date().toISOString();
    if (status != null && status !== l.status) { l.history.push({ status, from: l.status, at, by: 'Super Admin' }); Object.assign(l, { status, status_at: at, status_by: 'Super Admin' }); }
    if (text) l.notes.push({ text, at, by: 'Super Admin' });
    send(res, 200, { success: true, lead: l });
  }],
  // assembly detail: stored counts (tbl_assembly_consitituency) + live voter-DB counts.
  // Every 5th assembly's live count differs a little so the 'differs' state can be seen.
  ['GET', /^\/api\/assemblies\/(\d+)$/, (req, res, q, [no]) => {
    const ac = Number(no);
    const a = ASSEMBLY_LIST[ac - 1];
    if (!a) return send(res, 404, { success: false, message: 'Assembly not found.' });
    const total = a.total_voters;
    const split = (t) => { const male = Math.round(t * 0.487); const other = Math.round(t * 0.003); return { male, female: t - male - other, other }; };
    const st = split(total);
    const liveTotal = ac % 5 === 0 ? total + 1180 : total;
    const lv = ac % 5 === 0 ? split(liveTotal) : st;
    send(res, 200, { success: true, assembly: { ...a, male_voters: st.male, female_voters: st.female, third_gender_voters: st.other, table_name: `ass_${ac}` }, liveCounts: { total: liveTotal, male: lv.male, female: lv.female, other: lv.other } });
  }],
  ['POST', /^\/api\/assembly-credentials\/(\d+)\/generate$/, (req, res, q, [no]) => {
    const ac = Number(no);
    const a = ASSEMBLY_LIST[ac - 1];
    if (!a) return send(res, 404, { success: false, message: 'Assembly not found.' });
    const row = { assembly_no: ac, username: a.assembly_name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), passcode: String(100000 + Math.floor(Math.random() * 900000)) };
    ASSEMBLY_CREDS[ac] = row;
    send(res, 200, { success: true, ...row });
  }],
  ['DELETE', /^\/api\/mla\/profile\/(\d+)$/, (req, res, q, [no]) => { delete MLA_PROFILES[no]; send(res, 200, { success: true }); }],
  ['GET', /^\/api\/flow-sim\/flows\/([^/]+)$/, (req, res, q, [name]) => { name = decodeURIComponent(name); if (!/^[\w .()-]+\.json$/.test(name)) return send(res, 400, { success: false, message: 'Invalid flow name.' }); try { const raw = fs.readFileSync(path.join(WACTO_DIR, name), 'utf8'); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(raw); } catch { send(res, 404, { success: false, message: 'Flow file not found.' }); } }],
  ['DELETE', /^\/api\/flow-images\/([^/]+)$/, (req, res, q, [key]) => { key = decodeURIComponent(key); if (key.startsWith('bot_img_')) delete BOT_IMG_OVERRIDES[key]; else { const a = LEGACY_ASSETS.find((x) => x.key === key); if (a) a.url = null; } send(res, 200, { success: true, message: 'Asset deleted successfully!' }); }],
  ['DELETE', /^\/api\/mla\/flag\/([^/]+)$/, (req, res, q, [party]) => { delete MLA_FLAGS[decodeURIComponent(party)]; send(res, 200, { success: true }); }],
  ['GET', /^\/api\/registrations\/([^/]+)$/, (req, res, q, [id]) => {
    const r = findReg(id);
    if (!r) return send(res, 404, { success: false, message: 'Registration not found.' });
    // as live: a candidate flagged paid without any transaction has no ledger row (UX2 shows that state)
    const payment = r.paid_status === 'Yes' && r.transaction_id ? { payment_id: r.transaction_id, order_id: null, amount: 2360, status: 'Manual', booth_count: r.booth_count, created_at: r.paid_at || r.created_at } : null;
    send(res, 200, { success: true, registration: { ...r, payment }, socialRequests: r.requests.map((q2, i) => ({ _id: `${id}-req${i}`, all_voters: false, booth_no: r.booths[0] || 1, section_no: 2, language: 'Tamil', message_content: 'வாக்காளர் சந்திப்பு கூட்டம் — ஞாயிறு மாலை 5 மணி', image_url: '', audio_url: '', ...q2 })) });
  }],
  ['PUT', /^\/api\/registrations\/([^/]+)\/set-paid$/, (req, res, q, [id], body) => {
    const r = findReg(id);
    if (!r) return send(res, 404, { success: false, message: 'Registration not found.' });
    r.paid_status = body.paid_status === 'Yes' ? 'Yes' : 'No';
    if (r.paid_status === 'Yes') { r.transaction_id = `MANUAL-${Date.now()}`; r.paid_at = new Date().toISOString(); }
    send(res, 200, { success: true, paid_status: r.paid_status, transaction_id: r.transaction_id });
  }],
  ['PUT', /^\/api\/registrations\/([^/]+)\/assign-booths$/, (req, res, q, [id], body) => {
    const r = findReg(id);
    if (!r) return send(res, 404, { success: false, message: 'Registration not found.' });
    r.booths = (body.booths || []).map((b) => b.part_no);
    r.booth_count = r.booths.length;
    send(res, 200, { success: true, booths: body.booths || [], message: `${r.booth_count} booth(s) assigned.` });
  }],
  ['PUT', /^\/api\/registrations\/([^/]+)$/, (req, res, q, [id], body) => {
    const r = findReg(id);
    if (!r) return send(res, 404, { success: false, message: 'Registration not found.' });
    for (const k of ['full_name', 'district', 'role', 'affiliation', 'party', 'body_type', 'position', 'union_or_municipality', 'panchayat_or_corporation', 'ward_number']) if (k in body) r[k] = body[k];
    send(res, 200, { success: true, message: 'Registration updated.' });
  }],
  ['DELETE', /^\/api\/registrations\/([^/]+)$/, (req, res, q, [id]) => {
    const i = REGISTRATIONS.findIndex((r) => r._id === id);
    if (i < 0) return send(res, 404, { success: false, message: 'Registration not found.' });
    REGISTRATIONS.splice(i, 1);
    send(res, 200, { success: true, message: 'Registration deleted.' });
  }],
];

// Admin-only routes, read from the backend's own route table so the mock cannot drift from it: any non-admin login
// gets the backend's 403 on these (routes whose handler list includes adminOnly).
// Every backend route, for the fallback below: an address the backend does not have answers 404 here too.
const BACKEND_ROUTES = (() => {
  try {
    const src = fs.readFileSync(new URL('../../backend/src/routes/index.js', import.meta.url), 'utf8');
    return src.split(/\r?\n/).map((l) => /^r\.(get|post|put|patch|delete)\('([^']+)'/.exec(l.trim())).filter(Boolean)
      .map((m) => ({ method: m[1].toUpperCase(), re: new RegExp(`^/api${m[2].replace(/:[A-Za-z_]+/g, '[^/]+')}$`) }));
  } catch { return []; }
})();
const ADMIN_ONLY = (() => {
  try {
    const src = fs.readFileSync(new URL('../../backend/src/routes/index.js', import.meta.url), 'utf8');
    return src.split(/\r?\n/).map((l) => /^r\.(get|post|put|patch|delete)\('([^']+)',\s*adminOnly\b/.exec(l.trim())).filter(Boolean)
      .map((m) => ({ method: m[1].toUpperCase(), re: new RegExp(`^/api${m[2].replace(/:[A-Za-z_]+/g, '[^/]+')}$`) }));
  } catch { return []; }
})();
console.log(`admin-only routes mirrored from the backend: ${ADMIN_ONLY.length}`);

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const key = `${req.method} ${url.pathname}`;
  const handler = routes[key];
  console.log(`${new Date().toISOString().slice(11, 19)} ${key}${handler ? '' : '  (not mocked → empty)'}`);
  const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : {};
  const who = /(?:^|;\s*)edm_mock=(\w+)/.exec(req.headers.cookie || '')?.[1];
  if (who) currentUser = who === 'admin' ? ADMIN_USER : MOCK_USERS[who] || currentUser;
  if (who && currentUser !== ADMIN_USER && ADMIN_ONLY.some((r) => r.method === req.method && r.re.test(url.pathname))) return send(res, 403, { success: false, message: 'You do not have permission to perform this action.' });
  // QA knobs (qa/admin-checks.mjs), set per browser as cookies so the mock can show what the live site does:
  // edm_fail=bot,flowsim,settings  → those endpoints answer 404 "Route not found." (not deployed on live)
  // edm_fail=writes                → every change fails with 500, to see where a page shows the error
  // edm_slow=<ms>                  → voter lists answer late, to see the loading state
  const qa = (name) => new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(req.headers.cookie || '')?.[1] || '';
  const fail = qa('edm_fail').split(',');
  const notDeployed = { bot: /^\/api\/flow-images\/bot/, flowsim: /^\/api\/flow-sim\//, settings: /^\/api\/payments\/settings/, features: /^\/api\/whatsapp-features/ };
  if (Object.entries(notDeployed).some(([k, re]) => fail.includes(k) && re.test(url.pathname))) return send(res, 404, { success: false, message: 'Route not found.' });
  if (fail.includes('writes') && req.method !== 'GET' && !url.pathname.startsWith('/api/auth/')) return send(res, 500, { success: false, message: 'QA: the server refused this change.' });
  const slow = Number(qa('edm_slow')) || 0;
  if (slow && url.pathname === '/api/voters') await new Promise((r) => setTimeout(r, slow));
  if (handler) return handler(req, res, url.searchParams, body);
  for (const [method, re, fn] of paramRoutes) {
    const m = req.method === method && url.pathname.match(re);
    if (m) return fn(req, res, url.searchParams, m.slice(1), body);
  }
  if (url.pathname.startsWith('/report-files/')) {
    if (!who) return send(res, 401, { success: false, message: 'Not authenticated.' }); // C10: reports need a login
    // The real report when this PC has a copy (read-only, kept inside REPORTS_DIR) ...
    const file = path.resolve(REPORTS_DIR, '.' + decodeURIComponent(url.pathname.slice('/report-files'.length)));
    if (file.startsWith(REPORTS_DIR + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(file).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      return fs.createReadStream(file).pipe(res);
    }
    // ... otherwise a stand-in for the pre-built HTML reports on the server.
    const name = decodeURIComponent(url.pathname).split('/').pop().replace(/_/g, ' ').replace('.html', '');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Inter,sans-serif;padding:32px;color:#0F172A}h1{font-size:22px}h2{font-size:15px;color:#334155;margin-top:24px}p{color:#64748B;max-width:60ch}</style></head><body><h1>${name}</h1><p>Local placeholder. On the server this is the pre-built report under /report-files.</p><h2>Executive summary</h2><p>…</p><h2>Priority areas</h2><p>…</p><h2>Resource allocation</h2><p>…</p></body></html>`);
  }
  if (url.pathname.startsWith('/api/')) {
    // As the backend: an address it does not have is "not found" (so a removed route cannot look alive on the mock).
    if (BACKEND_ROUTES.length && !BACKEND_ROUTES.some((r) => r.method === req.method && r.re.test(url.pathname))) return send(res, 404, { success: false, message: 'Route not found.' });
    // Pages not converted yet still render: empty but well-formed answers.
    return send(res, 200, { success: true, rows: [], data: [], items: [], total: 0, mocked: false, message: 'Not mocked yet (local dev)' });
  }
  send(res, 404, { success: false, message: 'Not found' });
}).listen(PORT, () => console.log(`[devmock] EDMS mock API on http://localhost:${PORT}  (local only, fictional people)`));
