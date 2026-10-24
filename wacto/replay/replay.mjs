// Replays a real Tamil registration chat (de-identified: synthetic number + name) and its English
// mirror through the controller, then checks language, bubble structure and saved values.
// Usage: node replay.mjs <src/controllers/x.js> ta|en [--fail-caption]   (run setup.mjs first)
import { pathToFileURL } from 'node:url';
const H = (globalThis.__H = { cols: {}, sent: [], failCaption: process.argv.includes('--fail-caption') });
const ctrl = await import(pathToFileURL(process.argv[2]).href);

const TAMIL = /[஀-௿]/;

// A message is Tamil when Tamil letters outnumber Latin letters (approved English text may contain Tamil words in brackets)
const isTamil = (s = '') => (s.match(/[஀-௿]/g) || []).length > (s.match(/[A-Za-z]/g) || []).length;
const PHONE = '919000000001';
const URL_QR = 'payment-qr', URL_REG = 'registration-complete';

const L = (t) => ({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'x', title: t } } });
const B = (t) => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'x', title: t } } });
const T = (t) => ({ type: 'text', text: { body: t } });

const RUNS = {
  ta: [T('hi'), L('தமிழ்'), L('பதிவு செய்ய'), L('பிரச்சாரக் குழு'), B('ஆம், கட்சி உள்ளது'), L('TVK'),
       L('ஊரகப் பகுதி'), L('மாவட்ட வார்டு உறுப்பினர்'), L('Kallakurichi'), L('Sankarapuram'), T('3, 6, 9'),
       '--- after registration ---',
       L('மாதிரி விளக்கம்'), L('பயன்பாடுகள்'), L('கேள்வி பதில்கள்'), L('சமூக வலைத்தள சேவை'),
       L('திட்டத்தை வாங்க'), 'EXPIRE', L('உதவி மையம்'), L('இணையதளம்')],
  en: [T('hi'), L('English'), L('Register'), L('Campaign Team Member'), B('Yes, have a party'), L('TVK'),
       L('Rural'), L('DP Ward Member'), L('Kallakurichi'), L('Sankarapuram'), T('3, 6, 9'),
       '--- after registration ---',
       L('Demo'), L('Benefits'), L('FAQ'), L('Social Media'), L('Purchase Plan'), 'EXPIRE', L('Support'), L('Website')],
};

const lang = process.argv[3];
H.cols.tbl_assembly_consitituency = [{ assembly_name: 'Sankarapuram', assembly_no: 79 }];
const res = { sendStatus() {} };
let fails = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };

const after = [];
let inAfter = false;
for (const step of RUNS[lang]) {
  if (step === 'EXPIRE') {           // the real Support tap came ~4.5 h later: age the session past 30 min
    for (const s of H.cols.tbl_wacto_sessions || []) s.updated_at = new Date(Date.now() - 31 * 60 * 1000);
    continue;
  }
  if (typeof step === 'string') { inAfter = true; continue; }
  const label = step.text?.body || step.interactive[step.interactive.type].title;
  const before = H.sent.length;
  await ctrl.handleWactoWebhook({ body: { entry: [{ changes: [{ value: {
    messages: [{ from: PHONE, ...step }], contacts: [{ profile: { name: 'Sim' } }] } }] }] } }, res);
  const out = H.sent.slice(before);
  for (const o of out) console.log(`    -> [${o.kind}] ${(o.url ? o.url.split('/').pop() + ' ' : '')}${(o.text || '').split('\n').find(Boolean)?.slice(0, 60) || ''}`);
  if (inAfter) after.push({ label, out });
  console.log(`  tap: ${label}  (${out.length} msg)`);
}

console.log(`\n=== CHECKS (${lang}${H.failCaption ? ', caption rejected' : ''}) ===`);
const texts = H.sent.filter((o) => o.text);
if (lang === 'ta') check(texts.every((o) => isTamil(o.text)), `every backend message is Tamil (${texts.length} msgs)`);
else check(texts.every((o) => !isTamil(o.text)), `every backend message is English (${texts.length} msgs)`);

for (const [label, kw] of lang === 'ta'
  ? [['சமூக வலைத்தள சேவை', 'வாட்ஸ்அப்'], ['திட்டத்தை வாங்க', 'திட்ட'], ['உதவி மையம்', 'சந்தேகத்தை']]
  : [['Social Media', 'WhatsApp Broadcast'], ['Purchase Plan', 'Plan'], ['Support', 'query']]) {
  const a = after.find((x) => x.label === label);
  check(a && a.out.length === 1 && a.out[0].text.includes(kw), `"${label}" reply in ${lang === 'ta' ? 'Tamil' : 'English'}`);
}

const reg = H.sent.filter((o) => o.url?.includes(URL_REG)), qr = H.sent.filter((o) => o.url?.includes(URL_QR));
if (H.failCaption) {
  const iReg = H.sent.findIndex((o) => o.url?.includes(URL_REG)), iQr = H.sent.findIndex((o) => o.url?.includes(URL_QR));
  check(H.sent[iReg + 1]?.kind === 'text' && H.sent[iQr + 1]?.kind === 'text', 'fallback: image then text sent separately (today\'s behaviour)');
} else {
  check(reg.length === 1 && reg[0].kind === 'image+caption' && /9000000001/.test(reg[0].text), 'registration image + credentials = ONE bubble');
  check(qr.length === 1 && qr[0].kind === 'image+caption' && /okaxis/.test(qr[0].text), 'QR + payment details = ONE bubble');
  check([...reg, ...qr].every((o) => (o.text || "").length <= 1024), `captions within 1024 chars (${[...reg, ...qr].map((o) => (o.text || "").length).join(', ')})`);
}

const e = H.cols.tbl_enquiry?.[0] || {};
const want = { role: 'Campaign Team Member', party: 'TVK', body_type: 'Rural', position: 'District Panchayat Ward Member',
  district: 'Kallakurichi', assembly_name: 'Sankarapuram', assembly_no: 79, booth_count: 3 };
const got = Object.fromEntries(Object.keys(want).map((k) => [k, e[k]]));
check(JSON.stringify(got) === JSON.stringify(want) && JSON.stringify(e.booths) === '[3,6,9]', `saved enquiry = ${JSON.stringify(got)} booths=${JSON.stringify(e.booths)}`);
check((H.cols.tbl_user || []).length === 1, 'exactly one user created');

console.log(fails ? `\nRESULT: ${fails} FAILED` : '\nRESULT: ALL PASS');
process.exit(fails ? 1 : 0);
