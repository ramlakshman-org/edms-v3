import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Globe, ChevronDown, Users, BarChart3, MessagesSquare, ShieldCheck, Check } from 'lucide-react';
import { loadBoundaries } from '../civic/boothGeo.js';
import './entry.css';

// Shared pieces of the public pages (Login, Register). EDMS-1: the master reference approved by Ram on 2026-10-14
// (diary/assets/edms-auth-reference-2026-10-14.webp) built as real components. The real EDMS mark is used — never a
// government emblem. Behind the left side sits Ram's Tamil Nadu temple-town illustration (2026-10-14), as
// public/entry/temple-town-*.webp made by qa/make-backdrop.mjs. It is a CSS background (.en-backdrop in entry.css):
// decorative only, never clickable.

// Tamil first, as the public pages always were; the choice is remembered on this device.
export function useLang() {
  const [lang, setLang] = useState(() => { try { return localStorage.getItem('edm_lang') === 'en' ? 'en' : 'ta'; } catch { return 'ta'; } });
  useEffect(() => { try { localStorage.setItem('edm_lang', lang); } catch { /* private window */ } document.documentElement.lang = lang; }, [lang]);
  const t = (en, ta) => (lang === 'ta' ? ta : en);
  return { lang, setLang, t, isTa: lang === 'ta' };
}

// The public pages are always light: readability over the system dark-mode preference.
export function useLightPage() {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    const prev = document.body.style.background; document.body.style.background = '#F8F4ED';
    return () => { document.documentElement.removeAttribute('data-theme'); document.body.style.background = prev; };
  }, []);
}

export function EntryHeader({ lang, setLang, t, have, action }) {
  return (
    <header className="en-head">
      <Link className="en-brand" to="/register" aria-label="EDMS">
        <img src="/EDM-fav.png" alt="" width="44" height="54" />
        <span><b>EDMS</b><small>{t('Election Data Management System', 'தேர்தல் தரவு மேலாண்மை அமைப்பு')}</small></span>
      </Link>
      <div className="en-head-right">
        <label className="en-lang">
          <Globe size={18} aria-hidden="true" />
          <select id="lang" value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language / மொழி">
            <option value="ta">தமிழ்</option>
            <option value="en">English</option>
          </select>
          <ChevronDown size={15} className="chev" aria-hidden="true" />
        </label>
        <span className="en-sep" aria-hidden="true" />
        <span><span className="en-have">{have} </span>{action}</span>
      </div>
    </header>
  );
}

// Left side: kicker, title, one paragraph, the four capability tiles; the architectural backdrop sits behind them.
export function EntryIntro({ t, title }) {
  const tiles = [
    [Users, t('Booth-level voter data', 'வாக்குச்சாவடி வாரியான வாக்காளர் தரவு')],
    [BarChart3, t('Targeted outreach', 'இலக்கு சார்ந்த அணுகல்')],
    [MessagesSquare, t('Multi-channel communication', 'பல வழித் தொடர்பு')],
    [ShieldCheck, t('Secure and reliable', 'பாதுகாப்பானது, நம்பகமானது')],
  ];
  return (
    <section className="en-intro" aria-label={t('About EDMS', 'EDMS பற்றி')}>
      <p className="en-kicker" data-rise style={{ '--i': 0 }}>{t('Tamil Nadu', 'தமிழ்நாடு')}</p>
      <h1 className="en-title" data-rise style={{ '--i': 1 }}>{title}</h1>
      <p className="en-lead" data-rise style={{ '--i': 2 }}>{t('A secure and intelligent platform to manage booth-level data, connect with voters, and run effective campaigns across Tamil Nadu.', 'வாக்குச்சாவடி அளவிலான தரவை நிர்வகிக்கவும், வாக்காளர்களுடன் இணையவும், தமிழ்நாடு முழுவதும் பயனுள்ள பிரச்சாரங்களை நடத்தவும் பாதுகாப்பான, அறிவார்ந்த தளம்.')}</p>
      <ul className="en-tiles" data-rise style={{ '--i': 3 }}>
        {tiles.map(([Icon, label]) => <li key={label} className="en-tile"><i aria-hidden="true"><Icon size={28} strokeWidth={1.75} /></i>{label}</li>)}
      </ul>
      <div className="en-backdrop" aria-hidden="true" />
    </section>
  );
}

export function Stepper({ steps, current }) {
  return (
    <ol className="en-steps" aria-label="Steps">
      {steps.map((label, i) => {
        const state = i < current ? 'is-done' : i === current ? 'is-on' : '';
        return (
          <li key={label} className={`en-step ${state}`} aria-current={i === current ? 'step' : undefined}>
            <span className="dot">{i < current ? <Check size={16} strokeWidth={2.5} aria-hidden="true" /> : i + 1}</span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}

export function EntryFoot({ t }) {
  return (
    <footer className="en-foot">
      <span>© {new Date().getFullYear()} {t('Election Data Management · tnedms.com', 'தேர்தல் தரவு மேலாண்மை · tnedms.com')}</span>
      <nav>
        <Link to="/terms">{t('Terms', 'விதிமுறைகள்')}</Link>
        <Link to="/privacy">{t('Privacy', 'தனியுரிமை')}</Link>
        <Link to="/faq">{t('Questions', 'கேள்விகள்')}</Link>
        <a href="https://wa.me/917904759268">WhatsApp +91 79047 59268</a>
      </nav>
    </footer>
  );
}

// The chosen assembly's real outline with its booths; the chosen booths turn blue.
export function AssemblyMap({ assemblyNo, booths, selected }) {
  const [bounds, setBounds] = useState(null);
  useEffect(() => { loadBoundaries().then(setBounds); }, []);
  const drawn = useMemo(() => {
    const poly = bounds?.[String(Number(assemblyNo))]?.polygon;
    if (!poly || poly.length < 3) return null;
    const W = 560, H = 280, pad = 0.08;
    const xs = poly.map((q) => q[0]), ys = poly.map((q) => q[1]);
    const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
    const s = Math.min(W * (1 - 2 * pad) / (maxx - minx || 1), H * (1 - 2 * pad) / (maxy - miny || 1));
    const ox = (W - (maxx - minx) * s) / 2, oy = (H - (maxy - miny) * s) / 2;
    const X = (x) => ox + (x - minx) * s, Y = (y) => H - (oy + (y - miny) * s);
    const d = poly.map((q, i) => `${i ? 'L' : 'M'}${X(q[0]).toFixed(1)} ${Y(q[1]).toFixed(1)}`).join(' ') + 'Z';
    const dots = (booths || []).map((b) => {
      const lat = Number(b.latitude ?? b.lat), lng = Number(b.longitude ?? b.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !lat || !lng) return null;
      if (lng < minx || lng > maxx || lat < miny || lat > maxy) return null;
      return { x: X(lng), y: Y(lat), on: selected.includes(b.part_no) };
    }).filter(Boolean);
    return { d, dots };
  }, [bounds, assemblyNo, booths, selected]);
  if (!drawn) return null;
  return (
    <div className="en-minimap" aria-hidden="true">
      <svg viewBox="0 0 560 280">
        <path d={drawn.d} fill="#FFFFFF" stroke="#1B2B4B" strokeWidth="1.5" />
        {drawn.dots.map((p, i) => <circle key={i} cx={p.x.toFixed(1)} cy={p.y.toFixed(1)} r={p.on ? 3.6 : 2.6} fill={p.on ? '#2557D6' : '#C4BCAD'} />)}
      </svg>
    </div>
  );
}
