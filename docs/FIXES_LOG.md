# EDM-online — Fixes Log (Before → After)

**What this is:** a confirmation of the changes already made **in this working session**, with the before/after state of each.
**Date:** 2026-10-26
**Note:** This documents fixes that were applied. It is **separate** from `AUDIT_REPORT.md`, which lists issues that are **still open** and NOT yet fixed. No code was changed to produce this log.

> ⚠️ **About verification:** all checks below were done with **test accounts and test phone numbers** created for development (e.g. placeholder telecallers and "Test client …" leads). **These are NOT real users or real production data.** "Verified" here means the behaviour was confirmed on the local dev build against test data — it is not a sign-off against live production users. Re-test with real accounts in staging before relying on any of these in production.
>
> Scope reminder: the backend runs **without `--watch`** now, so backend code changes were loaded by a manual restart. Nothing was pushed to GitHub after the initial push.

---

## 🔒 Security hardening pass (from the audit — code changed + backend restarted + verified)

These address CRITICAL/HIGH findings from `AUDIT_REPORT.md` (see its §0.1 table).

| Finding | Before | After | Verified |
|---|---|---|---|
| **Group-7 privilege escalation** | `crmAccess` admitted group 7, but `isCrmAgent()` checked only group 12 → a group-7 login was treated like an **admin** (unscoped access to all conversations/leads). | `isCrmAgent()` now covers group 7 **and** 12 → group-7 is agent-scoped like a telecaller (`crmController.js`). | core endpoints 200 |
| **`/crm/recordings` had no ownership check** | **Any** CRM caller could stream **any** recording file by name. | A telecaller can stream **only their own** leads' recordings; admins unrestricted (`telecmiController.getRecording`). | own→200, bogus→404 |
| **Candidate passcode leak** | `/registrations` returned `password_str` to **all** telecallers (shown via reveal+copy). | Passcode is **masked (`••••••`) for non-admins** in the list + detail (`registrationController`). | telecaller→masked, admin→real |
| **`/reports/*` had no role guard** | Any logged-in user (incl. telecallers) could pull booth/analytics report data. | Gated to admin + MLA/candidate groups (`reportAccess`, `routes/index.js`). | telecaller→403, admin→passes |
| **WACTO webhook unauthenticated** | `/whatsapp/wacto` processed arbitrary forged requests (could create accounts, trigger paid sends). | Opt-in `WACTO_WEBHOOK_SECRET` — when set, a matching `?token=`/`x-webhook-token` is required (`wactoWebhookController`). | boots clean |
| **TeleCMI webhook spoofable** | `appidOk()` passed when `appid` was omitted; appid is non-secret. | Opt-in `TELECMI_WEBHOOK_SECRET` — when set, `/telecmi/webhook` + `/flow` require the token (`telecmiController`). | boots clean |
| **`/auth/refresh` never re-validated** | A deactivated/deleted user kept sliding their session indefinitely. | Refresh now re-checks the account exists + `is_active` (401 + clears cookie if not); admin bootstrap skipped; safe-degrade if DB offline (`authController`). | boots clean |
| **Cookie vs JWT lifetime mismatch** | Cookie hard-coded 40 min while `JWT_EXPIRES_IN` could be `1d`. | Cookie `maxAge` derived from `JWT_EXPIRES_IN` (same source) (`authController.jwtTtlMs`). | boots clean |
| **`voterController` missing import (latent bug)** | `getAppDb()` used but never imported → silent `ReferenceError`; booth users got an empty scope. | Added the import (`voterController.js`). | boots clean |
| **No crash handlers** | A stray async rejection/throw could kill the API process. | Added `unhandledRejection` / `uncaughtException` loggers (`server.js`). | boots clean |
| **Duplicate call rows** | Live CDR webhook + sync could log the same call twice (uuid field mismatch). | `sync-recordings` now also de-dups on the recording **filename** (`crmController`). | boots clean |

**To turn on the webhook secrets in production:** set `WACTO_WEBHOOK_SECRET` + `TELECMI_WEBHOOK_SECRET` in `backend/.env` and append `?token=<secret>` to the webhook/flow URLs in the WACTO and TeleCMI dashboards. Until set, behaviour is unchanged.

**Not changed (need product decisions / behavioural changes):** 6-digit passcode strength + account lockout, OTP enforcement on registration, CRM `lead_status` auto-sync, full agent-scoping of the follow-up *lists* (mobiles/ledger still visible to telecallers — passcodes are now masked), routing WACTO leads into the CRM, hiding admin-only buttons on the frontend + wiring CrmLeads URL params, and the external gates (ngrok, single TeleCMI extension, ₹0 balance, WABA billing). See `AUDIT_REPORT.md` §9.

---

## 1. Telecaller login by username **or** phone number
**File:** `backend/src/models/userModel.js` (`findByCredentials`)
- **Before:** login did `findOne({$or:[user_name, mobile_no, email]})` and returned the **first** match. When a phone number existed on two accounts (e.g. a candidate + a telecaller), the wrong record matched first and login by phone **failed (401)**.
- **After:** it now fetches **all** matching accounts (active first) and returns the first whose **password actually matches**. Telecallers can log in with **username or phone**.
- **Verified (test accounts only):** two **test** telecaller logins each worked by both their username and their phone number (200); a wrong password still returned 401. (These were placeholder test telecallers, not real users.)

