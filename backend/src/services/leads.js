// Incomplete registrations (Ram, 2026-10-15): everyone who messages the WhatsApp bot or finishes step 1 of the website
// form gets one row in tbl_leads (keyed by the 10-digit mobile), from the first message. It records how far they got,
// and moves to "registered" when they finish. Rows are never deleted: the admin marks them Interested / Not interested.
// Only findOne / insertOne / updateOne($set) are used, so the offline bot harness's fake DB runs this code too.
export const LEADS_COLL = 'tbl_leads';

// How far someone got, furthest wins. WhatsApp and the website share one ladder.
export const LEAD_STEPS = {
  contacted: { rank: 0, label: 'Messaged the bot' },
  language: { rank: 1, label: 'Chose a language' },
  details: { rank: 1, label: 'Gave name and number' },
  role: { rank: 2, label: 'Chose their role' },
  body_type: { rank: 3, label: 'Chose rural or urban' },
  position: { rank: 4, label: 'Chose the position' },
  district: { rank: 5, label: 'Chose the district' },
  assembly: { rank: 6, label: 'Chose the assembly' },
  booth_numbers: { rank: 7, label: 'Asked for booth numbers' },
};
export const LEAD_STATUSES = ['new', 'contacted', 'interested', 'not_interested'];

const ten = (m) => String(m || '').replace(/\D/g, '').slice(-10);
// any account with this number (some store only the hashed passcode, so password_str is not a test)
const isRegistered = async (db, mobile) => !!(await db.collection('tbl_user').findOne({ mobile_no: mobile }));

// The furthest registration step a WhatsApp bot session has reached.
export function stepOfSession(s = {}) {
  if (s.awaiting_booth_numbers || s.booth_count) return 'booth_numbers';
  if (s.assembly) return 'assembly';
  if (s.district) return 'district';
  if (s.position) return 'position';
  if (s.body_type) return 'body_type';
  if (s.role) return 'role';
  if (s.lang) return 'language';
  return 'contacted';
}

// Record a contact. Best effort: never throws, so the bot and the form carry on whatever happens here.
export async function touchLead(db, { mobile, name = '', source, step = 'contacted', at = new Date() }) {
  try {
    const m = ten(mobile);
    if (m.length !== 10 || !LEAD_STEPS[step]) return null;
    const coll = db.collection(LEADS_COLL);
    const now = at.toISOString();
    const lead = await coll.findOne({ mobile: m });
    let resultRow = null;
    if (!lead) {
      if (await isRegistered(db, m)) return null; // already has an account: not a lead
      const row = {
        mobile: m, wa_name: source === 'whatsapp' ? String(name || '') : '', web_name: source === 'website' ? String(name || '') : '',
        sources: [source], first_seen: now, last_seen: now, step, step_rank: LEAD_STEPS[step].rank, step_at: now,
        status: 'new', status_at: null, status_by: '', notes: [], history: [], registered_at: null,
      };
      try { await coll.insertOne(row); resultRow = row; } catch (e) { if (e?.code !== 11000) throw e; return touchLead(db, { mobile, name, source, step, at }); }
    } else {
      const set = { last_seen: now };
      if (!lead.sources?.includes(source)) set.sources = [...(lead.sources || []), source];
      if (name && source === 'whatsapp' && name !== lead.wa_name) set.wa_name = String(name);
      if (name && source === 'website' && name !== lead.web_name) set.web_name = String(name);
      if (LEAD_STEPS[step].rank > (lead.step_rank ?? -1)) Object.assign(set, { step, step_rank: LEAD_STEPS[step].rank, step_at: now });
      if (!lead.registered_at && await isRegistered(db, m)) set.registered_at = now;
      await coll.updateOne({ mobile: m }, { $set: set });
      resultRow = { ...lead, ...set };
    }

    // Always bridge into tbl_crm_conversation so telecallers see incomplete leads immediately
    try {
      const stepLabel = LEAD_STEPS[step]?.label || step;
      const contactName = String(name || resultRow?.web_name || resultRow?.wa_name || '').trim() || `Lead ${m.slice(-4)}`;
      await db.collection('tbl_crm_conversation').updateOne(
        { clean_mobile: m },
        {
          $setOnInsert: {
            clean_mobile: m,
            source: source || 'website',
            lead_status: 'new',
            assigned_agent_id: null,
            assigned_agent_name: null,
            taken: false,
            unread_count: 0,
            last_message: `Lead captured via ${source} (${stepLabel})`,
            last_message_at: at,
            window_active: true,
            window_hours: 24,
            created_at: at,
            status_history: [{ status: 'new', note: `Incomplete lead created from ${source} (${stepLabel})`, by: 'System', at, source }],
          },
          $set: {
            contact_name: contactName,
            step,
            step_label: stepLabel,
            last_inbound_at: at,
            updated_at: at,
          },
        },
        { upsert: true }
      );
    } catch (e) {
      console.error('[touchLead crm sync error]:', e);
    }

    return resultRow;
  } catch (e) {
    console.warn(`[leads] not recorded for ******${ten(mobile).slice(-4)}: ${e.message}`);
    return null;
  }
}

