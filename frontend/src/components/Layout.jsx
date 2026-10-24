import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import PurchaseModal from './PurchaseModal.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../api/client.js';
import AppShell from '../civic/AppShell.jsx';

// The pre-redesign frame, still used by every role except Super Admin.
function LegacyLayout() {
  const { user, logout, updateUserData } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false);
  const [wardInfo, setWardInfo] = useState({ isSample: true, booths: [], account: null });
  const [isPaidState, setIsPaidState] = useState(false);
  const [proofPending, setProofPending] = useState(false); // screenshot sent, admin not yet approved

  const isWardUser = Number(user?.group_id || user?.user_group_id) === 6;
  const isCandidate = [6, 11].includes(Number(user?.group_id || user?.user_group_id));

  useEffect(() => {
    const fetchWardStatus = () => {
      api.get('/payments/check-paid')
        .then(({ data }) => {
          if (data.success && data.paid) {
            setIsPaidState(true);
            if (updateUserData) updateUserData({ paid_status: 'Yes' });
          } else if (data.success) {
            setProofPending(!!data.pending);
          }
        })
        .catch(() => {});

      if (!isWardUser) return;
      api.get('/ward/home')
        .then(({ data }) => {
          if (data.success) {
            setWardInfo(data);
            if (data.account?.paid_status === 'Yes' || data.paid_status === 'Yes') {
              setIsPaidState(true);
              if (updateUserData) updateUserData({ paid_status: 'Yes' });
            }
          }
        })
        .catch(() => {});
    };

    fetchWardStatus();

    const handlePaymentUpdated = () => {
      setIsPaidState(true);
      if (updateUserData) updateUserData({ paid_status: 'Yes' });
      fetchWardStatus();
    };

    const handleProofSubmitted = () => setProofPending(true);

    window.addEventListener('payment-updated', handlePaymentUpdated);
    window.addEventListener('payment-proof-submitted', handleProofSubmitted);
    return () => {
      window.removeEventListener('payment-updated', handlePaymentUpdated);
      window.removeEventListener('payment-proof-submitted', handleProofSubmitted);
    };
  }, [isWardUser]);

  const hasAssignedBooths = !wardInfo.isSample && Array.isArray(wardInfo.booths) && wardInfo.booths.length > 0;
  const isPaid = user?.paid_status === 'Yes' || isPaidState || wardInfo.account?.paid_status === 'Yes' || wardInfo.paid_status === 'Yes';
  const actualBoothCount = hasAssignedBooths ? wardInfo.booths.length : 1;

  return (
    <div className="app">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      {navOpen && <div className="sidebar-overlay" onClick={() => setNavOpen(false)} />}
      <div className="main">
        <div className="topbar">
          <div className="topbar-left">
            <button className="nav-toggle" aria-label="Toggle menu" onClick={() => setNavOpen((v) => !v)}>
              <span /><span /><span />
            </button>
            <img src="/EDM.png" alt="EDM Logo" style={{ height: 48, objectFit: 'contain' }} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Apple-styled Header BUY Button / PRO Badge for Ward Users */}
            {(isWardUser || (isCandidate && proofPending && !isPaid)) && (
              <>
                {isPaid ? (
                  /* Apple PRO Crown Badge */
                  <div
                    title="PRO Plan Active"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      background: 'linear-gradient(180deg, #fffbeb 0%, #fef3c7 100%)',
                      color: '#92400e',
                      fontWeight: 700,
                      fontSize: 12.5,
                      padding: '5px 14px',
                      borderRadius: 980,
                      border: '1px solid #fde68a',
                      boxShadow: '0 2px 8px rgba(245, 158, 11, 0.2)',
                      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif',
                    }}
                  >
                    <span style={{ fontSize: 14 }}>👑</span>
                    <span>PRO</span>
                  </div>
                ) : proofPending ? (
                  /* Proof sent, waiting for the admin */
                  <button
                    type="button"
                    onClick={() => setPurchaseModalOpen(true)}
                    title="Payment proof under verification"
                    style={{ background: 'linear-gradient(180deg, #fffbeb 0%, #fef3c7 100%)', color: '#92400e', border: '1px solid #fde68a', borderRadius: 980, padding: '5px 14px', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif' }}
                  >
                    ⏳ Verifying payment
                  </button>
                ) : (
                  /* Premium Apple-styled BUY Button */
                  <button
                    onClick={() => setPurchaseModalOpen(true)}
                    title="Buy Subscription"
                    style={{
                      background: 'linear-gradient(180deg, #0077ed 0%, #0066cc 100%)',
                      color: '#ffffff',
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      borderRadius: 980,
                      padding: '6px 18px',
                      fontWeight: 600,
                      fontSize: 13,
                      letterSpacing: '-0.2px',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 2px 8px rgba(0, 119, 237, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.25)',
                      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif',
                      transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.03)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    BUY
                  </button>
                )}
              </>
            )}

            <span className="muted user-label">{user?.name} ({user?.role})</span>
            <button className="secondary" onClick={logout}>Logout</button>
          </div>
        </div>

        <div className="content">
          <Outlet />
        </div>
      </div>

      {/* Purchase Modal Dialog */}
      <PurchaseModal
        open={purchaseModalOpen}
        onClose={() => setPurchaseModalOpen(false)}
        user={user}
        accountInfo={wardInfo.account}
        boothCount={actualBoothCount}
        isSample={wardInfo.isSample}
        onSuccess={() => setIsPaidState(true)}
      />
    </div>
  );
}

// Every role gets the Civic Ops frame (step 10, 2026-10-11). LegacyLayout above
// is kept for reference only.
export default function Layout() {
  return <AppShell />;
}