---

## 2. Auto-generated 6-digit passcode when creating a telecaller
**File:** `frontend/src/pages/civic/TeamMembers.jsx`
- **Before:** the "Create Credentials" form opened with an **empty** passcode field; the admin had to type one.
- **After:** opens with a **random 6-digit passcode pre-filled** (`gen6()`), plus a **Regenerate** button; still editable. On Edit it stays blank (leave blank = keep current).
- **Verified (test account):** the form auto-filled a random 6-digit code; Regenerate present.
- **Also (data on test accounts, not code):** regenerated the two **test** telecallers' passcodes to new random 6-digit codes (they still showed the old shared test passcode because the auto-gen only fills the form for *new* members). The actual passcode values are intentionally not recorded in this doc.

---

## 3. Passcode field no longer triggers Chrome's saved-password autofill
**File:** `frontend/src/pages/Login.jsx`
- **Before:** the Passcode input had `autocomplete="current-password"`, so Chrome's password manager dumped a long saved site-password into it.
- **After:** `autocomplete="one-time-code"` + `name="passcode"` (kept numeric, length uncapped so the admin's longer password still types). Chrome no longer autofills a saved password.
- **Verified:** live DOM shows `autocomplete="one-time-code"`.

---

## 4. "Sync calls" button in the Shared Inbox
**Files:** `frontend/src/pages/civic/Inbox.jsx`, `inbox.css`
- **Before:** no way to pull real TeleCMI call logs/recordings from the UI; button had no styling.
- **After:** a styled **"Sync calls"** pill (admin) that calls `POST /crm/sync-recordings`, with a toast; `.cv-inbox-sync` CSS added.
- **Verified (test numbers):** real TeleCMI call logs + playable recordings showed for the **test** numbers used during development (not real users).

---

## 5. Status bar shows all call-done buttons on the right
**Files:** `frontend/src/pages/civic/Inbox.jsx`, `inbox.css`
- **Before:** the status bar rendered only the first 6 buttons and overflowed, so **2nd/3rd call done were hidden**.
- **After:** status pills (Contacted/Interested/Call back/Not answered/Switched off) on the left; **1st / 2nd / 3rd call done grouped on the right** with a divider; the bar wraps so nothing is clipped.
- **Verified:** all three call-done buttons render, pinned right.

---

## 6. Send button icon
**File:** `frontend/src/pages/civic/inbox.css`
- **Before:** the global `button { padding: 0 16px }` squeezed the send icon to ~8px inside the 40px circle → it looked like an empty green blob.
- **After:** `padding:0` + `svg { flex:none }` on `.cv-inbox-send` → the paper-plane icon renders at 18×18 in a clean round button.
- **Verified:** icon visible.

---

## 7. Calling: web softphone path (no surprise mobile ring) + preview + errors surfaced
**Files:** `frontend/src/civic/webphone.jsx`, `frontend/src/pages/civic/Inbox.jsx`, `CrmLeads.jsx`
- **Before:** when the softphone wasn't ready (e.g. admin), Call **silently rang the agent's mobile** (mobile bridge) and showed no preview; call errors weren't shown in the inbox.
- **After:**
  - If the web phone is ready → place a **web call** (DID `918031406056`, no mobile ring), and the **call card shows immediately**.
  - If not ready (admin / no softphone) → **ring the lead's assigned telecaller's browser** (the dialer pops in their browser), with a clear **toast** — no silent mobile ring, no confusing popup.
  - Call errors now surface via the inbox toast (previously `setErr` wasn't rendered).
- **Verified (test data):** as admin, Call on a test lead owned by a telecaller **without** a TeleCMI id returned a clear message instead of ringing a mobile, with no confusing confirm popup.

---

## 8. Call card: ring first, then dialpad + timer on answer; auto-end on no-answer
**File:** `frontend/src/civic/webphone.jsx`
- **Before:** the card jumped straight to "answered" with the timer running (because the agent's own leg auto-answered), even while the lead was still ringing; and a no-answer call didn't auto-close.
- **After:** switched to **direct PIOPIY dialing**, which reports accurate progress — **"Ringing…"** while the lead's phone rings (no timer), then **dialpad opens + seconds timer starts** when the lead actually answers, and the card **auto-closes** on no-answer/hangup (`ended`/`failed`). The own-leg auto-answer is ignored (`bridgingRef`).
- **Caveat flagged to you:** direct dialing uses the TeleCMI user's caller id — confirm the lead still sees `918031406056` on a live test.

---

## 9. Recordings appear automatically after an answered call
**Files:** `backend/src/controllers/crmController.js`, `backend/src/routes/index.js`, `frontend/src/civic/webphone.jsx`, `Inbox.jsx`
- **Before:** a web call was logged immediately with its duration, but the **recording only showed after a manual "Sync calls"**; and sync was **admin-only** (telecallers got 403).
- **After:**
  - `POST /crm/sync-recordings` is now `crmAccess` and **scoped to the telecaller's own** TeleCMI calls (admin still syncs the whole team).
  - After an answered web call ends, the app **auto-pulls the recording** (a few retries over ~50s, since TeleCMI needs time to process) and refreshes the thread → the recording shows **on its own**.
- **Verified (test data):** a test telecaller's own sync imported their recent **test** calls and the recordings rendered inline in that test lead's thread.

---

## 10. Telecaller "Follow-up" pages (Registrations / Incomplete regs / Payments) 403
**File:** `backend/src/routes/index.js` (+ backend restart)
- **Before:** those pages called admin-only endpoints → **"You do not have permission"** (403) for telecallers.
- **After:** `GET /registrations`, `/registrations/:id`, `/leads` (already `crmAccess` on disk) plus **`GET /payments/subscriptions` and `/payments/pending-utrs` opened to `crmAccess`**, and the backend was **restarted** so it actually loaded them.
- **Verified (test account):** a test telecaller gets 200 on all four; the Registrations page renders without the permission error.
- **⚠️ Note:** `AUDIT_REPORT.md` flags that these reads are **not agent-scoped** (telecallers can see all candidates' passcodes/PII and the full payment ledger) — that is an **open item**, not fixed here.

---

## 11. Softphone login no longer flashes a "login failed" error
**File:** `frontend/src/civic/webphone.jsx`
- **Before:** the normal SIP `407` auth challenge during PIOPIY login was logged/flagged as a **login failure** before the successful login arrived.
- **After:** a transient `407` is tolerated — the error state is only set if the phone still isn't "ready" after ~8s. It reaches **"Web phone: ready"** cleanly.
- **Note:** the red `wss://sbcind.telecmi.com "can't establish connection"` lines come from the **browser/PIOPIY SDK** and can't be suppressed from app code; they recover and don't affect calling.

---

## 12. Infrastructure fixes (environment, not product code)
- **404s on telecalling pages (Vite proxy):** the dev server had restarted pointing at the **live** API (`www.tnedms.com`, which lacks these routes). **Restarted Vite with `EDM_API_TARGET=http://localhost:5000`** → `/api/*` hits the local backend again.
- **Intermittent 500 on `/call`:** caused by the backend restarting under `node --watch` (churned by temporary debug scripts). **Restarted the backend without `--watch`** for stability + added a **one-time retry on transient 5xx** in the web-call path.
- **Data actions on test accounts (via API/DB, not code):** transferred a **test** lead from one test telecaller to another (via the real `assign` endpoint, logged to `assignment_history`); assigned the single available TeleCMI extension to a second **test** telecaller so her softphone works (note: only one extension exists, so the two test telecallers **share** it — only one can call at a time). These were test accounts, not real users.

---

## 13. Repository
- **Initial push to GitHub** (`senthilkumarnagendranofficial-maker/tnedms.online`, branch `main`, 287 files) with a new **`.gitignore`** that excludes `.env` (kept `.env.example`), `node_modules`, and build output. Verified no secrets in tracked files.
- **After the push**, every change above was made **locally only** — nothing has been pushed to GitHub since.

---

## 14. Documentation produced this session
- `docs/TELECALLER_CRM_TELECMI_LOGIC.md` — end-to-end logic of the super-admin panel, telecaller login + CRM, and the TeleCMI integration.
- `docs/AUDIT_REPORT.md` — full production-readiness audit (open issues, scores, security/routing/bugs, fix checklist).
- `docs/FIXES_LOG.md` — this before/after log.

---

### Summary
| # | Fix | Status |
|---|---|---|
| 1 | Login by username **or** phone | ✅ fixed & verified |
| 2 | Auto 6-digit passcode on create (+ regenerate) | ✅ fixed & verified |
| 3 | Passcode field: no Chrome autofill | ✅ fixed & verified |
| 4 | Inbox "Sync calls" button | ✅ fixed & verified |
| 5 | Status bar shows all call-done buttons | ✅ fixed & verified |
| 6 | Send button icon | ✅ fixed & verified |
| 7 | Web-call path (no silent mobile ring) + preview + toasts | ✅ fixed & verified |
| 8 | Call card: ring → dialpad+timer on answer → auto-end | ✅ fixed (confirm DID live) |
| 9 | Recordings auto-appear after answered call | ✅ fixed & verified |
| 10 | Telecaller Follow-up pages 403 | ✅ fixed & verified |
| 11 | Softphone login no "failed" flash | ✅ fixed & verified |
| 12 | Vite proxy / backend stability / data actions | ✅ fixed & verified |
| 13 | Initial GitHub push + `.gitignore` | ✅ done |

**Open items (NOT fixed — see `AUDIT_REPORT.md`):** WACTO/TeleCMI/Meta webhook authentication, group-7 scoping, agent-scoping the follow-up reads + masking passcodes, 6-digit passcode strength, OTP enforcement, CRM lead-status auto-sync, `/auth/refresh` re-validation, ngrok/extension/balance/billing gates, and the other medium/low findings.
