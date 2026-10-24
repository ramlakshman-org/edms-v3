// TeleCMI webhooks: the CDR logger (records each call into the CRM thread) and
// the inbound IVR HTTP flow (routes a caller to their telecaller, else round-robin).
// Both are PUBLIC (TeleCMI calls them) and verify the appid so they can't be spoofed.
import { getAppDb } from '../config/db.js';
import { toObjectId } from '../utils/objectId.js';
import { telecmiAppId, toDialNumber } from '../services/telecmiService.js';
import { saveCrmMessage } from './whatsappController.js';
import { ROLES } from '../constants/roles.js';

const clean10 = (m) => String(m ?? '').replace(/\D/g, '').slice(-10);
const TC_BASE = (process.env.TELECMI_BASE || 'https://rest.telecmi.com').replace(/\/$/, '');

/**
 * GET /api/crm/recordings?file=... — stream a TeleCMI call recording through the
 * backend so the app secret never reaches the browser. Auth via the session
 * (crmAccess). Docs: GET /v2/play?appid&secret&file
 */
export async function getRecording(req, res) {
  try {
    const file = String(req.query.file || '').trim();
    if (!file || /[\/\\]/.test(file)) return res.status(400).json({ success: false, message: 'Invalid recording file.' });
    const appid = process.env.TELECMI_APP_ID;
    const secret = process.env.TELECMI_APP_SECRET;
    if (!appid || !secret) return res.status(503).json({ success: false, message: 'TeleCMI is not configured.' });
    const url = `${TC_BASE}/v2/play?appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}&file=${encodeURIComponent(file)}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    let r;
    try { r = await fetch(url, { signal: ctrl.signal }); } finally { clearTimeout(t); }
    if (!r.ok) return res.status(502).json({ success: false, message: 'Recording not available yet.' });
    res.setHeader('Content-Type', r.headers.get('content-type') || 'audio/wav');
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.setHeader('Content-Disposition', `inline; filename="${file.replace(/[^\w.-]/g, '_')}"`);
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    console.error('[telecmi getRecording]', e.message);
    res.status(502).json({ success: false, message: 'Could not fetch recording.' });
  }
}
const nameOf = (u) => [u?.first_name, u?.last_name].filter(Boolean).join(' ') || u?.user_name || u?.mobile_no || 'Agent';

function appidOk(body) {
  const expected = telecmiAppId();
  if (!expected) return true;            // not configured → don't block
  if (body.appid === undefined) return true; // some events omit it
  return String(body.appid) === String(expected);
}

/**
 * POST /api/telecmi/webhook — Call Detail Record (and events).
 * Logs the call into tbl_crm_conversation.status_history + a tbl_crm_message.
 * Always answers 200 so the telephony platform never retries on our errors.
 */
export async function webhook(req, res) {
  try {
    const b = req.body || {};
    if (!appidOk(b)) return res.status(403).json({ success: false });
    // Only CDRs carry the final call outcome; ignore interim "event" pings.
    if (String(b.type || 'cdr') !== 'cdr') return res.json({ success: true });

    const db = getAppDb();
    const direction = String(b.direction || '').toLowerCase();
    const outbound = direction.includes('out');
    // The lead is the far end: the dialed number on outbound, the caller on inbound.
    const leadMobile = clean10(outbound ? b.to : b.from);
    if (!leadMobile) return res.json({ success: true });

    const answered = Number(b.answeredsec || 0);
    const at = b.time ? new Date(Number(b.time) * 1000 || b.time) : new Date();

    // Map the TeleCMI user who handled the call back to our telecaller.
    let agentName = null;
    if (b.user) {
      const u = await db.collection('tbl_user').findOne({ telecmi_id: String(b.user) });
      agentName = u ? nameOf(u) : null;
    }

    const status = answered > 0 ? 'call_completed' : 'not_answered';
    const note = `${direction || 'call'} · ${answered}s${b.ivr_name ? ` · IVR ${b.ivr_name}` : ''}`;
    const phoneFull = String(b.from || leadMobile).replace(/\D/g, '') || leadMobile;

    await db.collection('tbl_crm_conversation').updateOne(
      { clean_mobile: leadMobile },
      {
        $set: { updated_at: new Date(), last_telecmi_uuid: b.cmiuuid || b.conversation_uuid || null },
        $setOnInsert: {
          clean_mobile: leadMobile, phone: phoneFull, contact_name: `Caller ${leadMobile.slice(-4)}`,
          status: 'open', lead_status: 'none', unread_count: 0, created_at: new Date(),
        },
        $push: {
          status_history: {
            status, note, by: agentName || 'IVR', at,
            source: 'telecmi', direction: direction || 'call',
            duration: answered, recording: b.filename || null, ivr: b.ivr_name || null,
          },
        },
      },
      { upsert: true },
    );

    await saveCrmMessage({
      phone: phoneFull,
      direction: outbound ? 'outgoing' : 'incoming',
      type: 'call',
      body: `📞 ${outbound ? 'Outgoing' : 'Incoming'} call ${answered > 0 ? `answered (${answered}s)` : 'missed/unanswered'}${b.ivr_name ? ` · IVR: ${b.ivr_name}` : ''}${agentName ? ` · ${agentName}` : ''}`,
      metadata: { telecmi: true, cmiuuid: b.cmiuuid, conversation_uuid: b.conversation_uuid, recording: b.filename || null, agent: agentName, answeredsec: answered },
    }).catch(() => {});

    return res.json({ success: true });
  } catch (e) {
    console.error('[telecmi webhook]', e.message);
    return res.json({ success: true }); // never 5xx to the telephony platform
  }
}

// Active telecallers that have a TeleCMI user id (eligible for inbound routing).
async function routableAgents(db) {
  return db.collection('tbl_user')
    .find({ user_group_id: ROLES.CRM_AGENT, is_active: 1, telecmi_id: { $nin: [null, ''] } })
    .toArray();
}

/**
 * POST|GET /api/telecmi/flow — inbound IVR HTTP routing.
 * TeleCMI sends { from, to, cmiuuid, appid } and we reply with routing JSON:
 * route to the caller's existing telecaller, else round-robin to an active one.
 * Docs: https://doc.telecmi.com/chub/docs/http
 */
export async function flow(req, res) {
  try {
    const b = { ...(req.query || {}), ...(req.body || {}) };
    if (b.appid !== undefined && !appidOk(b)) return res.status(403).json({ code: 403 });

    const db = getAppDb();
    const from = clean10(b.from);

    // 1) existing owner of this caller's conversation
    let conv = from ? await db.collection('tbl_crm_conversation').findOne({ clean_mobile: from }) : null;
    let agent = null;
    if (conv?.assigned_agent_id) {
      agent = await db.collection('tbl_user').findOne({ _id: toObjectId(conv.assigned_agent_id) }).catch(() => null);
      if (!agent) agent = await db.collection('tbl_user').findOne({ user_name: conv.assigned_agent_id });
    }

    // 2) no routable owner → round-robin among active agents with a TeleCMI id
    if (!agent?.telecmi_id) {
      const pool = await routableAgents(db);
      if (pool.length) {
        const st = await db.collection('tbl_crm_settings').findOne({ _id: 'telecmi_rr' });
        let idx = 0;
        if (st?.last) { const p = pool.findIndex((a) => String(a._id) === st.last); idx = p === -1 ? 0 : (p + 1) % pool.length; }
        agent = pool[idx];
        await db.collection('tbl_crm_settings').updateOne({ _id: 'telecmi_rr' }, { $set: { last: String(agent._id), updated_at: new Date() } }, { upsert: true });
        if (from) {
          await db.collection('tbl_crm_conversation').updateOne(
            { clean_mobile: from },
            {
              $set: { assigned_agent_id: String(agent._id), assigned_agent_name: nameOf(agent), updated_at: new Date() },
              $setOnInsert: { clean_mobile: from, phone: String(b.from || from).replace(/\D/g, ''), contact_name: `Caller ${from.slice(-4)}`, status: 'open', lead_status: 'none', unread_count: 0, created_at: new Date() },
            },
            { upsert: true },
          );
        }
      }
    }

    const welcome_music = process.env.TELECMI_WELCOME || undefined;
    const waiting_music = process.env.TELECMI_WAITING || undefined;

    if (!agent?.telecmi_id) {
      // nobody to route to — greet and stop (hangup handled by TeleCMI timeout)
      return res.json({ code: 200, hangup: false, timeout: 20, welcome_music, waiting_music, result: [] });
    }

    const phone = agent.mobile_no ? toDialNumber(agent.mobile_no) : undefined;
    return res.json({
      code: 200, loop: 2, followme: true, hangup: false, timeout: 25,
      welcome_music, waiting_music,
      result: [{ agent_id: String(agent.telecmi_id), ...(phone ? { phone } : {}) }],
    });
  } catch (e) {
    console.error('[telecmi flow]', e.message);
    return res.json({ code: 200, result: [] });
  }
}
