import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  UserPlus, MapPin, BadgeCheck, Search, AlertTriangle, CircleAlert, CircleCheck, Info, RefreshCw, ArrowUpRight,
} from 'lucide-react';
import api from '../api/client.js';
import { PageHeader, Card, Pill, Kpi, BarChart, BarList, Funnel, Segmented, Skeleton, inr } from '../civic/kit.jsx';
import { hasBooths, openRequestCount, isTestReg, isInvalidPaid, paidMobiles, cleanMobile, atLeast } from '../civic/needs.js';
import { useAttention, attentionItems, allClear, loadSource, refreshAttention, waitingItems, cleanupItems, countOf } from '../civic/attention.js';

// Super Admin dashboard (Civic Ops step 1). Built only on existing APIs:
// /dashboard/stats, /dashboard/search-epic, /registrations, /payments/pending-utrs.
// (CRM figures removed 2026-10-12 with the WhatsApp CRM; chats are handled in WACTO.) Registrations are aggregated in the browser; when the
// total grows past a few hundred this should move to a summary endpoint.
const DAY = 86400000;

const PERIODS = [
  { id: '7', label: '7D' },
  { id: '30', label: '30D' },
  { id: '90', label: '90D' },
  { id: 'all', label: 'All' },
];

const dayKey = (d) => d.toISOString().slice(0, 10);



const whyVoters = (e) => (!e?.response ? 'no connection to the server' : e.response.status >= 500 ? `server error ${e.response.status}` : e.response.data?.message || `error ${e.response.status}`);

