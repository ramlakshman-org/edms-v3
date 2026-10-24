// Payment-proof scenarios: a candidate sends a screenshot (image) to the bot after paying the
// static UPI QR. Checks queueing in tbl_utr_payments, replies (EN/TA), media resolution and the
// settings-driven payment message. Usage: node proof.mjs src/controllers/current.js  (run setup.mjs first)
import { pathToFileURL } from 'node:url';

const H = (globalThis.__H ||= { cols: {}, sent: [], failCaption: false });
const ctrl = await import(pathToFileURL(process.argv[2]).href);
const settingsMod = await import(pathToFileURL(process.argv[2].replace(/controllers[\\/].*$/, 'services/paymentSettings.js')).href);

const isTamil = (s = '') => (s.match(/[஀-௿]/g) || []).length > (s.match(/[A-Za-z]/g) || []).length;
const PH = '919000000003', MOB = '9000000003';
const res = { sendStatus() {} };
let fails = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const IMG = (extra = {}) => ({ type: 'image', image: { id: 'MEDIA123', mime_type: 'image/jpeg', sha256: 'x', ...extra } });
const T = (t) => ({ type: 'text', text: { body: t } });

async function send(step, phone = PH) {
  const before = H.sent.length;
  await ctrl.handleWactoWebhook({ body: { entry: [{ changes: [{ value: { messages: [{ from: phone, ...step }], contacts: [{ profile: { name: 'Sim' } }] } }] }] } }, res);
  return H.sent.slice(before);
}
function reset(users = [], extra = {}) {
  Object.assign(H, { cols: { tbl_user: users, tbl_assembly_consitituency: [], ...extra }, sent: [], uploads: [] });
  settingsMod.clearPaymentSettingsCache();
}
const okFetch = (bytes = 4) => async () => ({ ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new Uint8Array(bytes).buffer });
globalThis.fetch = okFetch();
delete process.env.WACTO_MEDIA_URL;
const rows = () => H.cols.tbl_utr_payments || [];

console.log('=== payment proof via bot ===');
// 1 unknown number
reset();
let out = await send(IMG());
check(out.length === 1 && /Register/.test(out[0].text), 'unknown number → asked to register first');
check(rows().length === 0, 'nothing queued for an unknown number');

// 2 registered, unpaid, payload carries a direct link
reset([{ _id: 'u1', mobile_no: MOB, first_name: 'Sim', booths: [3, 6, 9], paid_status: 'No', district_id: 'Salem' }]);
out = await send(IMG({ link: 'https://m.test/a.jpg' }));
check(rows().length === 1 && rows()[0].status === 'pending' && rows()[0].source === 'whatsapp', 'proof queued (pending, source whatsapp)');
check(rows()[0].booth_count === 3 && rows()[0].expected_amount === 5900 && rows()[0].amount === 5900, '3 booths → ₹5,900 expected');
check(H.uploads.length === 1 && H.uploads[0].folder === 'payment-proofs' && rows()[0].screenshot_url.startsWith('https://cdn.test/'), 'screenshot stored under payment-proofs');
check(out.length === 1 && /screenshot received/i.test(out[0].text) && /5,900/.test(out[0].text), 'English confirmation quotes the expected amount');

// 3 second image within the window joins the same proof; UTR read from the caption
out = await send(IMG({ link: 'https://m.test/b.jpg', caption: 'paid, UTR 412398765432' }));
check(rows().length === 1 && rows()[0].screenshots.length === 2 && rows()[0].utr === '412398765432', 'second image attaches to the same proof, UTR taken from caption');
check(/additional screenshot/i.test(out[0].text) && /412398765432/.test(out[0].text), '"additional" reply shows the UTR');

// 4 Tamil session
reset([{ _id: 'u1', mobile_no: MOB, first_name: 'Sim', booth_count: 1, paid_status: 'No' }], { tbl_wacto_sessions: [{ phone: PH, lang: 'ta' }] });
out = await send(IMG({ link: 'https://m.test/a.jpg' }));
check(isTamil(out[0].text) && /2,360/.test(out[0].text), 'Tamil confirmation, 1 booth = ₹2,360');

// 5 already paid
reset([{ _id: 'u1', mobile_no: MOB, paid_status: 'Yes' }]);
out = await send(IMG());
check(/already active/.test(out[0].text) && rows().length === 0, 'paid account → "already active", nothing queued');

