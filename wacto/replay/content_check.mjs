// Content-rewrite check: run the same Tamil + English chats through a controller and
// dump every outgoing backend message. Usage: node content_check.mjs <controller.js> <out.json>
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';

const L = (t) => ({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'x', title: t } } });
const B = (t) => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'x', title: t } } });
const T = (t) => ({ type: 'text', text: { body: t } });

const RUNS = {
  ta: [T('hi'), L('தமிழ்'), L('பதிவு செய்ய'), L('பிரச்சாரக் குழு'), B('ஆம், கட்சி உள்ளது'), L('TVK'),
       L('ஊரகப் பகுதி'), L('மாவட்ட வார்டு உறுப்பினர்'), L('Kallakurichi'), L('Sankarapuram'),
       T('3 6 9 x'), T('3, 6, 9'),                        // bad format -> error re-prompt, then good
       L('திட்டத்தை வாங்க'), T('9'), T('2'), T('4'),       // plan list, wrong number, pick, booths
       L('சமூக வலைத்தள சேவை'), T('7'), T('1'), T('Name'), T('Msg'), T('Area'),
       L('உதவி மையம்'), T('issue'), T('skip'),
       L('எனது கணக்கு விவரங்கள்'),
       L('பதிவு செய்ய')],                                  // returning user -> welcome back
  en: [T('hi'), L('English'), L('Register'), L('Campaign Team Member'), B('Yes, have a party'), L('TVK'),
       L('Rural'), L('DP Ward Member'), L('Kallakurichi'), L('Sankarapuram'),
       T('3 6 9 x'), T('3, 6, 9'),
       L('Purchase Plan'), T('9'), T('2'), T('4'),
       L('Social Media'), T('7'), T('1'), T('Name'), T('Msg'), T('Area'),
       L('Support'), T('issue'), T('skip'),
       L('My Credentials'),
       L('Register')],
};

const out = {};
for (const lang of ['ta', 'en']) {
  // fakes captured globalThis.__H at first import — reset it in place, never replace it
  const H = (globalThis.__H ||= {});
  Object.assign(H, { cols: { tbl_assembly_consitituency: [{ assembly_name: 'Sankarapuram', assembly_no: 79 }] }, sent: [], failCaption: false });
  const ctrl = await import(pathToFileURL(process.argv[2]).href + `?run=${lang}`);
  const res = { sendStatus() {} };
  const log = [];
  for (const step of RUNS[lang]) {
    const label = step.text?.body || step.interactive[step.interactive.type].title;
    const before = globalThis.__H.sent.length;
    await ctrl.handleWactoWebhook({ body: { entry: [{ changes: [{ value: {
      messages: [{ from: '919000000001', ...step }], contacts: [{ profile: { name: 'Test User' } }] } }] }] } }, res);
    for (const o of globalThis.__H.sent.slice(before)) log.push({ tap: label, kind: o.kind, text: o.text || '' });
  }
  // random passcode differs per run — mask it so runs are comparable
  out[lang] = log.map((m) => ({ ...m, text: m.text.replace(/`\d{6}`/g, '`PASS`').replace(/(Passcode\)?:) \d{6}/g, '$1 PASS') }));
  out[`${lang}_saved`] = { enquiry: globalThis.__H.cols.tbl_enquiry, purchase: globalThis.__H.cols.tbl_purchase_interests,
    campaign: globalThis.__H.cols.tbl_campaign_requests, support: globalThis.__H.cols.tbl_support_tickets };
}
writeFileSync(process.argv[3], JSON.stringify(out, null, 2));
console.log(`ta: ${out.ta.length} msgs, en: ${out.en.length} msgs -> ${process.argv[3]}`);