export default function AdminDashboard() {
  // Payments + registrations come from the shared attention store (the top-bar bell reads the same one);
  // voter totals load here. Each source still fails on its own.
  const att = useAttention(true);
  const [voters, setVoters] = useState(undefined);
  const [votersErr, setVotersErr] = useState('');
  const [votersBusy, setVotersBusy] = useState(true);
  const data = { ...att.data, voters };
  const errs = { ...att.errs, ...(votersErr ? { voters: votersErr } : {}) };
  const busy = { ...att.busy, voters: votersBusy };
  const at = att.at;
  const [period, setPeriod] = useState('30');
  const [tidyOpen, setTidyOpen] = useState(false); // phone only: Data clean-up folds to one row
  const [epic, setEpic] = useState('');
  const [epicResult, setEpicResult] = useState(null);
  const [epicBusy, setEpicBusy] = useState(false);

  const loadVoters = () => {
    setVotersBusy(true);
    return api.get('/dashboard/stats')
      .then((r) => { setVoters(r.data); setVotersErr(''); })
      .catch((e) => { setVoters(undefined); setVotersErr(whyVoters(e)); })
      .finally(() => setVotersBusy(false));
  };
  const loadOne = (key) => (key === 'voters' ? loadVoters() : loadSource(key));
  const load = () => Promise.all([refreshAttention(), loadVoters()]);
  useEffect(() => { loadVoters(); }, []);
  const anyBusy = Object.values(busy).some(Boolean);
  const waiting = (key) => data[key] === undefined && !errs[key]; // first load still running

  const m = useMemo(() => {
    if (!data.regs) return null;
    const rows = data.regs.rows;
    const now = Date.now();
    const count = (f) => rows.reduce((acc, r) => { const k = f(r) || '—'; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
    const toList = (obj) => Object.entries(obj).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    const inLast = (days) => rows.filter((r) => now - new Date(r.created_at).getTime() <= days * DAY).length;
    // same tests as the Registrations "Show" filter (civic/needs.js), so each count opens exactly its rows
    const oddPaid = rows.filter(isInvalidPaid).length;
    const withBooths = rows.filter(hasBooths).length;
    // the funnel's paid step: candidates with booths whose payment is on the received list (matched by mobile)
    const paid = data.subs ? paidMobiles(data.subs) : null;
    const isPaidReg = (r) => !!paid && paid.has(cleanMobile(r.mobile));
    const paidWithBooths = paid ? rows.filter((r) => hasBooths(r) && isPaidReg(r)).length : null;
    const paidNoBooths = paid ? rows.filter((r) => !hasBooths(r) && isPaidReg(r)).length : 0;
    const testRows = rows.filter(isTestReg).length;
    const openRequests = rows.filter((r) => openRequestCount(r) > 0).length; // candidates, as the list shows candidates
    const body = count((r) => String(r.body_type || '').toLowerCase() === 'urban' ? 'Urban' : String(r.body_type || '').toLowerCase() === 'rural' ? 'Rural' : 'Unknown');
    const source = count((r) => (r.source === 'whatsapp_bot' ? 'WhatsApp bot' : 'Website'));
    // last 14 days for the KPI sparkline
    const spark = Array.from({ length: 14 }, (_, i) => {
      const k = dayKey(new Date(now - (13 - i) * DAY));
      return rows.filter((r) => String(r.created_at).slice(0, 10) === k).length;
    });
    return {
      rows, total: data.regs.total, loaded: rows.length, capped: !!data.regs.capped, oddPaid, withBooths, paidWithBooths, paidNoBooths, testRows, openRequests,
      last30: inLast(30), last7: inLast(7),
      districts: toList(count((r) => r.district)),
      positions: toList(count((r) => r.position)),
      body, source, spark,
    };
  }, [data.regs, data.subs]);

  const series = useMemo(() => {
    if (!m) return [];
    if (period === 'all') {
      const byMonth = {};
      m.rows.forEach((r) => { const k = String(r.created_at).slice(0, 7); byMonth[k] = (byMonth[k] || 0) + 1; });
      return Object.keys(byMonth).sort().map((k) => ({ label: new Date(`${k}-01`).toLocaleDateString('en-IN', { month: 'short' }), full: new Date(`${k}-01`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }), value: byMonth[k] }));
    }
    const days = Number(period);
    const now = Date.now();
    return Array.from({ length: days }, (_, i) => {
      const d = new Date(now - (days - 1 - i) * DAY);
      const k = dayKey(d);
      return { label: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), full: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' }), value: m.rows.filter((r) => String(r.created_at).slice(0, 10) === k).length };
    });
  }, [m, period]);


  const updated = at ? at.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';
  const firstLoad = waiting('regs') || waiting('utrs') || waiting('subs');
  // "Paid" has one meaning in the admin: payments received, the same list as the Payments page.
  const received = data.subs || [];
  const receivedAmount = received.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const attention = attentionItems(att); // same list as the bell
  const waitingList = waitingItems(attention);
  const cleanupList = cleanupItems(attention);
  const chip = (a) => {
    const Icon = a.tone === 'bad' ? CircleAlert : a.tone === 'warn' ? AlertTriangle : Info;
    return a.retry ? (
      <button key={a.key} type="button" className={`cv-attn-chip cv-attn-chip--${a.tone}`} onClick={() => loadOne(a.retry)} disabled={busy[a.retry]} title={a.text}>
        <Icon size={14} /> {a.short} · {busy[a.retry] ? 'retrying…' : 'retry'}
      </button>
    ) : (
      <Link key={a.key} to={a.to} className={`cv-attn-chip cv-attn-chip--${a.tone} ${a.lead ? 'cv-attn-chip--lead' : ''}`} title={`${inr(a.n)}${a.more ? '+' : ''} ${a.text}`}>
        <Icon size={14} /> <span><strong>{inr(a.n)}{a.more ? '+' : ''}</strong> {a.short}{a.detail && <span className="cv-attn-detail"> · {a.detail}</span>}</span>
      </Link>
    );
  };
  const retryBtn = (key) => <button type="button" className="cv-btn cv-btn--ghost cv-btn--sm" onClick={() => loadOne(key)} disabled={busy[key]}>{busy[key] ? 'Retrying…' : 'Retry'}</button>;
  // Trend cards just say so; the one Retry for registrations sits in the attention strip.
  const regsFailed = (h) => (errs.regs ? <p className="cv-empty cv-empty--bad">Registrations couldn't load.</p> : <Skeleton h={h} />);

  const searchEpic = async (e) => {
    e.preventDefault();
    if (!epic.trim()) return;
    setEpicBusy(true);
    try {
      const { data } = await api.get('/dashboard/search-epic', { params: { epic: epic.trim() } });
      setEpicResult(data);
    } catch {
      setEpicResult({ success: false, message: 'Search failed.' });
    } finally {
      setEpicBusy(false);
    }
  };

  const v = data.voters?.stats;

  const epicForm = (
    <form className="cv-epic" onSubmit={searchEpic}>
      <label className="cv-search">
        <Search size={15} />
        <input value={epic} onChange={(e) => setEpic(e.target.value.toUpperCase())} placeholder="Search a voter by EPIC number" aria-label="EPIC number" />
      </label>
      <button type="submit" className="cv-btn" disabled={epicBusy || !epic.trim()}>{epicBusy ? 'Searching…' : 'Search'}</button>
    </form>
  );

  return (
    <div className="cv-page cv-page--dash">
      <PageHeader
        title="Dashboard"
        subtitle={updated ? `Tamil Nadu local body elections 2026 · updated ${updated}${Object.keys(errs).length ? " · some figures couldn't load" : ''}` : 'Loading live figures…'}
        actions={<button type="button" className="cv-btn cv-btn--ghost cv-refresh" onClick={load} disabled={anyBusy} aria-label="Refresh figures"><RefreshCw size={14} className={anyBusy ? 'cv-spin' : ''} /> <span className="cv-refresh-label">Refresh</span></button>}
      />

      {/* 1 · What needs Ram today: who is waiting on him, then data clean-up, as clickable chips
            (the bell shows the same list on every page; its badge counts only "Waiting on you"). */}
      {firstLoad ? <div className="cv-attn-skel"><Skeleton h="var(--cv-attn-skel-h, 44px)" /></div> : attention.length ? (
        <nav className="cv-attn-strip" aria-label="Needs attention">
          <div className="cv-attn-group">
            <span className="cv-attn-group-label">Waiting on you</span>
            <div className="cv-attn-chips">{waitingList.length ? waitingList.map(chip) : <span className="cv-attn-none"><CircleCheck size={14} /> nothing right now</span>}</div>
          </div>
          {cleanupList.length > 0 && (
            // Desktop: a quiet second row of chips. Phone: one "to tidy" row that opens the list (civic-ui.css).
            <div className={`cv-attn-group cv-attn-group--quiet ${tidyOpen ? 'cv-attn-group--open' : ''}`}>
              <span className="cv-attn-group-label">Data clean-up</span>
              <button type="button" className="cv-attn-fold" aria-expanded={tidyOpen} aria-controls="cv-attn-tidy" onClick={() => setTidyOpen((o) => !o)}>
                <span>Data clean-up</span> <span className="cv-attn-fold-n">{inr(countOf(cleanupList))} to tidy</span>
              </button>
              <div className="cv-attn-chips cv-attn-tidy" id="cv-attn-tidy">{cleanupList.map(chip)}</div>
            </div>
          )}
        </nav>
      ) : allClear(att, attention) && (
        <div className="cv-allclear"><CircleCheck size={16} /> <span><strong>All clear.</strong> Nothing needs you right now.</span></div>
      )}

      {/* on a phone the EPIC search (the most-used action) sits right under the figures instead of at the foot (UX6) */}
      <div className="cv-epic-quick"><Card title="Find a voter" meta="By EPIC number">{epicForm}</Card></div>

      {/* 2 · Totals only; each tile opens its list. What waits on Ram is said once, in the strip above. */}
      <div className="cv-kpis cv-kpis--3">
        {firstLoad ? Array.from({ length: 3 }, (_, i) => <div key={i} className="cv-kpi"><Skeleton w="60%" /><Skeleton h={28} w="40%" /><Skeleton w="70%" /></div>) : (
          <>
            {errs.subs
              ? <Kpi icon={BadgeCheck} label="Payments received" value="—" note="couldn't load" tone="bad" to="/payments?tab=paid" />
              : <Kpi icon={BadgeCheck} label="Payments received" value={atLeast(received)} note={received.capped ? `latest ${inr(received.length)} shown · ₹${inr(receivedAmount)} in those` : received.length ? `₹${inr(receivedAmount)} incl. GST` : 'none yet'} to="/payments?tab=paid" />}
            {m ? (
              <>
                <Kpi icon={MapPin} label="Booths assigned" value={`${inr(m.withBooths)}`} note={m.capped ? `of the latest ${inr(m.loaded)} candidates` : `${Math.round((m.withBooths / Math.max(m.loaded, 1)) * 100)}% of candidates`} to="/registrations" />
                <Kpi icon={UserPlus} label="Registrations" value={inr(m.total)} note={`${m.last30} in last 30 days · ${m.last7} this week`} spark={m.spark} to="/registrations" />
              </>
            ) : ['Booths assigned', 'Registrations'].map((l) => <Kpi key={l} label={l} value="—" note="couldn't load" tone="bad" to="/registrations" />)}
          </>
        )}
      </div>

      {/* 3 · Trends and reference data, below the work. */}
      <div className="cv-section-head">
        <h2>Trends</h2>
        <p>How candidates are joining, and the electoral roll</p>
      </div>

      <div className="cv-grid cv-grid--2-1">
        <Card title="New registrations" meta={period === 'all' ? 'Per month, all time' : `Per day, last ${period} days`} action={<Segmented options={PERIODS} value={period} onChange={setPeriod} />}>
          {m ? <BarChart data={series} period={period === 'all' ? 'month' : 'day'} /> : regsFailed(200)}
        </Card>
        <Card title="Candidate pipeline" meta={m?.capped ? `The latest ${inr(m.loaded)} of ${inr(m.total)} registrations` : 'Registered candidates, from sign-up to paid'}>
          {!m ? regsFailed(200) : (
            <Funnel steps={[
              { label: 'Registered', value: m.loaded },
              { label: 'Booths assigned', value: m.withBooths },
              // one meaning of "paid" on this page: a payment on the received list (UX1); the tile above shows the same number
              m.paidWithBooths == null
                ? { label: 'Paid', value: null, note: errs.subs ? "Payments received couldn't load." : 'Checking payments…' }
                : { label: 'Paid', value: received.length, note: m.paidNoBooths ? `${inr(m.paidWithBooths)} with booths · ${inr(m.paidNoBooths)} without booths yet` : undefined },
            ]} />
          )}
        </Card>
      </div>

      <div className="cv-grid cv-grid--1-1">
        <Card title="By district" meta={m ? `${m.districts.length} of 38 districts` : ''}>
          {m ? <BarList items={m.districts.slice(0, 10)} /> : regsFailed(220)}
          {m && m.districts.length > 10 && <p className="cv-more">+ {m.districts.length - 10} more districts</p>}
        </Card>
        <Card title="By position" meta="What candidates are contesting">
          {m ? <BarList items={m.positions} /> : regsFailed(220)}
        </Card>
        <Card title="How candidates join" meta="Sign-up channel and local body type">
          {m ? (
            <>
              <BarList items={[{ label: 'WhatsApp bot', value: m.source['WhatsApp bot'] || 0 }, { label: 'Website', value: m.source.Website || 0 }]} />
              <div className="cv-splits">
                <div><span>Rural</span><strong>{m.body.Rural || 0}</strong></div>
                <div><span>Urban</span><strong>{m.body.Urban || 0}</strong></div>
              </div>
            </>
          ) : regsFailed(220)}
        </Card>

        <Card title="Electoral roll" meta={errs.voters ? `Voter totals couldn't load (${errs.voters})` : data.voters?.voterDbOnline === false ? 'Voter database offline' : 'Master roll · 234 assemblies'} action={errs.voters ? retryBtn('voters') : null}>
          <div className="cv-roll">
            <div><span>Total voters</span><strong>{v ? inr(v.totalVoters) : '—'}</strong></div>
            <div><span>Male</span><strong>{v ? inr(v.maleVoters) : '—'}</strong></div>
            <div><span>Female</span><strong>{v ? inr(v.femaleVoters) : '—'}</strong></div>
            <div><span>Other</span><strong>{v ? inr(v.otherVoters) : '—'}</strong></div>
          </div>
          <div className="cv-epic-desktop">{epicForm}</div>
          {epicResult && (epicResult.success ? (
            <div className="cv-epic-result">
              <span className="cv-mono">{epicResult.voter.EPIC_NO}</span>
              <div>
                <strong>{epicResult.voter.VOTER_NAME_EN}</strong>
                {epicResult.voter.VOTER_NAME && <div className="cv-ta">{epicResult.voter.VOTER_NAME}</div>}
              </div>
              <dl>
                <div><dt>Assembly</dt><dd>{epicResult.voter.ASSEMBLY_NO} · {epicResult.assembly_name}</dd></div>
                <div><dt>Part</dt><dd>{epicResult.voter.PART_NO}</dd></div>
                <div><dt>Age</dt><dd>{epicResult.voter.AGE}</dd></div>
                <div><dt>Gender</dt><dd>{epicResult.voter.GENDER}</dd></div>
              </dl>
              <Link to="/voters" className="cv-link">Voters <ArrowUpRight size={13} /></Link>
            </div>
          ) : <p className="cv-empty">{epicResult.message}</p>)}
        </Card>
      </div>

      {m && <p className="cv-foot"><Pill tone="neutral">Data</Pill> Charts are built from all {inr(m.rows.length)} registrations. Payments and registrations refresh every 5 minutes; Refresh updates them now.</p>}
    </div>
  );
}
