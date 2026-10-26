import { MongoClient } from 'mongodb';

// Two independent connections, mirroring the original app:
//   voterDb  -> voter roll (ass_1..ass_234)
//   appDb    -> app data (users, tbl_assembly_consitituency, payments, ...)
let voterClient, appClient;
let voterDb = null;
let appDb = null;

export async function connectDbs() {
  const {
    MONGO_VOTER_URL, MONGO_VOTER_DB_NAME,
    MONGO_APP_URL, MONGO_APP_DB_NAME,
  } = process.env;

  try {
    voterClient = new MongoClient(MONGO_VOTER_URL, { serverSelectionTimeoutMS: 5000, maxPoolSize: 10 });
    await voterClient.connect();
    voterDb = voterClient.db(MONGO_VOTER_DB_NAME);
    console.log(`[db] voter_db connected (${MONGO_VOTER_DB_NAME})`);
  } catch (e) {
    console.warn(`[db] voter_db connection failed: ${e.message} (voter features will report offline)`);
    voterDb = null;
  }

  try {
    // Larger pool so the admin + telecaller panels stay responsive at scale
    // (10 lakh+ leads / many concurrent agents).
    appClient = new MongoClient(MONGO_APP_URL, { serverSelectionTimeoutMS: 5000, maxPoolSize: 50 });
    await appClient.connect();
    appDb = appClient.db(MONGO_APP_DB_NAME);
    console.log(`[db] election_app connected (${MONGO_APP_DB_NAME})`);
    await ensureAppIndexes(appDb);
  } catch (e) {
    console.warn(`[db] election_app connection failed: ${e.message}`);
    appDb = null;
  }
}

// Ensure the indexes the hot admin/CRM queries rely on. Without these, filtering
// and sorting over hundreds of thousands of leads does full collection scans.
// Best-effort: a failure here never blocks boot (createIndex is idempotent).
async function ensureAppIndexes(db) {
  const plan = {
    tbl_crm_conversation: [
      { key: { clean_mobile: 1 }, opts: { name: 'ix_conv_mobile' } },
      { key: { assigned_agent_id: 1, last_message_at: -1 }, opts: { name: 'ix_conv_agent_recent' } },
      { key: { lead_status: 1 }, opts: { name: 'ix_conv_leadstatus' } },
      { key: { status: 1 }, opts: { name: 'ix_conv_status' } },
      { key: { last_message_at: -1 }, opts: { name: 'ix_conv_recent' } },
    ],
    tbl_crm_message: [
      { key: { clean_mobile: 1, created_at: 1 }, opts: { name: 'ix_msg_mobile_time' } },
      { key: { 'metadata.cmiuuid': 1 }, opts: { name: 'ix_msg_cmiuuid', sparse: true } },
      { key: { 'metadata.recording': 1 }, opts: { name: 'ix_msg_recording', sparse: true } },
    ],
    tbl_user: [
      { key: { mobile_no: 1 }, opts: { name: 'ix_user_mobile' } },
      { key: { user_name: 1 }, opts: { name: 'ix_user_name' } },
      { key: { user_group_id: 1 }, opts: { name: 'ix_user_group' } },
      { key: { telecmi_id: 1 }, opts: { name: 'ix_user_telecmi', sparse: true } },
    ],
    tbl_enquiry: [
      { key: { mobile: 1 }, opts: { name: 'ix_enq_mobile' } },
      { key: { created_at: -1 }, opts: { name: 'ix_enq_recent' } },
      { key: { district: 1 }, opts: { name: 'ix_enq_district' } },
    ],
    tbl_leads: [
      { key: { mobile: 1 }, opts: { name: 'ix_lead_mobile' } },
      { key: { status: 1 }, opts: { name: 'ix_lead_status' } },
      { key: { registered_at: 1 }, opts: { name: 'ix_lead_registered', sparse: true } },
    ],
    tbl_payment: [
      { key: { mobile_no: 1 }, opts: { name: 'ix_pay_mobile' } },
      { key: { payment_id: 1 }, opts: { name: 'ix_pay_pid', sparse: true } },
      { key: { created_at: -1 }, opts: { name: 'ix_pay_recent' } },
    ],
    tbl_utr_payments: [
      { key: { status: 1, created_at: -1 }, opts: { name: 'ix_utr_status_recent' } },
      { key: { mobile: 1 }, opts: { name: 'ix_utr_mobile' } },
    ],
    tbl_wacto_sessions: [
      { key: { mobile: 1 }, opts: { name: 'ix_wacto_mobile' } },
    ],
    tbl_login_attempts: [
      // auto-clean lockout records an hour after the last failed attempt
      { key: { updated_at: 1 }, opts: { name: 'ix_login_ttl', expireAfterSeconds: 3600 } },
    ],
  };
  let made = 0;
  for (const [coll, idxs] of Object.entries(plan)) {
    for (const { key, opts } of idxs) {
      try { await db.collection(coll).createIndex(key, { background: true, ...opts }); made += 1; }
      catch (e) { /* index exists with other options, or collection missing — ignore */ }
    }
  }
  console.log(`[db] ensured ${made} app indexes`);
}

export function getVoterDb() {
  if (!voterDb) throw new Error('VOTER_DB_OFFLINE');
  return voterDb;
}
export function isVoterDbOnline() {
  return !!voterDb;
}
export function getAppDb() {
  if (!appDb) throw new Error('APP_DB_OFFLINE');
  return appDb;
}
export function isAppDbOnline() {
  return !!appDb;
}

export async function closeDbs() {
  await voterClient?.close().catch(() => {});
  await appClient?.close().catch(() => {});
}
