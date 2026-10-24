import bcrypt from 'bcryptjs';
import { getAppDb } from '../config/db.js';
import { isPaid, paidFlag, PAID_VALUES } from '../utils/paid.js';
import { sendWactoText, sendWactoImage, sendWactoImageWithCaption } from '../services/wactoService.js';
import { getPaymentSettings } from '../services/paymentSettings.js';
import { loadBotContent, botText, botImage } from '../services/botContent.js';
import {
  mediaOf, fetchIncomingMedia, storeScreenshot, recordProof, extractUtr, boothCountOf,
  paymentMessage, proofReceivedMessage, proofUnknownUserMessage, proofAlreadyPaidMessage,
} from '../services/paymentProof.js';

import { blankUser, maxUserId } from '../models/userModel.js';
import { ROLES } from '../constants/roles.js';
import { touchLead, markLeadRegistered, stepOfSession } from '../services/leads.js';
import { DISTRICT_ASSEMBLIES } from '../constants/wactoAssemblies.js';
import { getFeatureSettings, isOnFor } from '../services/features.js';
import { onRegistered, optOut, payLater } from '../services/reminders.js';

// ── Known values from EDMS-WhatsApp bilingual chatbot ─────────────────────────

// Language select node sends exactly these two titles
const LANG_VALUES = new Set(['English', 'தமிழ்']);

const ROLE_VALUES = new Set(['Planning to Contest', 'Confirmed Candidate', 'Campaign Team Member', 'Party Functionary']);

const PARTY_VALUES = new Set([
  'TVK', 'DMK', 'AIADMK', 'BJP', 'INC', 'NTK', 'PMK', 'VCK', 'MDMK',
  'AMMK', 'DMDK', 'AISMK', 'Naam Tamilar Katchi', 'Other Party', 'Independent',
]);

const BODY_TYPE_VALUES = new Set(['Rural', 'Urban']);

// Expand abbreviated rural position titles (WhatsApp list rows max 24 chars) to full DB names
const POSITION_FULL_NAME = {
  'VP Ward Member': 'Village Panchayat Ward Member',
  'VP President':   'Village Panchayat President',
  'PU Ward Member': 'Panchayat Union Ward Member',
  'DP Ward Member': 'District Panchayat Ward Member',
};

const POSITION_VALUES = new Set([
  'VP Ward Member', 'VP President', 'PU Ward Member', 'DP Ward Member',
  'Village Panchayat Ward Member', 'Village Panchayat President',
  'Panchayat Union Ward Member', 'District Panchayat Ward Member',
  'Town Panchayat', 'Municipality', 'Corporation',
]);

const DISTRICT_VALUES = new Set([
  'Ariyalur', 'Chengalpattu', 'Chennai', 'Coimbatore', 'Cuddalore', 'Dharmapuri',
  'Dindigul', 'Erode', 'Kallakurichi', 'Kanchipuram', 'Kanyakumari', 'Karur',
  'Krishnagiri', 'Madurai', 'Mayiladuthurai', 'Nagapattinam', 'Namakkal', 'Nilgiris',
  'Perambalur', 'Pudukkottai', 'Ramanathapuram', 'Ranipet', 'Salem', 'Sivaganga',
  'Tenkasi', 'Thanjavur', 'Theni', 'Thoothukudi', 'Tiruchirappalli', 'Tirunelveli',
  'Tirupathur', 'Tiruppur', 'Tiruvallur', 'Tiruvannamalai', 'Tiruvarur', 'Vellore',
  'Viluppuram', 'Virudhunagar',
]);

// ── Tamil UI text → English DB value maps ─────────────────────────────────────
// DB always stores English values; Tamil input is mapped before writing.

const TAMIL_ROLE_MAP = {
  'உள்ளாட்சித் தேர்தலில் போட்டியிடத் திட்டமிட்டுள்ளேன்': 'Planning to Contest',
  'அதிகாரப்பூர்வ வேட்பாளர்':                              'Confirmed Candidate',
  'களப் பிரச்சாரக் குழு உறுப்பினர்':                      'Campaign Team Member',
  'கட்சி நிர்வாகி / பொறுப்பாளர்':                         'Party Functionary',
  // Short WACTO row titles (WhatsApp list rows max 24 chars)
  'போட்டியிட திட்டம்': 'Planning to Contest',
  'பிரச்சாரக் குழு':   'Campaign Team Member',
  'கட்சி நிர்வாகி':    'Party Functionary',
};

const TAMIL_BODY_TYPE_MAP = {
  'ஊரகப் பகுதி':    'Rural',
  'நகர்ப்புறப் பகுதி': 'Urban',
};

const TAMIL_POSITION_MAP = {
  'கிராம ஊராட்சி வார்டு உறுப்பினர்': 'Village Panchayat Ward Member',
  'கிராம ஊராட்சி தலைவர்':            'Village Panchayat President',
  'ஊராட்சி ஒன்றிய வார்டு உறுப்பினர்': 'Panchayat Union Ward Member',
  'மாவட்ட ஊராட்சி வார்டு உறுப்பினர்': 'District Panchayat Ward Member',
  'பேரூராட்சி':  'Town Panchayat',
  'நகராட்சி':    'Municipality',
  'மாநகராட்சி':  'Corporation',
  // Short WACTO row titles (WhatsApp list rows max 24 chars)
  'கிராம ஊராட்சி உறுப்பினர்': 'Village Panchayat Ward Member',
  'ஒன்றிய வார்டு உறுப்பினர்': 'Panchayat Union Ward Member',
  'மாவட்ட வார்டு உறுப்பினர்': 'District Panchayat Ward Member',
};

