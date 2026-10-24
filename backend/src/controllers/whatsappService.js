const fetch = globalThis.fetch;

function formatPhoneForWhatsApp(to) {
  let phone = String(to || '').replace(/\D/g, '');
  if (phone.length === 10) {
    phone = '91' + phone; // Add 91 country code prefix for 10-digit Indian numbers
  }
  return phone;
}

function getMetaConfig() {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
  const wabaId = process.env.META_WABA_ID;
  const version = process.env.META_GRAPH_VERSION || 'v22.0';

  if (!accessToken || !phoneNumberId) {
    throw new Error('Meta API credentials (META_ACCESS_TOKEN, META_PHONE_NUMBER_ID) missing in environment.');
  }

  return {
    accessToken,
    phoneNumberId,
    wabaId,
    version,
    messagesUrl: `https://graph.facebook.com/${version}/${phoneNumberId}/messages`,
  };
}

/**
 * Send a plain text WhatsApp message.
 */
export async function sendText(to, text) {
  const cfg = getMetaConfig();
  const phone = formatPhoneForWhatsApp(to);

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone,
    type: 'text',
    text: {
      body: text,
      preview_url: false,
    },
  };

  const res = await fetch(cfg.messagesUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfg.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('[WhatsApp API Error - sendText]:', data);
    throw new Error(data.error?.message || 'Failed to send WhatsApp text message.');
  }

  return data;
}

/**
 * Send interactive Flow message with registration form.
 */
export async function sendFlowMessage(to, options = {}) {
  const cfg = getMetaConfig();
  const phone = formatPhoneForWhatsApp(to);

  const flowId = options.flowId || process.env.WHATSAPP_FLOW_ID || '1003285115645097';
  const flowCta = options.flowCta || 'Register Now 🗳️';
  const flowToken = options.flowToken || `register_${phone}`;
  const rawBody = options.bodyText || 'Welcome! Register to access constituency insights, voter patterns, campaign tools, and local body election support.\n\nTap the button below to fill out the registration form inside WhatsApp.';
  const bodyText = String(rawBody).slice(0, 1024);
  const footerText = options.footerText || 'Election Data Management';

  const headerType = options.headerType || 'text';
  const headerUrl = options.headerUrl || null;
  const headerText = options.headerText || 'Candidate Registration';

  let header = { type: 'text', text: headerText.slice(0, 60) };
  if (headerType === 'video' && headerUrl) {
    header = { type: 'video', video: { link: headerUrl } };
  } else if (headerType === 'image' && headerUrl) {
    header = { type: 'image', image: { link: headerUrl } };
  }

  const flowStatus = (process.env.WHATSAPP_FLOW_STATUS || 'PUBLISHED').toUpperCase();
  const mode = flowStatus === 'PUBLISHED' ? 'published' : 'draft';

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone,
    type: 'interactive',
    interactive: {
      type: 'flow',
      header,
      body: { text: bodyText },
      footer: { text: footerText.slice(0, 60) },
      action: {
        name: 'flow',
        parameters: {
          flow_message_version: '3',
          flow_token: flowToken,
          flow_id: flowId,
          flow_cta: flowCta,
          mode,
          flow_action: 'navigate',
          flow_action_payload: {
            screen: 'WELCOME',
          },
        },
      },
    },
  };

  const res = await fetch(cfg.messagesUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfg.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('[WhatsApp API Error - sendFlowMessage]:', data);
    throw new Error(data.error?.message || 'Failed to send WhatsApp Flow message.');
  }

  return data;
}

/**
 * Send CTA URL button message (e.g. Welcome Back / Login Credentials).
 */
export async function sendUrlButtonMessage(to, options = {}) {
  const cfg = getMetaConfig();
  const phone = formatPhoneForWhatsApp(to);

  const bodyText = String(options.bodyText || '').slice(0, 1024);
  const headerUrl = options.headerUrl || null;
  const headerType = options.headerType || 'text';
  const headerText = options.headerText || 'Login Credentials';
  const btnText = options.btnText || 'Login Now';
  const btnUrl = options.btnUrl || 'https://tamilnadubjp.live/login';

  let header = { type: 'text', text: headerText.slice(0, 60) };
  if (headerType === 'image' && headerUrl) {
    header = { type: 'image', image: { link: headerUrl } };
  } else if (headerType === 'video' && headerUrl) {
    header = { type: 'video', video: { link: headerUrl } };
  }

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone,
    type: 'interactive',
    interactive: {
      type: 'cta_url',
      header,
      body: { text: bodyText },
      action: {
        name: 'cta_url',
        parameters: {
          display_text: btnText,
          url: btnUrl,
        },
      },
    },
  };

  const res = await fetch(cfg.messagesUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfg.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('[WhatsApp API Error - sendUrlButtonMessage]:', data);
    throw new Error(data.error?.message || 'Failed to send WhatsApp button message.');
  }

  return data;
}
