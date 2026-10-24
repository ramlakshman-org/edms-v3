// What OUR backend sends on top of the WACTO flow (see wacto-flow skill §1,
// "Who answers an option"). Data-driven so other bots can get their own set.
// Texts come from the bot content catalogue (GET /flow-images/bot), so the
// simulator shows the wording currently saved in Bot Messages & Media.
import { isTamil } from './flowModel.js';

const TAMIL_MENU = { 'உதவி மையம்': 'Support', 'திட்டத்தை வாங்க': 'Purchase Plan', 'சமூக வலைத்தள சேவை': 'Social Media', 'எனது கணக்கு விவரங்கள்': 'My Credentials', 'பதிவு செய்ய': 'Register', 'இப்போதே பதிவு செய்க': 'Register', 'Register now': 'Register' };

export const EDMS_RULES = {
  id: 'edms',
  label: 'EDMS backend (tnedms.com)',
  // language follows the tapped label; shared labels keep the current one
  langFromLabel: (title) => (isTamil(title) ? 'ta' : ['English', 'Register', 'Register now', 'Main menu', 'Support', 'Purchase Plan', 'Social Media', 'My Credentials', 'Demo', 'Benefits', 'FAQ', 'Website'].includes(title) ? 'en' : null),
  // after a tap: dual = WACTO node AND a backend follow-up; backend = backend only (no edge)
  onTap(title, ctx) {
    const en = TAMIL_MENU[title] || title;
    if (en === 'Support') return [{ kind: 'dual', key: 'menu_support_intro', note: 'follow-up after WACTO’s Support image (2 s delay)' }];
    if (en === 'Purchase Plan') return [{ kind: 'dual', key: 'menu_purchase_plans', note: 'follow-up after WACTO’s plans image', flow: 'purchase_select' }];
    if (en === 'Social Media') return [{ kind: 'dual', key: 'menu_social_intro', note: 'follow-up after WACTO’s social image', flow: 'social_service' }];
    if (en === 'My Credentials') return [{ kind: 'backend', key: ctx.registered ? 'menu_credentials' : 'menu_no_account', image: ctx.registered ? 'credentials' : null, vars: { mobile: ctx.mobile, passcode: ctx.passcode } }];
    if (en === 'Register' && ctx.registered) return [{ kind: 'dual', key: 'reg_welcome_back', image: 'credentials', vars: { name: ctx.name, mobile: ctx.mobile, passcode: ctx.passcode } }];
    // an assembly row (node "Assembly: X pN", Tamil "TA Assembly: X pN") has no edge: the backend asks for booth numbers
    if (ctx.nodeName && /^(TA )?Assembly: /.test(ctx.nodeName) &&!/^More in /.test(title) && !/மேலும்/.test(title)) return [{ kind: 'backend', key: 'reg_booth_ask', vars: { assembly: title }, flow: 'booths', remember: { assembly: title } }];
    return [];
  },
  // typed text
  onText(text, ctx) {
    const t = text.trim();
    if (ctx.flow === 'booths') {
      const nums = t.split(/[,，、]/).map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n) && n >= 1 && n <= 500);
      if (!nums.length) return [{ kind: 'backend', key: 'reg_booth_invalid', vars: { assembly: ctx.assembly } }];
      return [
        { kind: 'backend', key: 'reg_complete', image: 'registration_complete', vars: { name: ctx.name, mobile: ctx.mobile, passcode: ctx.passcode }, remember: { registered: true, booths: nums.length, flow: null } },
        { kind: 'backend', key: 'pay_qr', image: 'payment_qr', payVars: { assembly: ctx.assembly, booths: nums.length } },
      ];
    }
    if (ctx.flow === 'purchase_select') {
      const plans = { 1: ['1 Booth', '₹2,000'], 2: ['Up to 5 Booths', '₹5,000'], 3: ['Up to 10 Booths', '₹10,000'], 4: ['Up to 25 Booths', '₹25,000'], 5: ['Up to 100 Booths', '₹50,000'] };
      if (!plans[t]) return [{ kind: 'backend', key: 'purchase_invalid' }];
      return [{ kind: 'backend', key: 'purchase_booth_ask', vars: { plan: plans[t][0], price: plans[t][1] }, remember: { flow: 'purchase_booths', plan: plans[t][0], price: plans[t][1] } }];
    }
    if (ctx.flow === 'purchase_booths') {
      // the typed booth count sets the price; QR + UPI in one caption; no account → register-first steps too
      const n = parseInt(t.replace(/\D/g, ''), 10);
      if (!n) return [{ kind: 'backend', key: 'purchase_booth_ask', vars: { plan: ctx.plan, price: ctx.price } }];
      return [{ kind: 'backend', key: 'pay_qr', image: 'payment_qr', payVars: { booths: n, title: 'purchase_pay_title', titleVars: { booths: n }, titleExtra: ctx.registered ? null : 'purchase_register_first' }, remember: { flow: null } }];
    }
    if (ctx.flow === 'social_service') {
      const map = { 1: 'WA Broadcast', 2: 'Audio SMS', 3: 'SMS Broadcast' };
      if (!map[t]) return [{ kind: 'backend', key: 'social_invalid' }];
      return [{ kind: 'backend', key: 'social_name_ask', vars: { service: map[t] }, remember: { flow: 'social_name', service: map[t] } }];
    }
    if (ctx.flow === 'social_name') return [{ kind: 'backend', key: 'social_message_ask', remember: { flow: 'social_message' } }];
    if (ctx.flow === 'social_message') return [{ kind: 'backend', key: 'social_area_ask', remember: { flow: 'social_area' } }];
    if (ctx.flow === 'social_area') return [{ kind: 'backend', key: 'social_done', vars: { service: ctx.service }, remember: { flow: null } }];
    if (ctx.flow === 'support_issue') return [{ kind: 'backend', key: 'support_ask_name', remember: { flow: 'support_name' } }];
    if (ctx.flow === 'support_name') return [{ kind: 'backend', key: 'support_done', remember: { flow: null } }];
    if (/^pay$/i.test(t)) return ctx.registered
      ? [{ kind: 'backend', key: 'pay_qr', image: 'payment_qr', payVars: { booths: ctx.booths || 1, title: 'pay_qr_title_pay' } }]
      : [{ kind: 'backend', key: 'pay_not_registered' }];
    return [];
  },
  // the Support follow-up opens a typed flow
  afterReply(key) { return key === 'menu_support_intro' ? { flow: 'support_issue' } : null; },
};

export const RULE_SETS = [EDMS_RULES];