// Tamil party affiliation button labels
// (WhatsApp reply buttons max 20 chars — short forms are what WACTO sends)
const TAMIL_AFF_YES = new Set(['ஆம், கட்சி உள்ளது', 'ஆம், கட்சியுடன் இணைந்து செயல்படுகிறேன்']);
const TAMIL_AFF_NO  = new Set(['இல்லை, சுயேச்சை', 'இல்லை, சுயேச்சையாக செயல்படுகிறேன்']);

// Tamil party names that differ from the English WACTO row titles
const TAMIL_PARTY_MAP = {
  'நாம் தமிழர் கட்சி': 'Naam Tamilar Katchi',
  'பிற கட்சிகள்':      'Other Party',
};

// Tamil menu items → English canonical names (Register handled separately)
const TAMIL_MENU_MAP = {
  'எனது கணக்கு விவரங்கள்':         'My Credentials',
  'மாதிரி விளக்கம்':                'Demo',
  'பயன்பாடுகள்':                    'Benefits',
  'அடிக்கடி கேட்கப்படும் கேள்விகள்': 'FAQ',
  'கேள்வி பதில்கள்':                'FAQ',
  'இணையதளம்':                       'Website',
  'உதவி மையம்':                     'Support',
  'திட்டத்தை வாங்க':                'Purchase Plan',
  'சமூக வலைத்தள சேவை':             'Social Media',
};

// Tamil purchase plan display names (for bilingual confirmation messages)
const TAMIL_PLAN_NAMES = {
  '1 Booth':          '1 பூத்',
  'Up to 5 Booths':   '5 பூத் வரை',
  'Up to 10 Booths':  '10 பூத் வரை',
  'Up to 25 Booths':  '25 பூத் வரை',
  'Up to 100 Booths': '100 பூத் வரை',
};

// Navigation items to ignore — pure UI pagination, carry no data
const NAV_ITEMS = new Set([
  'More Districts', 'More Assemblies', 'More Parties', 'Button 1', 'Start Registration',
  // Tamil equivalents
  'மேலும் மாவட்டங்கள்', 'மேலும் சட்டமன்றங்கள்', 'மேலும் கட்சிகள்',
]);

// Flow v8 paging rows carry their own target so every title opens exactly one page:
// "More Districts (3/5)", "More in Salem →", "மேலும் மாவட்டங்கள் (3/5)", "மேலும்: Salem →"
const NAV_PATTERN = /^(More Districts \(\d\/\d\)|More in .+ →|மேலும் மாவட்டங்கள் \(\d\/\d\)|மேலும்: .+ →)$/;
const isNavItem = (text) => NAV_ITEMS.has(text) || NAV_PATTERN.test(text);

// Top-level menu selections (English canonical names only — Tamil is normalised before lookup)
const MENU_SELECTIONS = new Set([
  'My Credentials', 'Demo', 'Benefits', 'FAQ',
  'Website', 'Support', 'Purchase Plan', 'Social Media',
]);

const SESSION_TTL_MS = 30 * 60 * 1000;

// Support / Purchase Plan / Social Media: WACTO sends its image (intro) and we send the follow-up
// (list + "reply with…") at the same moment; WhatsApp does not keep their order. Waiting lets the
// image arrive first. The webhook is already acknowledged and the step already saved before the wait.
const FOLLOWUP_DELAY_MS = Number(process.env.WACTO_FOLLOWUP_DELAY_MS ?? 2000);
const pause = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

// The WACTO flow's root keywords (lower-cased): typing one restarts the chat at the language question
const RESTART_WORDS = new Set(['hi', 'hello', 'hey', 'start', 'menu', 'வணக்கம்']);

// ── Helpers ────────────────────────────────────────────────────────────────────

function extractSelection(msg) {
  if (msg.type === 'interactive') {
    const iv = msg.interactive;
    if (iv?.type === 'list_reply')   return iv.list_reply?.title?.trim()   || null;
    if (iv?.type === 'button_reply') return iv.button_reply?.title?.trim() || null;
  }
  if (msg.type === 'text') return msg.text?.body?.trim() || null;
  // A tap on a TEMPLATE's quick-reply button (Pay Now, Pay Later, Register now) — Meta's "button" message (2026-10-16)
  if (msg.type === 'button') return msg.button?.text?.trim() || msg.button?.payload?.trim() || null;
  return null;
}

function toMobile10(waPhone) {
  const d = String(waPhone).replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) return d.slice(2);
  if (d.length === 10) return d;
  return d;
}


// Language follows what the user tapped, so it survives session deletion/expiry.
// Shared labels (districts, party codes) return null and keep the current language.
const TAMIL_SCRIPT = /[஀-௿]/;
// "Register" buttons: the menu row, and the Demo video message's "Register now" (flow v17)
const REGISTER_LABELS = new Set(['Register', 'பதிவு செய்ய', 'Register now', 'இப்போதே பதிவு செய்க']);
const ENGLISH_LANG_LABELS = new Set(['English', 'Register', 'Register now', 'Main menu', ...MENU_SELECTIONS]);
function langFromLabel(label) {
  if (TAMIL_SCRIPT.test(label)) return 'ta';
  if (ENGLISH_LANG_LABELS.has(label)) return 'en';
  return null;
}

// One bubble (image + caption) — two separate sends can arrive out of order on WhatsApp.
async function sendImageWithText(phone, imageUrl, text) {
  try {
    await sendWactoImageWithCaption(phone, imageUrl, text);
  } catch (e) {
    console.warn('[WACTO Bot] caption send failed, sending separately:', e.message);
    await sendWactoImage(phone, imageUrl);
    await sendWactoText(phone, text);
  }
}

