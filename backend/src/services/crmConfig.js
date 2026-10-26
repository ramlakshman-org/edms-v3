// CRM assignment configuration (Super-Admin controlled), stored as a single
// doc in tbl_crm_settings. Controls round-robin vs manual, claim-unassigned,
// and the automatic daily/periodic redistribution schedule.
import { getAppDb } from '../config/db.js';

const ID = 'crm_config';

export const DEFAULT_CONFIG = {
  round_robin: true,       // auto round-robin on inbound + the Distribute button
  manual_assign: true,     // admin can assign leads manually
  claim_unassigned: true,  // telecallers may claim unassigned leads themselves
  auto_distribute: { enabled: true, frequency: '10min', hour: 9 }, // scheduled auto-distribution
};

export async function loadCrmConfig(db) {
  const d = db || getAppDb();
  let doc = null;
  try { doc = await d.collection('tbl_crm_settings').findOne({ _id: ID }); } catch { /* app db offline */ }
  return {
    ...DEFAULT_CONFIG,
    ...(doc || {}),
    auto_distribute: { ...DEFAULT_CONFIG.auto_distribute, ...(doc?.auto_distribute || {}) },
  };
}

export async function saveCrmConfig(db, patch = {}, by = null) {
  const d = db || getAppDb();
  const $set = { updated_at: new Date(), updated_by: by };
  for (const k of ['round_robin', 'manual_assign', 'claim_unassigned']) {
    if (k in patch) $set[k] = !!patch[k];
  }
  if (patch.auto_distribute) {
    const a = patch.auto_distribute;
    $set.auto_distribute = {
      enabled: !!a.enabled,
      frequency: ['10min', 'hourly', 'daily', 'weekly'].includes(a.frequency) ? a.frequency : '10min',
      hour: Math.max(0, Math.min(23, Number(a.hour) || 9)),
    };
  }
  await d.collection('tbl_crm_settings').updateOne({ _id: ID }, { $set }, { upsert: true });
  return loadCrmConfig(d);
}
