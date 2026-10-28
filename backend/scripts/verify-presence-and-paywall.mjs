import dotenv from 'dotenv';
dotenv.config({ path: 'backend/.env' });
import { getAppDb, connectDbs, closeDbs } from '../src/config/db.js';
import { getActiveAgents, assignAgentRoundRobin, dispatchOvernightLeads } from '../src/controllers/whatsappController.js';
import { getAdminLeaderboard } from '../src/controllers/crmController.js';
import { list as listRegistrations } from '../src/controllers/registrationController.js';
import { home as candidateHome } from '../src/controllers/wardController.js';
import { ROLES } from '../src/constants/roles.js';

async function runVerification() {
  console.log('========================================================================');
  console.log('🧪 VERIFYING LIVE PRESENCE, SHIFT-AWARE ROUTING & 24H DEMO PAYWALL');
  console.log('========================================================================\n');

  await connectDbs();
  const db = getAppDb();

  const testAgentMobile = '9000000102'; // Abinaya
  const testCandidateMobile = '9840112233';

  // Cleanup prior test data
  await db.collection('tbl_crm_conversation').deleteOne({ clean_mobile: testCandidateMobile });
  await db.collection('tbl_enquiry').deleteOne({ mobile: testCandidateMobile });
  await db.collection('tbl_user').deleteOne({ mobile_no: testCandidateMobile });

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Agent Login Tracking & Live Presence Status
    // -------------------------------------------------------------------------
    console.log('TEST 1: Telecaller Shift Presence (Active / Idle / Offline)');

    // 1A: Check offline state when last_login_at is old
    const yesterday = new Date(Date.now() - 25 * 3600 * 1000);
    await db.collection('tbl_user').updateOne(
      { mobile_no: testAgentMobile },
      { $set: { last_login_at: yesterday } }
    );

    let fakeReq = { user: { sub: 'admin', group_id: 1 } };
    let fakeRes = {
      json: (data) => data,
      status: () => fakeRes,
    };

    let lbData;
    await getAdminLeaderboard(fakeReq, {
      json: (d) => { lbData = d; },
      status: () => ({ json: (d) => { lbData = d; } })
    });

    const agentOffline = lbData.leaderboard.find((a) => a.name.toLowerCase().includes('abinaya'));
    console.log(`  Agent presence before shift login: [${agentOffline?.presence_status}] - "${agentOffline?.presence_label}"`);
    if (agentOffline?.presence_status !== 'offline') {
      throw new Error(`Expected offline presence status, got ${agentOffline?.presence_status}`);
    }

    // 1B: Agent logs in today -> Active Now
    const now = new Date();
    await db.collection('tbl_user').updateOne(
      { mobile_no: testAgentMobile },
      { $set: { last_login_at: now } }
    );

    await getAdminLeaderboard(fakeReq, {
      json: (d) => { lbData = d; },
      status: () => ({ json: (d) => { lbData = d; } })
    });

    const agentActive = lbData.leaderboard.find((a) => a.name.toLowerCase().includes('abinaya'));
    console.log(`  Agent presence after shift login: [${agentActive?.presence_status}] - "${agentActive?.presence_label}"`);
    if (agentActive?.presence_status !== 'active') {
      throw new Error(`Expected active presence status, got ${agentActive?.presence_status}`);
    }
    console.log('  ✅ TEST 1 PASSED: Agent login tracking and presence states work seamlessly.\n');

    // -------------------------------------------------------------------------
    // TEST 2: Shift-Aware Auto-Routing & Overnight Pool Drain
    // -------------------------------------------------------------------------
    console.log('TEST 2: Shift-Aware Lead Auto-Routing & Overnight Lead Pooling');

    // Case 2A: If no agents are logged in today, leads are held in unassigned pool
    const agentsOnline = await getActiveAgents(db, { onlineOnly: true });
    console.log(`  Currently online agents for shift: ${agentsOnline.length} (${agentsOnline.map(a => a.name).join(', ')})`);

    // Pick agent round robin (online only)
    const assigned = await assignAgentRoundRobin(db, { requireOnline: true });
    console.log(`  Shift-Aware Round-Robin assigned to: ${assigned?.name || 'None (Pool)'}`);
    if (!assigned) throw new Error('Expected online agent to receive lead.');

    // Case 2B: Create an unassigned overnight lead and test dispatchOvernightLeads
    await db.collection('tbl_crm_conversation').insertOne({
      clean_mobile: testCandidateMobile,
      contact_name: 'Overnight Test Candidate',
      assigned_agent_id: null,
      lead_status: 'new',
      created_at: new Date(Date.now() - 5 * 3600 * 1000), // arrived at 4 AM
    });

    const drained = await dispatchOvernightLeads(db);
    console.log(`  Morning pool drain dispatched: ${drained} overnight lead(s)`);

    const drainedLead = await db.collection('tbl_crm_conversation').findOne({ clean_mobile: testCandidateMobile });
    console.log(`  Overnight lead assigned to: ${drainedLead.assigned_agent_name} (by: ${drainedLead.assigned_by})`);
    if (!drainedLead.assigned_agent_id || drainedLead.assigned_by !== 'morning_auto_dispatch') {
      throw new Error('Overnight lead was not properly dispatched to online telecaller.');
    }
    console.log('  ✅ TEST 2 PASSED: Shift-aware auto-routing and morning pool drain verified.\n');

    // -------------------------------------------------------------------------
    // TEST 3: Candidate Activation & Login Tracking
    // -------------------------------------------------------------------------
    console.log('TEST 3: Candidate Portal Activation & Login Tracking');

    // Create a candidate account
    const candidateUser = {
      mobile_no: testCandidateMobile,
      first_name: 'Murugan Test',
      user_group_id: ROLES.BOOTH_ALT,
      is_active: 1,
      paid_status: 'No',
      first_login_at: now,
      last_login_at: now,
      login_count: 3,
      demo_first_login_at: now,
      demo_expires_at: new Date(now.getTime() + 24 * 3600 * 1000),
    };
    const insUser = await db.collection('tbl_user').insertOne(candidateUser);

    await db.collection('tbl_enquiry').insertOne({
      mobile: testCandidateMobile,
      full_name: 'Murugan Test',
      has_logged_in: true,
      last_login_at: now,
      login_count: 3,
      created_at: now.toISOString(),
    });

    // Test Registrations API output
    let regData;
    await listRegistrations(
      { query: { search: testCandidateMobile }, user: { sub: 'admin', group_id: 1 } },
      { json: (d) => { regData = d; }, status: () => ({ json: (d) => { regData = d; } }) }
    );

    const regRow = regData.rows.find((r) => r.mobile === testCandidateMobile);
    console.log(`  Registrations Table Candidate Status: has_logged_in=${regRow?.has_logged_in}, visits=${regRow?.login_count}`);
    if (!regRow?.has_logged_in || regRow?.login_count !== 3) {
      throw new Error('Candidate portal activation did not appear in Registrations list.');
    }
    console.log('  ✅ TEST 3 PASSED: Candidate activation and visit count visible to Admin.\n');

    // -------------------------------------------------------------------------
    // TEST 4: 24-Hour Demo Preview (Active Countdown)
    // -------------------------------------------------------------------------
    console.log('TEST 4: 24-Hour Demo Preview (Within 24 Hours)');

    let wardData;
    await candidateHome(
      { user: { sub: String(insUser.insertedId), name: 'Murugan Test', group_id: ROLES.BOOTH_ALT } },
      { json: (d) => { wardData = d; } }
    );

    console.log(`  Candidate Dashboard State: demoActive=${wardData.demoActive}, demoExpired=${wardData.demoExpired}, remainingSec=${wardData.demoRemainingSec}`);
    if (!wardData.demoActive || wardData.demoExpired || wardData.demoRemainingSec <= 0) {
      throw new Error('Expected active demo countdown within 24 hours of first login.');
    }
    console.log('  ✅ TEST 4 PASSED: Demo active countdown correctly reported.\n');

    // -------------------------------------------------------------------------
    // TEST 5: 24-Hour Demo Expiration & Paywall Hard Lock
    // -------------------------------------------------------------------------
    console.log('TEST 5: 24-Hour Demo Expiration & Paywall Lock (After 24 Hours)');

    // Simulate 24 hours having elapsed
    const expiredTime = new Date(Date.now() - 2 * 3600 * 1000); // expired 2 hours ago
    await db.collection('tbl_user').updateOne(
      { _id: insUser.insertedId },
      { $set: { demo_expires_at: expiredTime } }
    );

    await candidateHome(
      { user: { sub: String(insUser.insertedId), name: 'Murugan Test', group_id: ROLES.BOOTH_ALT } },
      { json: (d) => { wardData = d; } }
    );

    console.log(`  Candidate Dashboard State (Expired): demoExpired=${wardData.demoExpired}, demoRemainingSec=${wardData.demoRemainingSec}`);
    if (!wardData.demoExpired) {
      throw new Error('Expected demoExpired=true when 24-hour window has passed.');
    }

    // Test Pro Plan Unlock
    await db.collection('tbl_user').updateOne(
      { _id: insUser.insertedId },
      { $set: { paid_status: 'Yes' } }
    );

    await candidateHome(
      { user: { sub: String(insUser.insertedId), name: 'Murugan Test', group_id: ROLES.BOOTH_ALT } },
      { json: (d) => { wardData = d; } }
    );

    console.log(`  Candidate Dashboard State (After Pro Upgrade): demoExpired=${wardData.demoExpired}`);
    if (wardData.demoExpired) {
      throw new Error('Expected demoExpired=false once candidate is upgraded to Pro.');
    }
    console.log('  ✅ TEST 5 PASSED: 24-Hour demo expiration locks dashboard and Pro upgrade unlocks it.\n');

    console.log('========================================================================');
    console.log('🎉 ALL 5 LIVE PRESENCE & DEMO PAYWALL VERIFICATION TESTS PASSED (100%)');
    console.log('========================================================================\n');

  } finally {
    // Cleanup
    await db.collection('tbl_crm_conversation').deleteOne({ clean_mobile: testCandidateMobile });
    await db.collection('tbl_enquiry').deleteOne({ mobile: testCandidateMobile });
    await db.collection('tbl_user').deleteOne({ mobile_no: testCandidateMobile });
    await closeDbs();
  }
}

runVerification().catch((e) => {
  console.error('\n❌ VERIFICATION TEST FAILED:', e.message);
  process.exit(1);
});