// ── Old-tap lock ───────────────────────────────────────────────────────────────
// WhatsApp keeps buttons/lists of old messages tappable and WACTO answers those taps itself.
// The backend therefore accepts a registration tap only when it answers the NEXT step; any other
// registration tap changes nothing and the user is told which step to continue with.

const isAssemblyOf = (district, text) => !!DISTRICT_ASSEMBLIES[district]?.includes(text);
const ALL_ASSEMBLIES = new Set(Object.values(DISTRICT_ASSEMBLIES).flat());

// Flow v10 district rows: "Dindigul District" / "Dindigul மாவட்டம்" — unique titles, so a same-name
// assembly tap ("Dindigul") no longer re-opens the district's list. Returns the plain district or null.
function districtFromLabel(text) {
  const m = /^(.+) (District|மாவட்டம்)$/.exec(text);
  return m && DISTRICT_VALUES.has(m[1]) ? m[1] : null;
}

// Which registration step a tapped label answers (null = not a registration answer)
function registrationStep(session, text) {
  if (TAMIL_ROLE_MAP[text] || ROLE_VALUES.has(text)) return 'role';
  if (TAMIL_AFF_YES.has(text) || TAMIL_AFF_NO.has(text) || text === 'Yes, have a party' || text === 'No, Independent') return 'party_affiliation';
  if (TAMIL_PARTY_MAP[text] || (PARTY_VALUES.has(text) && text !== 'Independent')) return 'party';
  if (TAMIL_BODY_TYPE_MAP[text] || BODY_TYPE_VALUES.has(text)) return 'body_type';
  if (TAMIL_POSITION_MAP[text] || POSITION_VALUES.has(text)) return 'position';
  if (districtFromLabel(text)) return 'district';   // a district row is never an assembly
  // Before districts: 23 assemblies share their district's name (e.g. Dindigul)
  if (session?.district && isAssemblyOf(session.district, text)) return 'assembly';
  if (DISTRICT_VALUES.has(text)) return 'district';
  if (ALL_ASSEMBLIES.has(text)) return 'assembly';
  return null;
}

function nextStep(s = {}) {
  if (!s.role) return 'role';
  if (!s.party_affiliation) return 'party_affiliation';
  if (s.party_affiliation === 'yes' && !s.party) return 'party';
  if (!s.body_type) return 'body_type';
  if (!s.position) return 'position';
  if (!s.district) return 'district';
  if (!s.assembly) return 'assembly';
  return 'booths';
}

// Step titles exactly as the WACTO flow shows them
const STEP_LABEL = {
  role:              ['Step 1 — Your Role', 'படி 1 — உங்கள் பங்கு'],
  party_affiliation: ['Step 2 — Party Affiliation', 'படி 2 — கட்சி இணைப்பு'],
  party:             ['Step 2 — Select your party', 'படி 2 — உங்கள் கட்சியைத் தேர்ந்தெடுக்கவும்'],
  body_type:         ['Step 3 — Local Body Type', 'படி 3 — உள்ளாட்சி அமைப்பு வகை'],
  position:          ['Step 4 — Position', 'படி 4 — பதவி'],
  district:          ['Step 5 — Select District', 'படி 5 — மாவட்டத்தைத் தேர்ந்தெடுக்கவும்'],
  assembly:          ['Step 6 — Assembly', 'படி 6 — சட்டமன்றத் தொகுதி'],
  booths:            ['type your booth numbers, e.g. 1, 5, 9', 'பூத் எண்களை உள்ளிடவும் (எ.கா. 1, 5, 9)'],
};

async function sendStepLocked(phone, session, step) {
  const [en, ta] = STEP_LABEL[step];
  await sendWactoText(phone, botText('reg_step_locked', session?.lang, { step: session?.lang === 'ta' ? ta : en }));
}

// After a warning WACTO may already show the next step and stay silent on the right answer,
// so the first correct answer after a warning gets an explicit pointer to the next step.
async function sendNextStep(phone, session, step) {
  const [en, ta] = STEP_LABEL[step];
  await sendWactoText(phone, botText('reg_next_step', session?.lang, { step: session?.lang === 'ta' ? ta : en }));
}

async function sendAlreadyRegistered(phone, session) {
  await sendWactoText(phone, botText('reg_already_registered', session?.lang, {}));
}

const isRegistered = async (db, phone) => !!(await db.collection('tbl_user').findOne({ mobile_no: toMobile10(phone) }))?.password_str;

// The bot never re-registers an existing user (that would reset their passcode)
async function finishRegistration(phone, session, contactName, coll, db) {
  await coll.deleteOne({ phone });
  if (await isRegistered(db, phone)) return sendAlreadyRegistered(phone, session);
  await completeRegistration(phone, session, contactName);
}

// ── Session update logic ───────────────────────────────────────────────────────

