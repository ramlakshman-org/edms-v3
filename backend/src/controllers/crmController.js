import { getAppDb } from '../config/db.js';
import { findById } from '../models/userModel.js';
import { click2call, fetchUserCdr } from '../services/telecmiService.js';
import { loadCrmConfig, saveCrmConfig } from '../services/crmConfig.js';
import { isPaid, paidFlag, PAID_VALUES } from '../utils/paid.js';
import { sendText, sendUrlButtonMessage, sendFlowMessage, sendMediaMessage, sendTemplateMessage, sendReaction } from '../services/whatsappService.js';
import { sendWactoText, wactoConfigured } from '../services/wactoService.js';
import { saveCrmMessage, getFlowMessageText, getActiveAgents, assignAgentRoundRobin } from './whatsappController.js';
import * as cloudinary from '../services/cloudinaryService.js';
import { ROLES } from '../constants/roles.js';
import { escapeRegex } from '../utils/escapeRegex.js';

// Registration template whose CTA is a WhatsApp Flow button (launches the
// in-WhatsApp registration flow). Used when the messaging window is closed.
const REGISTER_FLOW_TEMPLATE = process.env.REGISTER_FLOW_TEMPLATE || 'edms_reg_flow';
// Welcome-back / login-nudge template (image header + Login button, no passcode —
// Meta rejects credentials in templates, so the passcode stays in the in-window msg).
const WELCOME_TEMPLATE = process.env.WELCOME_TEMPLATE || 'edms_welcome';

// A logged-in user is a CRM agent (not admin) when their group is a telecaller
// group. crmAccess admits both CRM_AGENT (12) and TELECALLER (7), so BOTH must be
// treated as agents here — otherwise a group-7 login would skip agent-scoping and
// see every conversation/lead like an admin (privilege escalation).
function isCrmAgent(req) {
  const g = Number(req.user?.group_id);
  return g === ROLES.CRM_AGENT || g === ROLES.TELECALLER;
}

// The current agent's id (matches assigned_agent_id stored on conversations).
function currentAgentId(req) {
  return String(req.user?.sub || req.user?.id || '');
}

// Guard: a CRM agent may only touch conversations assigned to them. Admins and
// other roles are unrestricted. Returns true if allowed.
async function agentCanAccess(db, req, cleanMobile) {
  if (!isCrmAgent(req)) return true;
  const conv = await db
    .collection('tbl_crm_conversation')
    .findOne({ clean_mobile: cleanMobile }, { projection: { assigned_agent_id: 1 } });
  return !!conv && String(conv.assigned_agent_id) === currentAgentId(req);
}

// Resolve the WhatsApp messaging window for a contact. Uses the fields stored on
// the conversation by saveCrmMessage; falls back to the last incoming message for
// legacy threads that predate window tracking. 72h for ad-sourced, else 24h.
export async function resolveWindow(db, cleanMobile, conv = null) {
  let expiresAt = conv?.window_expires_at || null;
  let source = conv?.window_source || null;
  let hours = conv?.window_hours || null;
  let lastInboundAt = conv?.last_inbound_at || null;

  if (!expiresAt) {
    const lastIn = await db
      .collection('tbl_crm_message')
      .find({ clean_mobile: cleanMobile, direction: 'incoming' })
      .sort({ created_at: -1 })
      .limit(1)
      .next();
    if (lastIn) {
      const isAd = !!(lastIn.metadata && lastIn.metadata.referral);
      hours = isAd ? 72 : 24;
      source = isAd ? 'ad' : 'direct';
      lastInboundAt = lastIn.created_at;
      expiresAt = new Date(new Date(lastIn.created_at).getTime() + hours * 3600 * 1000);
    }
  }

  const expiresMs = expiresAt ? new Date(expiresAt).getTime() : null;
  return {
    window_source: source,
    window_hours: hours,
    last_inbound_at: lastInboundAt,
    window_expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
    window_active: expiresMs ? expiresMs > Date.now() : false,
  };
}

/**
 * GET /api/crm/conversations — List CRM chat threads
 */
