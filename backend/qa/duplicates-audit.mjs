// Read-only duplicate audit (Ram, 2026-10-14): registrations, logins, payments, booth selection.
// Never writes. Prints counts, group ids and record-id tails only — no names, no mobile numbers (DPDP).
//   node qa/duplicates-audit.mjs        (run from the backend folder; uses that folder's .env)
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_APP_URL);
await client.connect();
const db = client.db(process.env.MONGO_APP_DB_NAME);
const tail = (id) => '…' + String(id).slice(-6);
const ten = (m) => String(m ?? '').replace(/\D/g, '').slice(-10);
const out = (k, v) => console.log(k.padEnd(52), typeof v === 'string' ? v : JSON.stringify(v));
console.log(`db ${process.env.MONGO_APP_DB_NAME} — read only`);

// 1) logins: one mobile on more than one tbl_user row (compared on the last 10 digits)
const users = await db.collection('tbl_user').find({}, { projection: { _id: 1, mobile_no: 1, user_name: 1, user_group_id: 1, is_active: 1, paid_status: 1, booths: 1 } }).toArray();
const byMob = new Map();
for (const u of users) { const m = ten(u.mobile_no); if (m.length === 10) (byMob.get(m) || byMob.set(m, []).get(m)).push(u); }
const dupMob = [...byMob.values()].filter((g) => g.length > 1);
out('logins: rows in tbl_user', users.length);
out('logins: mobiles on 2+ rows', dupMob.length);
out('logins: rows involved', dupMob.reduce((n, g) => n + g.length, 0));
const groupMix = {};
for (const g of dupMob) { const k = g.map((u) => Number(u.user_group_id)).sort((a, b) => a - b).join('+'); groupMix[k] = (groupMix[k] || 0) + 1; }
out('logins: duplicate sets by role groups', groupMix);
out('logins: duplicate sets where 2+ rows are active', dupMob.filter((g) => g.filter((u) => Number(u.is_active ?? 1) === 1).length > 1).length);
// a user_name that equals another row's mobile can shadow that login (login matches user_name OR mobile_no)
const shadow = users.filter((u) => { const n = ten(u.user_name); return n.length === 10 && String(u.user_name).replace(/\D/g, '') === String(u.user_name).trim() && byMob.has(n) && byMob.get(n).some((x) => String(x._id) !== String(u._id)); });
out('logins: user_name equal to another row\'s mobile', shadow.length);
// same mobile written with different formats (+91, spaces) — still one person, but string matches miss it
out('logins: mobile not stored as plain 10 digits', users.filter((u) => u.mobile_no && !/^\d{10}$/.test(String(u.mobile_no))).length);

// 2) registrations: tbl_enquiry
const enq = await db.collection('tbl_enquiry').find({}, { projection: { _id: 1, mobile: 1, source: 1 } }).toArray();
const byEnq = new Map();
for (const e of enq) { const m = ten(e.mobile); if (m.length === 10) (byEnq.get(m) || byEnq.set(m, []).get(m)).push(e); }
const dupEnq = [...byEnq.values()].filter((g) => g.length > 1);
out('registrations: rows in tbl_enquiry', enq.length);
out('registrations: mobiles on 2+ rows', dupEnq.length);
out('registrations: rows involved', dupEnq.reduce((n, g) => n + g.length, 0));
out('registrations: without a login row', [...byEnq.keys()].filter((m) => !byMob.has(m)).length);

// 3) payments
const pay = await db.collection('tbl_payment').find({}, { projection: { _id: 1, payment_id: 1, mobile_no: 1, user_id: 1, status: 1, proof_id: 1 } }).toArray();
const cnt = (arr, key) => { const m = new Map(); for (const x of arr) { const k = key(x); if (k) m.set(k, (m.get(k) || 0) + 1); } return [...m.values()].filter((n) => n > 1); };
out('payments: rows in tbl_payment', pay.length);
out('payments: same payment_id on 2+ rows (sets)', cnt(pay, (p) => p.payment_id).length);
out('payments: same proof approved into 2+ rows (sets)', cnt(pay, (p) => p.proof_id).length);
out('payments: same mobile with 2+ "Paid" rows (sets)', cnt(pay.filter((p) => /paid/i.test(String(p.status))), (p) => ten(p.mobile_no)).length);
let proofs = [];
try { proofs = await db.collection('tbl_utr_payments').find({}, { projection: { _id: 1, utr: 1, mobile_no: 1, status: 1 } }).toArray(); } catch { /* none */ }
const colls = (await db.listCollections().toArray()).map((c) => c.name);
const proofColl = colls.includes('tbl_utr_payments') ? 'tbl_utr_payments' : colls.find((c) => /proof|utr/i.test(c));
if (!proofs.length && proofColl) proofs = await db.collection(proofColl).find({}, { projection: { _id: 1, utr: 1, mobile_no: 1, status: 1 } }).toArray();
out('payments: proof collection', proofColl || 'none');
out('payments: proofs', proofs.length);
out('payments: same UTR on 2+ proofs (sets)', cnt(proofs, (p) => String(p.utr || '').trim()).length);
out('payments: same mobile with 2+ pending proofs (sets)', cnt(proofs.filter((p) => p.status === 'pending'), (p) => ten(p.mobile_no)).length);

// 4) booth selection
let dupInside = 0, mixedAssembly = 0, withBooths = 0;
const boothTakers = new Map();
for (const u of users) {
  if (!Array.isArray(u.booths) || !u.booths.length) continue;
  withBooths++;
  const keys = u.booths.map((b) => (typeof b === 'object' ? `${b.assembly_no}_${b.part_no}` : `?_${b}`));
  if (new Set(keys).size !== keys.length) dupInside++;
  if (new Set(u.booths.map((b) => (typeof b === 'object' ? b.assembly_no : '?'))).size > 1) mixedAssembly++;
  for (const k of new Set(keys)) boothTakers.set(k, (boothTakers.get(k) || 0) + 1);
}
out('booths: logins with booths', withBooths);
out('booths: logins with the same booth twice in their list', dupInside);
out('booths: logins whose booths span 2+ assemblies', mixedAssembly);
out('booths: booths chosen by 2+ different logins', [...boothTakers.values()].filter((n) => n > 1).length);

// 5) what the database itself enforces
for (const c of ['tbl_user', 'tbl_enquiry', 'tbl_payment', proofColl].filter(Boolean)) {
  const idx = await db.collection(c).indexes();
  out(`indexes: ${c} unique`, idx.filter((i) => i.unique).map((i) => Object.keys(i.key).join('+')));
}
await client.close();