function applySelection(session, text) {
  // Language selection — store lang flag, no registration state change
  if (text === 'English') { session.lang = 'en'; return; }
  if (text === 'தமிழ்')   { session.lang = 'ta'; return; }

  // ── Tamil → English mappings (DB always stores English) ───────────────────
  const tRole = TAMIL_ROLE_MAP[text];
  if (tRole) { session.role = tRole; return; }

  if (TAMIL_AFF_YES.has(text)) { session.party_affiliation = 'yes'; return; }
  if (TAMIL_AFF_NO.has(text))  { session.party_affiliation = 'no'; session.party = 'Independent'; return; }

  const tParty = TAMIL_PARTY_MAP[text];
  if (tParty) { session.party = tParty; return; }

  const tBodyType = TAMIL_BODY_TYPE_MAP[text];
  if (tBodyType) {
    session.body_type = tBodyType;
    session.position = null; session.district = null; session.assembly = null;
    session.booth_count = null; session.booths = null; session.awaiting_booth_numbers = false;
    return;
  }

  const tPosition = TAMIL_POSITION_MAP[text];
  if (tPosition) {
    session.position = tPosition;
    session.district = null; session.assembly = null;
    session.booth_count = null; session.booths = null; session.awaiting_booth_numbers = false;
    return;
  }

  // ── English values (original logic unchanged) ──────────────────────────────
  if (ROLE_VALUES.has(text)) { session.role = text; return; }
  if (text === 'Yes, have a party') { session.party_affiliation = 'yes'; return; }
  if (text === 'No, Independent')   { session.party_affiliation = 'no'; session.party = 'Independent'; return; }
  if (PARTY_VALUES.has(text) && text !== 'Independent') { session.party = text; return; }
  if (BODY_TYPE_VALUES.has(text)) {
    session.body_type = text;
    session.position = null; session.district = null; session.assembly = null;
    session.booth_count = null; session.booths = null; session.awaiting_booth_numbers = false;
    return;
  }
  if (POSITION_VALUES.has(text)) {
    session.position = text;
    session.district = null; session.assembly = null;
    session.booth_count = null; session.booths = null; session.awaiting_booth_numbers = false;
    return;
  }
  const labelDistrict = districtFromLabel(text);   // "Dindigul District" / "Dindigul மாவட்டம்" → DB stores "Dindigul"
  if (labelDistrict) { session.district = labelDistrict; session.assembly = null; return; }
  // Once role+body_type+position+district are all set, the only remaining step is assembly —
  // and only an assembly of the picked district counts (an old district tap is not an assembly)
  if (session.role && session.body_type && session.position && session.district && isAssemblyOf(session.district, text)) {
    session.assembly = text; return;
  }
  if (DISTRICT_VALUES.has(text)) { session.district = text; session.assembly = null; return; }
}

function getRecommendedPlan(boothCount) {
  if (boothCount <= 1) return { name: '1 Booth',           price: '₹2,000'  };
  if (boothCount <= 5) return { name: 'Up to 5 Booths',   price: '₹5,000'  };
  if (boothCount <= 10) return { name: 'Up to 10 Booths', price: '₹10,000' };
  if (boothCount <= 25) return { name: 'Up to 25 Booths', price: '₹25,000' };
  return                       { name: 'Up to 100 Booths', price: '₹50,000' };
}

function isComplete(session) {
  return !!(session.role && session.body_type && session.position && session.district && session.assembly && session.booth_count);
}

// ── Top-level menu handlers ────────────────────────────────────────────────────
// selected is always the English canonical name (normalised by caller)

async function handleMenuSelection(phone, selected, db, coll, session) {
  const mobile = toMobile10(phone);
  const lang   = session?.lang || 'en';

  if (selected === 'My Credentials') {
    const user = await db.collection('tbl_user').findOne({ mobile_no: mobile });
    if (user?.password_str) {
      await sendImageWithText(phone, botImage('credentials'), botText('menu_credentials', session?.lang, { mobile, passcode: user.password_str }));
    } else {
      await sendWactoText(phone, botText('menu_no_account', session?.lang, { mobile }));
    }
    return;
  }

  if (selected === 'Demo')    return;
  if (selected === 'Benefits') return;
  if (selected === 'FAQ')     return;
  if (selected === 'Website') return;

  if (selected === 'Support') {
    await coll.updateOne(
      { phone },
      { $set: { phone, flow: 'support_issue', lang, updated_at: new Date() } },
      { upsert: true }
    );
    await pause(FOLLOWUP_DELAY_MS);
    await sendWactoText(phone, botText('menu_support_intro', session?.lang, {}));
    return;
  }

  if (selected === 'Purchase Plan') {
    await coll.updateOne(
      { phone },
      { $set: { phone, flow: 'purchase_select', lang, updated_at: new Date() } },
      { upsert: true }
    );
    await pause(FOLLOWUP_DELAY_MS);
    await sendWactoText(phone, botText('menu_purchase_plans', session?.lang, {}));
    return;
  }

  if (selected === 'Social Media') {
    await coll.updateOne(
      { phone },
      { $set: { phone, flow: 'social_service', lang, updated_at: new Date() } },
      { upsert: true }
    );
    await pause(FOLLOWUP_DELAY_MS);
    await sendWactoText(phone, botText('menu_social_intro', session?.lang, {}));
    return;
  }
}

// ── Registration on completion ─────────────────────────────────────────────────