export async function listConversations(req, res) {
  try {
    const db = getAppDb();
    const { search = '', status = 'all', lead_status = 'all', page = 1, limit = 50, hide_snoozed } = req.query;

    const query = {};
    const and = [];
    // CRM agents see their own leads — plus the unassigned pool when claiming is on.
    if (isCrmAgent(req)) {
      const config = await loadCrmConfig(db);
      if (config.claim_unassigned) {
        and.push({ $or: [{ assigned_agent_id: currentAgentId(req) }, { assigned_agent_id: { $in: [null, ''] } }, { assigned_agent_id: { $exists: false } }] });
      } else {
        query.assigned_agent_id = currentAgentId(req);
      }
    }
    if (status !== 'all') query.status = status;
    if (lead_status !== 'all') query.lead_status = lead_status;

    if (hide_snoozed === 'true') {
      and.push({
        $or: [
          { snooze_until: { $exists: false } },
          { snooze_until: null },
          { snooze_until: { $lte: new Date() } },
        ],
      });
    }

    if (search.trim()) {
      const s = escapeRegex(search.trim());
      and.push({ $or: [
        { contact_name: { $regex: s, $options: 'i' } },
        { clean_mobile: { $regex: s, $options: 'i' } },
        { phone: { $regex: s, $options: 'i' } },
        { last_message: { $regex: s, $options: 'i' } },
      ] });
    }

    // Super-admin oversight: ?agent_id= scopes to one telecaller's inbox; 'unassigned' shows the pool.
    if (!isCrmAgent(req) && req.query.agent_id) {
      query.assigned_agent_id = req.query.agent_id === 'unassigned' ? { $in: [null, ''] } : String(req.query.agent_id);
    }
    if (and.length) query.$and = and;

    const total = await db.collection('tbl_crm_conversation').countDocuments(query);
    const conversations = await db
      .collection('tbl_crm_conversation')
      .find(query)
      .sort({ last_message_at: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .toArray();

    // Enrich conversation threads with registration info if available
    const mobiles = conversations.map((c) => c.clean_mobile).filter(Boolean);
    const [users, enquiries] = await Promise.all([
      db.collection('tbl_user').find({ mobile_no: { $in: mobiles } }).toArray(),
      db.collection('tbl_enquiry').find({ mobile: { $in: mobiles } }).toArray(),
    ]);

    const userByMobile = Object.fromEntries(users.map((u) => [u.mobile_no, u]));
    const enquiryByMobile = Object.fromEntries(enquiries.map((e) => [e.mobile, e]));

    const enriched = conversations.map((c) => {
      const u = userByMobile[c.clean_mobile];
      const e = enquiryByMobile[c.clean_mobile];
      const isRegistered = !!(u || e);
      const paidStatus = u?.paid_status || e?.paid_status || 'No';
      const isPro = String(paidStatus).toLowerCase() === 'yes';
      const now = new Date();
      const isSnoozed = c.snooze_until ? new Date(c.snooze_until) > now : false;
      const isDue = (c.next_call_at && new Date(c.next_call_at) <= now) ||
        (c.snooze_until && new Date(c.snooze_until) <= now && Number(c.call_attempts) > 0);

      return {
        ...c,
        is_registered: isRegistered,
        paid_status: paidStatus,
        is_pro: isPro,
        district: u?.district || e?.district || '-',
        local_body: u?.local_body || e?.panchayat_or_corporation || e?.union_or_municipality || '-',
        ward_number: u?.ward_id || e?.ward_number || '-',
        position: u?.position || e?.position || '-',
        passcode: u?.password_str || e?.passcode || '-',
        snooze_until: c.snooze_until || null,
        next_call_at: c.next_call_at || null,
        call_attempts: Number(c.call_attempts) || 0,
        archived: !!c.archived,
        is_snoozed: isSnoozed,
        is_due: isDue,
      };
    });

    return res.json({
      success: true,
      total,
      page: Number(page),
      conversations: enriched,
    });
  } catch (err) {
    console.error('[CRM listConversations Error]:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to fetch conversations.' });
  }
}

/**
 * GET /api/crm/conversations/:phone — Get chat message history
 */
export async function getConversationHistory(req, res) {
  try {
    const db = getAppDb();
    const { phone } = req.params;
    const cleanMobile = String(phone).replace(/\D/g, '').slice(-10);

    if (!(await agentCanAccess(db, req, cleanMobile))) {
      return res.status(403).json({ success: false, message: 'This conversation is not assigned to you.' });
    }

    // Reset unread count for this thread
    await db.collection('tbl_crm_conversation').updateOne(
      { clean_mobile: cleanMobile },
      { $set: { unread_count: 0 } }
    );

    const messages = await db
      .collection('tbl_crm_message')
      .find({ clean_mobile: cleanMobile })
      .sort({ created_at: 1 })
      .toArray();

    // Fetch flow assets map to attach header images/videos to conversation messages
    const flowAssets = await db.collection('app_flow_images').find({}).toArray();
    const assetMap = {};
    for (const a of flowAssets) {
      if (a.key && a.url) {
        let url = String(a.url).replace(/^http:\/\//, 'https://');
        assetMap[a.key] = {
          headerUrl: url,
          headerType: a.type || (url.includes('.mp4') ? 'video' : 'image'),
        };
      }
    }

    const DEFAULT_HEADER = 'https://tnedms.com/EDM.png';

    const enrichedMessages = messages.map((m) => {
      const meta = m.metadata || {};
      let headerUrl = meta.headerUrl;
      let headerType = meta.headerType;
      let headerText = meta.headerText;

      const txt = m.body || '';

      if (!headerUrl) {
        if (meta.action === 'sent_credentials' || meta.action === 'manual_crm_sent_credentials' || txt.includes('Welcome back') || txt.includes('Passcode')) {
          const wb = assetMap['welcome_back_header'] || assetMap['register_success_header'];
          headerUrl = wb ? wb.headerUrl : DEFAULT_HEADER;
          headerType = wb ? wb.headerType : 'image';
          headerText = headerText || 'Welcome Back';
        } else if (meta.action === 'sent_registration_flow' || txt.includes('Register to access') || txt.includes('Tap the button below')) {
          const reg = assetMap['register_header'];
          headerUrl = reg ? reg.headerUrl : DEFAULT_HEADER;
          headerType = reg ? reg.headerType : 'image';
          headerText = headerText || 'Candidate Registration';
        } else if (meta.action === 'flow_registration_success' || txt.includes('Registration Complete') || txt.includes('registered successfully')) {
          const succ = assetMap['register_success_header'] || assetMap['welcome_back_header'];
          headerUrl = succ ? succ.headerUrl : DEFAULT_HEADER;
          headerType = succ ? succ.headerType : 'image';
          headerText = headerText || 'Registration Complete';
        }
      }

      return {
        ...m,
        metadata: {
          ...meta,
          headerUrl: headerUrl || undefined,
          headerType: headerType || undefined,
          headerText: headerText || undefined,
        },
      };
    });

    // Fetch contact details from tbl_user / tbl_enquiry / tbl_crm_conversation
    const [user, enquiry, conv] = await Promise.all([
      db.collection('tbl_user').findOne({ mobile_no: cleanMobile }),
      db.collection('tbl_enquiry').findOne({ mobile: cleanMobile }),
      db.collection('tbl_crm_conversation').findOne({ clean_mobile: cleanMobile }),
    ]);

    const paidStatus = user?.paid_status || enquiry?.paid_status || 'No';
    const isPro = String(paidStatus).toLowerCase() === 'yes';

    // Resolve assembly name + selected booths (register form now uses
    // District -> Assembly -> Booth(s) instead of ward/local body).
    const assemblyId = user?.assembly_id || enquiry?.assembly_id || null;
    let assemblyName = '-';
    if (assemblyId) {
      const asm = await db.collection('tbl_assembly_consitituency').findOne({ assembly_no: parseInt(assemblyId, 10) });
      assemblyName = asm ? (asm.assembly_name || `Assembly ${assemblyId}`) : String(assemblyId);
    }
    const boothsRaw = user?.booths || enquiry?.booths || [];
    const booths = Array.isArray(boothsRaw) ? boothsRaw.map(String) : (boothsRaw ? [String(boothsRaw)] : []);

    const contact = {
      phone: String(phone).replace(/\D/g, ''),
      clean_mobile: cleanMobile,
      name: user ? [user.first_name, user.last_name].filter(Boolean).join(' ') : (enquiry?.full_name || enquiry?.firstname || conv?.contact_name || `User ${cleanMobile.slice(-4)}`),
      is_registered: !!(user || enquiry),
      paid_status: paidStatus,
      is_pro: isPro,
      district: user?.district || enquiry?.district || '-',
      assembly: assemblyName,
      booths,
      position: user?.position || enquiry?.position || '-',
      passcode: user?.password_str || enquiry?.passcode || '-',
      lead_status: conv?.lead_status || 'none',
      agent_notes: conv?.agent_notes || '',
      assigned_agent_name: conv?.assigned_agent_name || conv?.last_handled_by || '-',
      status_history: Array.isArray(conv?.status_history) ? conv.status_history : [],
    };

    // WhatsApp 24h/72h messaging window (drives the CRM chat timer & lock).
    const windowInfo = await resolveWindow(db, cleanMobile, conv);
    Object.assign(contact, windowInfo);

    return res.json({
      success: true,
      contact,
      messages: enrichedMessages,
    });
  } catch (err) {
    console.error('[CRM getConversationHistory Error]:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to fetch message history.' });
  }
}

/**
 * POST /api/crm/messages/send — Send direct text message from CRM UI
 */
export async function sendMessage(req, res) {
  try {
    const { phone, message } = req.body;
    if (!phone || !message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Phone number and message text are required.' });
    }

    const cleanMobile = String(phone).replace(/\D/g, '').slice(-10);
    const targetPhone = String(phone).replace(/\D/g, '');

    const db = getAppDb();
    if (!(await agentCanAccess(db, req, cleanMobile))) {
      return res.status(403).json({ success: false, message: 'This conversation is not assigned to you.' });
    }

    // Enforce the WhatsApp messaging window — free-form replies are only allowed
    // while the 24h/72h window from the user's last message is still open.
    const conv = await db.collection('tbl_crm_conversation').findOne({ clean_mobile: cleanMobile });
    const win = await resolveWindow(db, cleanMobile, conv);
    // No active window -> locked. This covers both an expired window and a thread
    // where the user has never messaged us (no window was ever opened). Free-form
    // sends are only allowed while the 24h/72h window is open; use a template otherwise.
    if (!win.window_active) {
      return res.status(403).json({
        success: false,
        code: 'window_closed',
        message: 'The WhatsApp messaging window is closed. You can send a free-form message only after the user messages you (within their 24h/72h window). Use a Template to reach out now.',
      });
    }

    // Call WhatsApp Meta API
    const replyTo = req.body.reply_to || null;
    const replyPreview = req.body.reply_preview || null;
    const result = await sendText(targetPhone, message.trim(), replyTo);
    const waMessageId = result?.messages?.[0]?.id;

    // Save message to CRM thread
    await saveCrmMessage({
      phone: targetPhone,
      direction: 'outgoing',
      type: 'text',
      body: message.trim(),
      waMessageId,
      metadata: replyPreview ? { reply_to: replyTo, reply_preview: replyPreview } : {},
    });

    return res.json({
      success: true,
      message: 'WhatsApp message sent successfully.',
      result,
    });
  } catch (err) {
    console.error('[CRM sendMessage Error]:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to send WhatsApp message.' });
  }
}

/**
 * POST /api/crm/send-credentials — Send login credentials button message via WhatsApp
 */
