// Reconcile approved payments with the candidates who made them (Ram, 2026-10-14, C11).
// Found on live: an approved proof whose user_id points at a record that no longer exists, so the candidate
// who paid ₹5,900 was never activated; and manual mark-paid rows whose "amount" is the booth COUNT.
// Dry run by default; --apply writes. Uses the backend's own .env (staging first; live only with Ram's go).
//   node scripts/reconcile-payments.mjs [--apply] [--skip=<record-id tail>,...]
// --skip leaves records alone by the last 6 characters of their id, as printed (Ram, 2026-10-14: proof 3004c4 was a test).
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';
import { isPaid } from '../src/utils/paid.js';
import { calculateWardPricing } from '../src/controllers/paymentController.js';

const apply = process.argv.includes('--apply');
const skip = new Set((process.argv.find((a) => a.startsWith('--skip=')) || '').slice(7).split(',').map((x) => x.trim()).filter(Boolean));
const skipped = (doc) => skip.has(String(doc._id).slice(-6));
const digits = (m) => String(m || '').replace(/\D/g, '').slice(-10);
const c = new MongoClient(process.env.MONGO_APP_URL, { serverSelectionTimeoutMS: 8000 });
await c.connect();
const db = c.db(process.env.MONGO_APP_DB_NAME);
const U = db.collection('tbl_user'); const P = db.collection('tbl_payment'); const PR = db.collection('tbl_utr_payments');
const now = new Date().toISOString();
const findUser = async (userId, mobile) => {
  if (userId && ObjectId.isValid(userId)) { const u = await U.findOne({ _id: new ObjectId(userId) }); if (u) return { u, by: 'id' }; }
  const mob = digits(mobile);
  if (mob) { const u = await U.findOne({ $or: [{ mobile_no: mob }, { mobile_no: String(mobile) }] }); if (u) return { u, by: 'mobile' }; }
  return { u: null, by: null };
};
console.log(`db ${process.env.MONGO_APP_DB_NAME} — ${apply ? 'APPLY' : 'dry run'}${skip.size ? ` — skipping ${[...skip].join(', ')}` : ''}`);

// A. approved proofs → the candidate must be paid and the ledger row must point at them
for (const proof of await PR.find({ status: 'approved' }).toArray()) {
  const { u, by } = await findUser(proof.user_id, proof.mobile_no);
  const tag = `proof ${String(proof._id).slice(-6)} ₹${proof.amount} ${proof.booth_count || '?'} booths`;
  if (skipped(proof)) { console.log(`${tag}: SKIPPED (--skip) — left alone`); continue; }
  if (!u) { console.log(`${tag}: NO user found by id or mobile — left alone`); continue; }
  const fixes = [];
  if (!isPaid(u.paid_status)) fixes.push('mark paid');
  if (!u.transaction_id && proof.utr) fixes.push('set transaction_id');
  const row = await P.findOne({ $or: [{ payment_id: proof.utr }, { user_id: String(proof.user_id) }] });
  if (row && String(row.user_id) !== String(u._id)) fixes.push('relink ledger row');
  if (row && Number(row.user_group_id) !== Number(u.user_group_id)) fixes.push('ledger group');
  console.log(`${tag}: user found by ${by}, group ${u.user_group_id}, paid ${JSON.stringify(u.paid_status)} → ${fixes.length ? fixes.join(', ') : 'nothing to do'}`);
  if (apply && fixes.length) {
    await U.updateOne({ _id: u._id }, { $set: { paid_status: 'Yes', ...(proof.utr && !u.transaction_id ? { transaction_id: proof.utr } : {}), updated_at: now, reconciled_at: now } });
    if (row) await P.updateOne({ _id: row._id }, { $set: { user_id: String(u._id), user_group_id: u.user_group_id, mobile_no: u.mobile_no || row.mobile_no, reconciled_at: now } });
    await PR.updateOne({ _id: proof._id }, { $set: { user_id: String(u._id), reconciled_at: now } });
  }
}

// B. manual mark-paid rows whose amount is really the booth count
for (const row of await P.find({ status: 'Manual', amount: { $lt: 100 } }).toArray()) {
  if (skipped(row)) { console.log(`manual row ${String(row._id).slice(-6)}: SKIPPED (--skip) — left alone`); continue; }
  const n = Number(row.booth_count) || Number(row.amount) || 1;
  const pr = calculateWardPricing(n);
  console.log(`manual row ${String(row._id).slice(-6)}: amount ${row.amount} looks like a booth count → ₹${pr.totalAmount} (${n} booths)`);
  if (apply) await P.updateOne({ _id: row._id }, { $set: { amount_was: row.amount, amount: pr.totalAmount, base_amount: pr.basePrice, gst_amount: pr.gst, booth_count: n, reconciled_at: now } });
}
if (!apply) console.log('dry run — add --apply to write');
await c.close();
