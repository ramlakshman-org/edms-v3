import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import AdminDashboard from './pages/AdminDashboard.jsx';
import Voters from './pages/civic/Voters.jsx';
import AssemblyDetail from './pages/civic/AssemblyDetail.jsx';
import Booths from './pages/civic/Booths.jsx';
import Analytics from './pages/civic/Analytics.jsx';
import Mla from './pages/civic/Mla.jsx';
import Logins from './pages/civic/Logins.jsx';
import WardLogins from './pages/WardLogins.jsx';
import CreateWardLogin from './pages/CreateWardLogin.jsx';
import WardDetail from './pages/WardDetail.jsx';
import EditWardBooths from './pages/EditWardBooths.jsx';
import HtmlReport from './pages/civic/HtmlReport.jsx';
import BoothReport from './pages/civic/BoothReport.jsx';
import PerformanceReport from './pages/PerformanceReport.jsx';
import CandidateHome from './pages/civic/CandidateHome.jsx';
import Broadcast from './pages/civic/Broadcast.jsx';
import BroadcastReports from './pages/civic/BroadcastReports.jsx';
import Registrations from './pages/civic/Registrations.jsx';
import Leads from './pages/civic/Leads.jsx';
import RegistrationDetail from './pages/civic/RegistrationDetail.jsx';
import RegistrationEdit from './pages/civic/RegistrationEdit.jsx';
import Payments from './pages/civic/Payments.jsx';
import PaymentSettings from './pages/civic/PaymentSettings.jsx';
import BotContent from './pages/civic/BotContent.jsx';
import FlowSimulator from './pages/civic/FlowSimulator.jsx';
import WhatsAppFeatures from './pages/civic/WhatsAppFeatures.jsx';
import Faq from './pages/Faq.jsx';
import TermsAndConditions from './pages/TermsAndConditions.jsx';
import PrivacyPolicy from './pages/PrivacyPolicy.jsx';
import AccessClosed from './pages/civic/AccessClosed.jsx';
import BoothLoginNotice from './pages/civic/BoothLoginNotice.jsx';
import TeamMembers from './pages/civic/TeamMembers.jsx';
import CrmLeads from './pages/civic/CrmLeads.jsx';
import TelecallerDashboard from './pages/civic/TelecallerDashboard.jsx';
import LeadReports from './pages/civic/LeadReports.jsx';
import Assignment from './pages/civic/Assignment.jsx';
import Inbox from './pages/civic/Inbox.jsx';

// Helper to determine home path for any user based on their group/role.
function getHomePath(user) {
  if (!user) return '/register';
  const groupId = Number(user.group_id || user.user_group_id || 1);
  if (groupId === 12 || groupId === 7) return '/team/dashboard'; // telecallers / CRM team members
  if (groupId === 4) return '/booth-login'; // A1: booth logins are not in use (notice page)
  if (user.home) return user.home;
  if (groupId === 3) return '/assembly-details';
  if ([6, 11].includes(groupId)) return '/candidate';
  return '/dashboard';
}

// Redirect unauthenticated users to the login/register page.
function Protected({ children }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/register" replace />;
}