export async function sendCredentials(req, res) {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Phone number is required.' });
    }

    const db = getAppDb();
    const cleanMobile = String(phone).replace(/\D/g, '').slice(-10);
    const targetPhone = String(phone).replace(/\D/g, '');

    if (!(await agentCanAccess(db, req, cleanMobile))) {
      return res.status(403).json({ success: false, message: 'This conversation is not assigned to you.' });
    }

    const user = await db.collection('tbl_user').findOne({ mobile_no: cleanMobile });
    const enquiry = await db.collection('tbl_enquiry').findOne({ mobile: cleanMobile });

    if (!user && !enquiry) {
      return res.status(404).json({ success: false, message: 'Candidate registration not found.' });
    }

    const name = user ? [user.first_name, user.last_name].filter(Boolean).join(' ') : (enquiry?.full_name || enquiry?.firstname || 'Candidate');
    const passcode = user?.password_str || enquiry?.passcode || cleanMobile;

    // Outside the messaging window, free-form/interactive isn't allowed — fall
    // back to the approved 'login_credentials' template with the live values.
    const credWin = await resolveWindow(db, cleanMobile);
    if (!credWin.window_active) {
      try {
        // edms_welcome has an IMAGE header + one body var ({{1}} = name) — both
        // must be supplied at send time or Meta rejects with (#132000).
        const credAsset = (await db.collection('app_flow_images').findOne({ key: 'welcome_back_header' })) || (await db.collection('app_flow_images').findOne({ key: 'register_success_header' }));
        let credHeaderUrl = credAsset?.url ? String(credAsset.url).replace(/^http:\/\//, 'https://') : 'https://tnedms.com/EDM.png';
        if (credAsset?.type === 'video' || /\.mp4($|\?)/i.test(credHeaderUrl)) credHeaderUrl = 'https://tnedms.com/EDM.png';
        // Window closed: send the approved 'edms_welcome' template (image header +
        // Login button). WhatsApp does not allow the passcode inside a template,
        // so it's a login nudge; the passcode is delivered inside the window.
        const tplResult = await sendTemplateMessage(targetPhone, {
          name: WELCOME_TEMPLATE,
          language: 'en',
          bodyParams: [name],
          headerImageUrl: credHeaderUrl,
        });
        await saveCrmMessage({
          phone: targetPhone,
          direction: 'outgoing',
          type: 'template',
          body: `Welcome back ${name}! 👋\n\nYou are registered on EDMS. Tap the button below to log in to your Election Management Dashboard.`,
          waMessageId: tplResult?.messages?.[0]?.id,
          contactName: name,
          metadata: { action: 'sent_credentials', username: cleanMobile, passcode, headerUrl: credHeaderUrl, headerType: 'image', btnText: 'Login Now', btnUrl: 'https://tnedms.com/login' },
        });
        return res.json({ success: true, message: `Login nudge sent to ${name} via approved template (window closed). The passcode isn't allowed inside templates by WhatsApp — it's shared inside the messaging window.`, result: tplResult });
      } catch (e) {
        const isBilling = e.code === 131042 || e.code === 131044 || /payment method|payment|billing/i.test(e.message || '');
        if (isBilling) {
          return res.status(402).json({ success: false, code: 'no_payment_method', message: 'Cannot send the template — your WhatsApp Business account has no payment method set up. Add one in Meta Business Settings → WhatsApp Manager → Billing & payments, then try again.' });
        }
        return res.status(400).json({ success: false, message: `Window closed and template send failed: ${e.message}. Ensure the '${WELCOME_TEMPLATE}' template is Approved (Templates panel).` });
      }
    }

    const defaultCredText = `Hello *{name}*!\n\nHere are your login credentials for the Election Management Portal:\n\n🔑 *Username:* \`{username}\`\n🔒 *Passcode:* \`{passcode}\`\n\nTap below to sign in:`;
    const bodyText = await getFlowMessageText('welcome_back_text', defaultCredText, {
      name,
      username: cleanMobile,
      passcode,
    });

    const asset = (await db.collection('app_flow_images').findOne({ key: 'welcome_back_header' })) || (await db.collection('app_flow_images').findOne({ key: 'register_success_header' }));
    let headerUrl = asset?.url ? String(asset.url).replace(/^http:\/\//, 'https://') : null;
    let headerType = asset?.type || (headerUrl?.includes('.mp4') ? 'video' : 'image');

    const result = await sendUrlButtonMessage(targetPhone, {
      bodyText,
      headerText: 'Login Credentials',
      btnText: 'Login Now',
      btnUrl: 'https://tnedms.com/login',
      headerUrl,
      headerType: headerUrl ? headerType : 'text',
    });

    await saveCrmMessage({
      phone: targetPhone,
      direction: 'outgoing',
      type: 'interactive',
      body: bodyText,
      waMessageId: result?.messages?.[0]?.id,
      contactName: name,
      metadata: { action: 'manual_crm_sent_credentials', passcode, username: cleanMobile },
    });

    return res.json({
      success: true,
      message: `Credentials sent to ${name} (${cleanMobile}) via WhatsApp!`,
      result,
    });
  } catch (err) {
    console.error('[CRM sendCredentials Error]:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to send credentials.' });
  }
}

/**
 * POST /api/crm/send-flow — Send Meta WhatsApp Flow registration message via WhatsApp
 */
export async function sendFlow(req, res) {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Phone number is required.' });
    }

    const db = getAppDb();
    const cleanMobile = String(phone).replace(/\D/g, '').slice(-10);
    const targetPhone = String(phone).replace(/\D/g, '');

    if (!(await agentCanAccess(db, req, cleanMobile))) {
      return res.status(403).json({ success: false, message: 'This conversation is not assigned to you.' });
    }

    // Outside the window the interactive flow can't be sent — fall back to the
    // approved 'candidate_registration' template (Register Now button).
    const flowWin = await resolveWindow(db, cleanMobile);
    if (!flowWin.window_active) {
      try {
        const regHdrAsset = await db.collection('app_flow_images').findOne({ key: 'register_header' });
        let regHeaderUrl = regHdrAsset?.url ? String(regHdrAsset.url).replace(/^http:\/\//, 'https://') : 'https://tnedms.com/EDM.png';
        if (regHdrAsset?.type === 'video' || /\.mp4($|\?)/i.test(regHeaderUrl)) regHeaderUrl = 'https://tnedms.com/EDM.png';

        // The registration template's CTA is a WhatsApp Flow button — tapping it
        // opens the in-WhatsApp registration form.
        const tplResult = await sendTemplateMessage(targetPhone, {
          name: REGISTER_FLOW_TEMPLATE,
          language: 'en',
          headerImageUrl: regHeaderUrl,
          flowButton: { index: 0, flowToken: `register_${targetPhone}` },
        });
        await saveCrmMessage({
          phone: targetPhone,
          direction: 'outgoing',
          type: 'template',
          body: '🗳️ Registration invite sent via template (Register Now).',
          waMessageId: tplResult?.messages?.[0]?.id,
          metadata: { action: 'sent_registration_flow', template_name: REGISTER_FLOW_TEMPLATE, flowCta: 'Register Now', headerUrl: regHeaderUrl, headerType: 'image' },
        });
        return res.json({ success: true, message: 'Registration invite sent via approved template (window closed).', result: tplResult });
      } catch (e) {
        const isBilling = e.code === 131042 || e.code === 131044 || /payment method|payment|billing/i.test(e.message || '');
        if (isBilling) {
          return res.status(402).json({ success: false, code: 'no_payment_method', message: 'Cannot send the template — your WhatsApp Business account has no payment method set up. Add one in Meta Business Settings → WhatsApp Manager → Billing & payments, then try again.' });
        }
        return res.status(400).json({ success: false, message: `Window closed and template send failed: ${e.message}. Ensure a registration template is Approved (Templates panel).` });
      }
    }

    const defaultRegText = `Welcome! Register to access constituency insights, voter patterns, campaign tools, and local body election support.\n\nTap the button below to fill out the registration form inside WhatsApp.`;
    const bodyText = await getFlowMessageText('register_welcome_text', defaultRegText);

    const asset = await db.collection('app_flow_images').findOne({ key: 'register_header' });
    let headerUrl = asset?.url ? String(asset.url).replace(/^http:\/\//, 'https://') : null;
    let headerType = asset?.type || (headerUrl?.includes('.mp4') ? 'video' : 'image');

    const result = await sendFlowMessage(targetPhone, {
      flowCta: 'Register Now 🗳️',
      bodyText,
      headerText: 'Candidate Registration',
      flowToken: `register_${cleanMobile}`,
      headerUrl: headerUrl || undefined,
      headerType: headerUrl ? headerType : 'text',
    });

    await saveCrmMessage({
      phone: targetPhone,
      direction: 'outgoing',
      type: 'interactive',
      body: bodyText,
      waMessageId: result?.messages?.[0]?.id,
      contactName: `User ${cleanMobile.slice(-4)}`,
      metadata: {
        action: 'sent_registration_flow',
        headerUrl,
        headerType: headerUrl ? headerType : 'text',
        headerText: 'Candidate Registration',
        flowCta: 'Register Now 🗳️',
      },
    });

    return res.json({
      success: true,
      message: `WhatsApp Flow registration message sent to ${cleanMobile}!`,
      result,
    });
  } catch (err) {
    console.error('[CRM sendFlow Error]:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to send WhatsApp Flow.' });
  }
}

/**
 * POST /api/crm/conversations/:phone/lead-status — Update CRM Lead Status (interested, not_interested, call_completed, pro_user)
 */
