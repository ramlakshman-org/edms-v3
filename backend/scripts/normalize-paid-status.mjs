// Normalise tbl_user.paid_status to exactly 'Yes' for every record that is paid under any spelling
// (1, true, 'yes', ...). Leaves 'No', null and missing alone. Uses the backend's own .env (run it from the
// backend folder of the environment you mean: staging first, live only with Ram's go).
//   node scripts/normalize-paid-status.mjs                          dry run (counts only)
//   node scripts/normalize-paid-status.mjs --apply                  write
//   --unpaid=<record-id tail>,...   test accounts to set to 'No' instead (Ram, 2026-10-14: count only money that reached
//                                   the bank; …58f89d is a test account stored as paid 1 with no payment behind it)
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { isPaid } from '../src/utils/paid.js';

const apply = process.argv.includes('--apply');
const unpaid = new Set((process.argv.find((a) => a.startsWith('--unpaid=')) || '').slice(9).split(',').map((x) => x.trim()).filter(Boolean));
const tail = (u) => String(u._id).slice(-6);
const c = new MongoClient(process.env.MONGO_APP_URL, { serverSelectionTimeoutMS: 8000 });
await c.connect();
const U = c.db(process.env.MONGO_APP_DB_NAME).collection('tbl_user');
const odd = await U.find({ paid_status: { $exists: true, $nin: ['Yes', 'No', null] } }, { projection: { paid_status: 1, user_group_id: 1 } }).toArray();
const toNo = odd.filter((u) => unpaid.has(tail(u)));
const toYes = odd.filter((u) => isPaid(u.paid_status) && !unpaid.has(tail(u)));
const other = odd.filter((u) => !isPaid(u.paid_status) && !unpaid.has(tail(u)));
console.log(`db ${process.env.MONGO_APP_DB_NAME}: ${odd.length} non-standard paid_status values → ${toYes.length} mean paid, ${toNo.length} test account(s) set to 'No'${toNo.length ? ` (…${toNo.map(tail).join(', …')})` : ''}, ${other.length} other (${[...new Set(other.map((u) => JSON.stringify(u.paid_status)))].join(', ') || 'none'})`);
console.log('by group (paid under another spelling):', JSON.stringify(toYes.reduce((m, u) => ({ ...m, [u.user_group_id]: (m[u.user_group_id] || 0) + 1 }), {})));
const missing = [...unpaid].filter((t) => !odd.some((u) => tail(u) === t));
if (missing.length) console.log(`--unpaid not found among non-standard values (left alone): ${missing.join(', ')}`);
if (apply) {
  if (toYes.length) { const r = await U.updateMany({ _id: { $in: toYes.map((u) => u._id) } }, { $set: { paid_status: 'Yes', paid_status_was: 'normalized 2026-10-14' } }); console.log(`updated ${r.modifiedCount} record(s) to 'Yes'`); }
  if (toNo.length) { const r = await U.updateMany({ _id: { $in: toNo.map((u) => u._id) } }, { $set: { paid_status: 'No', paid_status_was: 'test account, no payment (Ram 2026-10-14)' } }); console.log(`updated ${r.modifiedCount} test record(s) to 'No'`); }
} else console.log('dry run — add --apply to write');
await c.close();
