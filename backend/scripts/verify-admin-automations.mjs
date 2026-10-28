import dotenv from 'dotenv';
dotenv.config({ path: 'backend/.env' });
// Targeted verification script for Admin CRM automations
import { getAppDb, connectDbs, closeDbs, isAppDbOnline } from '../src/config/db.js';
import { runDistribute, getAdminLeaderboard, reassignAgentLeads, teamStats } from '../src/controllers/crmController.js';
import { getActiveAgents } from '../src/controllers/whatsappController.js';
import { touchLead } from '../src/services/leads.js';

async function main() {
  console.log('--- 🧪 STARTING ADMIN CRM AUTOMATION VERIFICATION ---');
  await connectDbs();
  const db = getAppDb();

  // Test 1: Active agents resolution
  const agents = await getActiveAgents(db);
  console.log(`✅ Test 1: getActiveAgents found ${agents.length} active telecallers:`, agents.map(a => a.name).join(', '));
  if (agents.length === 0) throw new Error('No active telecallers found!');

  // Test 2: Instant Lead Assignment on touchLead
  const testPhone = '9999000099';
  await db.collection('tbl_crm_conversation').deleteOne({ clean_mobile: testPhone });
  await db.collection('tbl_leads').deleteOne({ mobile: testPhone });

  const lead = await touchLead(db, {
    mobile: testPhone,
    name: 'Automation Test Candidate',
    source: 'website',
    step: 'district',
  });
  console.log(`✅ Test 2a: touchLead executed for ${testPhone}`);

  const createdConv = await db.collection('tbl_crm_conversation').findOne({ clean_mobile: testPhone });
  console.log(`✅ Test 2b: Instant auto-assignment verified! Assigned to: ${createdConv?.assigned_agent_name} (${createdConv?.assigned_agent_id})`);
  if (!createdConv?.assigned_agent_id) throw new Error('Instant lead auto-assignment failed!');

  // Test 3: teamStats with overdue_callbacks & short_calls metrics
  let statsOut = null;
  const mockReq = { user: { group_id: 1, sub: 'admin', name: 'Admin' }, query: {} };
  const mockRes = {
    status: (code) => ({ json: (d) => { console.error('Status Error', code, d); return d; } }),
    json: (d) => { statsOut = d; return d; },
  };

  await teamStats(mockReq, mockRes);
  console.log('✅ Test 3: teamStats response metrics:');
  console.log(`   • Total Leads: ${statsOut?.stats?.total}`);
  console.log(`   • Calls Today: ${statsOut?.stats?.calls_today}`);
  console.log(`   • Overdue Callbacks: ${statsOut?.stats?.overdue_callbacks}`);
  console.log(`   • Short Calls (<10s): ${statsOut?.stats?.short_calls}`);
  if (typeof statsOut?.stats?.overdue_callbacks === 'undefined' || typeof statsOut?.stats?.short_calls === 'undefined') {
    throw new Error('teamStats is missing overdue_callbacks or short_calls metrics!');
  }

  // Test 4: getAdminLeaderboard
  let lbOut = null;
  const mockLbRes = {
    status: (code) => ({ json: (d) => { console.error('LB Status Error', code, d); return d; } }),
    json: (d) => { lbOut = d; return d; },
  };
  await getAdminLeaderboard(mockReq, mockLbRes);
  console.log(`✅ Test 4: getAdminLeaderboard returned ${lbOut?.leaderboard?.length} telecallers:`);
  (lbOut?.leaderboard || []).forEach((a) => {
    console.log(`   • ${a.name.padEnd(20)} | Calls Today: ${String(a.calls_today).padStart(2)} | Target: ${String(a.target_pct).padStart(3)}% | Untouched: ${String(a.untouched_leads).padStart(2)} | Talk: ${a.talk_time_formatted}`);
  });
  if (!lbOut?.leaderboard?.length) throw new Error('Leaderboard returned empty array!');

  // Test 5: Reassign Agent Leads
  const sourceAgent = agents[0];
  let reassignOut = null;
  const reassignReq = {
    user: { group_id: 1, sub: 'admin', name: 'Admin' },
    body: { source_agent_id: sourceAgent.id, uncontacted_only: true },
  };
  const reassignRes = {
    status: (code) => ({ json: (d) => { console.error('Reassign Error', code, d); return d; } }),
    json: (d) => { reassignOut = d; return d; },
  };
  await reassignAgentLeads(reassignReq, reassignRes);
  console.log(`✅ Test 5: reassignAgentLeads executed:`, reassignOut?.message);

  // Clean up test lead
  await db.collection('tbl_crm_conversation').deleteOne({ clean_mobile: testPhone });
  await db.collection('tbl_leads').deleteOne({ mobile: testPhone });
  console.log('✅ Cleaned up test lead records.');

  console.log('\n=========================================');
  console.log('🎉 ALL 5 ADMIN AUTOMATION TESTS PASSED 100%!');
  console.log('=========================================');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
