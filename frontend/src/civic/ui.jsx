import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Eye, EyeOff, Copy, Check, X, Inbox , MoreHorizontal } from 'lucide-react';

// Shared Civic Ops form/table/dialog pieces (cv- prefixed, see civic.css).

export function Field({ label, hint, children, required }) {
  return (
    <label className="cv-field">
      <span className="cv-field-label">{label}{required && <em> *</em>}</span>
      {children}
      {hint && <span className="cv-field-hint">{hint}</span>}
    </label>
  );
}

export function Input(props) {
  return <input {...props} className={`cv-input ${props.className || ''}`} />;
}

export function Select({ children, ...props }) {
  return <select {...props} className={`cv-input cv-select ${props.className || ''}`}>{children}</select>;
}

export function Textarea(props) {
  return <textarea {...props} className={`cv-input cv-textarea ${props.className || ''}`} />;
}

export function Button({ variant = 'primary', size, icon: Icon, children, className = '', ...props }) {
  return (
    <button type="button" {...props} className={`cv-btn cv-btn--${variant} ${size ? `cv-btn--${size}` : ''} ${className}`}>
      {Icon && <Icon size={size === 'sm' ? 13 : 15} />}
      {children}
    </button>
  );
}

// A failed load in plain words. The live server answers 404 "Route not found." for endpoints that were
// built locally but not deployed yet; that is not something to make the admin decode.
export function loadError(e, what) {
  const status = e?.response?.status;
  const msg = e?.response?.data?.message;
  if (status === 404 && /route not found/i.test(msg || '')) return `Couldn't load ${what}: this part needs the server update that isn't on the live site yet.`;
  if (!e?.response) return `Couldn't load ${what}: no connection to the server.`;
  return `Couldn't load ${what}${msg ? `: ${msg}` : '.'}`;
}

