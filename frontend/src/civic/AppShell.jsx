import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { LogOut, Menu, X, ChevronRight, Crown, Hourglass, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../api/client.js';
import PurchaseModal from '../components/PurchaseModal.jsx';
import AttentionBell from './AttentionBell.jsx';
import { navFor, findNavItem, ROLE_LABEL } from './nav.js';
import { WebPhoneProvider } from './webphone.jsx';
import './civic.css';
import './civic-ui.css';

const groupOf = (user) => Number(user?.group_id || user?.user_group_id || 0);
const isCandidateGroup = (g) => [4, 6, 11].includes(g);

// Plan state in the top bar for candidates: PRO / verifying / activate.
function PlanBadge({ user }) {
  const { updateUserData } = useAuth();
  const [state, setState] = useState(user?.paid_status === 'Yes' ? 'paid' : 'unknown');
  const [open, setOpen] = useState(false);

  const refresh = () => api.get('/payments/check-paid').then(({ data }) => {
    if (data?.paid) { setState('paid'); if (updateUserData && user?.paid_status !== 'Yes') updateUserData({ paid_status: 'Yes' }); }
    else setState(data?.pending ? 'pending' : 'unpaid');
  }).catch(() => setState((s) => (s === 'unknown' ? 'unpaid' : s)));

  useEffect(() => {
    refresh();
    const onProof = () => setState('pending');
    const onPaid = () => { setState('paid'); refresh(); };
    window.addEventListener('payment-proof-submitted', onProof);
    window.addEventListener('payment-updated', onPaid);
    return () => { window.removeEventListener('payment-proof-submitted', onProof); window.removeEventListener('payment-updated', onPaid); };
  }, []);

  const booths = Array.isArray(user?.booths) ? user.booths.length : Number(user?.booth_count) || 1;
  return (
    <>
      {state === 'paid' && <span className="cv-plan cv-plan--pro" title="PRO plan active"><Crown size={14} /> PRO</span>}
      {state === 'pending' && <button type="button" className="cv-plan cv-plan--pending" onClick={() => setOpen(true)} title="Payment proof under verification"><Hourglass size={14} /> Verifying payment</button>}
      {state === 'unpaid' && <button type="button" className="cv-plan cv-plan--buy" onClick={() => setOpen(true)}><Sparkles size={14} /> Activate plan</button>}
      <PurchaseModal open={open} onClose={() => setOpen(false)} user={user} accountInfo={user} boothCount={Math.max(1, booths)} isSample={false} onSuccess={() => { setState('paid'); setOpen(false); }} />
    </>
  );
}

// Civic Ops frame for every role: grouped sidebar + top bar. The sidebar and
// breadcrumbs follow the role's navigation (nav.js); pages not yet converted
// render inside `.content` with their old styles.
export default function AppShell() {
  const { user, logout } = useAuth();
  const { pathname, search } = useLocation();
  const [open, setOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const userWrap = useRef(null);
  useEffect(() => {
    if (!userMenu) return undefined;
    const onDoc = (e) => { if (userWrap.current && !userWrap.current.contains(e.target)) setUserMenu(false); };
    const onKey = (e) => { if (e.key === 'Escape') setUserMenu(false); };
    document.addEventListener('mousedown', onDoc); window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); window.removeEventListener('keydown', onKey); };
  }, [userMenu]);
  // Below 900px the sidebar is an off-canvas drawer: while it is closed it is inert, so Tab and screen
  // readers skip its links instead of walking through a menu nobody can see.
  const aside = useRef(null);
  const [offCanvas, setOffCanvas] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const on = () => setOffCanvas(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  useEffect(() => { if (aside.current) aside.current.inert = offCanvas && !open; }, [offCanvas, open]);
  const skip = (e) => { e.preventDefault(); document.getElementById('cv-main')?.focus(); };
  const group = groupOf(user);
  const nav = navFor(group);
  const current = findNavItem(pathname, search, nav);
  const initials = String(user?.name || 'SA').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const roleLabel = ROLE_LABEL[group] || user?.role || 'User';
  const foot = group === 1 ? 'Tamil Nadu · 234 ACs' : group === 3 ? `Assembly ${user?.assembly_id || ''}`.trim() : isCandidateGroup(group) ? 'Local body elections 2026' : 'EDMS';

  // Telecalling roles (Super Admin + telecallers) get the browser softphone mounted.
  const withPhone = (node) => ([1, 7, 12].includes(group) ? <WebPhoneProvider>{node}</WebPhoneProvider> : node);

  return withPhone(
    <div className={`cv-shell ${open ? 'cv-shell--nav-open' : ''}`}>
      <a href="#cv-main" className="cv-skip" onClick={skip}>Skip to content</a>
      <aside ref={aside} className="cv-sidebar" aria-label="Main navigation">
        <div className="cv-brand">
          <img src="/EDM.png" alt="" className="cv-brand-logo" />
          <div>
            <div className="cv-brand-title">EDMS</div>
            <div className="cv-brand-sub">{group === 1 ? 'Election Data Management' : roleLabel}</div>
          </div>
          <button type="button" className="cv-icon-btn cv-nav-close" aria-label="Close menu" onClick={() => setOpen(false)}>
            <X size={16} />
          </button>
        </div>

        <nav className="cv-nav">
          {nav.map((group) => (
            <div className="cv-nav-group" key={group.section}>
              <div className="cv-nav-label">{group.section}</div>
              {group.items.map((item) => {
                const Icon = item.icon;
                if (item.soon) {
                  return (
                    <span key={item.to} className="cv-nav-item cv-nav-item--soon" aria-disabled="true" title="Coming soon">
                      <Icon size={16} />
                      <span>{item.label}</span>
                      <span className="cv-nav-badge">Soon</span>
                    </span>
                  );
                }
                if (item.external) {
                  return (
                    <a key={item.to} href={item.to} target="_blank" rel="noreferrer" className="cv-nav-item" onClick={() => setOpen(false)}>
                      <Icon size={16} />
                      <span>{item.label}</span>
                    </a>
                  );
                }
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setOpen(false)}
                    className={() => `cv-nav-item ${current?.item.to === item.to ? 'cv-nav-item--active' : ''}`}
                  >
                    <Icon size={16} />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="cv-sidebar-foot">
          <span>{foot}</span>
        </div>
      </aside>
      {open && <div className="cv-scrim" onClick={() => setOpen(false)} />}

      <div className="cv-main">
        <header className="cv-topbar">
          <button type="button" className="cv-icon-btn cv-nav-toggle" aria-label="Open menu" onClick={() => setOpen(true)}>
            <Menu size={18} />
          </button>
          <div className="cv-crumbs">
            <span>{current?.group.section || 'EDMS'}</span>
            <ChevronRight size={14} />
            <strong>{current?.item.label || 'Page'}</strong>
          </div>
          <div className="cv-topbar-right">
            {isCandidateGroup(group) && <PlanBadge user={user} />}
            {group === 1 && <AttentionBell />}
            {/* account menu: name, role and Logout live here, so the header is quieter (UX8) */}
            <div className="cv-user-wrap" ref={userWrap}>
              <button type="button" className="cv-user cv-user-btn" aria-haspopup="menu" aria-expanded={userMenu} onClick={() => setUserMenu((o) => !o)}>
                <span className="cv-avatar">{initials}</span>
                <span className="cv-user-text">
                  <strong>{user?.name || 'User'}</strong>
                  <small>{roleLabel}</small>
                </span>
              </button>
              {userMenu && (
                <div className="cv-user-menu" role="menu">
                  <div className="cv-user-menu-head"><strong>{user?.name || 'User'}</strong><small>{roleLabel}</small></div>
                  <button type="button" role="menuitem" onClick={logout}><LogOut size={15} /> Logout</button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main id="cv-main" tabIndex={-1} className="cv-content content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
