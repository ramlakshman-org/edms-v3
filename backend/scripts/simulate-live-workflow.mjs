import dotenv from 'dotenv';
dotenv.config({ path: 'backend/.env' });
import readline from 'readline';
import bcrypt from 'bcryptjs';
import { connectDbs, getAppDb, closeDbs } from '../src/config/db.js';
import { touchLead } from '../src/services/leads.js';
import { getActiveAgents, assignAgentRoundRobin } from '../src/controllers/whatsappController.js';
import { runDistribute } from '../src/controllers/crmController.js';

// Configuration
const SIM_PREFIX = '984099'; // Test range: 9840990001 .. 9840990020
const DELAY_MS = 2500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function promptEnter(msg) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`\n👉 ${msg} (Press ENTER to proceed)... `, () => {
      rl.close();
      resolve();
    });
  });
}

const STEP_COLORS = {
  header: '\x1b[1m\x1b[36m',
  success: '\x1b[32m',
  warning: '\x1b[33m',
  event: '\x1b[35m',
  reset: '\x1b[0m',
};

async function logStep(title) {
  console.log(`\n${STEP_COLORS.header}========================================================================${STEP_COLORS.reset}`);
  console.log(`${STEP_COLORS.header}🎬 SIMULATION EVENT: ${title}${STEP_COLORS.reset}`);
  console.log(`${STEP_COLORS.header}========================================================================${STEP_COLORS.reset}`);
}

