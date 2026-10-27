import 'dotenv/config';
import { connectDbs, getAppDb, closeDbs } from '../src/config/db.js';

const LEGACY_USERNAMES = ['nunciya', 'mahimaa', 'mahima', 'tamilarasi'];
const LEGACY_MOBILES = ['9566752446', '7823923086', '9940136163', '9000000101'];

async function run() {
  await connectDbs();
  const db = getAppDb();
  console.log('Connected to DB.');

  // 1. Check legacy telecaller users
  const legacyUsers = await db.collection('tbl_user').find({
    $or: [
      { username: { $in: LEGACY_USERNAMES } },
      { mobile_no: { $in: LEGACY_MOBILES } },
      { first_name: { $in: ['Nunciya', 'Mahimaa', 'Mahima', 'Tamilarasi', 'Priya Murugan'] } },
    ],
  }).toArray();
  console.log(`Found ${legacyUsers.length} legacy telecaller user(s):`, legacyUsers.map(u => `${u.username} (${u._id})`));

  const legacyIds = legacyUsers.map(u => String(u._id));
  const legacyNumericIds = legacyUsers.map(u => u.id).filter(Boolean);

  // 2. Check and reset any leads assigned to legacy telecallers in tbl_crm_conversation
  if (legacyIds.length > 0) {
    const assignedConvCount = await db.collection('tbl_crm_conversation').countDocuments({
      assigned_agent_id: { $in: legacyIds },
    });
    console.log(`Conversations assigned to legacy telecallers: ${assignedConvCount}`);
    if (assignedConvCount > 0) {
      await db.collection('tbl_crm_conversation').updateMany(
        { assigned_agent_id: { $in: legacyIds } },
        {
          $set: {
            assigned_agent_id: null,
            assigned_agent_name: null,
            assigned_at: null,
            assigned_by: null,
            taken: false,
            updated_at: new Date(),
          },
        }
      );
      console.log(`Reset ${assignedConvCount} conversation(s) to unassigned.`);
    }

    // Check tbl_leads as well
    const assignedLeadCount = await db.collection('tbl_leads').countDocuments({
      assigned_agent_id: { $in: legacyIds },
    });
    console.log(`tbl_leads assigned to legacy telecallers: ${assignedLeadCount}`);
    if (assignedLeadCount > 0) {
      await db.collection('tbl_leads').updateMany(
        { assigned_agent_id: { $in: legacyIds } },
        {
          $set: {
            assigned_agent_id: null,
            assigned_agent_name: null,
            updated_at: new Date().toISOString(),
          },
        }
      );
      console.log(`Reset ${assignedLeadCount} lead(s) in tbl_leads to unassigned.`);
    }

    // 3. Delete legacy users from tbl_user
    const delResult = await db.collection('tbl_user').deleteMany({
      _id: { $in: legacyUsers.map((u) => u._id) },
    });
    console.log(`Deleted ${delResult.deletedCount} legacy telecaller(s) from tbl_user.`);
  } else {
    console.log('No legacy telecallers found in tbl_user.');
  }

  // 4. Check tbl_crm_settings round_robin
  const rrSetting = await db.collection('tbl_crm_settings').findOne({ _id: 'round_robin' });
  if (rrSetting?.last_agent_id && legacyIds.includes(String(rrSetting.last_agent_id))) {
    console.log(`Resetting round-robin last_agent_id from legacy ID ${rrSetting.last_agent_id} to null.`);
    await db.collection('tbl_crm_settings').updateOne(
      { _id: 'round_robin' },
      { $set: { last_agent_id: null, updated_at: new Date() } }
    );
  }

  // 5. Retroactively sync existing tbl_leads into tbl_crm_conversation
  const allLeads = await db.collection('tbl_leads').find({}).toArray();
  console.log(`Total leads in tbl_leads: ${allLeads.length}`);
  let leadsSynced = 0;
  for (const lead of allLeads) {
    if (!lead.mobile) continue;
    const cleanMobile = String(lead.mobile).replace(/\D/g, '').slice(-10);
    const existing = await db.collection('tbl_crm_conversation').findOne({ clean_mobile: cleanMobile });
    const isReg = !!lead.registered_at;
    const contactName = lead.web_name || lead.wa_name || `Lead ${cleanMobile.slice(-4)}`;
    const now = new Date();
    if (!existing) {
      await db.collection('tbl_crm_conversation').insertOne({
        clean_mobile: cleanMobile,
        contact_name: contactName,
        source: lead.sources?.[0] || 'website',
        sources: lead.sources || ['website'],
        lead_status: isReg ? 'registered' : (lead.status || 'new'),
        is_registered: isReg,
        registered_at: lead.registered_at || null,
        assigned_agent_id: lead.assigned_agent_id || null,
        assigned_agent_name: lead.assigned_agent_name || null,
        assigned_at: lead.assigned_at ? new Date(lead.assigned_at) : null,
        assigned_by: lead.assigned_by || null,
        taken: false,
        unread_count: 0,
        last_message: lead.notes?.[lead.notes.length - 1]?.text || 'Lead created',
        last_message_at: lead.last_seen ? new Date(lead.last_seen) : now,
        created_at: lead.first_seen ? new Date(lead.first_seen) : now,
        updated_at: now,
      });
      leadsSynced++;
    } else {
      // update status / registered flag if needed
      const updateSet = {};
      if (isReg && !existing.is_registered) {
        updateSet.is_registered = true;
        updateSet.lead_status = 'registered';
        updateSet.registered_at = lead.registered_at;
      }
      if (lead.assigned_agent_id && !existing.assigned_agent_id) {
        updateSet.assigned_agent_id = lead.assigned_agent_id;
        updateSet.assigned_agent_name = lead.assigned_agent_name;
      }
      if (Object.keys(updateSet).length > 0) {
        updateSet.updated_at = now;
        await db.collection('tbl_crm_conversation').updateOne(
          { clean_mobile: cleanMobile },
          { $set: updateSet }
        );
        leadsSynced++;
      }
    }
  }
  console.log(`Synced ${leadsSynced} record(s) from tbl_leads into tbl_crm_conversation.`);

  // 6. Retroactively sync registered candidates from tbl_user into tbl_crm_conversation
  const candidates = await db.collection('tbl_user').find({
    user_group_id: { $in: [2, '2'] },
  }).toArray();
  console.log(`Total candidate users in tbl_user: ${candidates.length}`);
  let candidatesSynced = 0;
  for (const cand of candidates) {
    if (!cand.mobile_no) continue;
    const cleanMobile = String(cand.mobile_no).replace(/\D/g, '').slice(-10);
    const existing = await db.collection('tbl_crm_conversation').findOne({ clean_mobile: cleanMobile });
    const contactName = [cand.first_name, cand.last_name].filter(Boolean).join(' ') || cand.name || `Candidate ${cleanMobile.slice(-4)}`;
    const now = new Date();
    if (!existing) {
      await db.collection('tbl_crm_conversation').insertOne({
        clean_mobile: cleanMobile,
        contact_name: contactName,
        source: 'website',
        sources: ['website'],
        lead_status: 'registered',
        is_registered: true,
        is_pro: cand.is_pro === 1 || cand.is_paid === 1,
        registered_at: cand.created_at || now,
        assigned_agent_id: null,
        assigned_agent_name: null,
        taken: false,
        unread_count: 0,
        last_message: 'Registered candidate',
        last_message_at: cand.created_at ? new Date(cand.created_at) : now,
        created_at: cand.created_at ? new Date(cand.created_at) : now,
        updated_at: now,
      });
      candidatesSynced++;
    } else if (!existing.is_registered) {
      await db.collection('tbl_crm_conversation').updateOne(
        { clean_mobile: cleanMobile },
        {
          $set: {
            is_registered: true,
            lead_status: 'registered',
            is_pro: cand.is_pro === 1 || cand.is_paid === 1,
            registered_at: cand.created_at || now,
            updated_at: now,
          },
        }
      );
      candidatesSynced++;
    }
  }
  console.log(`Synced ${candidatesSynced} candidate user(s) into tbl_crm_conversation.`);

  // 7. Summary of active telecallers
  const activeTelecallers = await db.collection('tbl_user').find({
    user_group_id: 12,
    is_active: 1,
  }).toArray();
  console.log(`Active Telecallers (${activeTelecallers.length}):`);
  activeTelecallers.forEach(t => console.log(`  - ${t.first_name} ${t.last_name || ''} (@${t.username}, mobile: ${t.mobile_no}, id: ${t._id})`));

  console.log('Cleanup & sync complete!');
  await closeDbs();
}

run().catch((e) => {
  console.error('Error running sync-and-cleanup:', e);
  process.exit(1);
});