async function completeRegistration(phone, session, contactName) {
  const mobile  = toMobile10(phone);
  const fullName = contactName || session.contact_name || mobile;
  const passcode = String(Math.floor(100000 + Math.random() * 900000));
  const db = getAppDb();

  try {
    let assembly_id = 0;
    let assembly_no = 0;
    if (session.assembly) {
      const words = session.assembly.replace(/[()]/g, '').trim().split(/\s+/);
      const nameRegex = new RegExp(words.join('.*'), 'i');
      const assemblyDoc = await db.collection('tbl_assembly_consitituency').findOne({ assembly_name: nameRegex });
      if (assemblyDoc) {
        assembly_id = assemblyDoc.assembly_no;
        assembly_no = assemblyDoc.assembly_no;
      }
    }

    const positionFull = POSITION_FULL_NAME[session.position] || session.position;

    const enquiry = {
      full_name: fullName, firstname: fullName, mobile,
      role: session.role, party: session.party || 'Independent',
      body_type: session.body_type, position: positionFull,
      district: session.district, district_id: session.district, assembly_name: session.assembly,
      assembly_id, assembly_no,
      ward_number: session.booth_ward || '',
      booth_count: session.booth_count || 0,
      booths: session.booths || [],
      passcode, source: 'whatsapp_bot',
    };

    const existing = await db.collection('tbl_enquiry').findOne({ mobile });
    if (existing) {
      await db.collection('tbl_enquiry').updateOne({ mobile }, { $set: enquiry });
    } else {
      await db.collection('tbl_enquiry').insertOne({ ...enquiry, created_at: new Date().toISOString() });
    }

    const userExists = await db.collection('tbl_user').findOne({ mobile_no: mobile });
    if (!userExists) {
      const id = (await maxUserId()) + 1;
      await db.collection('tbl_user').insertOne({
        ...blankUser(), id,
        user_group_id: ROLES.BOOTH_ALT,
        first_name: fullName, mobile_no: mobile,
        password_str: passcode,
        password: await bcrypt.hash(passcode, 10),
        district_id: session.district,
        assembly_id, assembly_no,
        candidate_type: session.body_type,
        position: positionFull,
        booth_count: session.booth_count || 0,
        booths: session.booths || [],
        is_user_login: true,
      });
    } else {
      await db.collection('tbl_user').updateOne({ mobile_no: mobile }, {
        $set: {
          password_str: passcode,
          password: await bcrypt.hash(passcode, 10),
          first_name: fullName,
          district_id: session.district,
          assembly_id, assembly_no,
          booth_count: session.booth_count || 0,
          booths: session.booths || [],
          is_user_login: true,
        },
      });
    }

    await markLeadRegistered(db, mobile);
    await onRegistered(db, { mobile, name: fullName, lang: session.lang, booth_count: session.booth_count, source: 'whatsapp' }); // payment-reminder clock (sends only when switched on)
    await sendImageWithText(phone, botImage('registration_complete'), botText('reg_complete', session?.lang, { name: fullName, mobile, passcode }));

    if (session.booth_count) {
      // 2026-10-17 (Ram's live test): WhatsApp delivered the QR before "Registration Complete" — two back-to-back
      // sends don't keep their order, so wait like the other follow-ups do
      await pause(FOLLOWUP_DELAY_MS);
      // UPI ID, QR image and proof instructions come from the admin "Payment setup" page.
      const pay = await getPaymentSettings(db);
      await sendImageWithText(phone, pay.qr_url, paymentMessage(pay, session.lang, { assembly: session.assembly, boothCount: session.booth_count }));
    }

    console.log(`[WACTO Bot] Registered ${mobile} (${fullName}) via WhatsApp chatbot`);
  } catch (e) {
    console.error('[WACTO Bot] Registration failed:', e.message);
    await sendWactoText(phone, botText('reg_failed', session?.lang, {})).catch(() => {});
  }
}

// ── Multi-step flow handler ────────────────────────────────────────────────────

