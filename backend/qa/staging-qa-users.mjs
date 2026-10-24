// STAGING ONLY: (re)create the four QA accounts in the staging copy of the app DB, with the usernames and
// passwords already recorded in the staging secrets folder (so the QA suite's credentials stay valid after a
// reset). Run from the staging backend folder so bcryptjs/mongodb resolve:
//   cd /var/www/edm-staging/backend && node qa/staging-qa-users.mjs
// Paths can be overridden with STAGING_SECRETS (default /root/edm-staging). Never run against live.
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { MongoClient } from 'mongodb';

const SECRETS = process.env.STAGING_SECRETS || '/root/edm-staging';
const DB = process.env.STAGING_DB || 'election_app_staging';
const pwd = fs.readFileSync(path.join(SECRETS, 'mongo.pass'), 'utf8').trim();
const users = JSON.parse(fs.readFileSync(path.join(SECRETS, 'qa-users.json'), 'utf8'));
const c = new MongoClient(`mongodb://edm_staging:${encodeURIComponent(pwd)}@127.0.0.1:27017/?authSource=admin`);
await c.connect();
const U = c.db(DB).collection('tbl_user');
const DROP = ['_id', 'id', 'uuid', 'g_user_id', 'password', 'password_str', 'user_token', 'otp', 'email', 'email_verification_code', 'last_login', 'last_login_at', 'transaction_id', 'created_at', 'updated_at', 'provider', 'provider_id', 'player_id', 'user_image', 'user_image_path', 'guser_image'];
const strip = (d) => { const o = { ...d }; for (const k of DROP) delete o[k]; return o; };
const now = new Date().toISOString();
// templates: a real record of each kind, so the QA accounts have the same shape as real ones
const admin = await U.findOne({ user_group_id: 1, qa_staging: { $ne: true } });
const unpaid = await U.findOne({ user_group_id: 11, paid_status: 'No', booths: { $exists: true, $ne: [] }, qa_staging: { $ne: true } });
const mla = await U.findOne({ user_group_id: 3, assembly_id: { $exists: true }, qa_staging: { $ne: true } });
const spec = {
  admin: [admin, { user_group_id: 1, first_name: 'QA Admin', mobile_no: '9000000001', user_name: 'qa_admin', paid_status: 'Yes' }],
  candidate: [unpaid, { user_group_id: 11, first_name: 'QA Candidate Paid', mobile_no: '9000000002', user_name: 'qa_candidate', paid_status: 'Yes', booths: unpaid.booths }],
  ward: [unpaid, { user_group_id: 11, first_name: 'QA Candidate Unpaid', mobile_no: '9000000003', user_name: 'qa_ward', paid_status: 'No', booths: unpaid.booths }],
  mla: [mla, { user_group_id: 3, first_name: 'QA Assembly', mobile_no: '9000000004', user_name: 'qa_mla' }],
  // a generated booth login (group 4) — lands on the notice page (A1)
  booth: [await U.findOne({ user_group_id: 4, qa_staging: { $ne: true } }), { user_group_id: 4, first_name: 'QA Booth Login', mobile_no: '9000000006', user_name: 'qa_booth', paid_status: 'Yes' }],
  // paid, but stored as the NUMBER 1 — exactly like one real candidate (B5)
  legacy: [unpaid, { user_group_id: 11, first_name: 'QA Candidate Legacy', mobile_no: '9000000005', user_name: 'qa_legacy', paid_status: 1, booths: unpaid.booths }],
};
for (const [key, [base, patch]] of Object.entries(spec)) {
  const doc = { ...strip(base), ...patch, last_name: '(staging)', password: await bcrypt.hash(users[key].password, 10), password_str: '', email: '', is_active: 1, created_at: now, updated_at: now, qa_staging: true };
  await U.updateOne({ user_name: patch.user_name }, { $set: doc }, { upsert: true });
}
console.log('qa users:', await U.countDocuments({ qa_staging: true }));
await c.close();
