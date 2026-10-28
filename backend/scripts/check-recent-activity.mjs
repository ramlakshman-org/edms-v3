import 'dotenv/config';
import { connectDbs, getAppDb, closeDbs } from '../src/config/db.js';

async function run() {
  await connectDbs();
  const db = getAppDb();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  console.log('=== RECENT DB ACTIVITY (PAST 60 MINS) ===');

  // Check recent leads in tbl_leads
  const recentLeads = await db.collection('tbl_leads').find({
    last_seen: { $gte: oneHourAgo.toISOString() }
  }).sort({ last_seen: -1 }).limit(10).toArray();
  console.log(`Recent tbl_leads active: ${recentLeads.length}`);
  recentLeads.forEach(l => console.log(`  Lead: ${l.web_name || l.wa_name || 'No name'} (${l.mobile}) - step: ${l.step}, status: ${l.status}, assigned: ${l.assigned_agent_name}`));

  // Check recent conversations in tbl_crm_conversation
  const recentConvs = await db.collection('tbl_crm_conversation').find({
    updated_at: { $gte: oneHourAgo }
  }).sort({ updated_at: -1 }).limit(10).toArray();
  console.log(`\nRecent CRM Conversations active: ${recentConvs.length}`);
  recentConvs.forEach(c => console.log(`  Conv: ${c.contact_name} (${c.clean_mobile}) - lead_status: ${c.lead_status}, assigned: ${c.assigned_agent_name}, last_msg: ${c.last_message}`));

  await closeDbs();
}
run();
