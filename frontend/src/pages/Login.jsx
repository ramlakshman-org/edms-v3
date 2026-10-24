import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { User, Lock, ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang, useLightPage, EntryHeader, EntryIntro, EntryFoot } from '../entry/parts.jsx';

// Public sign-in — EDMS-1, same family as the register page (master reference approved by Ram on 2026-10-14).
// Same call as before: AuthContext.login → POST /auth/login (mobile + passcode), then the role's home page.
// There is no password-reset route in EDMS: recovery is a WhatsApp message to the team.
export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const { lang, setLang, t } = useLang();
  useLightPage();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (loading) return; // no double submission
    setErr(''); setLoading(true);
    try {
      const res = await login(username, password);
      if (res.success) nav(res.user?.home || '/dashboard', { replace: true });
      else setErr(res.message || t('Login failed.', 'உள்நுழைவு தோல்வியடைந்தது.'));
    } catch (e2) {
      setErr(e2.response?.data?.message || t('Login failed.', 'உள்நுழைவு தோல்வியடைந்தது.'));
    } finally { setLoading(false); }
  };

  return (
    <div className="en">
      <EntryHeader lang={lang} setLang={setLang} t={t} have={t('New to EDMS?', 'EDMS-க்கு புதியவரா?')} action={<Link className="en-link" to="/register">{t('Create account', 'கணக்கை உருவாக்குக')}</Link>} />
      <main className="en-split en-login">
        <EntryIntro t={t} title={t('Election Data Management System', 'தேர்தல் தரவு மேலாண்மை அமைப்பு')} />
        <div className="en-card-wrap">
          <section className="en-card" aria-labelledby="h-login">
            <h2 id="h-login">{t('Welcome back', 'மீண்டும் வருக')}</h2>
            <p className="en-sub">{t('Your username is your mobile number. The passcode came to your WhatsApp when you registered.', 'உங்கள் பயனர் பெயர் உங்கள் கைபேசி எண். கடவுச்சொல் பதிவின் போது உங்கள் வாட்ஸ்அப்பிற்கு வந்தது.')}</p>
            <form onSubmit={submit} noValidate style={{ marginTop: 28 }}>
              {err && <p className="en-error" role="alert">{err}</p>}
              <label className="en-f"><span className="lbl">{t('Username or mobile', 'பயனர் பெயர் அல்லது கைபேசி')}</span>
                <span className="en-in"><User size={19} className="ico" aria-hidden="true" /><input id="username" type="text" inputMode="numeric" value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t('10-digit mobile number', '10 இலக்க கைபேசி எண்')} autoComplete="username" required /></span>
              </label>
              <label className="en-f"><span className="lbl">{t('Passcode', 'கடவுச்சொல்')}</span>
                <span className="en-in"><Lock size={19} className="ico" aria-hidden="true" /><input id="password" type="password" inputMode="numeric" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('6-digit passcode', '6 இலக்க கடவுச்சொல்')} autoComplete="current-password" required /></span>
              </label>
              <div className="en-actions">
                <button className="en-btn" type="submit" disabled={loading}>{loading ? t('Signing in…', 'உள்நுழைகிறது…') : t('Sign in', 'உள்நுழைக')} {!loading && <ArrowRight size={18} aria-hidden="true" />}</button>
              </div>
              {import.meta.env.VITE_MOCK_LOGINS === '1' && (
                <div className="en-devnote"><strong>Local test server</strong> (any password): <code>admin</code> Super Admin · <code>candidate</code> paid, 5 booths · <code>ward</code> unpaid, 3 booths · <code>mla</code> assembly 86 · <code>legacy</code> paid=1 · <code>booth</code> booth login</div>
              )}
              <p className="en-alt">
                <a className="en-link" href="https://wa.me/917904759268">{t('Forgot your passcode? WhatsApp us', 'கடவுச்சொல் மறந்துவிட்டதா? வாட்ஸ்அப்பில் எழுதுங்கள்')}</a>
                <span>{t('New here?', 'புதியவரா?')} <Link className="en-link" to="/register">{t('Create an account', 'கணக்கை உருவாக்குக')}</Link></span>
              </p>
            </form>
          </section>
        </div>
      </main>
      <EntryFoot t={t} />
    </div>
  );
}
