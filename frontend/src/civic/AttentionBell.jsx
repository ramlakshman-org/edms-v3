import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bell, AlertTriangle, CircleAlert, Info, CircleCheck, ChevronRight, RefreshCw } from 'lucide-react';
import { useAttention, attentionItems, allClear, loadSource, refreshAttention, waitingItems, cleanupItems, countOf } from './attention.js';

const ICON = { bad: CircleAlert, warn: AlertTriangle, info: Info };

// Top-bar bell (Super Admin, every page): the badge counts the items; the panel lists them and
// each one opens its page or filtered list. Closes on navigation, outside click and Esc.
export default function AttentionBell() {
  const st = useAttention(true);
  const items = attentionItems(st);
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const btn = useRef(null);
  const loc = useLocation();

  useEffect(() => { setOpen(false); }, [loc.pathname, loc.search]);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    const t = setTimeout(() => (wrap.current?.querySelector('.cv-bell-item') || wrap.current?.querySelector('.cv-bell-panel a, .cv-bell-panel button'))?.focus(), 0);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  const waiting = waitingItems(items);
  const cleanup = cleanupItems(items);
  const failed = waiting.some((i) => i.retry);
  const checking = !st.at && Object.values(st.busy).some(Boolean);
  // the badge counts what waits on Ram; clean-up only shows inside the panel
  // the badge and the label count people and records (9 + 1 = 10), not kinds of item (2)
  // Ram, 2026-10-14 (A3): the badge counts what needs him today; "with booths, not paid" is a sales pipeline,
  // kept as a waiting item with its own count but not in the red number
  const people = countOf(waiting.filter((i) => i.key !== 'booths-unpaid'));
  const records = countOf(cleanup);
  const label = failed ? "Needs attention: some figures couldn't load" : waiting.length ? `Needs attention: ${people} waiting on you${records ? `, ${records} to tidy` : ''}` : records ? `Nothing waiting on you · ${records} to tidy` : 'Needs attention: all clear';
  const updated = st.at ? st.at.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';
  const busy = Object.values(st.busy).some(Boolean);

  const row = (i) => {
    const Icon = ICON[i.tone];
    return (
      <li key={i.key}>
        {i.retry ? (
          <button type="button" className={`cv-bell-item cv-bell-item--${i.tone}`} onClick={() => loadSource(i.retry)}>
            <Icon size={16} /><span>{i.text}</span><em>Retry</em>
          </button>
        ) : (
          <Link to={i.to} className={`cv-bell-item cv-bell-item--${i.tone}`}>
            <Icon size={16} /><span><strong>{i.n}{i.more ? '+' : ''}</strong> {i.text}</span><ChevronRight size={15} />
          </Link>
        )}
      </li>
    );
  };

  return (
    <div className="cv-bell" ref={wrap}>
      <button ref={btn} type="button" className={`cv-icon-btn cv-bell-btn ${waiting.length ? 'cv-bell-btn--on' : ''}`} aria-label={label} title={label} aria-expanded={open} aria-controls="cv-bell-panel" onClick={() => setOpen((o) => !o)}>
        <Bell size={18} />
        {waiting.length > 0 && <span className={`cv-bell-badge ${failed ? 'cv-bell-badge--bad' : ''}`} aria-hidden="true">{failed ? '!' : people > 99 ? '99+' : people}</span>}
      </button>
      {open && (
        <div className="cv-bell-panel" id="cv-bell-panel" role="region" aria-label="Needs attention">
          <header className="cv-bell-head">
            <div><strong>Needs attention</strong>{updated && <small>updated {updated}</small>}</div>
            <button type="button" className="cv-icon-btn cv-icon-btn--sm" onClick={refreshAttention} disabled={busy} aria-label="Check again"><RefreshCw size={14} className={busy ? 'cv-spin' : ''} /></button>
          </header>
          {checking ? <p className="cv-bell-note">Checking payments and registrations…</p> : items.length ? (
            <>
              <h3 className="cv-bell-group">Waiting on you</h3>
              {waiting.length ? <ul className="cv-bell-list">{waiting.map(row)}</ul> : <p className="cv-bell-clear"><CircleCheck size={16} /> Nothing waiting on you.</p>}
              {cleanup.length > 0 && <><h3 className="cv-bell-group">Data clean-up</h3><ul className="cv-bell-list cv-bell-list--quiet">{cleanup.map(row)}</ul></>}
            </>
          ) : allClear(st, items) ? <p className="cv-bell-clear"><CircleCheck size={16} /> All clear. Nothing needs you right now.</p> : <p className="cv-bell-note">Checking…</p>}
          {!/^\/(dashboard)?$/.test(loc.pathname) && <footer className="cv-bell-foot"><Link to="/dashboard">Open dashboard</Link></footer>}
        </div>
      )}
    </div>
  );
}
