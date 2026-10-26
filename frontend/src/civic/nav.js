import {
  LayoutDashboard,
  ClipboardList,
  CreditCard,
  UserCheck,
  Flag,
  Landmark,
  Users,
  MapPin,
  PieChart,
  Images,
  QrCode,
  Home,
  Megaphone,
  BarChart3,
  FileText,
  BookOpen,
  Map,
  Smartphone,
  UserPlus,
  ToggleRight,
  Headphones,
  PhoneCall,
  MessageSquare,
  Eye,
  LineChart,
  LayoutGrid,
  Shuffle,
  Inbox,
} from 'lucide-react';

// Civic Ops navigation per role (agreed 2026-10-11).
// One entry per real route. `soon` items are shown but disabled until built;
// `external` items open in a new tab. Ward Logins is intentionally absent:
// customers buy booth plans only (ward/street data comes later).

export const ADMIN_NAV = [
  {
    section: 'Overview',
    items: [{ to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    section: 'Candidates',
    items: [
      { to: '/registrations', label: 'Registrations', icon: ClipboardList },
      // Ram, 2026-10-15: people who messaged the bot or started the website form but did not finish
      { to: '/incomplete-registrations', label: 'Incomplete registrations', icon: UserPlus },
      { to: '/payments', label: 'Payments', icon: CreditCard },
      { to: '/payments/setup', label: 'Payment setup', icon: QrCode },
    ],
  },
  {
    section: 'Telecalling',
    items: [
      { to: '/team/dashboard', label: 'Call Center Dashboard', icon: LayoutGrid },
      { to: '/team/crm', label: 'Telecalling Workspace', icon: PhoneCall },
      { to: '/team/members', label: 'Team Members', icon: Headphones },
      { to: '/team/assignment', label: 'Lead Assignment', icon: Shuffle },
      { to: '/team/reports', label: 'Lead & Call Reports', icon: LineChart },
    ],
  },
  {
    section: 'MLA',
    items: [
      { to: '/mla-list', label: 'MLA Directory', icon: UserCheck },
      { to: '/mla-list?tab=flags', label: 'Parties & Flags', icon: Flag, match: (path, search) => path === '/mla-list' && search.includes('tab=flags') },
    ],
  },
  {
    section: 'Access',
    items: [
      // Round 1 (Ram, 2026-10-14): Booth Logins removed — not part of the product; see Logins.jsx
      { to: '/assemblies', label: 'Assembly access', icon: Landmark },
    ],
  },
  {
    section: 'Electoral data',
    items: [
      { to: '/voters', label: 'Voters', icon: Users },
      { to: '/booths', label: 'Booths', icon: MapPin },
      { to: '/assembly-analytics', label: 'Assembly Analytics', icon: PieChart },
    ],
  },
  {
    section: 'Reports',
    items: [
      { to: '/booth-report', label: 'Booth Report', icon: Map },
      { to: '/candidate-briefing', label: 'Candidate Briefing', icon: BookOpen },
      { to: '/field-operations', label: 'Field Operations', icon: FileText },
    ],
  },
  {
    section: 'WhatsApp bot',
    items: [
      { to: '/flow-images', label: 'Bot Messages & Media', icon: Images },
      // the flow editor lives inside the simulator (Edit tab)
      { to: '/flow-simulator', label: 'Flow Simulator', icon: Smartphone },
      // Ram, 2026-10-16: switches for Pay Now / Pay Later, STOP, website login on WhatsApp and the two reminder jobs
      { to: '/whatsapp-features', label: 'WhatsApp Features', icon: ToggleRight },
    ],
  },
];

// Candidates (booth plans): groups 4, 11 and the older ward logins (6).
export const CANDIDATE_NAV = [
  {
    section: 'My campaign',
    items: [
      { to: '/candidate', label: 'Home', icon: Home },
      { to: '/voters', label: 'My voters', icon: Users },
      { to: '/performance-report', label: 'Performance report', icon: BarChart3 },
    ],
  },
  {
    section: 'Reach voters',
    items: [
      { to: '/broadcast', label: 'Broadcast request', icon: Megaphone },
      { to: '/broadcast/reports', label: 'Broadcast reports', icon: FileText },
    ],
  },
  // Round 1 (Ram, 2026-10-14): the four intelligence pages open to candidates — the bigger picture their
  // ward sits in. Analytics and the two documents are free to every registered candidate; booth report
  // numbers stay behind the plan (C13).
  {
    section: 'Bigger picture',
    items: [
      { to: '/assembly-analytics', label: 'Assembly analytics', icon: PieChart },
      { to: '/booth-report', label: 'Booth report', icon: Map },
      { to: '/candidate-briefing', label: 'Candidate briefing', icon: BookOpen },
      { to: '/field-operations', label: 'Field operations', icon: FileText },
    ],
  },
];

// MLA / assembly logins (group 3).
export const MLA_NAV = [
  {
    section: 'My assembly',
    items: [
      { to: '/assembly-details', label: 'Assembly analytics', icon: PieChart },
      { to: '/voters', label: 'Voters', icon: Users },
      { to: '/booth-report', label: 'Booth report', icon: Map },
    ],
  },
  {
    section: 'Documents',
    items: [
      { to: '/candidate-briefing', label: 'Candidate briefing', icon: BookOpen },
      { to: '/field-operations', label: 'Field operations', icon: FileText },
    ],
  },
];

// Telecaller / CRM Team Member (group 12): their own workspace (restored 2026-10-24).
// A trimmed mirror of the admin — their dashboard, their assigned leads, follow-up
// lists (read-only) and their reports. Everything is scoped to the logged-in agent.
export const TELECALLER_NAV = [
  {
    section: 'My calling work',
    items: [
      { to: '/team/dashboard', label: 'My Dashboard', icon: LayoutGrid },
      { to: '/team/crm', label: 'Telecalling Workspace', icon: PhoneCall },
    ],
  },
  {
    section: 'Calling Queues',
    items: [
      { to: '/team/crm?queue=incomplete', label: 'Incomplete Regs', icon: UserPlus, match: (path, search) => path === '/team/crm' && search.includes('queue=incomplete') },
      { to: '/team/crm?queue=registered', label: 'Registered Leads', icon: ClipboardList, match: (path, search) => path === '/team/crm' && search.includes('queue=registered') },
      { to: '/team/crm?scope=paid', label: 'Payment Follow-up', icon: CreditCard, match: (path, search) => path === '/team/crm' && search.includes('scope=paid') },
    ],
  },
  {
    section: 'Reports',
    items: [
      { to: '/team/reports', label: 'My Call Reports', icon: LineChart },
    ],
  },
];

// Booth logins (group 4): no menu — they land on a notice page.
export const AGENT_NAV = [];

export const ROLE_LABEL = { 1: 'Super Admin', 3: 'Assembly', 4: 'Booth login', 6: 'Candidate', 7: 'Telecaller', 11: 'Candidate', 12: 'Telecaller' };

export function navFor(groupId) {
  const g = Number(groupId || 0);
  if (g === 1) return ADMIN_NAV;
  if (g === 3) return MLA_NAV;
  if (g === 12 || g === 7) return TELECALLER_NAV; // telecallers / CRM team members
  if (g === 4) return AGENT_NAV; // booth logins: no menu (notice page)
  if ([6, 11].includes(g)) return CANDIDATE_NAV;
  return CANDIDATE_NAV;
}

// Breadcrumb lookup: longest matching prefix wins (e.g. /registrations/view/:id).
export function findNavItem(pathname, search = '', nav = ADMIN_NAV) {
  let best = null;
  for (const group of nav) {
    for (const item of group.items) {
      const base = item.to.split('?')[0];
      const hit = item.match ? item.match(pathname, search) : (pathname === base || pathname.startsWith(`${base}/`)) && !group.items.some((o) => o !== item && o.match && o.match(pathname, search));
      if (hit && (!best || base.length >= best.item.to.split('?')[0].length)) best = { group, item };
    }
  }
  return best;
}
