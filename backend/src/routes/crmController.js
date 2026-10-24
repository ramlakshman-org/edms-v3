import { getAppDb } from '../config/db.js';
import { sendText, sendUrlButtonMessage, sendFlowMessage } from '../services/whatsappService.js';
import { saveCrmMessage, getFlowMessageText } from './whatsappController.js';

/**
 * GET /api/crm/conversations — List CRM chat threads
 */
export async function listConversations(req, res) {
  try {
    const db = getAppDb();
    const { search = '', status = 'all', lead_status = 'all', page = 1, limit = 50 } = req.query;

    const query = {};
    if (status !== 'all') {
      query.status = status;
    }
    if (lead_status !== 'all') {
      query.lead_status = lead_status;
    }

    if (search.trim()) {
      const s = search.trim();
      query.$or = [
        { contact_name: { $regex: s, $options: 'i' } },
        { clean_mobile: { $regex: s, $options: 'i' } },
        { phone: { $regex: s, $options: 'i' } },
        { last_message: { $regex: s, $options: 'i' } },
      ];
    }

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

    const DEFAULT_HEADER = 'https://tamilnadubjp.live/EDM.png';

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

    const contact = {
      phone: String(phone).replace(/\D/g, ''),
      clean_mobile: cleanMobile,
      name: user ? [user.first_name, user.last_name].filter(Boolean).join(' ') : (enquiry?.full_name || enquiry?.firstname || conv?.contact_name || `User ${cleanMobile.slice(-4)}`),
      is_registered: !!(user || enquiry),
      paid_status: paidStatus,
      is_pro: isPro,
      district: user?.district || enquiry?.district || '-',
      local_body: user?.local_body || enquiry?.panchayat_or_corporation || enquiry?.union_or_municipality || '-',
      ward_number: user?.ward_id || enquiry?.ward_number || '-',
      position: user?.position || enquiry?.position || '-',
      passcode: user?.password_str || enquiry?.passcode || '-',
      lead_status: conv?.lead_status || 'none',
      agent_notes: conv?.agent_notes || '',
      assigned_agent_name: conv?.assigned_agent_name || conv?.last_handled_by || '-',
    };

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

    // Call WhatsApp Meta API
    const result = await sendText(targetPhone, message.trim());
    const waMessageId = result?.messages?.[0]?.id;

    // Save message to CRM thread
    await saveCrmMessage({
      phone: targetPhone,
      direction: 'outgoing',
      type: 'text',
      body: message.trim(),
      waMessageId,
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

    const user = await db.collection('tbl_user').findOne({ mobile_no: cleanMobile });
    const enquiry = await db.collection('tbl_enquiry').findOne({ mobile: cleanMobile });

    if (!user && !enquiry) {
      return res.status(404).json({ success: false, message: 'Candidate registration not found.' });
    }

    const name = user ? [user.first_name, user.last_name].filter(Boolean).join(' ') : (enquiry?.full_name || enquiry?.firstname || 'Candidate');
    const passcode = user?.password_str || enquiry?.passcode || cleanMobile;

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
      btnUrl: 'https://tamilnadubjp.live/login',
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
      'interested',
      'not_interested',
      'first_call_complete',
      'second_call_complete',
      'third_call_complete',
      'switch_off',
      'not_answered',
      'will_call_back',
      'call_completed',
      'none',
    ];
    if (!validStatuses.includes(lead_status)) {
      return res.status(400).json({ success: false, message: 'Invalid lead status.' });
    }

    const agentName = req.user?.name || 'Admin';
    const agentId = String(req.user?.sub || req.user?.id || 'admin');

    const updateDoc = {
      lead_status,
      assigned_agent_id: agentId,
      assigned_agent_name: agentName,
      last_handled_by: agentName,
      updated_at: new Date(),
    };
    if (typeof req.body.agent_notes !== 'undefined') {
      updateDoc.agent_notes = String(req.body.agent_notes || '').trim();
    }

    await db.collection('tbl_crm_conversation').updateOne(
      { clean_mobile: cleanMobile },
      { $set: updateDoc }
    );

    return res.json({
      success: true,
      message: `Lead status updated to '${lead_status}' by ${agentName}.`,
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

    const agentName = req.user?.name || 'Admin';
    const agentId = String(req.user?.sub || req.user?.id || 'admin');

    await db.collection('tbl_crm_conversation').updateOne(
      { clean_mobile: cleanMobile },
      {
        $set: {
          agent_notes: String(agent_notes || '').trim(),
          last_handled_by: agentName,
          assigned_agent_id: agentId,
          assigned_agent_name: agentName,
          updated_at: new Date(),
        },
      }
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
