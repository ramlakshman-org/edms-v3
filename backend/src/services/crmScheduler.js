// Scheduled auto-distribution of unassigned CRM leads (Super-Admin configurable:
// hourly / daily-at-hour / weekly) + 8:00 PM Automated Daily Performance Digest.
// Checks every 5 minutes; a persisted run-key prevents double runs within the same window.
import { getAppDb, isAppDbOnline } from '../config/db.js';
import { loadCrmConfig } from './crmConfig.js';
import { runDistribute } from '../controllers/crmController.js';
import { sendWactoText, wactoConfigured } from './wactoService.js';
import { sendText } from './whatsappService.js';
import { getActiveAgents } from '../controllers/whatsappController.js';

const weekOf = (d) => {
  const first = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d - first) / 86400000 + first.getDay() + 1) / 7);
};

export async function generateDailyDigestData(db) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  // 1. All conversations with activity today
  const convsToday = await db.collection('tbl_crm_conversation').find({
    'status_history.at': { $gte: startOfToday },
  }).toArray();

  let totalCalls = 0;
  const agentCalls = {};
  const statusCounts = {};

  convsToday.forEach((c) => {
    (c.status_history || []).forEach((h) => {
      if (h.at && new Date(h.at) >= startOfToday) {
        totalCalls += 1;
        const agent = h.by || 'Agent';
        agentCalls[agent] = (agentCalls[agent] || 0) + 1;
        statusCounts[h.status] = (statusCounts[h.status] || 0) + 1;
      }
    });
  });

  // 2. User registrations today
  const regCount = await db.collection('tbl_user').countDocuments({
    created_at: { $gte: startOfToday },
  });

  // 3. Pro upgrades today
  const proCount = await db.collection('tbl_user').countDocuments({
    paid_status: 'Yes',
    $or: [{ updated_at: { $gte: startOfToday } }, { created_at: { $gte: startOfToday } }],
  });

  // 4. Unreachable / archived today
  const archivedCount = await db.collection('tbl_crm_conversation').countDocuments({
    archived: true,
    archived_at: { $gte: startOfToday },
  });

  const agentLines = Object.entries(agentCalls)
    .map(([name, count]) => `   • ${name}: ${count} call(s)`)
    .join('\n') || '   • No calls dialed today';

  const todayStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const text = 
`📊 *EDMS Daily Telecalling Performance (${todayStr})*
───────────────────────────
📞 *Total Calls Dialed:* ${totalCalls}
${agentLines}

🟡 *Incomplete Follow-ups / Converted:* ${statusCounts.converted || 0}
🟢 *New User Registrations:* ${regCount}
💎 *Pro Plan Upgrades:* ${proCount}
🚫 *Auto-Archived (3-Strikes):* ${archivedCount}
───────────────────────────
_Automated 8:00 PM System Report · EDMS Engine_`;

  return { totalCalls, agentCalls, statusCounts, regCount, proCount, archivedCount, text };
}

export async function dispatchDailyDigest(db, { force = false, targetPhone = null } = {}) {
  const digest = await generateDailyDigestData(db);
  const cfg = await loadCrmConfig(db);

  let phone = targetPhone || cfg.admin_phone || process.env.ADMIN_PHONE || process.env.WACTO_CHANNEL;
  if (!phone) {
    const adminUser = await db.collection('tbl_user').findOne({ group_id: 1, mobile_no: { $exists: true } });
    phone = adminUser?.mobile_no;
  }

  if (!phone) {
    console.warn('[crm-scheduler] Daily digest skipped: no admin phone configured.');
    return { sent: false, reason: 'No admin phone configured', digest };
  }

  const cleanPhone = String(phone).replace(/\D/g, '').slice(-10);
  try {
    if (wactoConfigured()) {
      await sendWactoText(cleanPhone, digest.text);
    } else {
      await sendText(cleanPhone, digest.text);
    }
    console.log(`[crm-scheduler] Daily digest dispatched to ${cleanPhone}`);
    return { sent: true, phone: cleanPhone, digest };
  } catch (err) {
    console.warn(`[crm-scheduler] Daily digest send failed to ${cleanPhone}:`, err.message);
    return { sent: false, error: err.message, digest };
  }
}

