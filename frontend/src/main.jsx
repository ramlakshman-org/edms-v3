import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import App from './App.jsx';
import '@fortawesome/fontawesome-free/css/all.min.css';
import './styles.css';

// Read-only lock, browser side (dev server only, see vite.config.js): files the admin builds in the
// browser (Logins passcode CSV, Booths CSV, Flow Simulator JSON) never reach the proxy, so downloads
// are stopped here. In a production build __EDM_READ_ONLY__ is false and this block is removed.
if (__EDM_READ_ONLY__) {
  const isDownload = (a) => a instanceof HTMLAnchorElement && (a.hasAttribute('download') || a.href.startsWith('blob:'));
  const stop = () => window.alert('Blocked: downloads are switched off while this local admin reads the live site.');
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (isDownload(this)) return stop(); return click.call(this); };
  document.addEventListener('click', (e) => { const a = e.target.closest?.('a'); if (a && isDownload(a)) { e.preventDefault(); e.stopPropagation(); stop(); } }, true);
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        {__EDM_READ_ONLY__ && (
          // dev server only (vite.config.js): says which data this is and that changes are switched off
          <div role="status" style={{ position: 'fixed', left: '50%', bottom: 10, transform: 'translateX(-50%)', zIndex: 10000, maxWidth: 'calc(100vw - 24px)', padding: '6px 12px', borderRadius: 999, background: '#7C2D12', color: '#FFF7ED', font: '600 12px/1.4 Inter, system-ui, sans-serif', textAlign: 'center', boxShadow: '0 4px 12px rgba(15,23,42,.25)', pointerEvents: 'none' }}>Live data · {__EDM_API_HOST__} · read-only: saving, approving and sending are switched off</div>
        )}
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