// Guard routes strictly based on allowed user groups/roles.
function RequireRole({ allowedGroups, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/register" replace />;

  const groupId = Number(user.group_id || user.user_group_id || 1);

  // Super Admin (Group 1) has full access to all pages
  if (groupId === 1) return children;

  if (allowedGroups && allowedGroups.includes(groupId)) {
    return children;
  }

  // Unauthorized for this route -> redirect to role home
  return <Navigate to={getHomePath(user)} replace />;
}

// Redirect already-authenticated users away from login/register pages.
function PublicOnly({ children }) {
  const { user } = useAuth();
  if (!user) return children;
  return <Navigate to={getHomePath(user)} replace />;
}

// Redirect index / or unknown paths to user's role home page.
function IndexRedirect() {
  const { user } = useAuth();
  return <Navigate to={getHomePath(user)} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
      <Route path="/faq" element={<Faq />} />
      <Route path="/terms" element={<TermsAndConditions />} />
      <Route path="/privacy" element={<PrivacyPolicy />} />
      {/* WhatsApp CRM removed 2026-10-12: chats are handled in WACTO. Old links land on the home page. */}
      <Route path="/crm" element={<Navigate to="/" replace />} />
      <Route path="/access-closed" element={<Protected><AccessClosed /></Protected>} />
      <Route path="/booth-login" element={<Protected><BoothLoginNotice /></Protected>} />
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<IndexRedirect />} />

        {/* Super Admin Only Routes (Group 1) */}
        <Route path="dashboard" element={<RequireRole allowedGroups={[1]}><AdminDashboard /></RequireRole>} />
        <Route path="assemblies" element={<RequireRole allowedGroups={[1]}><Logins /></RequireRole>} />
        <Route path="assemblies/:no" element={<RequireRole allowedGroups={[1]}><AssemblyDetail /></RequireRole>} />
        <Route path="mla-list" element={<RequireRole allowedGroups={[1]}><Mla /></RequireRole>} />
        <Route path="mla-images" element={<RequireRole allowedGroups={[1]}><Navigate to="/mla-list?tab=flags" replace /></RequireRole>} />
        <Route path="booth-logins" element={<RequireRole allowedGroups={[1]}><Navigate to="/assemblies" replace /></RequireRole>} />
        <Route path="booths" element={<RequireRole allowedGroups={[1]}><Booths /></RequireRole>} />
        <Route path="ward-logins" element={<RequireRole allowedGroups={[1]}><WardLogins /></RequireRole>} />
        <Route path="ward-logins/create" element={<RequireRole allowedGroups={[1]}><CreateWardLogin /></RequireRole>} />
        <Route path="ward-logins/:id" element={<RequireRole allowedGroups={[1]}><WardDetail /></RequireRole>} />
        <Route path="ward-logins/:id/edit" element={<RequireRole allowedGroups={[1]}><EditWardBooths /></RequireRole>} />
        <Route path="registrations" element={<RequireRole allowedGroups={[1]}><Registrations /></RequireRole>} />
        <Route path="incomplete-registrations" element={<RequireRole allowedGroups={[1]}><Leads /></RequireRole>} />
        <Route path="registrations/view/:id" element={<RequireRole allowedGroups={[1]}><RegistrationDetail /></RequireRole>} />
        <Route path="registrations/edit/:id" element={<RequireRole allowedGroups={[1]}><RegistrationEdit /></RequireRole>} />
        <Route path="payments" element={<RequireRole allowedGroups={[1]}><Payments /></RequireRole>} />
        <Route path="payments/setup" element={<RequireRole allowedGroups={[1]}><PaymentSettings /></RequireRole>} />
        {/* Telecalling / CRM (restored 2026-10-24) — Super Admin manages the team; telecallers (12/7) get their workspace */}
        <Route path="team/members" element={<RequireRole allowedGroups={[1]}><TeamMembers /></RequireRole>} />
        <Route path="team/assignment" element={<RequireRole allowedGroups={[1]}><Assignment /></RequireRole>} />
        <Route path="team/view" element={<RequireRole allowedGroups={[1]}><TelecallerDashboard adminView /></RequireRole>} />
        <Route path="team/dashboard" element={<RequireRole allowedGroups={[1, 7, 12]}><TelecallerDashboard /></RequireRole>} />
        <Route path="team/inbox" element={<RequireRole allowedGroups={[1, 7, 12]}><Inbox /></RequireRole>} />
        <Route path="team/crm" element={<RequireRole allowedGroups={[1, 7, 12]}><CrmLeads /></RequireRole>} />
        <Route path="team/reports" element={<RequireRole allowedGroups={[1, 7, 12]}><LeadReports /></RequireRole>} />
        <Route path="team/incomplete" element={<RequireRole allowedGroups={[1, 7, 12]}><CrmLeads scope="unregistered" title="Incomplete registrations" subtitle="Your assigned leads who haven’t registered yet — call back and convert." /></RequireRole>} />
        <Route path="team/registrations" element={<RequireRole allowedGroups={[1, 7, 12]}><CrmLeads scope="registered" title="Registrations" subtitle="Your assigned leads who have registered." /></RequireRole>} />
        <Route path="team/payments" element={<RequireRole allowedGroups={[1, 7, 12]}><CrmLeads scope="paid" title="Payments" subtitle="Your assigned leads who are Active Pro (paid)." /></RequireRole>} />
        <Route path="team/*" element={<Navigate to="/team/dashboard" replace />} />
        <Route path="flow-images" element={<RequireRole allowedGroups={[1]}><BotContent /></RequireRole>} />
        <Route path="flow-simulator" element={<RequireRole allowedGroups={[1]}><FlowSimulator /></RequireRole>} />
        <Route path="whatsapp-features" element={<RequireRole allowedGroups={[1]}><WhatsAppFeatures /></RequireRole>} />

        {/* MLA / Assembly Routes (Group 3 & Admin) — and candidates (6, 11) since Round 1, 2026-10-14: the bigger picture */}
        <Route path="assembly-details" element={<RequireRole allowedGroups={[1, 3, 6, 11]}><Analytics /></RequireRole>} />
        <Route path="assembly-analytics" element={<RequireRole allowedGroups={[1, 3, 6, 11]}><Analytics /></RequireRole>} />
        <Route path="candidate-briefing" element={<RequireRole allowedGroups={[1, 3, 6, 11]}><HtmlReport docKey="candidate-briefing" title="Candidate Briefing" /></RequireRole>} />
        <Route path="field-operations" element={<RequireRole allowedGroups={[1, 3, 6, 11]}><HtmlReport docKey="field-operations" title="Field Operations Manual" /></RequireRole>} />
        <Route path="booth-report" element={<RequireRole allowedGroups={[1, 3, 6, 11]}><BoothReport /></RequireRole>} />

        {/* Booth Agent Routes (Group 4, 11 & Admin) */}
        <Route path="candidate" element={<RequireRole allowedGroups={[1, 6, 11]}><CandidateHome /></RequireRole>} />
        <Route path="broadcast" element={<RequireRole allowedGroups={[1, 6, 11]}><Broadcast /></RequireRole>} />
        <Route path="broadcast/reports" element={<RequireRole allowedGroups={[1, 6, 11]}><BroadcastReports /></RequireRole>} />
        <Route path="performance-report" element={<RequireRole allowedGroups={[1, 6, 11]}><PerformanceReport /></RequireRole>} />
        {/* Old candidate URLs (bookmarks, login payloads from the current server) */}
        <Route path="booth/dashboard" element={<Navigate to="/candidate" replace />} />

        {/* Ward & Candidate Social Media Routes */}
        <Route path="ward/dashboard" element={<Navigate to="/candidate" replace />} />
        <Route path="ward/social-media" element={<Navigate to="/broadcast" replace />} />
        <Route path="ward/social-media-reports" element={<Navigate to="/broadcast/reports" replace />} />

        {/* Shared Voters List Route (Accessible to all logged-in roles) */}
        <Route path="voters" element={<RequireRole allowedGroups={[1, 2, 3, 6, 7, 8, 9, 10, 11]}><Voters /></RequireRole>} />

        <Route path="*" element={<IndexRedirect />} />
      </Route>
      <Route path="*" element={<IndexRedirect />} />
    </Routes>
  );
}