async function tick() {
  try {
    if (!isAppDbOnline()) return;
    const db = getAppDb();
    const cfg = await loadCrmConfig(db);
    const now = new Date();

    // 1. Auto-distribution of leads
    if (cfg.round_robin && cfg.auto_distribute?.enabled) {
      const { frequency, hour } = cfg.auto_distribute;
      let dueKey = null;
      if (frequency === '10min') dueKey = `10m-${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${Math.floor(now.getMinutes() / 10)}`;
      else if (frequency === 'hourly') dueKey = `h-${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;
      else if (frequency === 'daily' && now.getHours() === hour) dueKey = `d-${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
      else if (frequency === 'weekly' && now.getDay() === 1 && now.getHours() === hour) dueKey = `w-${now.getFullYear()}-${weekOf(now)}`;

      if (dueKey) {
        const st = await db.collection('tbl_crm_settings').findOne({ _id: 'auto_distribute_run' });
        if (st?.key !== dueKey) {
          await db.collection('tbl_crm_settings').updateOne({ _id: 'auto_distribute_run' }, { $set: { key: dueKey, at: now } }, { upsert: true });
          const r = await runDistribute(db, { reassignAll: false });
          console.log(`[crm-scheduler] auto-distribute (${frequency}) assigned ${r.assigned} of ${r.agents} agent(s)`);
        }
      }
    }

    // 2. 8:00 PM Daily Performance Digest
    if (now.getHours() === 20) {
      const digestKey = `digest-${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
      const st = await db.collection('tbl_crm_settings').findOne({ _id: 'daily_digest_run' });
      if (st?.key !== digestKey) {
        await db.collection('tbl_crm_settings').updateOne(
          { _id: 'daily_digest_run' },
          { $set: { key: digestKey, at: now } },
          { upsert: true }
        );
        await dispatchDailyDigest(db);
      }
    }

    // 3. Self-Healing Lead SLA Engine (Active during calling hours: 9 AM - 8 PM)
    // Automatically reassigns leads that have been assigned for >3 hours without a call attempt.
    const currentHour = now.getHours();
    if (currentHour >= 9 && currentHour < 20) {
      const threeHoursAgo = new Date(Date.now() - 3 * 3600 * 1000);
      const staleLeads = await db.collection('tbl_crm_conversation').find({
        assigned_agent_id: { $nin: [null, ''] },
        lead_status: { $in: ['new', 'none', 'assigned'] },
        call_attempts: { $in: [0, null] },
        $or: [
          { assigned_at: { $lt: threeHoursAgo } },
          { assigned_at: { $exists: false }, created_at: { $lt: threeHoursAgo } },
        ],
      }).limit(20).toArray();

      if (staleLeads.length > 0) {
        const agents = await getActiveAgents(db);
        if (agents.length > 1) {
          for (const lead of staleLeads) {
            const pool = agents.filter((a) => a.id !== String(lead.assigned_agent_id));
            if (pool.length) {
              const nextAgent = pool[Math.floor(Math.random() * pool.length)];
              const prevName = lead.assigned_agent_name || 'telecaller';
              const slaNote = `[SLA Timeout: untouched for >3h with ${prevName}]`;
              await db.collection('tbl_crm_conversation').updateOne(
                { clean_mobile: lead.clean_mobile },
                {
                  $set: {
                    assigned_agent_id: nextAgent.id,
                    assigned_agent_name: nextAgent.name,
                    assigned_at: now,
                    assigned_by: 'sla_timeout',
                    updated_at: now,
                  },
                  $push: {
                    status_history: {
                      status: 'assigned',
                      note: slaNote,
                      by: 'System (SLA)',
                      at: now,
                    },
                  },
                }
              );
              await db.collection('tbl_leads').updateOne(
                { mobile: lead.clean_mobile },
                { $set: { assigned_agent_id: nextAgent.id, assigned_agent_name: nextAgent.name, updated_at: now } }
              ).catch(() => {});
              console.log(`[crm-scheduler SLA] Auto-reassigned stale lead ${lead.clean_mobile} from ${prevName} to ${nextAgent.name}`);
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn('[crm-scheduler]', e.message);
  }
}

export function startCrmScheduler() {
  setInterval(tick, 5 * 60 * 1000);
}