async function handleFlowStep(phone, text, session, coll, db) {
  const mobile = toMobile10(phone);

  // ── Pay Later: their answer to "When would you like to pay?" (2026-10-16) ──
  if (session.flow === 'pay_later_when') {
    await payLater(db, mobile, text);
    await coll.updateOne({ phone }, { $set: { flow: null, updated_at: new Date() } });
    await sendWactoText(phone, botText('feat_pay_later_thanks', session?.lang, { answer: text.slice(0, 200) }));
    return;
  }

  // ── Support: 2-step ticket collection ──────────────────────────────────────
  if (session.flow === 'support_issue') {
    await coll.updateOne({ phone }, { $set: { flow: 'support_name', support_issue: text, updated_at: new Date() } });
    await sendWactoText(phone, botText('support_ask_name', session?.lang, {}));
    return;
  }

  if (session.flow === 'support_name') {
    const name = text.toLowerCase() === 'skip' ? '' : text;
    await db.collection('tbl_support_tickets').insertOne({
      phone, mobile,
      issue: session.support_issue,
      name,
      created_at: new Date(),
    });
    await coll.deleteOne({ phone });
    await sendWactoText(phone, botText('support_done', session?.lang, {}));
    console.log(`[WACTO Support] Ticket saved for ${mobile}`);
    return;
  }

  // ── Purchase Plan: 2-step (tier select → booth count) ──────────────────────
  if (session.flow === 'purchase_select') {
    const planMap = {
      '1': { name: '1 Booth',           price: '₹2,000',  maxBooths: 1   },
      '2': { name: 'Up to 5 Booths',   price: '₹5,000',  maxBooths: 5   },
      '3': { name: 'Up to 10 Booths',  price: '₹10,000', maxBooths: 10  },
      '4': { name: 'Up to 25 Booths',  price: '₹25,000', maxBooths: 25  },
      '5': { name: 'Up to 100 Booths', price: '₹50,000', maxBooths: 100 },
    };
    const plan = planMap[text];
    if (!plan) {
      await sendWactoText(phone, botText('purchase_invalid', session?.lang, {}));
      return;
    }
    const planTA = TAMIL_PLAN_NAMES[plan.name] || plan.name;
    await coll.updateOne({ phone }, {
      $set: { flow: 'purchase_booths', purchase_plan: plan.name, purchase_price: plan.price, updated_at: new Date() }
    });
    await sendWactoText(phone, botText('purchase_booth_ask', session?.lang, { plan: session?.lang === 'ta' ? planTA : plan.name, price: plan.price }));
    return;
  }

  if (session.flow === 'purchase_booths') {
    // The typed booth count sets the price (same tiers as after registration), even if a smaller
    // plan was picked. Not a positive number → ask again and keep waiting.
    const boothCount = parseInt(String(text).replace(/\D/g, ''), 10);
    if (!boothCount || boothCount < 1) {
      const planTA = TAMIL_PLAN_NAMES[session.purchase_plan] || session.purchase_plan;
      await sendWactoText(phone, botText('purchase_booth_ask', session?.lang, { plan: session?.lang === 'ta' ? planTA : session.purchase_plan, price: session.purchase_price }));
      return;
    }
    await db.collection('tbl_purchase_interests').insertOne({
      phone, mobile,
      plan: session.purchase_plan,
      price: session.purchase_price,
      booth_count: boothCount,
      created_at: new Date(),
    });
    await coll.deleteOne({ phone });
    // QR + UPI + amount in one image caption (as after registration). Numbers without an account also
    // get the WhatsApp / website registration steps, so their payment can be matched to an account.
    const pay = await getPaymentSettings(db);
    const user = await db.collection('tbl_user').findOne({ mobile_no: mobile });
    const registered = !!user?.password_str;
    const title = botText('purchase_pay_title', session?.lang, { booths: boothCount })
      + (registered ? '' : `\n\n${botText('purchase_register_first', session?.lang, {})}`);
    await sendImageWithText(phone, pay.qr_url, paymentMessage(pay, session?.lang, { boothCount, title }));
    console.log(`[WACTO Purchase] Interest saved for ${mobile} — ${session.purchase_plan} (${boothCount} booths), QR sent${registered ? '' : ' with register-first steps'}`);
    return;
  }

  // ── Social Media: 4-step campaign request ──────────────────────────────────
  if (session.flow === 'social_service') {
    const serviceMap = { '1': 'WA Broadcast', '2': 'Audio SMS', '3': 'SMS Broadcast' };
    const service = serviceMap[text] ||
      (['WA Broadcast', 'Audio SMS', 'SMS Broadcast'].includes(text) ? text : null);
    if (!service) {
      await sendWactoText(phone, botText('social_invalid', session?.lang, {}));
      return;
    }
    await coll.updateOne({ phone }, { $set: { flow: 'social_name', social_service: service, updated_at: new Date() } });
    await sendWactoText(phone, botText('social_name_ask', session?.lang, { service }));
    return;
  }

  if (session.flow === 'social_name') {
    await coll.updateOne({ phone }, { $set: { flow: 'social_message', social_name: text, updated_at: new Date() } });
    await sendWactoText(phone, botText('social_message_ask', session?.lang, {}));
    return;
  }

  if (session.flow === 'social_message') {
    await coll.updateOne({ phone }, { $set: { flow: 'social_area', social_message: text, updated_at: new Date() } });
    await sendWactoText(phone, botText('social_area_ask', session?.lang, {}));
    return;
  }

  if (session.flow === 'social_area') {
    await db.collection('tbl_campaign_requests').insertOne({
      phone, mobile,
      service: session.social_service,
      name: session.social_name,
      message: session.social_message,
      target_area: text,
      created_at: new Date(),
    });
    await coll.deleteOne({ phone });
    await sendWactoText(phone, botText('social_done', session?.lang, { service: session.social_service }));
    console.log(`[WACTO Social] Campaign request saved for ${mobile} — ${session.social_service}`);
    return;
  }
}

// ── WhatsApp features (Ram, 2026-10-16) ────────────────────────────────────────
// Each one is behind its switch in services/features.js (off → test numbers → everyone); while a switch is off for a
// number, that number's message goes on to the normal bot handling below, exactly as before. None of these titles has
// a WACTO edge, so WACTO itself never answers them. Replies come from the admin catalogue ("WhatsApp features" group);
// the QR message is the same Payment-setup message the bot sends after registration.
const PAY_NOW_LABELS = new Set(['Pay Now', 'இப்போது செலுத்த']);
const PAY_LATER_LABELS = new Set(['Pay Later', 'பிறகு செலுத்த']);
const STOP_WORDS = new Set(['stop', 'unsubscribe', 'நிறுத்து', 'நிறுத்தவும்']);
const LOGIN_PHRASES = new Set(['send my edms login', 'எனது edms உள்நுழைவு']);

// QR image + UPI ID + amount in ONE message (image with caption; separate sends only if the caption is refused)
async function sendPaymentDetails(phone, user, lang, db) {
  const pay = await getPaymentSettings(db);
  await sendImageWithText(phone, pay.qr_url, paymentMessage(pay, lang, { assembly: user.assembly_name || '', boothCount: boothCountOf(user) }));
}