export async function updateLeadStatus(req, res) {
  try {
    const db = getAppDb();
    const { phone } = req.params;
    const { lead_status } = req.body;
    const cleanMobile = String(phone).replace(/\D/g, '').slice(-10);

    const validStatuses = [
      'new', 'assigned', 'contacted',
      'interested',
      'not_interested',
      'first_call_complete',
      'second_call_complete',
      'third_call_complete',
      'switch_off',
      'not_answered',
      'will_call_back',
      'call_back',
      'unreachable',
      'call_completed',
      'registration_incomplete',
      'registration_completed',
      'converted',
      'none',
    ];
    if (!validStatuses.includes(lead_status)) {
      return res.status(400).json({ success: false, message: 'Invalid lead status.' });
    }

    if (!(await agentCanAccess(db, req, cleanMobile))) {
      return res.status(403).json({ success: false, message: 'This conversation is not assigned to you.' });
    }

    const agentName = req.user?.name || 'Admin';
    const agentId = currentAgentId(req) || 'admin';

    const note = String(req.body.note || '').trim();
    const updateDoc = {
      lead_status,
      last_handled_by: agentName,
      updated_at: new Date(),
    };
    if (typeof req.body.agent_notes !== 'undefined') {
      updateDoc.agent_notes = String(req.body.agent_notes || '').trim();
    }

    // Load existing lead details and candidate profile
    const existing = await db
      .collection('tbl_crm_conversation')
      .findOne({ clean_mobile: cleanMobile });

    const [candidateUser, candidateEnquiry] = await Promise.all([
      db.collection('tbl_user').findOne({ mobile_no: cleanMobile }),
      db.collection('tbl_enquiry').findOne({ mobile: cleanMobile }),
    ]);
    const candidateName = candidateUser?.first_name || candidateEnquiry?.full_name || existing?.contact_name || 'Candidate';
    const isRegisteredUser = !!(candidateUser || candidateEnquiry);

    let currentAttempts = Number(existing?.call_attempts) || 0;
    let effectiveStatus = lead_status;

    // --- Task 2: Auto-Snooze & 3-Strike Rule ---
    if (lead_status === 'not_answered' || lead_status === 'switch_off') {
      currentAttempts += 1;
      updateDoc.call_attempts = currentAttempts;

      if (currentAttempts >= 3) {
        // 3rd strike! Automatically retire to unreachable to keep queues clean
        effectiveStatus = 'unreachable';
        updateDoc.lead_status = 'unreachable';
        updateDoc.archived = true;
        updateDoc.archived_at = new Date();
        updateDoc.archive_reason = '3 strikes (unreachable after 3 call attempts)';
        updateDoc.snooze_until = null;
        updateDoc.next_call_at = null;
        updateDoc.agent_notes = (updateDoc.agent_notes ? updateDoc.agent_notes + ' ' : '') + '[Auto-retired after 3 missed attempts]';
      } else {
        // Snooze for 3 hours (or custom snooze_hours) so it re-appears later
        const snoozeHours = Math.max(1, Number(req.body.snooze_hours) || 3);
        const snoozeTime = new Date(Date.now() + snoozeHours * 3600 * 1000);
        updateDoc.snooze_until = snoozeTime;
        updateDoc.next_call_at = snoozeTime;
      }
    } else if (lead_status === 'call_back') {
      const cbDate = req.body.callback_at ? new Date(req.body.callback_at) : new Date(Date.now() + 3 * 3600 * 1000);
      updateDoc.next_call_at = cbDate;
      updateDoc.snooze_until = cbDate;
    } else if (['interested', 'converted', 'registration_completed'].includes(lead_status)) {
      updateDoc.snooze_until = null;
      updateDoc.call_attempts = 0;
    }

    // Preserve the round-robin owner; only claim ownership if none is set yet.
    if (!existing?.assigned_agent_id) {
      updateDoc.assigned_agent_id = agentId;
      updateDoc.assigned_agent_name = agentName;
    }

    // Append to the status-change history log (every click is recorded, even
    // repeats of the same status — e.g. calling the same lead twice).
    let historyNote = note;
    if (effectiveStatus === 'unreachable' && currentAttempts >= 3) {
      historyNote = (historyNote ? historyNote + ' ' : '') + '[System: Auto-retired to Unreachable after 3 attempts]';
    } else if ((lead_status === 'not_answered' || lead_status === 'switch_off') && updateDoc.snooze_until) {
      historyNote = (historyNote ? historyNote + ' ' : '') + `[System: Snoozed for 3h · Attempt #${currentAttempts}]`;
    } else if (lead_status === 'call_back' && updateDoc.next_call_at) {
      historyNote = (historyNote ? historyNote + ' ' : '') + `[Scheduled Callback for ${updateDoc.next_call_at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}]`;
    }

    const historyEntry = { status: effectiveStatus, note: historyNote, by: agentName, at: new Date() };
    await db.collection('tbl_crm_conversation').updateOne(
      { clean_mobile: cleanMobile },
      { $set: updateDoc, $push: { status_history: historyEntry } }
    );

    // --- Task 1: Instant Post-Call WhatsApp Drop ---
    let waSent = false;
    let waError = null;
    let waText = '';

    if (req.body.send_whatsapp) {
      const firstName = String(candidateName).trim().split(/\s+/)[0] || 'வணக்கம்';
      const waType = req.body.whatsapp_type || (isRegisteredUser ? 'pro_pitch' : 'incomplete_guide');

      if (waType === 'incomplete_guide') {
        waText = `வணக்கம் ${firstName}! 🗳️\n\nEDMS Election Management Portal-ல் உங்கள் பூத் மற்றும் வாக்காளர் விவரங்களை அணுக, கீழ்க்கண்ட லிங்க் மூலம் பதிவை உடனே முடிக்கவும்:\n👉 https://tnedms.com/register?mobile=${cleanMobile}\n\nஉங்களுக்கு ஏதேனும் உதவி தேவைப்பட்டால் இந்த எண்ணில் பதிலளிக்கவும் அல்லது எங்களை அழைக்கவும்.`;
      } else if (waType === 'pro_pitch') {
        waText = `வணக்கம் ${firstName}! 🚀\n\nநன்றி! EDMS Pro Plan மூலம் நீங்கள் பெறக்கூடிய நன்மைகள்:\n✅ உங்கள் தொகுதி/வார்டு முழு வாக்காளர் பட்டியல் & குடும்ப விவரங்கள்\n✅ பூத் வாரியான வாக்காளர் சீட்டு பிரிண்டிங் (Booth Slips)\n✅ களப்பணியாளர் மொபைல் ஆப் (Ward Surveyor App)\n\n👉 லாகின் செய்ய: https://tnedms.com/login\n💳 உடனடி ஆக்டிவேஷன்: UPI மூலம் செலுத்தலாம் (UPI ID: 9940136163@okbizaxis)\n\nஏதேனும் சந்தேகம் இருந்தால் உடனடியாக அழைக்கவும்!`;
      } else {
        waText = String(req.body.whatsapp_text || '').trim();
      }

      if (waText) {
        try {
          if (wactoConfigured()) {
            await sendWactoText(cleanMobile, waText);
          } else {
            await sendText(cleanMobile, waText);
          }
          waSent = true;
        } catch (e) {
          console.warn(`[CRM updateLeadStatus] WhatsApp send notice for ${cleanMobile}:`, e.message);
          waError = e.message;
        }

        // Always save message in conversation history so the agent sees it
        try {
          await saveCrmMessage({
            phone: cleanMobile,
            direction: 'outgoing',
            type: 'text',
            body: waText,
            contactName: candidateName,
          });
        } catch (e) {
          console.warn('[CRM updateLeadStatus] saveCrmMessage warning:', e.message);
        }
      }
    }

    return res.json({
      success: true,
      message: `Lead status updated to '${effectiveStatus}' by ${agentName}.` + (waSent ? ' WhatsApp message dispatched.' : ''),
      lead_status: effectiveStatus,
      snoozed: !!updateDoc.snooze_until,
      snooze_until: updateDoc.snooze_until,
      next_call_at: updateDoc.next_call_at,
      archived: !!updateDoc.archived,
      whatsapp: { sent: waSent, error: waError, text: waText },
    });
  } catch (err) {
    console.error('[CRM updateLeadStatus Error]:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to update lead status.' });
  }
}

/**
 * POST /api/crm/conversations/:phone/notes — Update agent notes/comments for candidate
 */
export async function updateLeadNotes(req, res) {
  try {
    const db = getAppDb();
    const { phone } = req.params;
    const { agent_notes } = req.body;
    const cleanMobile = String(phone).replace(/\D/g, '').slice(-10);

    if (!(await agentCanAccess(db, req, cleanMobile))) {
      return res.status(403).json({ success: false, message: 'This conversation is not assigned to you.' });
    }

    const agentName = req.user?.name || 'Admin';
    const agentId = currentAgentId(req) || 'admin';

    const setDoc = {
      agent_notes: String(agent_notes || '').trim(),
      last_handled_by: agentName,
      updated_at: new Date(),
    };
    const existing = await db
      .collection('tbl_crm_conversation')
      .findOne({ clean_mobile: cleanMobile }, { projection: { assigned_agent_id: 1 } });
    if (!existing?.assigned_agent_id) {
      setDoc.assigned_agent_id = agentId;
      setDoc.assigned_agent_name = agentName;
    }

    await db.collection('tbl_crm_conversation').updateOne(
      { clean_mobile: cleanMobile },
      { $set: setDoc }
    );

    return res.json({
      success: true,
      message: 'Agent notes/comments saved successfully!',
    });
  } catch (err) {
    console.error('[CRM updateLeadNotes Error]:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to save notes.' });
  }
}