// 6 only a media id, no WACTO_MEDIA_URL → queued with the id, no file
reset([{ _id: 'u1', mobile_no: MOB, booth_count: 2, paid_status: 'No' }]);
out = await send(IMG());
check(rows().length === 1 && rows()[0].wa_media_id === 'MEDIA123' && !rows()[0].screenshot_url && H.uploads.length === 0, 'id-only media: queued with media id, no file');
check(/screenshot received/i.test(out[0].text), 'candidate still gets the confirmation');

// 7 WACTO_MEDIA_URL template resolves the id with the bearer key
process.env.WACTO_MEDIA_URL = 'https://backend.wacto.ai/api/v1.0/media/{id}/{channel}';
process.env.WACTO_CHANNEL = '919900000000'; process.env.WACTO_API_KEY = 'k';
let seenUrl = '', seenAuth = '';
globalThis.fetch = async (url, opts) => { seenUrl = url; seenAuth = opts?.headers?.Authorization || ''; return okFetch(2)(); };
reset([{ _id: 'u1', mobile_no: MOB, booth_count: 2, paid_status: 'No' }]);
out = await send(IMG());
check(seenUrl === 'https://backend.wacto.ai/api/v1.0/media/MEDIA123/919900000000' && seenAuth === 'Bearer k' && H.uploads.length === 1, 'media id fetched through WACTO_MEDIA_URL with the API key');

// 8 download fails → still queued and confirmed
globalThis.fetch = async () => ({ ok: false, status: 404, headers: { get: () => '' } });
reset([{ _id: 'u1', mobile_no: MOB, booth_count: 2, paid_status: 'No' }]);
out = await send(IMG());
check(rows().length === 1 && /screenshot received/i.test(out[0].text), 'download failure: proof still queued and confirmed');
globalThis.fetch = okFetch();

// 9 UTR already used by another account
reset([{ _id: 'u1', mobile_no: MOB, booth_count: 1, paid_status: 'No' }], { tbl_utr_payments: [{ _id: 'x', utr: '111122223333', mobile_no: '9000000009', status: 'approved' }] });
out = await send(IMG({ link: 'https://m.test/a.jpg', caption: '111122223333' }));
check(/already submitted/i.test(out[0].text) && rows().length === 1, 'UTR of another account → warned, not queued');

// 10 "pay" → QR + settings-driven caption in ONE bubble
reset([{ _id: 'u1', mobile_no: MOB, first_name: 'Sim', booths: [1, 2], paid_status: 'No' }]);
out = await send(T('pay'));
check(out.length === 1 && out[0].kind === 'image+caption' && /payment-qr/.test(out[0].url), '"pay" → QR image + caption in one bubble');
check(/okaxis/.test(out[0].text) && /here in this chat/.test(out[0].text) && /5,900/.test(out[0].text) && !/wa\.me/.test(out[0].text), 'caption: UPI from settings, total ₹5,900, proof in this chat, no separate number');
check(out[0].text.length <= 1024, `caption ${out[0].text.length} chars ≤ 1024`);

// 11 Tamil "pay" caption fits too
reset([{ _id: 'u1', mobile_no: MOB, first_name: 'Sim', booths: [1, 2], paid_status: 'No' }], { tbl_wacto_sessions: [{ phone: PH, lang: 'ta' }] });
out = await send(T('pay'));
check(isTamil(out[0].text) && out[0].text.length <= 1024, `Tamil caption is Tamil and ${out[0].text.length} chars ≤ 1024`);

// 12 stored settings: separate proof number + other UPI id
reset([{ _id: 'u1', mobile_no: MOB, first_name: 'Sim', booths: [1], paid_status: 'No' }], { app_settings: [{ key: 'payment', proof_mode: 'number', proof_number: '917092800426', upi_id: 'test@upi', activation_minutes: 45 }] });
out = await send(T('pay'));
check(/wa\.me\/917092800426/.test(out[0].text) && /test@upi/.test(out[0].text) && /45 minutes/.test(out[0].text) && !/okaxis/.test(out[0].text), 'admin settings override UPI id, proof number and activation time');

// 13 a plain text/tap is untouched by the proof hook (regression guard)
reset([{ _id: 'u1', mobile_no: MOB, paid_status: 'No' }]);
out = await send(T('ok'));
check(out.length === 0 && rows().length === 0, '"ok" still ignored, no proof row');

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exit(fails ? 1 : 0);