// Website registration journey timestamps (first visit → started form → submitted → completed).
// Each stamp is set once (the first time it happens) so the CRM can show the full timeline.
export async function recordWebsiteEvent(db, { mobile, event, at = new Date() }) {
  try {
    const m = ten(mobile);
    if (m.length !== 10) return;
    const field = { visit: 'visited_at', start: 'started_at', submit: 'submitted_at', complete: 'completed_at' }[event];
    if (!field) return;
    const now = at.toISOString();
    await db.collection(LEADS_COLL).updateOne(
      { mobile: m },
      { $setOnInsert: { mobile: m, sources: ['website'], first_seen: now, step: 'contacted', step_rank: 0, step_at: now, status: 'new', notes: [], history: [], registered_at: null }, $set: { last_seen: now }, $min: { [field]: now } },
      { upsert: true },
    );
  } catch (e) {
    console.warn(`[leads] website event not recorded: ${e.message}`);
  }
}

// The number finished registering (bot or website): it leaves the open list for the Registered tab.
export async function markLeadRegistered(db, mobile) {
  try {
    const m = ten(mobile);
    const now = new Date().toISOString();
    const lead = await db.collection(LEADS_COLL).findOne({ mobile: m });
    if (lead) {
      if (!lead.registered_at) await db.collection(LEADS_COLL).updateOne({ mobile: m }, { $set: { registered_at: now } });
    } else {
      const user = await db.collection('tbl_user').findOne({ mobile_no: m });
      const name = user ? [user.first_name, user.last_name].filter(Boolean).join(' ') : `Candidate ${m.slice(-4)}`;
      await db.collection(LEADS_COLL).insertOne({
        mobile: m,
        wa_name: '',
        web_name: name,
        sources: ['website'],
        first_seen: now,
        last_seen: now,
        step: 'booth_numbers',
        step_rank: 7,
        step_at: now,
        status: 'registered',
        status_at: now,
        status_by: 'system',
        notes: [],
        history: [],
        registered_at: now,
      });
    }
  } catch (e) {
    console.warn(`[leads] registered mark failed for ******${ten(mobile).slice(-4)}: ${e.message}`);
  }
}

// Reflect a real registration/payment outcome onto the telecaller CRM pipeline so
// the CRM "registered"/"converted" metrics match reality (lead_status was otherwise
// moved only by an agent clicking). Updates the conversation if one exists — it does
// not create a conversation here (that is handled by the CRM assignment flow).
export async function markCrmLeadStatus(db, mobile, status, note = '') {
  try {
    const m = ten(mobile);
    if (!m) return;
    await db.collection('tbl_crm_conversation').updateOne(
      { clean_mobile: m },
      {
        $set: { lead_status: status, updated_at: new Date() },
        $push: { status_history: { status, note, by: 'System', at: new Date(), source: 'auto' } },
        $setOnInsert: {
          clean_mobile: m,
          assigned_agent_id: null,
          assigned_agent_name: null,
          taken: false,
          unread_count: 0,
          created_at: new Date(),
        },
      },
      { upsert: true }
    );
  } catch (e) {
    console.warn(`[leads] crm status sync failed for ******${ten(mobile).slice(-4)}: ${e.message}`);
  }
}

// The admin deleted this number's account: it is incomplete again, so it goes back to the follow-up list (2026-10-17).
export async function markLeadUnregistered(db, mobile) {
  try {
    const m = ten(mobile);
    const lead = await db.collection(LEADS_COLL).findOne({ mobile: m });
    if (lead?.registered_at) await db.collection(LEADS_COLL).updateOne({ mobile: m }, { $set: { registered_at: null } });
  } catch (e) {
    console.warn(`[leads] un-register failed for ******${ten(mobile).slice(-4)}: ${e.message}`);
  }
}
