import { MessagesSquare, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import '../../civic/civic.css';
import '../../civic/civic-ui.css';

// CRM agent logins (group 12) land here: the WhatsApp CRM and CRM Team screens were
// removed on 2026-10-12 because chats are handled in WACTO.
export default function AccessClosed() {
  const { user, logout } = useAuth();
  return (
    <div className="cv-shell cv-closed">
      <div className="cv-closed-card">
        <span className="cv-closed-icon"><MessagesSquare size={22} /></span>
        <h1>CRM access has moved</h1>
        <p>
          {user?.name || user?.first_name ? `Hi ${user.name || user.first_name}, ` : ''}
          WhatsApp chats with candidates are now handled in WACTO Live Chat, so the CRM screens in EDMS are closed.
          Please ask your admin for WACTO access.
        </p>
        <button type="button" className="cv-btn" onClick={logout}><LogOut size={15} /> Log out</button>
      </div>
    </div>
  );
}