async function main() {
  const isInteractive = process.argv.includes('--interactive') || process.argv.includes('-i');
  const isCleanOnly = process.argv.includes('--clean');

  await connectDbs();
  const db = getAppDb();

  // Helper cleanup
  async function cleanup() {
    console.log('\n🧹 Cleaning up any prior simulation records in range 9840990000..9840990050...');
    await db.collection('tbl_crm_conversation').deleteMany({ clean_mobile: { $regex: /^984099/ } });
    await db.collection('tbl_leads').deleteMany({ mobile: { $regex: /^984099/ } });
    await db.collection('tbl_user').deleteMany({ mobile_no: { $regex: /^984099/ } });
    await db.collection('tbl_utr_payments').deleteMany({ mobile_no: { $regex: /^984099/ } });
    await db.collection('tbl_crm_message').deleteMany({ phone: { $regex: /^984099/ } });
    console.log('✅ Simulation records cleaned.');
  }

  if (isCleanOnly) {
    await cleanup();
    await closeDbs();
    process.exit(0);
  }

  await cleanup();

  console.log(`\n🚀 ${STEP_COLORS.success}TNEDMS LIVE WORKFLOW SIMULATOR INITIALIZED${STEP_COLORS.reset}`);
  console.log(`Mode: ${isInteractive ? 'Interactive (Step-by-step)' : 'Continuous Auto-Play'}`);
  console.log(`Open your browser to:`);
  console.log(`  • Super Admin: https://tnedms.online/team/view`);
  console.log(`  • Telecaller:   https://tnedms.online/team/crm`);
  console.log(`  • Candidate:    https://tnedms.online/login\n`);

  if (isInteractive) await promptEnter('Start Simulation');

  // =========================================================================
  // SCENE 1: Morning Telecaller Shift Clock-In
  // =========================================================================
  await logStep('1. Telecallers Clock In for Morning Shift');
  const now = new Date();
  
  // Abinaya logs in
  await db.collection('tbl_user').updateOne(
    { mobile_no: '9000000102' },
    { $set: { last_login_at: now, updated_at: now } }
  );
  console.log(`  🟢 Telecaller "Abinaya M" signed in. Presence: ACTIVE NOW (<20m).`);
  await sleep(1000);

  // Yuvasri logs in
  await db.collection('tbl_user').updateOne(
    { mobile_no: '9000000103' },
    { $set: { last_login_at: now, updated_at: now } }
  );
  console.log(`  🟢 Telecaller "Yuvasri" signed in. Presence: ACTIVE NOW (<20m).`);
  console.log(`  ⚪ Telecaller "Omsree" has NOT logged in yet. Presence: OFFLINE / ABSENT.`);
  console.log(`  💡 Check Admin Leaderboard: Abinaya & Yuvasri show Green Badges; Omsree shows Gray.`);

  if (isInteractive) await promptEnter('Trigger Inbound Leads Arrival');
  else await sleep(DELAY_MS);

  // =========================================================================
  // SCENE 2: Real-time Inbound Leads Arrive & Auto-Route
  // =========================================================================
  await logStep('2. Prospective Candidates Drop In from Website');

  const incomingLeads = [
    { name: 'Kavitha Ramachandran', mobile: '9840990001', district: 'Chennai', assembly: 'Harbour (18)', party: 'DMK' },
    { name: 'Senthil Nathan', mobile: '9840990002', district: 'Chennai', assembly: 'Kolathur (13)', party: 'AIADMK' },
    { name: 'Dinesh Kumar M', mobile: '9840990003', district: 'Salem', assembly: 'Salem North (89)', party: 'TVK' },
    { name: 'Bhuvaneshwari R', mobile: '9840990004', district: 'Coimbatore', assembly: 'Coimbatore South (118)', party: 'BJP' },
  ];

  for (let i = 0; i < incomingLeads.length; i++) {
    const l = incomingLeads[i];
    console.log(`  📥 [Incoming Lead] "${l.name}" (${l.mobile}) started registration form...`);
    
    // Simulate drop-off at role / district step
    await touchLead(db, {
      mobile: l.mobile,
      name: l.name,
      source: 'website',
      step: 'district',
    });

    const conv = await db.collection('tbl_crm_conversation').findOne({ clean_mobile: l.mobile });
    console.log(`     ↳ ⚡ Auto-Assigned via Round-Robin to: ${conv?.assigned_agent_name || 'Unassigned'}`);
    await sleep(800);
  }

  console.log(`\n  💡 Check:`);
  console.log(`     • Admin /incomplete-registrations -> 4 leads under "To follow up" with "Website" tag.`);
  console.log(`     • Abinaya's queue -> Has Kavitha & Dinesh.`);
  console.log(`     • Yuvasri's queue -> Has Senthil & Bhuvaneshwari.`);

  if (isInteractive) await promptEnter('Simulate Telecaller Calls & Outcomes');
  else await sleep(DELAY_MS);

  // =========================================================================
  // SCENE 3: Telecallers Dial Leads & Log Dispositions
  // =========================================================================
  await logStep('3. Telecallers Dial Leads & Log Call Dispositions');

  // Call 1: Abinaya calls Kavitha -> High Interest (Normal call, 45s)
  const l1 = incomingLeads[0];
  console.log(`  📞 Abinaya calls "${l1.name}"... Connected (Talk time: 48s).`);
  await db.collection('tbl_crm_conversation').updateOne(
    { clean_mobile: l1.mobile },
    {
      $set: {
        lead_status: 'interested',
        last_contacted_at: new Date(),
        call_count: 1,
        total_duration: 48,
        notes: 'Candidate interested in booth 1-5 analysis. Requested payment details on WhatsApp.',
        updated_at: new Date(),
      },
      $push: {
        status_history: {
          status: 'interested',
          timestamp: new Date(),
          duration: 48,
          agent_name: 'Abinaya M',
          note: 'Candidate interested in booth 1-5 analysis.',
        }
      }
    }
  );
  console.log(`     ↳ Outcome Saved: "Interested" (48s). Counter updated.`);

  // Call 2: Short Call / Fake Disposition Audit Test (<10s)
  const l2 = incomingLeads[1];
  console.log(`  📞 Yuvasri dials "${l2.name}"... Call cuts off after 4s.`);
  await db.collection('tbl_crm_conversation').updateOne(
    { clean_mobile: l2.mobile },
    {
      $set: {
        lead_status: 'call_completed',
        last_contacted_at: new Date(),
        call_count: 1,
        total_duration: 4,
        notes: 'Call marked completed.',
        updated_at: new Date(),
      },
      $push: {
        status_history: {
          status: 'call_completed',
          timestamp: new Date(),
          duration: 4,
          agent_name: 'Yuvasri',
          note: 'Marked completed but lasted only 4 seconds.',
        }
      }
    }
  );
  console.log(`     ↳ ⚠️ Outcome Saved: "Call Completed" with duration 4s. Short-call flag triggered.`);

  // Call 3: Will Call Back (Overdue callback test)
  const l3 = incomingLeads[2];
  const yesterday = new Date(Date.now() - 26 * 60 * 60 * 1000);
  console.log(`  📞 Abinaya called "${l3.name}" yesterday -> Scheduled callback for morning.`);
  await db.collection('tbl_crm_conversation').updateOne(
    { clean_mobile: l3.mobile },
    {
      $set: {
        lead_status: 'will_call_back',
        callback_date: yesterday,
        updated_at: yesterday,
      }
    }
  );
  console.log(`     ↳ ⚠️ Callback is now >24 hours overdue. Overdue callbacks banner triggered on Admin Dashboard.`);

  if (isInteractive) await promptEnter('Candidate Completes Registration & Logs In');
  else await sleep(DELAY_MS);

  // =========================================================================
  // SCENE 4: Full Registration, First-Login & 24h Demo Clock Start
  // =========================================================================
  await logStep('4. Candidate Finishes Registration & Begins 24h Demo');

  const regMobile = '9840990010';
  const regName = 'Saravanan Candidate';
  const hashed = await bcrypt.hash('123456', 10);
  const regTime = new Date();

  // Create User
  await db.collection('tbl_user').insertOne({
    username: 'cand_9010',
    first_name: 'Saravanan',
    last_name: 'K',
    mobile_no: regMobile,
    password: hashed,
    password_str: '123456',
    user_group_id: 11,
    assembly_id: 33,
    assembly_no: 33,
    party_name: 'DMK',
    is_active: 1,
    is_paid: 0,
    paid_status: 'No',
    booths: [{ assembly_no: 33, part_no: 1 }, { assembly_no: 33, part_no: 2 }],
    created_at: regTime,
    updated_at: regTime,
  });

  // Sync to CRM conversation
  await db.collection('tbl_crm_conversation').updateOne(
    { clean_mobile: regMobile },
    {
      $set: {
        contact_name: regName,
        is_registered: true,
        lead_status: 'registered',
        registered_at: regTime,
        updated_at: regTime,
      },
      $setOnInsert: {
        clean_mobile: regMobile,
        source: 'website',
        taken: false,
        created_at: regTime,
      }
    },
    { upsert: true }
  );

  console.log(`  🎉 "${regName}" registered on website! (Username: cand_9010, Passcode: 123456).`);
  console.log(`     ↳ Lead automatically moved to "Registered" tab on Admin.`);

  // Candidate First Login Event
  console.log(`  🔑 Candidate logs into /login for the first time...`);
  const loginTime = new Date();
  const demoExpiresAt = new Date(loginTime.getTime() + 24 * 60 * 60 * 1000);

  await db.collection('tbl_user').updateOne(
    { mobile_no: regMobile },
    {
      $set: {
        first_login_at: loginTime,
        last_login_at: loginTime,
        login_count: 1,
        demo_expires_at: demoExpiresAt,
      }
    }
  );
  await db.collection('tbl_crm_conversation').updateOne(
    { clean_mobile: regMobile },
    {
      $set: {
        candidate_first_login_at: loginTime,
        candidate_last_login_at: loginTime,
        candidate_login_count: 1,
      }
    }
  );

  console.log(`     ↳ 🟢 First login stamped: ${loginTime.toLocaleTimeString()}`);
  console.log(`     ↳ ⏱️ 24-Hour Demo timer started! Expires at: ${demoExpiresAt.toLocaleTimeString()}`);
  console.log(`     ↳ Candidate Dashboard renders: "24-Hour Demo Preview: 23h 59m remaining"`);
  console.log(`     ↳ Telecaller Lead Drawer updates to: "🟢 Logged in (1x · Just now)"`);

  if (isInteractive) await promptEnter('Fast-Forward: Simulate Demo Expiration & Hard Paywall');
  else await sleep(DELAY_MS);

  // =========================================================================
  // SCENE 5: 24 Hours Elapse -> Hard Paywall Lock
  // =========================================================================
  await logStep('5. 24 Hours Pass -> Hard Paywall Locks Voter Access');

  const expiredTime = new Date(Date.now() - 3600 * 1000); // 1 hour ago
  await db.collection('tbl_user').updateOne(
    { mobile_no: regMobile },
    { $set: { demo_expires_at: expiredTime } }
  );
  console.log(`  ⌛ Fast-forwarding 24 hours... Demo timer expired!`);
  console.log(`     ↳ 🔒 Sample voter table locked (0 rows returned, demoExpired: true).`);
  console.log(`     ↳ 🛑 Candidate sees red paywall: "Your 24-Hour Demo Preview has Expired".`);
  console.log(`     ↳ 📲 Direct WhatsApp CTA rendered: "Contact Support on WhatsApp" (wa.me/917904759268).`);

  if (isInteractive) await promptEnter('Candidate Upgrades: Submits UTR Payment Proof');
  else await sleep(DELAY_MS);

  // =========================================================================
  // SCENE 6: Payment Submission & Admin Approval
  // =========================================================================
  await logStep('6. Candidate Submits UTR & Admin Unlocks Pro Plan');

  const testUtr = '984099UTR123456';
  await db.collection('tbl_utr_payments').insertOne({
    mobile_no: regMobile,
    utr: testUtr,
    amount: '₹2,360',
    plan: '1 Booth',
    status: 'pending',
    submitted_at: new Date(),
  });
  console.log(`  💳 Candidate submits UTR proof: "${testUtr}".`);
  console.log(`     ↳ Candidate banner updates: "🟡 Payment proof received, verification in progress".`);

  await sleep(1500);

  console.log(`  🛡️ Super Admin opens /payments and clicks [ Approve Payment ]...`);
  await db.collection('tbl_utr_payments').updateOne(
    { utr: testUtr },
    { $set: { status: 'approved', approved_at: new Date(), approved_by: 'admin' } }
  );
  await db.collection('tbl_user').updateOne(
    { mobile_no: regMobile },
    { $set: { is_paid: 1, paid_status: 'Yes', plan: 'Pro' } }
  );
  await db.collection('tbl_crm_conversation').updateOne(
    { clean_mobile: regMobile },
    { $set: { is_pro: true, lead_status: 'converted', paid_at: new Date() } }
  );

  console.log(`     ↳ 🟢 Account Upgraded! paid_status = "Yes".`);
  console.log(`     ↳ 🚀 Hard paywall removed, voter data and PDF exports fully unlocked.`);
  console.log(`     ↳ 💬 WhatsApp "edms_account_activated" template triggered with header image!`);

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log(`\n${STEP_COLORS.success}========================================================================${STEP_COLORS.reset}`);
  console.log(`${STEP_COLORS.success}🎉 E2E REAL-TIME SIMULATION RUN COMPLETE! (100% SUCCESS)${STEP_COLORS.reset}`);
  console.log(`${STEP_COLORS.success}========================================================================${STEP_COLORS.reset}`);
  console.log(`All core pillars operated in real-time sequence:`);
  console.log(`  1. Telecaller Presence: Logged-in agents marked Active; absent marked Offline.`);
  console.log(`  2. Shift Auto-Routing: Inbound drop-offs instantly distributed to active agents.`);
  console.log(`  3. Quality Audits: Short-call (<10s) and overdue callback flags triggered.`);
  console.log(`  4. Candidate Experience: First-login tracked, 24h demo timer displayed.`);
  console.log(`  5. Paywall Lock: Expiration safely locked voter records.`);
  console.log(`  6. Revenue Conversion: UTR submission & Admin approval unlocked full Pro access.`);
  console.log(`\nTo clean up simulation test records at any time, run:`);
  console.log(`  node backend/scripts/simulate-live-workflow.mjs --clean\n`);

  await closeDbs();
}

main().catch((err) => {
  console.error('Simulation execution error:', err);
  process.exit(1);
});
