import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp } from 'lucide-react';

// Shared Civic Ops building blocks (cv- prefixed, see civic.css).

export const inr = (n) => Number(n || 0).toLocaleString('en-IN');

export function PageHeader({ eyebrow, title, subtitle, actions }) {
  return (
    <div className="cv-page-head">
      <div>
        {eyebrow && <p className="cv-eyebrow">{eyebrow}</p>}
        <h1 className="cv-title">{title}</h1>
        {subtitle && <p className="cv-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="cv-page-actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, meta, action, children, flush, className = '' }) {
  return (
    <section className={`cv-card ${className}`}>
      {(title || action) && (
        <header className="cv-card-head">
          <div>
            {title && <h2 className="cv-card-title">{title}</h2>}
            {meta && <p className="cv-card-meta">{meta}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={flush ? '' : 'cv-card-body'}>{children}</div>
    </section>
  );
}

export function Pill({ tone = 'neutral', dot, icon: Icon, children }) {
  return (
    <span className={`cv-pill cv-pill--${tone}`}>
      {dot && <span className="cv-pill-dot" />}
      {Icon && <Icon size={12} style={{ flex: 'none' }} />}
      {children}
    </span>
  );
}

// `to` makes the whole tile a link to the list behind the number.
export function Kpi({ icon: Icon, label, value, note, tone, hero, spark, to }) {
  const cls = `cv-kpi ${hero ? 'cv-kpi--hero' : ''} ${tone ? `cv-kpi--${tone}` : ''} ${to ? 'cv-kpi--link' : ''}`;
  const body = (
    <>
      <span className="cv-kpi-label">{Icon && <Icon size={14} />}{label}</span>
      <div className="cv-kpi-row">
        <span className="cv-kpi-value">{value}</span>
        {spark && <Sparkline values={spark} />}
      </div>
      {note && <span className="cv-kpi-note">{note}</span>}
    </>
  );
  return to ? <Link to={to} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

export function Sparkline({ values }) {
  const w = 88, h = 26;
  if (!values?.length) return null;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => [(i / Math.max(values.length - 1, 1)) * w, h - 2 - (v / max) * (h - 4)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  return (
    <svg className="cv-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={`${line} L${w},${h} L0,${h} Z`} className="cv-spark-area" />
      <path d={line} className="cv-spark-line" />
    </svg>
  );
}

// Bars over time. data: [{label, value, full?}] (`full` names the period in the readout and summary).
// Values show on hover, on tap, and with the arrow keys once the plot has focus (one Tab stop, not one
// per bar). The top gridline carries the scale; a one-line summary under the plot says the same in
// words, for screen readers and for anyone without hover. Date labels thin out to fit the width.
// period: 'day' or 'month', only for the wording ("on 3 October" / "in August 2026").
export function BarChart({ data, height = 200, unit = ['registration', 'registrations'], period = 'day' }) {
  const [sel, setSel] = useState(null);
  const [width, setWidth] = useState(0);
  // a callback ref, so the width is tracked even when the chart first rendered as its empty state
  const ro = useRef(null);
  const box = useCallback((node) => {
    ro.current?.disconnect();
    ro.current = null;
    if (!node) return;
    setWidth(node.getBoundingClientRect().width); // measure now; the observer keeps it current
    if (typeof ResizeObserver === 'undefined') return;
    ro.current = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.current.observe(node);
  }, []);
  useEffect(() => () => ro.current?.disconnect(), []);
  useEffect(() => { setSel(null); }, [data]);

  const total = data.reduce((s, d) => s + d.value, 0);
  const max = Math.max(...data.map((d) => d.value), 1);
  const peak = data.reduce((b, d, i) => (d.value > data[b].value ? i : b), 0);
  const word = (n) => (n === 1 ? unit[0] : unit[1]);
  const name = (d) => d.full || d.label;
  // about 64px per date label, so labels never touch (11px "14 Sept" is ~44px wide)
  const fit = width ? Math.max(2, Math.floor(width / 64)) : 8;
  const step = Math.max(1, Math.ceil(data.length / fit));
  const mid = max % 2 === 0 ? max / 2 : null; // label the middle line only when it is a whole number
  // "peak" only when one bar is the highest; when several tie (e.g. one a day all week) it would pick one at random
  const tied = data.filter((d) => d.value === max).length > 1;
  const summary = total ? `${inr(total)} ${word(total)}${tied ? '' : ` · peak ${inr(data[peak].value)} ${period === 'month' ? 'in' : 'on'} ${name(data[peak])}`}` : '';
  // Pointer: a mouse shows the bar under it; a click or tap always shows the bar it lands on (never toggles
  // it off, which is what made a tap show nothing). A tap anywhere in the plot picks the nearest bar, since
  // bars are only ~8px wide on a phone. Esc, leaving with the mouse, or focus moving away clears it.
  const barAt = (e) => { const r = e.currentTarget.getBoundingClientRect(); return Math.min(data.length - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * data.length))); };

  const onKey = (e) => {
    const k = e.key;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(k)) return;
    e.preventDefault();
    if (k === 'Escape') return setSel(null);
    const last = data.length - 1;
    setSel((s) => (k === 'Home' ? 0 : k === 'End' ? last : s == null ? (k === 'ArrowLeft' ? last : 0) : Math.min(last, Math.max(0, s + (k === 'ArrowLeft' ? -1 : 1)))));
  };

  if (!data.length || !total) return <p className="cv-empty cv-bars-empty" style={{ minHeight: height }}>No {unit[1]} in this period.</p>;
  return (
    <div className="cv-bars-wrap" ref={box}>
      <div className="cv-bars" style={{ height }}>
        <div className="cv-bars-plot" tabIndex={0} role="group" aria-label={`Bar chart: ${summary}. Use the arrow keys to read each bar.`} onKeyDown={onKey} onBlur={() => setSel(null)}
          onPointerMove={(e) => { if (e.pointerType === 'mouse') setSel(barAt(e)); }}
          onPointerLeave={(e) => { if (e.pointerType === 'mouse') setSel(null); }}
          onClick={(e) => setSel(barAt(e))}>
          <span className="cv-bars-grid" style={{ bottom: '100%' }}><em>{inr(max)}</em></span>
          <span className="cv-bars-grid" style={{ bottom: '50%' }}>{mid != null && <em>{inr(mid)}</em>}</span>
          {data.map((d, i) => (
            <div key={i} className="cv-bars-col">
              <div className={`cv-bars-bar ${sel === i ? 'cv-bars-bar--on' : ''}`} style={{ height: `${(d.value / max) * 100}%` }} />
            </div>
          ))}
        </div>
        <div className="cv-bars-axis" aria-hidden="true">
          {data.map((d, i) => {
            if (i % step !== 0) return null;
            const left = ((i + 0.5) / data.length) * 100;
            const edge = left < 8 ? 'cv-bars-tick--start' : left > 92 ? 'cv-bars-tick--end' : '';
            return <span key={i} className={`cv-bars-tick ${edge}`} style={{ left: `${left}%` }}>{d.label}</span>;
          })}
        </div>
        {sel != null && (
          <div className="cv-bars-tip" style={{ left: `calc(var(--cv-bars-gutter) + (100% - var(--cv-bars-gutter)) * ${Math.min(0.9, Math.max(0.1, (sel + 0.5) / data.length))})` }} aria-hidden="true">
            <span><strong>{inr(data[sel].value)}</strong> {word(data[sel].value)}</span>
            <span>{name(data[sel])}</span>
          </div>
        )}
      </div>
      <p className="cv-bars-summary">{summary}</p>
      <p className="cv-sr-only" aria-live="polite">{sel != null ? `${name(data[sel])}: ${inr(data[sel].value)} ${word(data[sel].value)}` : ''}</p>
    </div>
  );
}

// Horizontal ranked bars. items: [{label, value, sub?}]
export function BarList({ items, max, color }) {
  const top = max || Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="cv-barlist">
      {items.map((it) => (
        <li key={it.label}>
          <span className="cv-barlist-label" title={it.label}>{it.label}</span>
          <span className="cv-barlist-track"><span style={{ width: `${(it.value / top) * 100}%`, background: color }} /></span>
          <span className="cv-barlist-value">{inr(it.value)}</span>
        </li>
      ))}
    </ul>
  );
}

// Funnel rows. steps: [{label, value (null = not known yet), note?}]
// Each step must be a subset of the one above; its share of that step is said in words
// ("89% of registered"), not as a red drop, since a low ratio is business, not an error.
export function Funnel({ steps }) {
  const top = Math.max(steps[0]?.value || 1, 1);
  return (
    <ol className="cv-funnel">
      {steps.map((s, i) => {
        const prev = i ? steps[i - 1] : null;
        const share = prev && prev.value && s.value != null ? Math.round((s.value / prev.value) * 100) : null;
        return (
          <li key={s.label}>
            <div className="cv-funnel-top">
              <span>{s.label}{share != null && <em> · {share}% of {prev.label.toLowerCase()}</em>}</span>
              <strong>{s.value == null ? '—' : inr(s.value)}</strong>
            </div>
            <div className="cv-funnel-track"><span className={i === steps.length - 1 ? 'cv-funnel-last' : ''} style={{ width: `${Math.max(((s.value || 0) / top) * 100, s.value ? 2 : 0)}%` }} /></div>
            {s.note && <p className="cv-funnel-note">{s.note}</p>}
          </li>
        );
      })}
    </ol>
  );
}

// A small tab switch (7D / 30D / 90D / All). One Tab stop (the selected option); the arrow keys,
// Home and End move the selection, as a tablist should.
export function Segmented({ options, value, onChange }) {
  const onKey = (e) => {
    const i = options.findIndex((o) => o.id === value);
    const last = options.length - 1;
    const n = { ArrowRight: i + 1 > last ? 0 : i + 1, ArrowDown: i + 1 > last ? 0 : i + 1, ArrowLeft: i - 1 < 0 ? last : i - 1, ArrowUp: i - 1 < 0 ? last : i - 1, Home: 0, End: last }[e.key];
    if (n === undefined) return;
    e.preventDefault();
    onChange(options[n].id);
    e.currentTarget.querySelectorAll('button')[n]?.focus();
  };
  return (
    <div className="cv-seg" role="tablist" onKeyDown={onKey}>
      {options.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={o.id === value} tabIndex={o.id === value ? 0 : -1} className={`cv-seg-btn ${o.id === value ? 'cv-seg-btn--on' : ''}`} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Skeleton({ h = 16, w = '100%' }) {
  return <span className="cv-skel" style={{ height: h, width: w }} />;
}

export function Trend({ value }) {
  if (value == null) return null;
  return <span className="cv-trend"><TrendingUp size={12} /> {value}</span>;
}