/**
 * POST /api/crm/conversations/:phone/status — Update thread status (open, resolved, archived)
 */
export async function updateStatus(req, res) {
  try {
    const db = getAppDb();
    const { phone } = req.params;
    const { status } = req.body;
    const cleanMobile = String(phone).replace(/\D/g, '').slice(-10);

    if (!['open', 'resolved', 'archived'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status. Must be open, resolved, or archived.' });
    }

    if (!(await agentCanAccess(db, req, cleanMobile))) {
      return res.status(403).json({ success: false, message: 'This conversation is not assigned to you.' });
    }

    await db.collection('tbl_crm_conversation').updateOne(
      { clean_mobile: cleanMobile },
      { $set: { status, updated_at: new Date() } }
    );

    return res.json({ success: true, message: `Conversation status updated to ${status}.` });
  } catch (err) {
    console.error('[CRM updateStatus Error]:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to update conversation status.' });
  }
}

/**
 * GET /api/crm/agents — Active CRM agents (for admin assign dropdown). Admin only.
 */
export async function listAgents(req, res) {
  try {
    if (isCrmAgent(req)) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }
    const db = getAppDb();
    const agents = await getActiveAgents(db);
    return res.json({ success: true, agents });
  } catch (err) {
    console.error('[CRM listAgents Error]:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to list agents.' });
  }
}

/**
 * Core round-robin distribution. Shared by the Distribute button and the
 * scheduled auto-distribute job. Returns { assigned, per_agent, agents }.
 */
export async function runDistribute(db, { reassignAll = false } = {}) {
  const agents = await getActiveAgents(db);
  if (!agents.length) return { assigned: 0, agents: 0, per_agent: {}, reason: 'no_agents' };

  const filter = reassignAll
    ? {}
    : { $or: [{ assigned_agent_id: { $exists: false } }, { assigned_agent_id: null }, { assigned_agent_id: '' }] };
  const convos = await db
    .collection('tbl_crm_conversation')
    .find(filter, { projection: { clean_mobile: 1 } })
    .sort({ last_message_at: -1 })
    .toArray();
  if (!convos.length) return { assigned: 0, agents: agents.length, per_agent: {} };

  const state = await db.collection('tbl_crm_settings').findOne({ _id: 'round_robin' });
  let idx = 0;
  if (state?.last_agent_id) {
    const pos = agents.findIndex((a) => a.id === String(state.last_agent_id));
    idx = pos === -1 ? 0 : (pos + 1) % agents.length;
  }

  const perAgent = {};
  const now = new Date();
  const ops = convos.map((c) => {
    const agent = agents[idx % agents.length];
    idx += 1;
    perAgent[agent.name] = (perAgent[agent.name] || 0) + 1;
    const entry = { status: 'assigned', note: `Round-robin → ${agent.name}`, by: 'System', at: now, source: 'distribute' };
    return {
      updateOne: {
        filter: { clean_mobile: c.clean_mobile },
        update: {
          $set: { assigned_agent_id: agent.id, assigned_agent_name: agent.name, assigned_at: now, assigned_by: 'distribute', taken: false, updated_at: now },
          $push: { assignment_history: entry },
        },
      },
    };
  });
  if (ops.length) {
    await db.collection('tbl_crm_conversation').bulkWrite(ops, { ordered: false });
    // Also sync assignment into tbl_leads
    const leadOps = convos.map((c, i) => {
      const agent = agents[(idx - ops.length + i) % agents.length];
      return {
        updateOne: {
          filter: { mobile: c.clean_mobile },
          update: { $set: { assigned_agent_id: agent.id, assigned_agent_name: agent.name, updated_at: now } },
        },
      };
    });
    try { await db.collection('tbl_leads').bulkWrite(leadOps, { ordered: false }); } catch { /* best effort */ }
  }
  const lastAgent = agents[(idx - 1 + agents.length) % agents.length];
  await db.collection('tbl_crm_settings').updateOne({ _id: 'round_robin' }, { $set: { last_agent_id: lastAgent.id, updated_at: now } }, { upsert: true });
  return { assigned: ops.length, agents: agents.length, per_agent: perAgent };
}

/**
 * POST /api/crm/distribute-leads — Distribute conversations round-robin. Admin only.
 * Body: { reassign_all?: true }.
 */
export async function distributeLeads(req, res) {
  try {
    if (isCrmAgent(req)) return res.status(403).json({ success: false, message: 'Not authorized.' });
    const db = getAppDb();
    const r = await runDistribute(db, { reassignAll: req.body?.reassign_all === true });
    if (r.reason === 'no_agents') {
      return res.status(400).json({ success: false, message: 'No active team members to assign leads to. Create/activate a team member first.' });
    }
    return res.json({
      success: true,
      message: r.assigned ? `Distributed ${r.assigned} conversation(s) across ${r.agents} team member(s).` : 'No conversations needed distribution.',
      assigned: r.assigned, per_agent: r.per_agent,
    });
  } catch (err) {
    console.error('[CRM distributeLeads Error]:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to distribute leads.' });
  }
}

/**
 * POST /api/crm/conversations/:phone/assign — Manually (re)assign to an active
 * agent. Admin only. Admin reassignment overrides a "taken" lock. Body: { agent_id }.
 */
export async function assignConversation(req, res) {
  try {
    if (isCrmAgent(req)) return res.status(403).json({ success: false, message: 'Not authorized.' });
    const db = getAppDb();
    const { phone } = req.params;
    const { agent_id } = req.body;
    const cleanMobile = String(phone).replace(/\D/g, '').slice(-10);

    const agents = await getActiveAgents(db);
    const agent = agents.find((a) => a.id === String(agent_id));
    if (!agent) return res.status(400).json({ success: false, message: 'Invalid or inactive team member.' });

    const now = new Date();
    const entry = { status: 'assigned', note: `Assigned → ${agent.name}`, by: req.user?.name || 'Admin', at: now, source: 'manual' };

    // Fetch contact info if not yet in tbl_crm_conversation
    const existingLead = await db.collection('tbl_leads').findOne({ mobile: cleanMobile });
    const existingUser = await db.collection('tbl_user').findOne({ mobile_no: cleanMobile });
    const contactName = existingUser?.first_name || existingUser?.name || existingLead?.web_name || existingLead?.wa_name || `Lead ${cleanMobile.slice(-4)}`;

    await db.collection('tbl_crm_conversation').updateOne(
      { clean_mobile: cleanMobile },
      {
        $set: {
          assigned_agent_id: agent.id,
          assigned_agent_name: agent.name,
          assigned_at: now,
          assigned_by: 'manual',
          taken: false,
          updated_at: now,
          contact_name: contactName,
        },
        $setOnInsert: {
          clean_mobile: cleanMobile,
          source: existingUser ? 'website' : (existingLead?.sources?.[0] || 'website'),
          lead_status: existingUser ? 'registered' : 'new',
          is_registered: !!existingUser,
          taken: false,
          unread_count: 0,
          created_at: now,
        },
        $push: { assignment_history: entry },
      },
      { upsert: true }
    );

    // Also sync into tbl_leads
    await db.collection('tbl_leads').updateOne(
      { mobile: cleanMobile },
      { $set: { assigned_agent_id: agent.id, assigned_agent_name: agent.name, updated_at: now.toISOString() } }
    ).catch(() => {});

    return res.json({ success: true, message: `Lead assigned to ${agent.name}.`, agent });
  } catch (err) {
    console.error('[CRM assignConversation Error]:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to assign conversation.' });
  }
}

/**
 * POST /api/crm/sync-recordings — pull the real TeleCMI call logs + recordings
 * for every telecaller that has TeleCMI credentials, and import them into the CRM
 * threads (deduped by cmiuid). Admin only. Body: { days? } (default 3, max 30).
 */
