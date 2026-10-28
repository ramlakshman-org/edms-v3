# EDMS - Master Automation & Logic Roadmap (TASKS.md)

> **Core System Philosophy:**  
> **Automate everything rule-based, time-sensitive, and administrative** so no lead is lost, no agent sits idle, and no admin has to micromanage.  
> **Keep human effort focused where it matters most** — building trust on the phone with political candidates, answering constituency-specific questions, and closing Pro Plan subscriptions.

---

## 🧭 Executive Summary of the System Purpose

The **Election Data Management System (EDMS)** empowers election candidates (MLAs, councillors, ward members, booth agents) across Tamil Nadu with voter list intelligence, booth-wise slip distribution, and cadre tracking.

To scale candidate onboarding and Pro Plan conversions without operational chaos, the CRM and Telecalling system acts as an **autonomous engine**:
1. Captures candidate signups and incomplete dropouts in real-time.
2. Routes leads instantly to **available/online** agents.
3. Guides telecallers with dynamic talking points tailored to the candidate's exact stage and portal activity.
4. Auto-dispatches follow-up WhatsApp messages (credentials, payment links, polite callback reminders).
5. Self-heals neglected leads via SLA rules so cold leads are automatically redistributed.
6. Gives the Super Admin a real-time live flight deck (presence, talk time, velocity, anti-cheat audit flags).
7. Enforces a **24-hour demo preview paywall** that starts only when a candidate first logs in, driving high-urgency conversions.

---

## 📊 Comprehensive Application Scan & Logic Inventory

| Pillar | Domain | Automated Logic | Human Touch Boundary | Status |
| :--- | :--- | :--- | :--- | :--- |
| **1. Lead Capture** | Ingestion & Attribution | Website signups & bot dropouts captured with district, AC, phone, and step in 0s. | Candidate fills form or chats with bot. | ✅ Active |
| **2. Routing** | Lead Distribution | Shift-aware round-robin to **online/active** agents; night leads pooled for morning dispatch. | Admin manual override / 1-click absentee reassign. | ✅ Active |
| **3. Presence** | Agent Attendance | Real-time presence detection (`🟢 Active`, `🟡 Idle >30m`, `⚪ Offline`) based on login & dialer. | Telecaller physically logs in and makes calls. | ✅ Active |
| **4. Telephony** | Calling Engine | TeleCMI cloud dialer + WebPhone with auto call-duration & recording sync via webhook. | Telecaller speaks to candidate. | ✅ Active |
| **5. Post-Call** | WhatsApp Follow-up | Auto-send Pro payment link on "Interested"; auto-send polite nudge on "Not Answered". | Telecaller logs call outcome in 1 click. | ✅ Active |
| **6. SLA Engine** | Neglected Lead Recovery | Untouched leads auto-reassigned after 3 hours (9 AM - 8 PM). | Target agent picks up reassigned lead. | ✅ Active |
| **7. Lifecycle** | Cadence & Retention | Smart retry schedule; 3-strike archival; auto-unarchive on candidate inbound WhatsApp. | Candidate calls back or replies. | ✅ Active |
| **8. Payments** | Conversion Sync | Payment approval instantly upgrades account to Pro & marks CRM lead as "Converted". | Candidate makes UPI/Razorpay payment. | ✅ Active |
| **9. Oversight** | Admin Flight Deck | Calling velocity leaderboard; short-call (<10s) audit flag; 8 PM daily WhatsApp digest. | Super Admin reviews KPIs & coaches team. | ✅ Active |
| **10. Activation** | Candidate Access Tracking | Track `first_login_at`, `last_login_at`, `login_count`; sync to Admin & CRM drawer. | Candidate tests candidate dashboard. | ✅ Active |
| **11. Paywall** | 24h Demo Expiration | 24-hour clock begins on 1st login; locks dashboard after 24h with support CTA if unpaid. | Telecaller calls candidate before expiry. | ✅ Active |

---

## 🛠️ Detailed Task Matrix & Implementation Backlog

### Phase 1: Telecaller Presence & Shift-Aware Routing (Completed & Verified)

