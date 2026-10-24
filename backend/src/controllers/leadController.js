// Incomplete registrations (Ram, 2026-10-15) — see services/leads.js.
//   POST /public/lead      website step 1/2: name + number (always answers the same, so it never tells who is registered)
//   GET  /leads            Super Admin: the list, one tab at a time, with the count of every tab
//   PUT  /leads/:id        Super Admin: set the status and/or add a note
import { getAppDb } from '../config/db.js';
import { toObjectId } from '../utils/objectId.js';
import { escapeRegex } from '../utils/escapeRegex.js';
import { LEADS_COLL, LEAD_STEPS, LEAD_STATUSES, touchLead, recordWebsiteEvent } from '../services/leads.js';

const TABS = {
  open: { registered_at: null, status: { $in: ['new', 'contacted'] } },
  interested: { registered_at: null, status: 'interested' },
  not_interested: { registered_at: null, status: 'not_interested' },
  registered: { registered_at: { $ne: null } },
};

export async function publicLead(req, res) {
  const b = req.body || {};
  const mobile = String(b.mobile || '').replace(/\D/g, '');
  const name = String(b.full_name || '').replace(/[0-9]/g, '').trim().slice(0, 80);
  const step = b.step === 'role' ? 'role' : 'details';
  if (/^[6-9]\d{9}$/.test(mobile) && name) await touchLead(getAppDb(), { mobile, name, source: 'website', step });
  res.json({ success: true });
}

// POST /public/track — website registration-journey beacon (visit / start / submit).
// Fire-and-forget: always 200 so the page never waits on it.
export async function track(req, res) {
  try {
    const mobile = String(req.body?.mobile || '').replace(/\D/g, '');
    const event = String(req.body?.event || '');
    if (/^[6-9]\d{9}$/.test(mobile) && ['visit', 'start', 'submit'].includes(event)) {
      await recordWebsiteEvent(getAppDb(), { mobile, event });
    }
  } catch { /* beacon never fails loudly */ }
  res.json({ success: true });
}

export async function list(req, res) {
  try {
    const db = getAppDb();
    const coll = db.collection(LEADS_COLL);
    const tab = TABS[req.query.tab] ? req.query.tab : 'open';
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 25));
    const extra = {};
    if (['whatsapp', 'website'].includes(req.query.source)) extra.sources = req.query.source;
    const q = String(req.query.search || '').trim();
    if (q) { const rx = new RegExp(escapeRegex(q), 'i'); extra.$or = [{ mobile: rx }, { wa_name: rx }, { web_name: rx }]; }
    const filter = { ...TABS[tab], ...extra };
    const counts = {};
    for (const [k, f] of Object.entries(TABS)) counts[k] = await coll.countDocuments({ ...f, ...extra });
    // warmest first: furthest step, then most recent
    const sort = tab === 'open' ? { step_rank: -1, last_seen: -1 } : tab === 'registered' ? { registered_at: -1 } : { status_at: -1 };
    const rows = await coll.find(filter).sort(sort).skip((page - 1) * pageSize).limit(pageSize).toArray();
    res.json({
      success: true, tab, page, pageSize, total: counts[tab], counts,
      steps: Object.fromEntries(Object.entries(LEAD_STEPS).map(([k, v]) => [k, v.label])), last_rank: Math.max(...Object.values(LEAD_STEPS).map((s) => s.rank)),
      rows: rows.map((r) => ({ ...r, name: r.web_name || r.wa_name || '', step_label: LEAD_STEPS[r.step]?.label || r.step })),
    });
  } catch (e) {
    if (e.message === 'APP_DB_OFFLINE') return res.status(503).json({ success: false, message: 'App database unavailable.' });
    res.status(500).json({ success: false, message: e.message });
  }
}

export async function update(req, res) {
  try {
    const oid = toObjectId(req.params.id);
    if (!oid) return res.status(400).json({ success: false, message: 'Invalid id.' });
    const { status, note } = req.body || {};
    if (status != null && !LEAD_STATUSES.includes(status)) return res.status(422).json({ success: false, message: 'Unknown status.' });
    const text = String(note || '').trim().slice(0, 1000);
    if (status == null && !text) return res.status(422).json({ success: false, message: 'Nothing to save.' });
    const coll = getAppDb().collection(LEADS_COLL);
    const lead = await coll.findOne({ _id: oid });
    if (!lead) return res.status(404).json({ success: false, message: 'Not found.' });
    const at = new Date().toISOString();
    const by = req.user?.name || req.user?.username || 'admin';
    const set = {};
    if (status != null && status !== lead.status) Object.assign(set, { status, status_at: at, status_by: by, history: [...(lead.history || []), { status, from: lead.status, at, by }] });
    if (text) set.notes = [...(lead.notes || []), { text, at, by }];
    if (Object.keys(set).length) await coll.updateOne({ _id: oid }, { $set: set });
    res.json({ success: true, lead: { ...lead, ...set } });
  } catch (e) {
    if (e.message === 'APP_DB_OFFLINE') return res.status(503).json({ success: false, message: 'App database unavailable.' });
    res.status(500).json({ success: false, message: e.message });
  }
}