export async function syncTelecmiRecordings(req, res) {
  try {
    const db = getAppDb();
    const days = Math.min(30, Math.max(1, Number(req.body?.days) || 3));
    const from = Date.now() - days * 86400000;
    const to = Date.now();
    // A telecaller syncs only their OWN recordings; an admin syncs the whole team.
    let agents;
    if (isCrmAgent(req)) {
      const me = await findById(currentAgentId(req)).catch(() => null);
      agents = me && me.telecmi_id && me.telecmi_password ? [me] : [];
      if (!agents.length) return res.status(400).json({ success: false, message: 'No TeleCMI softphone is set on your account — ask the admin to add it in Team Members.' });
    } else {
      agents = await db.collection('tbl_user').find({ user_group_id: ROLES.CRM_AGENT, telecmi_id: { $nin: [null, ''] }, telecmi_password: { $nin: [null, ''] } }).toArray();
      if (!agents.length) return res.status(400).json({ success: false, message: 'No telecaller has TeleCMI credentials set — add a TeleCMI User ID + softphone password in Team Members.' });
    }

    let imported = 0, skipped = 0;
    for (const a of agents) {
      const agentName = [a.first_name, a.last_name].filter(Boolean).join(' ') || a.user_name;
      let cdrs;
      try { cdrs = await fetchUserCdr({ userId: a.telecmi_id, password: a.telecmi_password, from, to }); }
      catch (e) { console.warn('[sync-recordings]', a.user_name, e.message); continue; }
      for (const c of cdrs) {
        if (!c.number || c.number.length !== 10) { skipped += 1; continue; }
        // Dedup: skip if this call was already logged — by the live CDR webhook's
        // uuid OR by the recording filename (the webhook stores a different uuid
        // field than the user-CDR API, so match the filename too to avoid doubles).
        const dupOr = [];
        if (c.cmiuid) dupOr.push({ 'metadata.cmiuuid': c.cmiuid });
        if (c.filename) dupOr.push({ 'metadata.recording': c.filename });
        if (dupOr.length && await db.collection('tbl_crm_message').findOne({ $or: dupOr }, { projection: { _id: 1 } })) { skipped += 1; continue; }
        const at = new Date(c.time);
        const body = c.answered ? `${c.direction === 'outgoing' ? 'Outgoing' : 'Incoming'} call answered (${c.duration}s)` : `${c.direction === 'outgoing' ? 'Outgoing' : 'Incoming'} call missed`;
        await db.collection('tbl_crm_message').insertOne({
          clean_mobile: c.number, phone: `91${c.number}`, direction: c.direction === 'outgoing' ? 'outgoing' : 'incoming',
          type: 'call', body, created_at: at,
          metadata: { telecmi: true, cmiuuid: c.cmiuid, recording: c.filename, answeredsec: c.duration, agent: agentName, imported: true },
        });
        await db.collection('tbl_crm_conversation').updateOne(
          { clean_mobile: c.number },
          {
            $push: { status_history: { status: c.answered ? 'call_completed' : 'not_answered', note: `${c.direction} ${c.duration}s`, by: agentName, at, source: 'telecmi', direction: c.direction, duration: c.duration, recording: c.filename } },
            $set: { last_message: body, last_message_at: at, updated_at: new Date() },
            $setOnInsert: { clean_mobile: c.number, phone: `91${c.number}`, contact_name: c.name && c.name !== 'unknown' ? c.name : `Caller ${c.number.slice(-4)}`, status: 'open', lead_status: 'none', unread_count: 0, created_at: at },
          },
          { upsert: true },
        );
        imported += 1;
      }
    }
    return res.json({ success: true, imported, skipped, message: `Imported ${imported} call(s) from TeleCMI${skipped ? ` (${skipped} already synced)` : ''}.` });
  } catch (e) {
    console.error('[sync-recordings]', e.message);
    return res.status(500).json({ success: false, message: e.message || 'Sync failed.' });
  }
}

/**
 * GET/PUT /api/crm/settings — the Super-Admin assignment configuration
 * (round-robin / manual switches, claim-unassigned, auto-distribute schedule).
 */
