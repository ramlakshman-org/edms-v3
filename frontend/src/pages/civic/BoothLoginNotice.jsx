import { KeyRound, LogOut, MessageCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import '../../civic/civic.css';
import '../../civic/civic-ui.css';

// Booth logins (group 4: one generated account per polling booth, 30,538 of them, 2 used in 90 days) are
// not part of the product. Ram, 2026-10-14 (A1): they land here instead of a half-working home page.
const SUPPORT = { text: '+91 79047 59268', wa: 'https://wa.me/917904759268' };

export default function BoothLoginNotice() {
  const { user, logout } = useAuth();
  return (
    <div className="cv-shell cv-closed">
      <div className="cv-closed-card">
        <span className="cv-closed-icon"><KeyRound size={22} /></span>
        <h1>This booth login is not in use yet</h1>
        <p>
          {user?.name ? `Hi ${user.name}, ` : ''}
          booth-level logins are not switched on in EDMS at the moment. Candidates use their own login,
          with the booths covered by their plan. For access, or if you were given this login by mistake,
          contact the EDMS team.
        </p>
        <p><a className="cv-btn" href={SUPPORT.wa} target="_blank" rel="noreferrer"><MessageCircle size={15} /> WhatsApp {SUPPORT.text}</a></p>
        <button type="button" className="cv-btn cv-btn--ghost" onClick={logout}><LogOut size={15} /> Log out</button>
      </div>
    </div>
  );
}