// A Cloudinary image at the size it's shown (twice that, for sharp screens), in a modern format, instead
// of the full-size original (live MLA photos were ~1 MB each for a 36px circle). Other URLs pass through.
export function cloudThumb(url, w, h, crop = 'fill') {
  if (!url || !/^https?:\/\/res\.cloudinary\.com\/.+\/upload\//.test(url)) return url;
  const t = [`c_${crop}`, w && `w_${Math.round(w * 2)}`, h && `h_${Math.round(h * 2)}`, 'f_auto', 'q_auto'].filter(Boolean).join(',');
  return url.replace('/upload/', `/upload/${t}/`);
}

// Booth search order: the booth with that exact number first, then numbers starting with it, then name
// matches (so "12" finds booth 12 before addresses whose pincode contains 12), each in booth order.
export const boothFirst = (q) => {
  const t = String(q || '').trim();
  const rank = (b) => (String(b.part_no) === t ? 0 : String(b.part_no).startsWith(t) ? 1 : 2);
  return (a, b) => rank(a) - rank(b) || Number(a.part_no) - Number(b.part_no);
};

export function Alert({ tone = 'info', children }) {
  return <div className={`cv-alert cv-alert--${tone}`}>{children}</div>;
}

// Passcode: hidden until revealed; copy without revealing.
export function Secret({ value }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(String(value)); } catch { /* clipboard blocked */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  if (!value) return <span className="cv-muted">—</span>;
  return (
    <span className="cv-secret">
      <span className="cv-mono">{show ? value : '••••••'}</span>
      <button type="button" className="cv-secret-btn" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide passcode' : 'Show passcode'}>{show ? <EyeOff size={13} /> : <Eye size={13} />}</button>
      <button type="button" className="cv-secret-btn" onClick={copy} aria-label="Copy passcode">{copied ? <Check size={13} /> : <Copy size={13} />}</button>
    </span>
  );
}

// A voter's mobile, masked by default (PRODUCT.md: personal voter data masked unless the job needs it):
// shows ••••••1234, the eye reveals the full number for that row only. Numbers the backend already
// masked (free tier, with *) are shown as they come. Call/SMS/WhatsApp links use the full number
// underneath, so outreach still works without revealing it on screen.
export function MaskedMobile({ value }) {
  const [show, setShow] = useState(false);
  const v = String(value || '').trim();
  if (!v) return <span className="cv-muted">—</span>;
  if (/\*/.test(v)) return <span className="cv-mono">{v}</span>;
  const digits = v.replace(/\D/g, '');
  return (
    <span className="cv-secret">
      <span className="cv-mono">{show ? v : `••••••${digits.slice(-4)}`}</span>
      <button type="button" className="cv-secret-btn" onClick={(e) => { e.stopPropagation(); setShow((s) => !s); }} aria-label={show ? 'Hide mobile number' : 'Show mobile number'} aria-pressed={show}>{show ? <EyeOff size={13} /> : <Eye size={13} />}</button>
    </span>
  );
}

// On phones (≤ 640 px) every row becomes a card: the `primary` column (default: the first
// column) is the title, other cells get their column label above them, action-type columns
// (no label, or key actions/go/view/share/report) span the full width at the bottom.
// Per column: primary: true · mobile: false (hide on phones) · wrap: true (text may wrap)
// · wrap: <px> (wrap, at least this wide). Per table: cards={false}.
const ACTION_KEYS = new Set(['actions', 'go', 'view', 'share', 'report']);
function cellClass(c, primaryKey) {
  const cls = [];
  if (c.align === 'right') cls.push('cv-num');
  if (c.key === primaryKey) cls.push('cv-td-primary');
  else if (ACTION_KEYS.has(c.key) || c.actions) cls.push('cv-td-actions');
  else if (!c.label) cls.push('cv-td-bare');
  if (c.mobile === false) cls.push('cv-td-hide-m');
  if (c.medium === false) cls.push('cv-td-hide-md'); // secondary column: hidden on small laptops (≤1100px), back in phone cards
  if (c.wrap) cls.push('cv-td-wrap'); // long text may wrap so the table fits a laptop screen
  return cls.join(' ');
}

export function DataTable({ columns, rows, rowKey, onRowClick, empty = 'Nothing to show.', loading, selectedKey, cards = true }) {
  const primaryKey = (columns.find((c) => c.primary) || columns.find((c) => c.label) || columns[0])?.key;
  // the pinned actions column only casts its edge shadow while the table is wider than its card
  const wrap = useRef(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const check = () => setOverflow(el.scrollWidth > el.clientWidth + 1);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    check();
    return () => ro.disconnect();
  }, [rows.length, columns.length]);
  return (
    // while a new page loads, the rows already shown stay but dim, with a thin bar on top (aria-busy for screen readers)
    <div ref={wrap} aria-busy={loading && rows.length > 0 ? 'true' : undefined} className={`cv-table-wrap ${cards ? 'cv-table-wrap--cards' : ''} ${overflow ? 'cv-table-wrap--overflow' : ''} ${loading && rows.length > 0 ? 'cv-table-wrap--busy' : ''}`}>
      <table className="cv-table">
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={[c.align === 'right' && 'cv-num', (ACTION_KEYS.has(c.key) || c.actions) && c.key !== primaryKey && 'cv-td-actions', c.medium === false && 'cv-td-hide-md'].filter(Boolean).join(' ') || undefined} style={c.width ? { width: c.width } : undefined}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {loading && rows.length === 0 && Array.from({ length: 6 }, (_, i) => (
            <tr key={`s${i}`}>{columns.map((c) => <td key={c.key}><span className="cv-skel" style={{ height: 14, width: `${50 + ((i * 17) % 40)}%` }} /></td>)}</tr>
          ))}
          {!loading && rows.length === 0 && (
            <tr><td colSpan={columns.length}><div className="cv-table-empty"><Inbox size={20} /> {empty}</div></td></tr>
          )}
          {rows.map((r) => {
            const k = rowKey(r);
            return (
              <tr key={k} className={`${onRowClick ? 'cv-row-click' : ''} ${selectedKey === k ? 'cv-row-on' : ''}`} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                {columns.map((c) => <td key={c.key} className={cellClass(c, primaryKey)} data-label={c.label || undefined} style={typeof c.wrap === 'number' ? { minWidth: c.wrap } : undefined}>{c.render ? c.render(r) : r[c.key]}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="cv-pager">
      <span>{total ? `${from.toLocaleString('en-IN')}–${to.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')}` : 'No records'}</span>
      <div className="cv-pager-btns">
        <button type="button" className="cv-icon-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft size={15} /></button>
        <span>Page {page.toLocaleString('en-IN')} of {pages.toLocaleString('en-IN')}</span>
        <button type="button" className="cv-icon-btn" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight size={15} /></button>
      </div>
    </div>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Focus moves into the dialog (to the element marked data-autofocus, else the dialog itself),
// Tab stays inside it, Esc closes, and focus returns to whatever opened it.
export function Modal({ open, title, onClose, children, width = 520, className = '' }) {
  const box = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    // focus the first control, scrolling only as far as needed (scroll-margin keeps it clear of a pinned action bar)
    const t = setTimeout(() => { const el = box.current?.querySelector('[data-autofocus]') || box.current; el?.focus({ preventScroll: true }); if (el !== box.current) el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }, 0);
    const onKey = (e) => {
      if (e.key === 'Escape') { closeRef.current(); return; }
      if (e.key !== 'Tab' || !box.current) return;
      const items = [...box.current.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === box.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); if (opener && document.contains(opener)) opener.focus(); };
  }, [open, title]); // a new title = new content (e.g. "Review next"): focus moves to it
  if (!open) return null;
  return (
    <div className="cv-modal-backdrop" onClick={onClose}>
      <div ref={box} tabIndex={-1} className={`cv-modal ${className}`} style={{ width: `min(${width}px, 100%)` }} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="cv-modal-head">
          <h2 className="cv-card-title">{title}</h2>
          <button type="button" className="cv-icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>
        <div className="cv-modal-body">{children}</div>
      </div>
    </div>
  );
}

export function KV({ items }) {
  return (
    <dl className="cv-kv">
      {items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v ?? <span className="cv-muted">—</span>}</dd></div>)}
    </dl>
  );
}

export const fmtDateTime = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? String(d) : dt.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
};
export const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
export const waLink = (m) => { const d = String(m || '').replace(/\D/g, ''); return `https://wa.me/${d.length === 10 ? '91' + d : d}`; };

// One "…" button per table row that opens the row's actions (call, WhatsApp, view, edit…) instead of a
// strip of unlabelled icons (UX4, 2026-10-14). items: [{ label, icon, href?, onClick?, external? }]
export function RowMenu({ items, label = 'More actions' }) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState(null); // final fixed-position style, null until measured
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  // The menu is rendered in a portal with fixed positioning so it is never clipped
  // by the table's horizontal scroll container. We MEASURE the menu's real height
  // after it renders, then place it below the button, flip above if there isn't room,
  // and clamp into the viewport — so a row near the bottom of the screen still shows
  // its full menu (the earlier version guessed the height and fell off-screen).
  useLayoutEffect(() => {
    if (!open) { setStyle(null); return; }
    const place = () => {
      const b = btnRef.current?.getBoundingClientRect();
      const menu = menuRef.current;
      if (!b || !menu) return;
      const h = menu.offsetHeight;
      const right = Math.max(8, Math.round(window.innerWidth - b.right));
      const spaceBelow = window.innerHeight - b.bottom;
      let top;
      if (spaceBelow >= h + 8) top = b.bottom + 4;          // room below
      else if (b.top >= h + 8) top = b.top - h - 4;          // flip above
      else top = Math.max(8, window.innerHeight - h - 8);    // clamp into view
      setStyle({ top: Math.round(top), right });
    };
    place();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (!menuRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onMove = () => setOpen(false); // scrolling/resizing closes it rather than drifting
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  return (
    <span className="cv-row-menu-wrap" onClick={(e) => e.stopPropagation()}>
      <button ref={btnRef} type="button" className={`cv-icon-btn cv-row-menu-btn ${open ? 'cv-row-menu-btn--open' : ''}`} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}><MoreHorizontal size={16} /></button>
      {open && createPortal(
        // Rendered off-screen+hidden until measured, so it never flashes in the wrong place.
        <div ref={menuRef} className="cv-row-menu cv-row-menu--fixed" role="menu"
          style={style ? { top: style.top, right: style.right } : { top: 0, left: -9999, visibility: 'hidden' }}
          onClick={(e) => e.stopPropagation()}>
          {items.filter(Boolean).map(({ label: l, icon: Icon, href, onClick, external }) => (href
            ? <a key={l} role="menuitem" href={href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined} onClick={() => setOpen(false)}>{Icon && <Icon size={14} />} {l}</a>
            : <button key={l} type="button" role="menuitem" onClick={() => { setOpen(false); onClick?.(); }}>{Icon && <Icon size={14} />} {l}</button>))}
        </div>,
        document.body,
      )}
    </span>
  );
}

// CSV export helpers (shared by Logins and Registrations; Excel opens them directly)
export const csvOf = (rows, cols) => [cols.join(','), ...rows.map((r) => cols.map((c) => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
export const download = (name, text) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' })); a.download = name; a.click(); URL.revokeObjectURL(a.href); };

// Polling-station names arrive in ALL CAPS from the roll; show them as names (UX10)
export const titleCase = (t) => String(t || '').toLowerCase().replace(/(^|[\s\-(/.])([a-z])/g, (m, p, c) => p + c.toUpperCase()).replace(/\b(Of|And|The)\b/g, (m) => m.toLowerCase());