async function handleFeatureMessage(phone, selected) {
  const low = selected.toLowerCase().trim();
  const isPayNow = PAY_NOW_LABELS.has(selected), isPayLater = PAY_LATER_LABELS.has(selected);
  const isStop = STOP_WORDS.has(low), isLogin = LOGIN_PHRASES.has(low);
  if (!isPayNow && !isPayLater && !isStop && !isLogin) return false;
  const db = getAppDb();
  const mobile = toMobile10(phone);
  const settings = await getFeatureSettings(db);
  const feature = isStop ? 'stop_optout' : isLogin ? 'website_login' : 'pay_buttons';
  if (!isOnFor(settings, feature, mobile)) return false;
  const coll = db.collection('tbl_wacto_sessions');
  const session = await coll.findOne({ phone });
  const lang = TAMIL_SCRIPT.test(selected) ? 'ta' : (session?.lang || 'en');

  if (isStop) {
    await optOut(db, mobile, 'whatsapp');
    await sendWactoText(phone, botText('feat_stop_done', lang));
    console.log(`[WACTO Features] ${new Date().toISOString()} STOP from ******${mobile.slice(-4)}`);
    return true;
  }

  const user = await db.collection('tbl_user').findOne({ mobile_no: mobile });

  if (isPayNow || isPayLater) {
    if (!user) {
      await sendWactoText(phone, botText('feat_pay_register_first', lang));
      return true;
    }
    if (isPaid(user.paid_status)) {
      await sendWactoText(phone, botText('feat_pay_already_active', lang));
      return true;
    }
    if (isPayNow) {
      await sendPaymentDetails(phone, user, lang, db);
      console.log(`[WACTO Features] ${new Date().toISOString()} Pay Now → payment details to ******${mobile.slice(-4)}`);
      return true;
    }
    await coll.updateOne({ phone }, { $set: { phone, flow: 'pay_later_when', lang, updated_at: new Date() } }, { upsert: true });
    await sendWactoText(phone, botText('feat_pay_later_ask', lang));
    return true;
  }

  // Website registration: the visitor sends the ready message from tnedms.com — reply with the login (+ payment details)
  if (!user?.password_str) {
    await sendWactoText(phone, botText('feat_login_no_account', lang, { mobile }));
    return true;
  }
  await sendImageWithText(phone, botImage('credentials'), botText('feat_login_sent', lang, { mobile, passcode: user.password_str }));
  if (!isPaid(user.paid_status)) { await pause(FOLLOWUP_DELAY_MS); await sendPaymentDetails(phone, user, lang, db); }
  console.log(`[WACTO Features] ${new Date().toISOString()} website login sent to ******${mobile.slice(-4)}`);
  return true;
}

// ── Payment proof: screenshot sent to the bot ──────────────────────────────────
// Registered + unpaid candidate sends an image → store it (Cloudinary), queue it in
// tbl_utr_payments for the admin Payments page, confirm in the chat. Unknown numbers
// are told to register first; paid accounts are told they are already active.

async function handleIncomingProof(phone, msg_, contactName) {
  const db = getAppDb();
  const mobile = toMobile10(phone);
  const media = mediaOf(msg_);
  const session = await db.collection('tbl_wacto_sessions').findOne({ phone });
  const lang = session?.lang || 'en';
  const settings = await getPaymentSettings(db);
  const user = await db.collection('tbl_user').findOne({ mobile_no: mobile });
  if (!user) { await sendWactoText(phone, proofUnknownUserMessage(lang)); return; }
  if (isPaid(user.paid_status)) { await sendWactoText(phone, proofAlreadyPaidMessage(lang)); return; }

  let screenshot = null;
  try {
    const got = await fetchIncomingMedia(media);
    if (got) screenshot = await storeScreenshot(got.buffer, got.mime, mobile);
  } catch (e) {
    console.warn(`[WACTO Proof] media not stored for ${mobile}: ${e.message}`);
  }
  const { outcome, doc } = await recordProof(db, {
    user, mobile, source: 'whatsapp', utr: extractUtr(media.caption), screenshot,
    wa_media_id: media.id, caption: media.caption, contact_name: contactName,
  });
  if (outcome === 'duplicate') {
    await sendWactoText(phone, botText('proof_duplicate', lang, { support_phone: settings.support_phone }));
    return;
  }
  await sendWactoText(phone, proofReceivedMessage(settings, lang, { boothCount: doc.booth_count, outcome, utr: doc.utr }));
  console.log(`[WACTO Proof] ${outcome} for ${mobile} (${screenshot ? 'file stored' : 'no file'}${media.id ? `, media ${media.id}` : ''})`);
}

// ── Main webhook handler ───────────────────────────────────────────────────────

