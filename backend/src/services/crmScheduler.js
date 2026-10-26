// Scheduled auto-distribution of unassigned CRM leads (Super-Admin configurable:
// hourly / daily-at-hour / weekly). Checks every 5 minutes; a persisted run-key
// prevents double runs within the same window (and across restarts).
import { getAppDb, isAppDbOnline } from '../config/db.js';
import { loadCrmConfig } from './crmConfig.js';
import { runDistribute } from '../controllers/crmController.js';

const weekOf = (d) => {
  const first = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d - first) / 86400000 + first.getDay() + 1) / 7);
};

async function tick() {
  try {
    if (!isAppDbOnline()) return;
    const db = getAppDb();
    const cfg = await loadCrmConfig(db);
    if (!cfg.round_robin || !cfg.auto_distribute?.enabled) return;

    const now = new Date();
    const { frequency, hour } = cfg.auto_distribute;
    let dueKey = null;
    if (frequency === '10min') dueKey = `10m-${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${Math.floor(now.getMinutes() / 10)}`;
    else if (frequency === 'hourly') dueKey = `h-${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;
    else if (frequency === 'daily' && now.getHours() === hour) dueKey = `d-${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    else if (frequency === 'weekly' && now.getDay() === 1 && now.getHours() === hour) dueKey = `w-${now.getFullYear()}-${weekOf(now)}`;
    if (!dueKey) return;

    const st = await db.collection('tbl_crm_settings').findOne({ _id: 'auto_distribute_run' });
    if (st?.key === dueKey) return; // already ran this window
    await db.collection('tbl_crm_settings').updateOne({ _id: 'auto_distribute_run' }, { $set: { key: dueKey, at: now } }, { upsert: true });

    const r = await runDistribute(db, { reassignAll: false });
    console.log(`[crm-scheduler] auto-distribute (${frequency}) assigned ${r.assigned} of ${r.agents} agent(s)`);
  } catch (e) {
    console.warn('[crm-scheduler]', e.message);
  }
}

export function startCrmScheduler() {
  setInterval(tick, 5 * 60 * 1000);
}
