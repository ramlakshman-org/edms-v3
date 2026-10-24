import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { User, Phone, Users, Flag, MapPin, Building2, Landmark, ChevronDown, ArrowRight, ArrowLeft, CheckCircle2, MessageCircle } from 'lucide-react';
import api from '../api/client.js';
import { RURAL_POSITIONS, URBAN_POSITIONS, districtsFor } from '../data/localBodies.js';
import { useLang, useLightPage, EntryHeader, EntryIntro, Stepper, EntryFoot, AssemblyMap } from '../entry/parts.jsx';

// Public candidate registration — EDMS-1 (master reference approved by Ram on 2026-10-14). Same nine fields,
// validation, messages and API calls as before (GET /public/assemblies, GET /public/booths?assemblyId,
// POST /auth/register, one submission at the end). Ram chose three real steps instead of the reference's four:
// there is no OTP or "verification" step in EDMS.
const PARTIES = ['DMK', 'AIADMK', 'BJP', 'INC', 'NTK', 'PMK', 'VCK', 'MDMK', 'AMMK', 'DMDK', 'TVK', 'Independent', 'Other'];
const ROLES = [
  ['planning', 'Planning to contest', 'போட்டியிடத் திட்டமிடுதல்'],
  ['confirmed', 'Confirmed candidate', 'உறுதிப்படுத்தப்பட்ட வேட்பாளர்'],
  ['team', 'Campaign team member', 'பிரச்சாரக் குழு உறுப்பினர்'],
  ['functionary', 'Party functionary', 'கட்சி நிர்வாகி'],
];
// [question EN, answer EN, question TA, answer TA]
const QUESTIONS = [
  ['What exactly do I get?', 'For every booth on your plan, the voter list as the Election Commission publishes it, with the mobile numbers we hold against it, and a booth report with the figures that matter: voters, women, men, how many have a mobile. For the whole assembly, the analytics page and the two briefing documents.',
    'எனக்கு சரியாக என்ன கிடைக்கும்?', 'உங்கள் திட்டத்தில் உள்ள ஒவ்வொரு வாக்குச்சாவடிக்கும், தேர்தல் ஆணையம் வெளியிடும் வாக்காளர் பட்டியல், எங்களிடம் உள்ள கைபேசி எண்களுடன்; முக்கிய எண்ணிக்கைகளுடன் வாக்குச்சாவடி அறிக்கை: வாக்காளர்கள், பெண்கள், ஆண்கள், கைபேசி உள்ளவர்கள். முழுத் தொகுதிக்கும், பகுப்பாய்வுப் பக்கமும் இரண்டு அறிக்கை ஆவணங்களும்.'],
  ['Which elections is this for?', 'The Tamil Nadu local body elections: ward councillors, town panchayats, municipalities, corporations and the rural bodies. The data is organised by assembly constituency and polling booth because that is how the roll is published.',
    'இது எந்தத் தேர்தலுக்கு?', 'தமிழ்நாடு உள்ளாட்சித் தேர்தல்: வார்டு உறுப்பினர்கள், பேரூராட்சிகள், நகராட்சிகள், மாநகராட்சிகள், கிராமப்புற அமைப்புகள். வாக்காளர் பட்டியல் சட்டமன்றத் தொகுதி மற்றும் வாக்குச்சாவடி வாரியாக வெளியிடப்படுவதால், தரவும் அப்படியே அமைக்கப்பட்டுள்ளது.'],
  ['How fast is it active?', 'Your login arrives on WhatsApp the moment you register. Pay over UPI, upload the screenshot, and the plan is active within the hour of our approval, usually sooner.',
    'எவ்வளவு விரைவில் செயல்படும்?', 'பதிவு செய்த உடனே உங்கள் உள்நுழைவு வாட்ஸ்அப்பில் வரும். UPI மூலம் செலுத்தி, ஸ்கிரீன்ஷாட்டைப் பதிவேற்றுங்கள்; எங்கள் ஒப்புதலுக்குப் பின் ஒரு மணி நேரத்திற்குள், பெரும்பாலும் அதற்கும் முன்பே, திட்டம் செயல்படும்.'],
  ['Can I add booths later?', 'Yes. Add booths from your dashboard; the price moves to the next tier only when the count crosses it.',
    'பின்னர் வாக்குச்சாவடிகளைச் சேர்க்கலாமா?', 'ஆம். உங்கள் டாஷ்போர்டில் இருந்து சேர்க்கலாம்; எண்ணிக்கை அடுத்த நிலையைத் தாண்டும்போது மட்டுமே விலை மாறும்.'],
  ['Is it legal to hold voter data?', 'The roll is a public document. We hold it under the Digital Personal Data Protection Act 2023: numbers are masked until a plan is active, every login is named, and nothing is shared outside your account.',
    'வாக்காளர் தரவை வைத்திருப்பது சட்டப்படி சரியா?', 'வாக்காளர் பட்டியல் ஒரு பொது ஆவணம். டிஜிட்டல் தனிநபர் தரவுப் பாதுகாப்புச் சட்டம் 2023-ன் கீழ் நாங்கள் அதை வைத்திருக்கிறோம்: திட்டம் செயல்படும் வரை எண்கள் மறைக்கப்படும், ஒவ்வொரு உள்நுழைவும் பெயருடன் இருக்கும், உங்கள் கணக்கிற்கு வெளியே எதுவும் பகிரப்படாது.'],
  ['What if I typed the wrong WhatsApp number?', 'Write to us on WhatsApp from the right number with your name and assembly; we move the login the same day.',
    'தவறான வாட்ஸ்அப் எண்ணை உள்ளிட்டுவிட்டால்?', 'சரியான எண்ணில் இருந்து உங்கள் பெயர் மற்றும் தொகுதியுடன் எங்களுக்கு வாட்ஸ்அப்பில் எழுதுங்கள்; அதே நாளில் உள்நுழைவை மாற்றித் தருகிறோம்.'],
  ['Is there a refund?', 'If the plan is not active within a working day of your payment, we refund in full. Once the numbers are unlocked there is no refund, because the data cannot be taken back.',
    'பணம் திரும்பக் கிடைக்குமா?', 'பணம் செலுத்திய ஒரு வேலை நாளுக்குள் திட்டம் செயல்படாவிட்டால், முழுத் தொகையும் திருப்பித் தரப்படும். எண்கள் திறக்கப்பட்ட பிறகு, தரவைத் திரும்பப் பெற முடியாது என்பதால், பணம் திருப்பித் தரப்படாது.'],
  ['Which language?', 'The site and the lists are in Tamil and English. Switch at the top of any page.',
    'எந்த மொழியில்?', 'இணையதளமும் பட்டியல்களும் தமிழ் மற்றும் ஆங்கிலத்தில் உள்ளன. எந்தப் பக்கத்தின் மேலேயும் மொழியை மாற்றலாம்.'],
];