export async function getCrmSettings(req, res) {
  try {
    const config = await loadCrmConfig(getAppDb());
    return res.json({ success: true, config });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}
export async function updateCrmSettings(req, res) {
  try {
    const config = await saveCrmConfig(getAppDb(), req.body || {}, req.user?.name || 'Admin');
    return res.json({ success: true, config, message: 'Assignment settings saved.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * POST /api/crm/conversations/:phone/claim — a telecaller takes ownership of an
 * UNASSIGNED lead (only when claim-unassigned is enabled). Marks it "Taken" and
 * blocks duplicate ownership — an already-owned lead can't be claimed by another.
 */
export async function claimLead(req, res) {
  try {
    const db = getAppDb();
    const { phone } = req.params;
    const cleanMobile = String(phone).replace(/\D/g, '').slice(-10);
    const config = await loadCrmConfig(db);

    const isAdmin = Number(req.user?.group_id) === ROLES.SUPER_ADMIN;
    if (!isAdmin && !config.claim_unassigned) {
      return res.status(403).json({ success: false, message: 'Claiming leads is turned off. Ask the admin to assign leads to you.' });
    }
    const meId = currentAgentId(req);
    const meName = req.user?.name || 'Agent';

    const conv = await db.collection('tbl_crm_conversation').findOne({ clean_mobile: cleanMobile }, { projection: { assigned_agent_id: 1, assigned_agent_name: 1 } });
    if (!conv) return res.status(404).json({ success: false, message: 'Lead not found.' });
    if (conv.assigned_agent_id && String(conv.assigned_agent_id) !== meId && !isAdmin) {
      return res.status(409).json({ success: false, message: `Already taken by ${conv.assigned_agent_name || 'another telecaller'}.` });
    }

    const now = new Date();
    const entry = { status: 'assigned', note: `Claimed by ${meName}`, by: meName, at: now, source: 'claim' };
    await db.collection('tbl_crm_conversation').updateOne(
      { clean_mobile: cleanMobile },
      {
        $set: { assigned_agent_id: meId, assigned_agent_name: meName, assigned_at: now, assigned_by: 'claim', taken: true, taken_by: meName, taken_at: now, updated_at: now },
        $push: { assignment_history: entry },
      },
    );
    return res.json({ success: true, message: 'Lead is yours now.' });
  } catch (err) {
    console.error('[CRM claimLead Error]:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to claim lead.' });
  }
}

/**
 * POST /api/crm/conversations/:phone/send-media — Upload an attachment to
 * Cloudinary and send it as a WhatsApp image/video/document. Free-form media,
 * so only allowed while the messaging window is open. Body: { filename, mime, fileBase64, caption }
 */
export async function sendMedia(req, res) {
  try {
    const db = getAppDb();
    const { phone } = req.params;
    const { filename, mime, fileBase64, caption } = req.body || {};
    const cleanMobile = String(phone).replace(/\D/g, '').slice(-10);
    const targetPhone = String(phone).replace(/\D/g, '');

    if (!(await agentCanAccess(db, req, cleanMobile))) {
      return res.status(403).json({ success: false, message: 'This conversation is not assigned to you.' });
    }
    if (!fileBase64) {
      return res.status(400).json({ success: false, message: 'No file provided.' });
    }

    const conv = await db.collection('tbl_crm_conversation').findOne({ clean_mobile: cleanMobile });
    const win = await resolveWindow(db, cleanMobile, conv);
    if (win.window_expires_at && !win.window_active) {
      return res.status(403).json({ success: false, code: 'window_closed', message: 'Messaging window closed — attachments can only be sent while the window is open. Use an approved template instead.' });
    }

    const mimeStr = String(mime || '');
    const isVideo = mimeStr.includes('video');
    const isImage = mimeStr.includes('image');
    const mediaType = isVideo ? 'video' : isImage ? 'image' : 'document';
    const resourceType = isVideo ? 'video' : isImage ? 'image' : 'auto';

    const b64 = String(fileBase64).replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(b64, 'base64');
    const uploaded = await cloudinary.upload(buffer, filename || 'attachment', resourceType, 'crm-attachments');

    const result = await sendMediaMessage(targetPhone, {
      mediaUrl: uploaded.url,
      mediaType,
      caption: caption || '',
      filename,
    });

    await saveCrmMessage({
      phone: targetPhone,
      direction: 'outgoing',
      type: mediaType,
      body: caption || `[${mediaType} attachment]`,
      waMessageId: result?.messages?.[0]?.id,
      metadata: {
        action: 'sent_media',
        headerUrl: uploaded.url,
        headerType: mediaType === 'video' ? 'video' : mediaType === 'image' ? 'image' : undefined,
      },
    });

    return res.json({ success: true, message: 'Attachment sent.', url: uploaded.url });
  } catch (err) {
    console.error('[CRM sendMedia Error]:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to send attachment.' });
  }
}

/**
 * GET /api/crm/team-stats — Dashboard stats for the logged-in team member
 * (their assigned leads). Admins see all. Returns { total, interested,
 * not_interested, pro }.
 */
export async function teamStats(req, res) {
  try {
    const db = getAppDb();
    // Agents see their own leads; a super-admin may pass ?agent_id= to view one telecaller's.
    const filter = isCrmAgent(req)
      ? { assigned_agent_id: currentAgentId(req) }
      : (req.query.agent_id ? { assigned_agent_id: String(req.query.agent_id) } : {});
    const convos = await db
      .collection('tbl_crm_conversation')
      .find(filter, { projection: { clean_mobile: 1, lead_status: 1, is_registered: 1, status_history: 1 } })
      .toArray();

    const total = convos.length;
    const interested = convos.filter((c) => c.lead_status === 'interested').length;
    const not_interested = convos.filter((c) => c.lead_status === 'not_interested').length;
    const converted = convos.filter((c) => ['converted', 'registration_completed'].includes(c.lead_status)).length;
    const contacted = convos.filter((c) => c.lead_status && c.lead_status !== 'none' && c.lead_status !== 'new').length;
    const pending = total - contacted;
    const conversion_rate = total ? Math.round((converted / total) * 100) : 0;

    // Registered / Pro computed live (a lead is registered if it exists in tbl_user
    // or tbl_enquiry; pro if its tbl_user record is paid) — same rule as the lead list,
    // so the dashboard never disagrees with the conversation rows.
    let pro = 0, registered = 0;
    const mobiles = convos.map((c) => c.clean_mobile).filter(Boolean);
    if (mobiles.length) {
      const [regUsers, regEnq, paidUsers] = await Promise.all([
        db.collection('tbl_user').distinct('mobile_no', { mobile_no: { $in: mobiles } }),
        db.collection('tbl_enquiry').distinct('mobile', { mobile: { $in: mobiles } }),
        db.collection('tbl_user').countDocuments({ mobile_no: { $in: mobiles }, paid_status: { $in: PAID_VALUES } }),
      ]);
      const regSet = new Set([...regUsers, ...regEnq].map(String));
      registered = mobiles.filter((m) => regSet.has(String(m))).length;
      pro = paidUsers;
    }

    // Statuses that count as a completed call (telecaller may call the same lead up to 3 times).
    const CALL_STATUSES = ['first_call_complete', 'second_call_complete', 'third_call_complete', 'call_completed'];
    // Status distribution for the chart
    const CHART_STATUSES = ['interested', 'not_interested', 'first_call_complete', 'second_call_complete', 'third_call_complete', 'call_completed', 'switch_off', 'not_answered', 'will_call_back'];
    const status_breakdown = CHART_STATUSES.map((s) => ({ status: s, count: convos.filter((c) => c.lead_status === s).length }));

    // Calls-completed metrics from the status history log
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const last7 = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(startToday); d.setDate(d.getDate() - i);
      last7.push({ key: d.toISOString().slice(0, 10), label: d.toLocaleDateString('en-US', { weekday: 'short' }), count: 0 });
    }
    const last7Map = Object.fromEntries(last7.map((x) => [x.key, x]));
    let calls_today = 0, calls_total = 0;
    for (const c of convos) {
      for (const h of (c.status_history || [])) {
        if (CALL_STATUSES.includes(h.status)) {
          calls_total += 1;
          const at = new Date(h.at);
          if (at >= startToday) calls_today += 1;
          const key = at.toISOString().slice(0, 10);
          if (last7Map[key]) last7Map[key].count += 1;
        }
      }
    }
    return res.json({ success: true, stats: { total, interested, not_interested, converted, contacted, pending, conversion_rate, pro, registered, calls_today, calls_total, status_breakdown, calls_last_7_days: last7.map(({ label, count, key }) => ({ label, count, key })) } });
  } catch (err) {
    console.error('[CRM teamStats Error]:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to load stats.' });
  }
}

/**
 * GET /api/crm/team-report — Lead list for the logged-in team member, used for
 * the report table and PDF export.
 */
export async function teamReport(req, res) {
  try {
    const db = getAppDb();
    // Agents see their own leads; a super-admin may pass ?agent_id= to view one telecaller's.
    const filter = isCrmAgent(req)
      ? { assigned_agent_id: currentAgentId(req) }
      : (req.query.agent_id ? { assigned_agent_id: String(req.query.agent_id) } : {});
    const { from, to } = req.query;
    const fromMs = from ? new Date(from).getTime() : null;
    const toMs = to ? new Date(to).getTime() : null;
    const hasRange = fromMs !== null || toMs !== null;
    const inRange = (d) => {
      if (!d) return false;
      const t = new Date(d).getTime();
      if (fromMs !== null && t < fromMs) return false;
      if (toMs !== null && t > toMs) return false;
      return true;
    };
    const convos = await db
      .collection('tbl_crm_conversation')
      .find(filter)
      .sort({ last_message_at: -1 })
      .toArray();

    // Enrich with registered user and pro status
    const mobiles = convos.map((c) => c.clean_mobile).filter(Boolean);
    const [users, enquiries] = await Promise.all([
      db.collection('tbl_user').find({ mobile_no: { $in: mobiles } }).toArray(),
      db.collection('tbl_enquiry').find({ mobile: { $in: mobiles } }).toArray(),
    ]);
    const userByMobile = Object.fromEntries(users.map((u) => [u.mobile_no, u]));
    const enquiryByMobile = Object.fromEntries(enquiries.map((e) => [e.mobile, e]));

    const rows = [];
    for (const c of convos) {
      const history = Array.isArray(c.status_history) ? c.status_history : [];
      const periodChanges = hasRange ? history.filter((h) => inRange(h.at)) : history;
      const activityInRange = hasRange ? inRange(c.last_message_at) : true;
      if (hasRange && periodChanges.length === 0 && !activityInRange) continue;
      const latest = periodChanges.length ? periodChanges[periodChanges.length - 1] : null;

      const u = userByMobile[c.clean_mobile];
      const e = enquiryByMobile[c.clean_mobile];
      const isRegistered = !!(u || e);
      const isPro = String(u?.paid_status || e?.paid_status || '').toLowerCase() === 'yes';

      const talkSec = periodChanges.reduce((sum, h) => sum + (Number(h.duration) || 0), 0);

      rows.push({
        name: c.contact_name || u?.first_name || e?.full_name || `User ${String(c.clean_mobile || '').slice(-4)}`,
        mobile: c.clean_mobile,
        lead_status: latest ? latest.status : (c.lead_status || 'none'),
        status_changes: periodChanges.length,
        status_timeline: periodChanges.map((h) => ({ status: h.status, at: h.at, note: h.note || '', by: h.by || '', duration: h.duration || 0 })),
        note: latest?.note || '',
        is_registered: isRegistered,
        is_pro: isPro,
        talk_seconds: talkSec,
        call_attempts: Number(c.call_attempts) || 0,
        archived: !!c.archived,
        agent: c.assigned_agent_name || '-',
        last_activity: c.last_message_at || null,
        last_status_at: latest ? latest.at : null,
      });
    }

    return res.json({ success: true, agent: req.user?.name || 'Team', generated_at: new Date(), rows });
  } catch (err) {
    console.error('[CRM teamReport Error]:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to load report.' });
  }
}

/**
 * POST /api/crm/conversations/:phone/call — Click-to-call the lead via TeleCMI.
 * The logged-in telecaller's phone rings first, then TeleCMI dials the lead.
 * Uses the caller's stored TeleCMI User ID (set by the admin in Team Members).
 */
export async function callLead(req, res) {
  try {
    const db = getAppDb();
    const { phone } = req.params;
    const cleanMobile = String(phone).replace(/\D/g, '').slice(-10);

    if (!(await agentCanAccess(db, req, cleanMobile))) {
      return res.status(403).json({ success: false, message: 'This conversation is not assigned to you.' });
    }

    // Which TeleCMI agent's phone rings first:
    //  - a telecaller calls through their own TeleCMI id;
    //  - an admin rings the lead's ASSIGNED telecaller (so the right person talks to the lead).
    let telecmiId = null;
    let agentLabel = req.user?.name || 'Agent';
    const isAdmin = Number(req.user?.group_id) === ROLES.SUPER_ADMIN;

    if (!isAdmin && req.user?.sub && req.user.sub !== 'admin') {
      const u = await findById(req.user.sub).catch(() => null);
      telecmiId = u?.telecmi_id || null;
      if (!telecmiId) {
        return res.status(400).json({ success: false, message: 'No TeleCMI User ID is set on your account. Ask the admin to add it in Team Members.' });
      }
    } else {
      // Admin: use the lead's assigned telecaller (or ?telecmi_id= to force one).
      const conv = await db.collection('tbl_crm_conversation').findOne({ clean_mobile: cleanMobile }, { projection: { assigned_agent_id: 1, assigned_agent_name: 1 } });
      if (conv?.assigned_agent_id) {
        const owner = await findById(conv.assigned_agent_id).catch(() => null);
        telecmiId = owner?.telecmi_id || null;
        if (conv.assigned_agent_name) agentLabel = conv.assigned_agent_name;
      }
      if (!telecmiId && req.query.telecmi_id) telecmiId = String(req.query.telecmi_id);
      if (!telecmiId) {
        return res.status(400).json({
          success: false,
          message: conv?.assigned_agent_id
            ? `This lead's telecaller (${conv.assigned_agent_name || 'assigned agent'}) has no TeleCMI User ID. Add it in Team Members.`
            : 'This lead has no assigned telecaller. Assign it to a telecaller (who has a TeleCMI User ID), then call.',
        });
      }
    }
    const meName = agentLabel;

    // web:true → ring the agent's browser softphone (webrtc) instead of their mobile.
    // Either way click2call passes the caller id (the DID) per call, so the lead sees it.
    const web = req.body?.web === true;
    const result = await click2call({ userId: telecmiId, to: cleanMobile, followme: !web });

    await saveCrmMessage({
      phone: String(phone).replace(/\D/g, '') || cleanMobile,
      direction: 'outgoing',
      type: 'call',
      body: web ? '📞 Web call started — connecting through the browser.' : '📞 Click-to-call started — your phone rings first, then connects to the lead.',
      metadata: { telecmi: true, action: web ? 'web_call' : 'click_to_call', request_id: result.request_id, by: meName },
    }).catch(() => {});

    return res.json({ success: true, web, message: web ? 'Connecting your web phone to the lead…' : 'Calling — your phone will ring first, then connect to the lead.', request_id: result.request_id });
  } catch (e) {
    console.error('[CRM callLead Error]:', e.message);
    return res.status(400).json({ success: false, message: e.message || 'Could not start the call.' });
  }
}