export async function handleWactoWebhook(req, res) {
  res.sendStatus(200); // Acknowledge immediately

  try {
    const change = req.body?.entry?.[0]?.changes?.[0]?.value;
    if (!change?.messages?.length) return;

    // Texts and images the bot sends come from the admin "Bot Messages & Media" page (cached 60 s).
    await loadBotContent(getAppDb());

    const msg_ = change.messages[0];
    const phone = msg_.from;
    const contactName = change.contacts?.[0]?.profile?.name || '';
    // Incomplete registrations (Ram, 2026-10-15): every number that messages the bot is recorded from its first message
    await touchLead(getAppDb(), { mobile: toMobile10(phone), name: contactName, source: 'whatsapp' });

    // A photo or PDF from a candidate is their payment proof for the static UPI QR.
    if (mediaOf(msg_)) { await handleIncomingProof(phone, msg_, contactName); return; }

    const selected = extractSelection(msg_);
    if (!selected) return;

    // Ignore navigation-only items (pure pagination, no data value)
    if (isNavItem(selected)) return;

    // Pay Now / Pay Later / STOP / website login — each behind its switch; switched off = the bot as before
    if (await handleFeatureMessage(phone, selected)) return;

    // Skip plain text greetings and root menu triggers
    if (msg_.type === 'text') {
      const low = selected.toLowerCase();
      // WACTO's root keywords restart its flow (language question) — start the backend side over
      // too, so a fresh start is not treated as old taps of an unfinished registration
      if (RESTART_WORDS.has(low)) {
        await getAppDb().collection('tbl_wacto_sessions').deleteOne({ phone });
        return;
      }
      if (low === 'ok') return;

      // PAY intent — user wants to complete payment after registration nudge
      if (low === 'pay') {
        const mobile = toMobile10(phone);
        const db = getAppDb();
        const user = await db.collection('tbl_user').findOne({ mobile_no: mobile });
        const paySession = await db.collection('tbl_wacto_sessions').findOne({ phone });
        if (!user) {
          await sendWactoText(phone, botText('pay_not_registered', paySession?.lang));
          return;
        }
        if (isPaid(user.paid_status)) {
          await sendWactoText(phone, botText('pay_already_active', paySession?.lang, { mobile, passcode: user.password_str }));
          return;
        }
        const boothCount = boothCountOf(user);
        const pay = await getPaymentSettings(db);
        await sendImageWithText(phone, pay.qr_url, paymentMessage(pay, paySession?.lang, { boothCount, title: botText('pay_qr_title_pay', paySession?.lang) }));
        return;
      }
    }

    const db   = getAppDb();
    const coll = db.collection('tbl_wacto_sessions');

    // Load session early — needed for language context throughout this request
    let session = await coll.findOne({ phone });
    const expired = !!(session?.updated_at && Date.now() - new Date(session.updated_at).getTime() > SESSION_TTL_MS);
    if (expired) {
      // Expired: Support / Purchase / Social steps lapse, but registration answers are kept so a
      // user who paused can continue from the latest message (tap Register to start over).
      session = { ...session, flow: null };
    }

    // While a registration is in progress the language is locked too (tap Register to start over)
    const regInProgress = !!session?.reg_started && !expired;
    const tappedLang = msg_.type === 'interactive' ? langFromLabel(selected) : null;
    const langLocked = regInProgress && (LANG_VALUES.has(selected) || !!registrationStep(session, selected));
    if (tappedLang && !langLocked) session = { ...(session || { phone, contact_name: contactName }), lang: tappedLang };

    // Check for active multi-step flow BEFORE menu / registration checks
    if (msg_.type === 'text') {
      // Intercept booth numbers reply during registration
      if (session?.awaiting_booth_numbers) {
        const parts = selected.replace(/[，、]/g, ',').split(',').map(s => s.trim()).filter(Boolean);
        const booths = parts.map(s => parseInt(s, 10)).filter(n => !isNaN(n) && n >= 1 && n <= 500);
        if (!booths.length) {
          await sendWactoText(phone, botText('reg_booth_invalid', session?.lang, { assembly: session.assembly }));
          return;
        }
        session.booths = booths;
        session.booth_count = booths.length;
        session.awaiting_booth_numbers = false;
        await coll.updateOne({ phone }, { $set: { booths, booth_count: booths.length, awaiting_booth_numbers: false, updated_at: new Date() } });
        if (isComplete(session)) await finishRegistration(phone, session, contactName, coll, db);
        return;
      }

      if (session?.flow) {
        await handleFlowStep(phone, selected, session, coll, db);
        return;
      }
    }

    // Normalise Tamil menu items to English canonical names before lookup
    const normalizedSelected = TAMIL_MENU_MAP[selected] || selected;

    // Handle top-level menu options (not part of registration flow)
    if (MENU_SELECTIONS.has(normalizedSelected)) {
      await handleMenuSelection(phone, normalizedSelected, db, coll, session);
      return;
    }

    // Register (English) or பதிவு செய்ய (Tamil) — returning-user shortcut
    if (REGISTER_LABELS.has(selected)) {
      const mobile   = toMobile10(phone);
      const existing = await db.collection('tbl_user').findOne({ mobile_no: mobile });
      if (existing?.password_str) {
        await sendImageWithText(phone, botImage('credentials'), botText('reg_welcome_back', session?.lang, { name: existing.first_name || mobile, mobile, passcode: existing.password_str }));
        return;
      }
      // New user starting registration — wipe stale session, preserve lang
      const savedLang = session?.lang;
      await coll.deleteOne({ phone });
      session = { phone, contact_name: contactName, lang: savedLang || 'en', reg_started: true };
    }

    // Language tap during a registration: keep the language, say which step is next
    if (LANG_VALUES.has(selected) && regInProgress) {
      await sendStepLocked(phone, session, nextStep(session));
      await coll.updateOne({ phone }, { $set: { lock_shown: true } });
      return;
    }

    // Old-tap lock: a registration answer counts only for the NEXT step
    const step = registrationStep(session, selected);
    if (step) {
      if (await isRegistered(db, phone)) { await sendAlreadyRegistered(phone, session); return; }
      const expected = nextStep(session || {});
      if (step !== expected || (step === 'assembly' && !isAssemblyOf(session?.district, selected))) {
        await sendStepLocked(phone, session, expected);
        if (session) await coll.updateOne({ phone }, { $set: { lock_shown: true } });
        return;
      }
    }

    // Initialise session for new interactions not yet in any session
    if (!session) {
      session = { phone, contact_name: contactName };
    }

    applySelection(session, selected);
    session.updated_at = new Date();
    if (contactName) session.contact_name = contactName;
    const showNext = !!(step && session.lock_shown); // right answer straight after a warning
    if (step) session.lock_shown = false;

    await coll.updateOne({ phone }, { $set: session }, { upsert: true });
    await touchLead(db, { mobile: toMobile10(phone), name: contactName, source: 'whatsapp', step: stepOfSession(session) });

    if (isComplete(session)) {
      await finishRegistration(phone, session, contactName, coll, db);
    } else if (session.assembly && !session.booth_count && !session.awaiting_booth_numbers) {
      // Assembly just captured — ask for booth numbers to complete registration
      await coll.updateOne({ phone }, { $set: { awaiting_booth_numbers: true, updated_at: new Date() } });
      await sendWactoText(phone, botText('reg_booth_ask', session?.lang, { assembly: session.assembly }));
      await touchLead(db, { mobile: toMobile10(phone), name: contactName, source: 'whatsapp', step: 'booth_numbers' });
    } else if (showNext) {
      await sendNextStep(phone, session, nextStep(session));
    }
  } catch (e) {
    console.error('[WACTO Webhook]', e.message);
  }
}