const Req = () => <span className="req" aria-hidden="true">*</span>;
function SelectIn({ icon: Icon, value, onChange, children, id, label }) {
  return (
    <span className={`en-in${Icon ? '' : ' no-ico'}`}>
      {Icon && <Icon size={19} className="ico" aria-hidden="true" />}
      <select id={id} value={value} onChange={onChange} aria-label={label}>{children}</select>
      <ChevronDown size={18} className="chev" aria-hidden="true" />
    </span>
  );
}

export default function Register() {
  const { lang, setLang, t, isTa } = useLang();
  useLightPage();
  const [f, setF] = useState({ full_name: '', mobile: '', role: '', affiliation: '', party: '', body_type: '', position: '', district: '', local_body: '', ward_number: '' });
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(null); // { username, passcode } — or { username, whatsapp: { number, text } } (login on WhatsApp)
  const [err, setErr] = useState('');
  const [exists, setExists] = useState(null); // 409 ALREADY_REGISTERED: nothing was changed; { whatsapp? } when the login can come on WhatsApp
  // Website login on WhatsApp (Ram, 2026-10-16; switch "website_login" on the admin WhatsApp Features page): when it is
  // on for everyone, the form says the login comes on WhatsApp only. GET /public/whatsapp-login answers { all }.
  const [waForAll, setWaForAll] = useState(false);
  useEffect(() => { api.get('/public/whatsapp-login').then(({ data }) => setWaForAll(!!data?.all)).catch(() => {}); }, []);
  const [loading, setLoading] = useState(false);
  const [allAssemblies, setAllAssemblies] = useState([]);
  const [availableBooths, setAvailableBooths] = useState([]);
  const [loadingBooths, setLoadingBooths] = useState(false);

  useEffect(() => {
    api.get('/public/assemblies').then(({ data }) => setAllAssemblies(data.assemblies || []))
      .catch(() => { api.get('/assemblies').then(({ data }) => setAllAssemblies(data.assemblies || [])).catch(() => {}); });
  }, []);
  const districtAssemblies = useMemo(() => {
    if (!f.district) return [];
    const cleanDist = f.district.toLowerCase().trim();
    const filtered = allAssemblies.filter((a) => String(a.district || '').toLowerCase().trim().includes(cleanDist) || cleanDist.includes(String(a.district || '').toLowerCase().trim()));
    return filtered.length ? filtered : allAssemblies;
  }, [allAssemblies, f.district]);
  useEffect(() => {
    if (!f.assembly_id) { setAvailableBooths([]); return; }
    setLoadingBooths(true);
    api.get('/public/booths', { params: { assemblyId: f.assembly_id } }).then(({ data }) => setAvailableBooths(data.booths || []))
      .catch(() => { api.get('/booths', { params: { assemblyId: f.assembly_id } }).then(({ data }) => setAvailableBooths(data.booths || [])).catch(() => setAvailableBooths([])); })
      .finally(() => setLoadingBooths(false));
  }, [f.assembly_id]);

  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const positions = f.body_type === 'urban' ? URBAN_POSITIONS : f.body_type === 'rural' ? RURAL_POSITIONS : [];
  const districts = useMemo(() => (f.position ? districtsFor(f.position) : []), [f.position]);
  const selected = f.selected_booths || [];
  const STEPS = [t('Your details', 'உங்கள் விவரங்கள்'), t('Role and party', 'பங்கு மற்றும் கட்சி'), t('Your constituency', 'போட்டியிடும் தொகுதி')];
  const nameOk = () => f.full_name.trim() && /^\d{10}$/.test(f.mobile);
  const nameMsg = () => t('Enter your name and a valid 10-digit mobile number.', 'உங்கள் பெயர் மற்றும் 10 இலக்க கைபேசி எண்ணை உள்ளிடவும்.');

  const next = () => {
    setErr('');
    if (step === 0 && !nameOk()) { setErr(nameMsg()); return; }
    // Incomplete registrations (Ram, 2026-10-15): name + number are kept from step 1 so the team can help someone finish.
    // Fire and forget: the form never waits for it or shows its result.
    if (step < 2) api.post('/public/lead', { full_name: f.full_name, mobile: f.mobile, step: step === 0 ? 'details' : 'role' }).catch(() => {});
    if (step === 0 && /^\d{10}$/.test(f.mobile)) api.post('/public/track', { mobile: f.mobile, event: 'start' }).catch(() => {}); // website journey: started the form
    setStep((s) => Math.min(2, s + 1));
  };
  const back = () => { setErr(''); setStep((s) => Math.max(0, s - 1)); };

  const submit = async (e) => {
    e.preventDefault();
    if (step < 2) { next(); return; }
    setErr('');
    if (!nameOk()) { setErr(nameMsg()); setStep(0); return; }
    if (!f.assembly_id) { setErr(t('Please select an Assembly Constituency.', 'சட்டமன்றத் தொகுதியைத் தேர்ந்தெடுக்கவும்.')); return; }
    if (loading) return; // no double submission
    setLoading(true);
    try {
      const payload = { full_name: f.full_name, mobile: f.mobile, role: f.role, affiliation: f.affiliation, party: f.party, body_type: f.body_type, position: f.position, district: f.district, assembly_id: f.assembly_id, assembly_name: f.assembly_name, booths: selected, lang };
      const { data } = await api.post('/auth/register', payload);
      if (data.success) setDone(data.via === 'whatsapp' ? { username: data.username, whatsapp: data.whatsapp } : { username: data.username, passcode: data.passcode });
      else setErr(data.message || t('Registration failed.', 'பதிவு தோல்வியடைந்தது.'));
    } catch (e2) {
      if (e2.response?.data?.code === 'ALREADY_REGISTERED') setExists({ whatsapp: e2.response.data.whatsapp || null });
      else setErr(e2.response?.data?.message || t('Registration failed.', 'பதிவு தோல்வியடைந்தது.'));
    } finally { setLoading(false); }
  };

  const Opt = ({ group, value, label, note, onPick }) => (
    <button type="button" className="en-opt" aria-pressed={f[group] === value} onClick={onPick || (() => set(group, value))}>{label}{note && <small>{note}</small>}</button>
  );
  const resetBelow = { assembly_id: '', assembly_name: '', selected_booths: [] };

  return (
    <div className="en">
      <EntryHeader lang={lang} setLang={setLang} t={t} have={t('Already have an account?', 'ஏற்கனவே கணக்கு உள்ளதா?')} action={<Link className="en-link" to="/login">{t('Sign in', 'உள்நுழைக')}</Link>} />
      <main className="en-split">
        <EntryIntro t={t} title={t('Election Data Management System', 'தேர்தல் தரவு மேலாண்மை அமைப்பு')} />
        <div className="en-card-wrap">
          <section className="en-card" id="register" aria-labelledby="h-reg">
            <h2 id="h-reg">{done ? t('Your account is ready', 'உங்கள் கணக்கு தயார்') : t('Create your account', 'உங்கள் கணக்கை உருவாக்குங்கள்')}</h2>
            <p className="en-sub">{t('Get started with EDMS and access booth-level election data for Tamil Nadu.', 'EDMS-ல் தொடங்கி, தமிழ்நாட்டின் வாக்குச்சாவடி அளவிலான தேர்தல் தரவைப் பெறுங்கள்.')}</p>
            <Stepper steps={STEPS} current={done ? 3 : step} />

            {exists && !done ? (
              <div className="en-done en-exists en-pane" role="alert">
                <span className="tag is-info">{t('Already registered', 'ஏற்கனவே பதிவானது')}</span>
                <p>
                  {t('This number already has an EDMS account, so nothing was changed. Sign in with your passcode.', 'இந்த எண்ணுக்கு ஏற்கனவே EDMS கணக்கு உள்ளது; எதுவும் மாற்றப்படவில்லை. உங்கள் கடவுச்சொல்லுடன் உள்நுழையவும்.')}
                  {' '}
                  {exists.whatsapp
                    ? t('Forgot it? Tap the green button to get your login on WhatsApp.', 'கடவுச்சொல் மறந்துவிட்டால், கீழே உள்ள பச்சை பொத்தானை அழுத்தி வாட்ஸ்அப்பில் பெறுங்கள்.')
                    : t('Forgot it? WhatsApp us on +91 79047 59268 from this number.', 'கடவுச்சொல் மறந்துவிட்டால், இதே எண்ணிலிருந்து +91 79047 59268 க்கு வாட்ஸ்அப்பில் எழுதுங்கள்.')}
                </p>
                {exists.whatsapp && (
                  <div className="en-actions">
                    <a className="en-btn en-btn--wa" id="wa-login" href={`https://wa.me/${exists.whatsapp.number}?text=${encodeURIComponent(isTa ? (exists.whatsapp.text_ta || exists.whatsapp.text) : exists.whatsapp.text)}`} target="_blank" rel="noreferrer"><MessageCircle size={18} aria-hidden="true" /> {t('Send my login to WhatsApp', 'என் உள்நுழைவை வாட்ஸ்அப்பில் அனுப்பு')}</a>
                  </div>
                )}
                <div className="en-actions">
                  <Link className="en-btn" to="/login">{t('Sign in', 'உள்நுழைக')} <ArrowRight size={18} aria-hidden="true" /></Link>
                  {!exists.whatsapp && <a className="en-btn en-btn--ghost" href="https://wa.me/917904759268">{t('WhatsApp us', 'வாட்ஸ்அப்பில் எழுதுங்கள்')}</a>}
                </div>
                <p className="en-alt"><button type="button" className="en-link" onClick={() => { setExists(null); setStep(0); setF((s) => ({ ...s, mobile: '' })); }}>{t('Use a different number', 'வேறு எண்ணைப் பயன்படுத்துக')}</button></p>
              </div>
            ) : done?.whatsapp ? (
              <div className="en-done en-pane en-done--wa">
                <span className="tag"><CheckCircle2 size={16} aria-hidden="true" /> {t('Registered', 'பதிவானது')}</span>
                <p>{t('One last step: get your login on WhatsApp. Tap the green button. WhatsApp opens with a ready message; just press Send, and your login and payment details arrive in seconds.', 'கடைசிப் படி: உங்கள் உள்நுழைவு விவரங்களை வாட்ஸ்அப்பில் பெறுங்கள். கீழே உள்ள பச்சை பொத்தானை அழுத்தவும்; வாட்ஸ்அப் ஒரு செய்தியுடன் திறக்கும். Send அழுத்தினால் போதும்; உள்நுழைவு விவரங்களும் கட்டண விவரங்களும் சில நொடிகளில் வரும்.')}</p>
                <div className="en-actions"><a className="en-btn en-btn--wa" id="wa-login" href={`https://wa.me/${done.whatsapp.number}?text=${encodeURIComponent(done.whatsapp.text)}`} target="_blank" rel="noreferrer"><MessageCircle size={18} aria-hidden="true" /> {t('Send my login to WhatsApp', 'என் உள்நுழைவை வாட்ஸ்அப்பில் அனுப்பு')}</a></div>
                <div className="cred cred--one"><div><span>{t('Username', 'பயனர் பெயர் (Username)')}</span><b>{done.username}</b></div></div>
                <p className="en-note">{t('Did not get it? Tap the green button again, or WhatsApp us: ', 'வரவில்லையா? பச்சை பொத்தானை மீண்டும் அழுத்தவும், அல்லது வாட்ஸ்அப்பில் எழுதுங்கள்: ')}<a className="en-link" href={`https://wa.me/${done.whatsapp.number}`} target="_blank" rel="noreferrer">+91 79047 59268</a></p>
                <div className="en-actions"><Link className="en-btn en-btn--ghost" to="/login">{t('Sign in', 'உள்நுழைக')} <ArrowRight size={18} aria-hidden="true" /></Link></div>
              </div>
            ) : done ? (
              <div className="en-done en-pane">
                <span className="tag"><CheckCircle2 size={16} aria-hidden="true" /> {t('Registered', 'பதிவானது')}</span>
                <p>{t('Your login is below and on its way to your WhatsApp. Take a screenshot or write it down; it is not shown again after you leave this page.', 'உங்கள் உள்நுழைவு கீழே உள்ளது; உங்கள் வாட்ஸ்அப்பிற்கும் அனுப்பப்பட்டது. ஸ்கிரீன்ஷாட் எடுக்கவும் அல்லது எழுதி வைக்கவும்; பக்கத்தை மூடினால் மீண்டும் காட்டப்படாது.')}</p>
                <div className="cred"><div><span>{t('Username', 'பயனர் பெயர் (Username)')}</span><b>{done.username}</b></div><div><span>{t('Passcode', 'கடவுச்சொல் (Passcode)')}</span><b>{done.passcode}</b></div></div>
                <div className="en-actions"><Link className="en-btn" to="/login">{t('Sign in now', 'இப்போது உள்நுழைக')} <ArrowRight size={18} aria-hidden="true" /></Link></div>
              </div>
            ) : (
              <form onSubmit={submit} noValidate>
                {step === 0 && (
                  <div className="en-pane" key="s0">
                    <label className="en-f"><span className="lbl">{t('Full name', 'முழு பெயர்')}<Req /></span>
                      <span className="en-in"><User size={19} className="ico" aria-hidden="true" /><input id="full_name" type="text" value={f.full_name} onChange={(e) => set('full_name', e.target.value.replace(/[0-9]/g, ''))} placeholder={t('As on your voter ID', 'வாக்காளர் அடையாள அட்டைப்படி')} autoComplete="name" /></span>
                    </label>
                    <label className="en-f"><span className="lbl">{t('WhatsApp number', 'வாட்ஸ்அப் எண்')}<Req /></span>
                      <span className="en-in"><Phone size={19} className="ico" aria-hidden="true" /><input id="mobile" type="tel" inputMode="numeric" pattern="[0-9]*" maxLength={10} value={f.mobile} onChange={(e) => set('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder={t('10-digit WhatsApp number', '10 இலக்க வாட்ஸ்அப் எண்')} autoComplete="tel-national" /></span>
                    </label>
                    <p className="en-note" id="mobile-note">{waForAll
                      ? t('Your login will be sent to this number on WhatsApp only, not shown on screen. Enter the correct number.', 'உங்கள் உள்நுழைவு விவரங்கள் இந்த எண்ணுக்கு மட்டுமே வாட்ஸ்அப்பில் அனுப்பப்படும்; திரையில் காட்டப்படாது. சரியான எண்ணை உள்ளிடவும்.')
                      : t('Your login details are shown on screen after you register and sent to this WhatsApp number. Enter the correct number.', 'பதிவு முடிந்ததும் உள்நுழைவு விவரங்கள் திரையில் காட்டப்படும்; இந்த வாட்ஸ்அப் எண்ணுக்கும் அனுப்பப்படும். சரியான எண்ணை உள்ளிடவும்.')} {t('When you press Next we keep your name and number, so our team can help if you do not finish.', 'அடுத்து என்பதை அழுத்தும்போது உங்கள் பெயரும் எண்ணும் சேமிக்கப்படும்; பதிவை முடிக்காவிட்டால் எங்கள் குழு உதவும்.')}</p>
                  </div>
                )}

                {step === 1 && (
                  <div className="en-pane" key="s1">
                    <div className="en-f"><span className="lbl">{t('Your role', 'உங்கள் பங்கு')}</span>
                      <SelectIn icon={Users} id="role" label={t('Your role', 'உங்கள் பங்கு')} value={f.role} onChange={(e) => set('role', e.target.value)}>
                        <option value="">{t('Select your role', 'உங்கள் பங்கைத் தேர்ந்தெடுக்கவும்')}</option>
                        {ROLES.map(([v, en, ta]) => <option key={v} value={v}>{isTa ? ta : en}</option>)}
                      </SelectIn>
                    </div>
                    <div className="en-f"><span className="lbl">{t('Political affiliation', 'அரசியல் சார்பு')}</span>
                      <div className="en-opts">
                        <Opt group="affiliation" value="affiliated" label={t('Affiliated with a party', 'கட்சி சார்புடையவர்')} />
                        <Opt group="affiliation" value="independent" label={t('Independent', 'சுயேச்சை')} onPick={() => setF((s) => ({ ...s, affiliation: 'independent', party: '' }))} />
                      </div>
                    </div>
                    {f.affiliation === 'affiliated' && (
                      <div className="en-f"><span className="lbl">{t('Party', 'அரசியல் கட்சி')}</span>
                        <SelectIn icon={Flag} id="party" label={t('Party', 'அரசியல் கட்சி')} value={f.party} onChange={(e) => set('party', e.target.value)}>
                          <option value="">{t('Select party', 'கட்சியைத் தேர்ந்தெடுக்கவும்')}</option>
                          {PARTIES.map((p) => <option key={p} value={p}>{p}</option>)}
                        </SelectIn>
                      </div>
                    )}
                  </div>
                )}

                {step === 2 && (
                  <div className="en-pane" key="s2">
                    <div className="en-f"><span className="lbl">{t('Local body type', 'உள்ளாட்சி அமைப்பு வகை')}<Req /></span>
                      <div className="en-opts">
                        <Opt group="body_type" value="rural" label={t('Rural local body', 'கிராமப்புற உள்ளாட்சி')} note={t('Panchayats, unions, district panchayat', 'ஊராட்சிகள், ஒன்றியங்கள், மாவட்ட ஊராட்சி')} onPick={() => setF((s) => ({ ...s, body_type: 'rural', position: '', district: '', ...resetBelow }))} />
                        <Opt group="body_type" value="urban" label={t('Urban local body', 'நகர்ப்புற உள்ளாட்சி')} note={t('Town panchayats, municipalities, corporations', 'பேரூராட்சிகள், நகராட்சிகள், மாநகராட்சிகள்')} onPick={() => setF((s) => ({ ...s, body_type: 'urban', position: '', district: '', ...resetBelow }))} />
                      </div>
                    </div>
                    {!!positions.length && (
                      <div className="en-f"><span className="lbl">{t("Position you're contesting", 'போட்டியிடும் பதவி')}<Req /></span>
                        <SelectIn icon={Landmark} id="position" label={t("Position you're contesting", 'போட்டியிடும் பதவி')} value={f.position} onChange={(e) => setF((s) => ({ ...s, position: e.target.value, district: '', ...resetBelow }))}>
                          <option value="">{t('Select position', 'பதவியைத் தேர்ந்தெடுக்கவும்')}</option>
                          {positions.map((p) => <option key={p} value={p}>{p}</option>)}
                        </SelectIn>
                      </div>
                    )}
                    {!!f.position && (
                      <div className="en-row2">
                        <div className="en-f"><span className="lbl">{t('District', 'மாவட்டம்')}<Req /></span>
                          <SelectIn icon={MapPin} id="district" label={t('District', 'மாவட்டம்')} value={f.district} onChange={(e) => setF((s) => ({ ...s, district: e.target.value, ...resetBelow }))}>
                            <option value="">{t('Select district', 'மாவட்டத்தைத் தேர்ந்தெடுக்கவும்')}</option>
                            {districts.map((d) => <option key={d} value={d}>{d}</option>)}
                          </SelectIn>
                        </div>
                        <div className="en-f"><span className="lbl">{t('Assembly constituency', 'சட்டமன்றத் தொகுதி')}<Req /></span>
                          <SelectIn icon={Building2} id="assembly" label={t('Assembly constituency', 'சட்டமன்றத் தொகுதி')} value={f.assembly_id || ''} onChange={(e) => { const id = e.target.value; const found = allAssemblies.find((a) => String(a.assembly_no) === id); setF((s) => ({ ...s, assembly_id: id, assembly_name: found ? found.assembly_name : '', selected_booths: [] })); }}>
                            <option value="">{f.district ? t('Select constituency', 'தொகுதியைத் தேர்ந்தெடுக்கவும்') : t('Choose a district first', 'முதலில் மாவட்டம்')}</option>
                            {districtAssemblies.map((a) => <option key={a.assembly_no} value={a.assembly_no}>No. {a.assembly_no} - {a.assembly_name}</option>)}
                          </SelectIn>
                        </div>
                      </div>
                    )}
                    {!!f.assembly_id && (
                      <div className="en-f">
                        <AssemblyMap assemblyNo={f.assembly_id} booths={availableBooths} selected={selected} />
                        <div className="en-booth-head">
                          <span>{t('Select booths', 'வாக்குச்சாவடிகளைத் தேர்ந்தெடுங்கள்')} · {selected.length} {t('chosen', 'தேர்வு')}</span>
                          <span className="tools"><button type="button" className="en-link" onClick={() => setF((s) => ({ ...s, selected_booths: availableBooths.map((b) => b.part_no) }))}>{t('Select all', 'அனைத்தும்')}</button><button type="button" className="en-link" onClick={() => setF((s) => ({ ...s, selected_booths: [] }))}>{t('Clear', 'அழி')}</button></span>
                        </div>
                        {loadingBooths ? <p className="en-note">{t('Loading polling booths…', 'வாக்குச்சாவடிகள் ஏற்றப்படுகின்றன…')}</p>
                          : availableBooths.length === 0 ? <p className="en-note">{t('No booths found for this assembly.', 'வாக்குச்சாவடிகள் ஏதும் கிடைக்கவில்லை.')}</p>
                          : (
                            <div className="en-booths">
                              {availableBooths.map((b) => {
                                const on = selected.includes(b.part_no);
                                return <button key={b.part_no} type="button" className="en-booth" aria-pressed={on} title={`Part ${b.part_no}: ${b.booth_name || b.booth || ''}`} onClick={() => setF((s) => { const cur = s.selected_booths || []; return { ...s, selected_booths: cur.includes(b.part_no) ? cur.filter((x) => x !== b.part_no) : [...cur, b.part_no] }; })}><b>{t('Booth', 'பாகம்')} {b.part_no}</b>{b.booth_name || b.booth || ''}</button>;
                              })}
                            </div>
                          )}
                      </div>
                    )}
                  </div>
                )}

                {err && <p className="en-error" role="alert">{err}</p>}
                <div className="en-actions">
                  {step > 0 && <button type="button" className="en-btn en-btn--ghost" onClick={back}><ArrowLeft size={18} aria-hidden="true" /> {t('Back', 'பின்')}</button>}
                  {step < 2
                    ? <button type="button" className="en-btn" id="next" onClick={next}>{t('Next', 'அடுத்து')} <ArrowRight size={18} aria-hidden="true" /></button>
                    : <button type="submit" className="en-btn" disabled={loading}>{loading ? t('Processing…', 'செயலாக்கப்படுகிறது…') : t('Create account', 'கணக்கை உருவாக்குக')} {!loading && <ArrowRight size={18} aria-hidden="true" />}</button>}
                </div>
              </form>
            )}
          </section>
        </div>
      </main>

      <div className="en-more">
        <section className="en-panel en-faq" id="questions" aria-labelledby="h-faq">
          <h2 id="h-faq">{t('Questions', 'கேள்விகள்')}</h2>
          <div className="en-faq-cols">
          {QUESTIONS.map(([q, a, qTa, aTa]) => <p key={q}><b>{isTa ? qTa : q}</b> {isTa ? aTa : a}</p>)}
          <p><b>{t('Who do I write to?', 'யாருக்கு எழுதுவது?')}</b> {t('WhatsApp', 'வாட்ஸ்அப்')} <a className="en-link" href="https://wa.me/917904759268">+91 79047 59268</a>. <Link className="en-link" to="/faq">{t('More questions (FAQ)', 'மேலும் கேள்விகள் (FAQ)')}</Link></p>
          </div>
        </section>
      </div>
      <EntryFoot t={t} />
    </div>
  );
}