- [x] **TASK-01: Agent Login Tracking (`last_login_at`)**
  - **Why:** Admin needs to know who showed up today versus who is absent.
  - **Automation:** On `authController.login`, automatically update `tbl_user.last_login_at = new Date()`.
  - **File:** `backend/src/controllers/authController.js`

- [x] **TASK-02: Live Presence Status on Admin Leaderboard**
  - **Why:** Stop telecallers from logging in at 9 AM and idling for hours without making calls.
  - **Automation:** Auto-calculate status:
    - `🟢 Active Now`: Call or note logged within last 15 minutes.
    - `🟡 Idle (>30m)`: Logged in today, but no activity in >30 minutes.
    - `⚪ Offline / Absent`: No login recorded today.
  - **Visual:** Display badge beside agent name on `/team/view`.
  - **Files:** `backend/src/controllers/crmController.js`, `frontend/src/pages/civic/TelecallerDashboard.jsx`

- [x] **TASK-03: Shift-Aware Lead Auto-Routing (Online Agents Only)**
  - **Why:** Prevent scenario where leads arrive at 9:30 AM and get assigned to telecallers who have not logged in yet.
  - **Automation:**
    - Filter round-robin candidates to agents where `last_login_at >= startOfToday`.
    - If **0 agents are logged in** (e.g. at night 11 PM or before 9 AM): Hold lead in `unassigned` pool.
    - **Morning Dispatch:** As soon as the first telecaller logs in, unassigned overnight leads automatically distribute evenly to active agents.
  - **Files:** `backend/src/controllers/whatsappController.js`, `backend/src/services/leads.js`

---

### Phase 2: Candidate Activation & 24-Hour Demo Paywall (Completed & Verified)

- [x] **TASK-13: Candidate Dashboard Access & Activation Tracking**
  - **Why:** Telecallers pitch blindly without knowing if the candidate ever opened their credentials or tested the dashboard.
  - **Automation:**
    - On candidate login in `authController.login`:
      - Record `first_login_at`, `last_login_at`, and increment `login_count` in `tbl_user`.
      - Bridge `has_logged_in: true` and `last_dashboard_access_at` into `tbl_enquiry` and `tbl_crm_conversation`.
    - **Admin Registrations Table (`/registrations`):** Display badge:
      `🟢 Logged in (Today, 11:30 AM · 4 visits)` vs `⚪ Never logged in`.
    - **Telecaller Lead Drawer (`/crm/leads`):** Dynamic guidance banner:
      - *If logged in:* "Candidate logged in 2 hours ago. They have seen sample booth data — ask how they liked it!"
      - *If never logged in:* "Candidate has NEVER opened dashboard. Guide them to log in on WhatsApp credentials."
    - **WhatsApp Nudge:** 24h automated WhatsApp reminder for registered candidates who haven't logged in.
  - **Files:** `backend/src/controllers/authController.js`, `frontend/src/pages/civic/Registrations.jsx`, `frontend/src/pages/civic/CrmLeads.jsx`

- [x] **TASK-14: 24-Hour First-Login Demo Expiration & Paywall Lock**
  - **Why:** Unpaid candidates currently browse sample data forever without urgency to pay.
  - **Automation:**
    - Clock starts **strictly on First Login** (`demo_expires_at = first_login_at + 24 hours`).
    - **Dashboard Countdown Banner:** While inside the 24h window, show floating header bar:
      `⏱️ Demo Preview: 16 hours remaining · [Upgrade to Pro Plan]`.
    - **After 24 Hours (If Unpaid):**
      - Block portal access and render friendly paywall lock screen:
        > *"🔒 Your 24-Hour Demo Preview has Expired.*  
        > *To unlock full voter lists, booth slips, and door-to-door tracking for your constituency, contact our team."*
        > `[ 📲 Contact Support on WhatsApp ]`   `[ 💳 Upgrade to Pro ]`
    - **Telecaller CRM Urgency Tag:**
      - Telecaller drawer displays remaining trial time (e.g. `⏱️ Demo: 5h left` or `🔒 Demo Expired`) giving callers massive urgency to close payments.
    - **Permanent Unlock:**
      - When payment is approved (`paid_status === 'Yes'`), demo timer is permanently cleared.
  - **Files:** `backend/src/controllers/authController.js`, `backend/src/controllers/wardController.js`, `frontend/src/pages/civic/WardDashboard.jsx`