/**
 * GET /api/crm/softphone — Browser-softphone (WebRTC) credentials for the logged-in
 * telecaller, so the CRM can register the PIOPIY web phone and place/receive calls
 * straight from the browser (no mobile ring). Only ever returns the caller's OWN creds.
 */
export async function softphoneCreds(req, res) {
  try {
    const sbc = process.env.TELECMI_SBC || 'sbcind.telecmi.com';
    const caller_id = process.env.TELECMI_CALLER_ID || '';
    if (Number(req.user?.group_id) === ROLES.SUPER_ADMIN || !req.user?.sub || req.user.sub === 'admin') {
      return res.json({ success: true, softphone: null, reason: 'admin', message: 'Admins have no web softphone — sign in as a telecaller to call from the browser.' });
    }
    const u = await findById(req.user.sub).catch(() => null);
    if (!u?.telecmi_id || !u?.telecmi_password) {
      return res.json({ success: true, softphone: null, reason: 'missing', message: 'No TeleCMI softphone credentials set on your account. Ask the admin to add your TeleCMI User ID and password in Team Members.' });
    }
    return res.json({
      success: true,
      softphone: { user_id: u.telecmi_id, password: u.telecmi_password, sbc, caller_id, name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.user_name },
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message || 'Could not load softphone credentials.' });
  }
}

/**
 * POST /api/crm/conversations/:phone/call-log — Record a browser-softphone call's
 * outcome into the lead history (the web SDK handles the audio; this logs the result).
 * Body: { outcome: 'answered'|'missed'|'failed', seconds, note }
 */
export async function logSoftphoneCall(req, res) {
  try {
    const db = getAppDb();
    const { phone } = req.params;
    const cleanMobile = String(phone).replace(/\D/g, '').slice(-10);
    if (!(await agentCanAccess(db, req, cleanMobile))) {
      return res.status(403).json({ success: false, message: 'This conversation is not assigned to you.' });
    }
    const outcome = String(req.body?.outcome || 'answered');
    const seconds = Number(req.body?.seconds || 0);
    const by = req.user?.name || 'Agent';
    const status = outcome === 'answered' ? 'call_completed' : (outcome === 'missed' ? 'not_answered' : 'not_answered');
    const note = `web call · ${outcome}${seconds ? ` · ${seconds}s` : ''}${req.body?.note ? ` · ${String(req.body.note).trim()}` : ''}`;
    await db.collection('tbl_crm_conversation').updateOne(
      { clean_mobile: cleanMobile },
      { $push: { status_history: { status, note, by, at: new Date(), source: 'softphone', direction: 'outbound', duration: seconds } }, $set: { updated_at: new Date() } },
    );
    await saveCrmMessage({
      phone: String(phone).replace(/\D/g, '') || cleanMobile,
      direction: 'outgoing', type: 'call',
      body: `📞 Web call ${outcome}${seconds ? ` (${seconds}s)` : ''}`,
      metadata: { softphone: true, outcome, seconds, by },
    }).catch(() => {});
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/**
 * POST /api/crm/conversations/:phone/react — React to a message with an emoji.
 * Body: { message_id (wamid), emoji }
 */
export async function reactToMessage(req, res) {
  try {
    const db = getAppDb();
    const { phone } = req.params;
    const { message_id, emoji } = req.body || {};
    const cleanMobile = String(phone).replace(/\D/g, '').slice(-10);
    const targetPhone = String(phone).replace(/\D/g, '');

    if (!(await agentCanAccess(db, req, cleanMobile))) {
      return res.status(403).json({ success: false, message: 'This conversation is not assigned to you.' });
    }
    if (!message_id) return res.status(400).json({ success: false, message: 'message_id is required.' });

    await sendReaction(targetPhone, message_id, emoji || '');
    await db.collection('tbl_crm_message').updateOne(
      { wa_message_id: message_id, clean_mobile: cleanMobile },
      { $set: { 'metadata.reaction': emoji || '' } }
    );

    return res.json({ success: true, emoji: emoji || '' });
  } catch (err) {
    console.error('[CRM reactToMessage Error]:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to react.' });
  }
}

// Parse a Cloudinary secure_url into { publicId, resourceType } for deletion.
function cloudinaryInfoFromUrl(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('res.cloudinary.com')) return null;
    const parts = u.pathname.split('/').filter(Boolean); // [cloud, resType, 'upload', (vNNN?), ...publicId, name.ext]
    const resourceType = parts[1];
    const uploadIdx = parts.indexOf('upload');
    if (uploadIdx === -1) return null;
    let rest = parts.slice(uploadIdx + 1);
    if (rest[0] && /^v\d+$/.test(rest[0])) rest = rest.slice(1);
    const publicId = rest.join('/').replace(/\.[^/.]+$/, '');
    return { publicId, resourceType };
  } catch {
    return null;
  }
}

/**
 * DELETE /api/crm/conversations/:phone/clear — Clear a chat: delete all messages
 * and remove this chat's own media from Cloudinary (only crm-incoming /
 * crm-attachments folders — never the shared flow assets). Keeps the contact,
 * lead status and agent assignment.
 */
export async function clearChat(req, res) {
  try {
    const db = getAppDb();
    const { phone } = req.params;
    const cleanMobile = String(phone).replace(/\D/g, '').slice(-10);

    if (!(await agentCanAccess(db, req, cleanMobile))) {
      return res.status(403).json({ success: false, message: 'This conversation is not assigned to you.' });
    }

    const msgs = await db.collection('tbl_crm_message').find({ clean_mobile: cleanMobile }).toArray();

    let deletedMedia = 0;
    for (const m of msgs) {
      const meta = m.metadata || {};
      const url = meta.mediaUrl || (meta.action === 'sent_media' ? meta.headerUrl : null);
      if (!url) continue;
      const info = cloudinaryInfoFromUrl(url);
      // Only remove per-chat uploads, never shared flow-asset headers.
      if (info?.publicId && (info.publicId.startsWith('crm-incoming') || info.publicId.startsWith('crm-attachments'))) {
        const ok = await cloudinary.destroy(info.publicId, info.resourceType || 'image');
        if (ok) deletedMedia += 1;
      }
    }

    await db.collection('tbl_crm_message').deleteMany({ clean_mobile: cleanMobile });
    await db.collection('tbl_crm_conversation').updateOne(
      { clean_mobile: cleanMobile },
      { $set: { last_message: '', unread_count: 0, updated_at: new Date() } }
    );

    return res.json({ success: true, deletedMessages: msgs.length, deletedMedia });
  } catch (err) {
    console.error('[CRM clearChat Error]:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to clear chat.' });
  }
}

/**
 * GET /api/crm/admin/daily-digest — Preview today's 8:00 PM performance digest
 */
export async function getDailyDigest(req, res) {
  try {
    const db = getAppDb();
    const { generateDailyDigestData } = await import('../services/crmScheduler.js');
    const digest = await generateDailyDigestData(db);
    return res.json({ success: true, digest });
  } catch (err) {
    console.error('[CRM getDailyDigest Error]:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to generate digest.' });
  }
}

/**
 * POST /api/crm/admin/daily-digest/send — Manually trigger today's digest to admin
 */
export async function sendDailyDigestNow(req, res) {
  try {
    const db = getAppDb();
    const { dispatchDailyDigest } = await import('../services/crmScheduler.js');
    const targetPhone = req.body.phone || null;
    const result = await dispatchDailyDigest(db, { force: true, targetPhone });
    return res.json({ success: true, result });
  } catch (err) {
    console.error('[CRM sendDailyDigestNow Error]:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to send digest.' });
  }
}