---

### Phase 3: Active Production Engines (Verified & Maintained)

- [x] **TASK-04: Zero-Second Multi-Channel Lead Ingestion**
  - Web dropouts via `touchLead` and bot dropouts via WACTO bridge into `tbl_crm_conversation` immediately.
  - Step rank preserved (furthest step reached wins).

- [x] **TASK-05: Dedicated Telecaller Work Queues**
  - `🟡 Incomplete Registrations` tab (candidates needing booth completion assistance).
  - `🟢 Registered Candidates` tab (candidates with accounts needing Pro Plan pitch).
  - `💎 Payment Follow-up` tab (leads with intent or submitted receipts).

- [x] **TASK-06: Dynamic Telecaller Guidance Banners**
  - Incomplete lead drawer displays amber banner with booth-selection talking points.
  - Registered lead drawer displays green banner with portal demo & Pro Plan pitch talking points.

- [x] **TASK-07: Automated WhatsApp Post-Call Nudges**
  - "Interested" status -> auto-drops portal login credentials + Pro payment link.
  - "Not Answered" (Attempt 1) -> auto-drops polite callback reminder.

- [x] **TASK-08: Self-Healing 3-Hour SLA Engine**
  - Untouched leads (>3h old during 9 AM - 8 PM) are automatically revoked and reassigned to other active agents.

- [x] **TASK-09: 3-Strike Archival & Auto-Resurrection**
  - 3 failed call attempts across 48h -> lead automatically archived so callers don't waste time on unreachable numbers.
  - If candidate messages on WhatsApp later -> automatically unarchived and moved back to active queue.

- [x] **TASK-10: Payment-to-CRM Closed Loop**
  - Approving a payment (Razorpay webhook or Admin UTR verification) auto-updates lead status to `converted` and marks user as `is_pro: true`.

- [x] **TASK-11: Anti-Cheat Quality Audit (<10s Calls)**
  - Calls completed with <10 seconds duration are tagged with a warning badge (`⚠️ Short Call (<10s)`) on admin reports.

- [x] **TASK-12: End-of-Day 8:00 PM Performance Digest**
  - Generates comprehensive WhatsApp digest for Admin: total calls, talk time, interested, converted, untouched leads.

---

## 🎯 Human vs Machine: Responsibility Map

```
┌────────────────────────────────────────────────────────────┐
│                    MACHINE / AUTOMATION                    │
├────────────────────────────────────────────────────────────┤
│ • Instant lead capture from Web & WhatsApp (0s)            │
│ • Assigning lead ONLY to logged-in caller (0s)             │
│ • Tracking candidate dashboard logins & first-login time   │
│ • Enforcing 24h demo countdown & paywall locking screen    │
│ • Routing phone calls through TeleCMI / WebPhone           │
│ • Calculating call duration, recording URL, & CDR          │
│ • Auto-sending WhatsApp credentials & payment QR           │
│ • Reassigning cold leads if untouched after 3 hours        │
│ • Archiving 3-time unreachable leads                       │
│ • Calculating presence (Active / Idle / Offline)           │
│ • Compiling 8 PM daily management summary                  │
└────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────┐
│                    HUMAN EFFORT TOUCH                      │
├────────────────────────────────────────────────────────────┤
│ • Telecaller: Building rapport on the phone                │
│ • Telecaller: Answering candidate's election/booth doubts  │
│ • Telecaller: Pitching the Pro Plan value before 24h lock  │
│ • Super Admin: Reviewing leaderboard & calling velocity    │
│ • Super Admin: 1-click reassigning leads for sick/absent   │
│ • Super Admin: Approving manual bank/cash payment receipts │
└────────────────────────────────────────────────────────────┘
```

---

*Last Updated: 2026-10-28 | Synced with GitHub: ramlakshman-org/edms-v3*
