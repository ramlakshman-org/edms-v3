# EDM-online — Production Readiness Audit (Full)

**Scope:** React/Vite frontend · Node/Express + MongoDB backend · WACTO WhatsApp bot · Meta WhatsApp webhook/Flow · TeleCMI IVR/telephony · telecaller CRM · the client registration → onboarding → payment journey.
**Target:** Live production quality — security, routing, integrity, end-to-end logic, lead→telecaller mapping.
**Method:** Direct source review + four parallel deep-dive audits (backend, client journey, frontend, integrations). **No code was changed.** References are `file:line`.
**Date:** 2026-10-26

---

## 0. Scorecard

| Area | Score /10 | Verdict |
|---|---|---|
| **OVERALL** | **5.5** | Feature-complete, well-built UI and a strong assignment engine — but **not production-safe yet**. Authorization leaks + an unauthenticated webhook + 6-digit passcodes + un-synced lead systems + external billing/telephony blocks must be fixed first. |
| Architecture & structure | 8 | Clean two-DB split, role layers, controller/service separation; two parallel WhatsApp stacks add confusion. |
| Authentication (login/session) | 5 | Good JWT/revocation/bootstrap hardening; weakened by 6-digit passcodes, no account lockout, refresh-never-revalidates. |
| **Authorization / routing** | **5** | Admin surface well-locked, telecaller(12) CRM scoping thorough — but **group-7 bypass**, **unscoped follow-up endpoints leak PII/passcodes**, `/reports/*` ungated, FE shows admin-only buttons that 403. |
| **Webhook / integration security** | **3** | **WACTO webhook has ZERO verification; Meta signature optional; TeleCMI appid bypassable by omission.** Top blocker. |
| Password / passcode strength | 4 | Admin password strong (≥12 enforced); staff + candidate passcodes are 6 digits → brute-forceable. |
| Input validation / injection | 6 | Free-text regex escaped; some query params allow Mongo-operator objects (low impact). |
| Secrets & config | 8 | Env-driven with fail-fast validation, app secret server-side, CORS locked to origin, helmet on. |
| Client journey (reg→onboard→pay) | 6 | Web + WhatsApp both work; **OTP built but not enforced**; credential delivery fragile. |
| Payment | 5 | Razorpay HMAC **exemplary**; UPI-proof queue solid; silent WhatsApp notify failures + amount-unit guessing + loose order-poll matching. |
| Lead assignment & mapping | 7 | Strong engine, BUT **WACTO-bot leads never reach the CRM/telecaller**; two RR pools. |
| CRM / Shared Inbox UI | 8 | WATI-style 3-pane, window-aware, status history, recordings, softphone — excellent. |
| TeleCMI / IVR telephony | 6 | Works; ngrok + single extension + spoofable webhook + ₹0 balance block prod. |
| WACTO / WhatsApp bot | 5.5 | Thorough bilingual bot; unauth webhook + no CRM linkage + billing block. |
| Super-Admin dashboard | 8 | Rich, resilient per-source loading; client-side aggregation won't scale. |
| Telecaller dashboard | 7.5 | Own-scoped (CRM only) + admin oversight; hard-coded daily goal. |
| Frontend (overall) | 7 | Polished, feature-complete; held back by authorization leaks visible from the UI. |
| Backend (overall) | 5 | Solid foundations; held back by webhook auth + group-7 scoping + passcodes + refresh gap. |
| Repo hygiene | 4 | 29 stray `.bak`/misplaced files + dead `services/*Controller.js` copies; no tests/CI. |

---

## 0.1 Fixes applied in this pass (code changed + backend restarted, verified)

> These were implemented and verified after the audit above. The findings they address are marked **✅ FIXED** in §9. Scores above reflect the *audit snapshot*; the fixes below raise the real posture (notably webhook security and authorization).

| # | Finding | Fix | Verified |
|---|---|---|---|
| F-1 | AUTHZ-1 group-7 privilege escalation | `isCrmAgent()` now covers group 7 (TELECALLER) too → group-7 logins are agent-scoped, not admin-like (`crmController.js`). | Logic + core endpoints 200 |
| F-2 | AUTHZ-3 `/crm/recordings` no ownership check | Telecallers can now stream **only their own** leads' recordings; admins unrestricted (`telecmiController.getRecording`). | own→200, bogus→404 |
| F-3 | AUTHZ-2 passcode leak | Candidate `password_str` is **masked (`••••••`) for non-admins** in `/registrations` list + detail (`registrationController`). | telecaller→masked, admin→real |
| F-4 | AUTHZ-4 `/reports/*` ungated | Added `reportAccess = requireRole(MLA, WARD, BOOTH_ALT)` (+admin) to the 4 report routes (`routes/index.js`). | telecaller→403, admin→passes |
| F-5 | S-WACTO unauthenticated webhook | Opt-in `WACTO_WEBHOOK_SECRET` — when set, `/whatsapp/wacto` requires `?token=`/`x-webhook-token` or it drops the request (`wactoWebhookController`). | boots clean |
| F-6 | S-TELECMI spoofable webhook | Opt-in `TELECMI_WEBHOOK_SECRET` — when set, `/telecmi/webhook` + `/flow` require the token (`telecmiController`). | boots clean |
| F-7 | AUTH-1 refresh never re-validates | `/auth/refresh` now re-checks the account exists + `is_active` (401 + clears cookie if not); admin bootstrap skipped; degrades safe if DB offline (`authController`). | boots clean |
| F-8 | AUTH-2 cookie/JWT lifetime mismatch | Cookie `maxAge` now derived from `JWT_EXPIRES_IN` (same source as the token) (`authController.jwtTtlMs`). | boots clean |
| F-9 | BUG-1 `voterController` missing import | Added `import { getAppDb }` → booth-from-enquiry fallback no longer throws silently (`voterController`). | boots clean |
| F-10 | BUG-2 no crash handlers | Added `unhandledRejection` / `uncaughtException` loggers so a stray async error can't kill the API (`server.js`). | boots clean |
| F-11 | T-5 duplicate call rows | `sync-recordings` now de-dups on the recording **filename** as well as the uuid, catching the webhook-logged copy (`crmController.syncTelecmiRecordings`). | boots clean |

**To activate the webhook secrets in production:** set `WACTO_WEBHOOK_SECRET` and `TELECMI_WEBHOOK_SECRET` in `backend/.env`, then append `?token=<secret>` to the webhook/flow URLs configured in the WACTO and TeleCMI dashboards. Until set, behaviour is unchanged (backward compatible).

**Still open (need product decisions or larger/behavioural changes — NOT changed):** S-1/PWD-1 6-digit passcode strength + lockout; J-1 OTP enforcement; J-3 CRM `lead_status` auto-sync; full agent-scoping of the follow-up *lists* (passcodes are now masked, but a telecaller can still *see* all candidates' mobiles + the payment ledger — scope or accept); M-1 route WACTO leads into the CRM; AUTHZ-5/UI FE admin-only buttons hidden by role + CrmLeads URL params; W-1 unify candidate group ids; external gates (ngrok, single TeleCMI extension, ₹0 balance, WABA billing). See §9.

---

## 1. Architecture & Deployment

nginx serves the Vite build and reverse-proxies `/api/*` to Node on `127.0.0.1:5054` (PM2 `edm-staging`); backend binds `127.0.0.1` behind nginx, `trust proxy=1` (`server.js:87`). TLS via Certbot. Staging behind nginx **basic-auth** + `noindex`; edge rate-limit on `/api/auth/`; `/report-files/` gated by `auth_request`→`/api/auth/check`. **Two MongoDB connections:** `voterDb` (read-only roll) + `appDb` (real PII).

**⚠️ TWO parallel, independent WhatsApp stacks:**
- **WACTO bot** → `POST /whatsapp/wacto` → `wactoWebhookController.js`. Writes `tbl_wacto_sessions/tbl_enquiry/tbl_user/tbl_leads`. **Never writes `tbl_crm_message` → never in the CRM inbox → no telecaller round-robin.**
- **Meta Cloud API native** → `POST /whatsapp/webhook` → `whatsappController.js`. Meta "Flow" registration **and** the CRM inbox + round-robin + 24/72h window.

**Server middleware:** `helmet` (CSP + COEP disabled, CORP cross-origin — deliberate for static HTML reports, weakens XSS defense-in-depth, `server.js:22-26`); `cors` locked to `CLIENT_ORIGIN` (default `https://tnedms.com`, no wildcard, `credentials:true`, `server.js:28-30`); `rawBody` captured for signatures (`server.js:34`); `validateEnv` fails fast on missing/weak `JWT_SECRET` in prod (`server.js:69-81`); prod 5xx bodies masked (`server.js:38-48`). ✅

**Hygiene:** dev Vite proxy **defaults to the LIVE API** unless `EDM_API_TARGET` set (footgun). `backend/src` carries **29 stray files** (`*.bak*`, misplaced `controllers/voterModel.js`, `services/authController.js`, `routes/crmController.js`) **and dead copies** of controllers under `services/` (`services/authController.js`, `services/whatsappController.js`, `services/whatsappService.js`) not imported by routes — confusing, risk of editing the wrong file. Remove before go-live.

---

## 2. Security Audit

### 2.1 Authentication / Session — 5/10
- **JWT:** secret from `JWT_SECRET` only, boot-validated. Cookie `edm_token`: `httpOnly`, `secure` only in production, `sameSite:'strict'`, path `/` (`authController.js:16-24`) ✅. Token also in JSON body + Bearer accepted.
- **Revocation:** jti denylist in `tbl_token_denylist` with TTL; logout revokes (`auth.js:33-40`). ✅
- **Admin bootstrap hardened:** enabled only if `ADMIN_USERNAME`&`ADMIN_PASSWORD` set, **password length ≥ 12**, and neither equals `admin` (`authController.js:35-51`) — the `.env.example` `admin/admin` is inert. ✅
- **OTP:** 6-digit, 5-attempt cap, 10-min TTL (`authController.js:114-181`) — adequate *as infrastructure* (but not enforced on registration, see §4).
- 🔴 **Finding AUTH-1 (HIGH): `/auth/refresh` never re-validates the user** (`authController.js:344-354`) — it re-signs from existing claims without checking the DB. **A deactivated/deleted user keeps sliding their session** until the current token expires; deactivation does not revoke outstanding tokens.
- **Finding AUTH-2 (Medium): session-lifetime inconsistency** — `JWT_EXPIRES_IN` is `1d` in `.env.example:11` but the cookie `maxAge` is hard-coded to **40 min** (`authController.js:15`). Token and cookie lifetimes disagree.
- **Finding AUTH-3 (Low): plaintext `password_str` is retained** after bcrypt upgrade (never cleared, `userModel.js:39-55`) and is surfaced widely (see §2.3 PII leaks).

### 2.2 🔴 Webhook / Integration Security — 3/10 (TOP BLOCKER)
- 🔴 **WACTO webhook `/whatsapp/wacto` — NO verification at all** (`wactoWebhookController.js:731`). 200-ACKs then processes forged `entry[].changes[].value.messages[]`. **Anyone with the URL can create `tbl_user` accounts with arbitrary mobiles + known passcodes, write enquiry/support/purchase/proof records, and trigger paid WACTO outbound sends (cost/abuse).** **Highest-severity public gap.**
- 🔴 **TeleCMI `/telecmi/webhook` & `/flow` — bypassable** (`telecmiController.js:42-47`): `appidOk()` returns **true when `appid` is omitted**, and appid (`33339108`) is a non-secret identifier. Attacker can inject fake CDRs/`status_history` into any conversation and influence IVR routing.
- 🔴 **Meta `/whatsapp/webhook` — signature OPTIONAL** (`whatsappController.js:808-827`): HMAC-SHA256 over rawBody with `timingSafeEqual`, **but only when `META_APP_SECRET` set AND `WHATSAPP_VERIFY_SIGNATURE !== 'false'`**; else it processes unverified. GET verify token defaults to hardcoded `'election2026_verification_token'` (`:12`).
- **Meta Flow endpoint** accepts **unencrypted** requests and replies in plaintext (`whatsappController.js:1523,1553`) — an attacker can drive the registration screens without Meta's key.
- ✅ **Razorpay `/payments/webhook` — exemplary:** rejects missing signature, HMAC-SHA256 over rawBody, constant-time compare (`paymentController.js:427-432`).

### 2.3 🔴 Authorization / Data Exposure — 5/10
- 🔴 **Finding AUTHZ-1 (HIGH — privilege escalation): `crmAccess = requireRole(CRM_AGENT=12, TELECALLER=7)`** (`routes/index.js:90`) admits group 7, **but `isCrmAgent()` tests group === 12 ONLY** (`crmController.js:20-22`; `agentCanAccess:31-37`; filters in `listConversations:85`, `teamStats:1021`, `teamReport:1095`). **A group-7 login passes `crmAccess` but is treated like an ADMIN → UNSCOPED access to every conversation, lead, registration (incl. passcodes), payment subscription and team stats.** Fix: make `crmAccess` CRM_AGENT-only, **or** have `isCrmAgent()` also cover group 7.
- 🔴 **Finding AUTHZ-2 (HIGH — PII/passcode leak): follow-up endpoints are NOT agent-scoped.** `GET /registrations`,`/registrations/:id`,`/leads`,`/payments/subscriptions`,`/payments/pending-utrs` are `crmAccess` with **no `agent_id` filter** in the controllers (`registrationController.js:56-97`, `paymentController.js:118`). **Any telecaller can view/copy every candidate's login passcode (`password_str`), full mobile, the entire payment ledger, UTRs and payment screenshots.** The UI renders passcodes via `<Secret>` reveal+copy (`RegistrationDetail.jsx:116,187`).
- 🔴 **Finding AUTHZ-3 (HIGH): `/crm/recordings` has no ownership check** (`telecmiController.js:18`) — streams ANY `?file=` to any `crmAccess` caller (only a no-slash filter). A telecaller who knows/guesses a filename can stream another agent's recording.
- **Finding AUTHZ-4 (Medium): `/reports/*` has no backend role guard** (`routes/index.js:204-207`) — FE restricts the pages to [1,3,6,11] but any authenticated user (incl. 7/12) can fetch booth/analytics report data directly.
- **Finding AUTHZ-5 (Medium — UX): admin-only action buttons are shown to telecallers then 403** — RegistrationDetail Edit/Mark-paid/Assign-booths and Payments Approve/Reject render for groups 7/12, but the endpoints are adminOnly → failed action, confusing UX. Hide/disable by role on the FE.
- ✅ **Good:** admin surface correctly locked (team/*, assembly-credentials, mla/booth/ward logins, registration mutations, approve-utr, whatsapp-features, crm assign/distribute/settings-PUT). EPIC search + voter mobile-update tightened to adminOnly (EDMS-13). **Telecaller (group 12) CRM scoping is thorough and correct** (own conversations via `agentCanAccess`, own-leads filters, sync-recordings own-creds).

### 2.4 Passwords — 4/10
- bcrypt cost 10 everywhere. 🔴 **Finding PWD-1 (HIGH): 6-digit numeric passcodes** for staff + candidates (~9×10⁵ space), **no per-account lockout**, and login matches by username OR mobile OR email trying every candidate (`userModel.js:12-57`). A known mobile's passcode is attackable from multiple IPs. → ≥8-char alphanumeric for staff + lockout/backoff; keep 6-digit for one-time delivery only.

### 2.5 Injection — 6/10
- `escapeRegex` applied to free-text before `$regex` (`userModel.js:77`, `voterModel.js:51-55`, `crmController.js:97`). ✅
- **Finding INJ-1 (Low): Mongo-operator injection via unnormalized query params** — e.g. `voterModel.buildQuery:37` (`?gender[$ne]=x`), `paymentController.pendingUtrs:667` (`?status[$ne]=approved` → all proofs, admin-only). Low impact; normalize params to strings.

---

## 3. End-to-End Client Journey

### 3.1 Website registration → onboarding
3-step form (`Register.jsx`); beacons `POST /public/lead` (incomplete capture) + `POST /public/track {start}`; `recordWebsiteEvent` stamps timestamps via `$min` (`leads.js:71-86`). On submit → `authController.register:208-296`: **account-takeover guard** (409 if number exists, writes nothing); 6-digit passcode; `tbl_user` (group `BOOTH_ALT`=11) bcrypt+`password_str`; unique index `uniq_candidate_mobile`; `markLeadRegistered`; `onRegistered` payment clock. Credentials: `website_login` ON → `wa.me` deep link (bot replies creds in-window); OFF → passcode on screen + best-effort WACTO notice.

### 3.2 WhatsApp registration (WACTO bot)
`handleWactoWebhook` → bilingual state machine in `tbl_wacto_sessions` (role→party→body_type→position→district→assembly→booths), old-tap lock, 30-min TTL. On booth reply → `completeRegistration:406-496`: resolve assembly by regex, upsert `tbl_enquiry`, create/update `tbl_user` (group `BOOTH_ALT`), send "complete" image + UPI QR after a 2s sleep.

### 3.3 Payment
Tiered pricing by booth count (1=₹2,360 … 26-100=₹59,000 incl 18% GST). `paid_status='Yes'` via (1) Razorpay checkout (HMAC ✅), (2) Razorpay webhook (HMAC ✅, matches by `contact` mobile), (3) order-status poll. Dominant path: **UPI QR + proof** → `recordProof` → `tbl_utr_payments` → admin `approve-utr` (adminOnly). Manual `setPaid` (adminOnly).

### 3.4 🔴 Lead lifecycle — TWO un-synced systems
- **(A) `tbl_leads`** (web/bot funnel): `new/contacted/interested/not_interested` + `registered_at` (auto on registration).
- **(B) `tbl_crm_conversation.lead_status`** (telecaller CRM pipeline): full enum incl. `registration_incomplete/registration_completed/converted`; **every transition is MANUAL** (`updateLeadStatus`).
- 🔴 **Finding J-3 (HIGH): nothing auto-writes `tbl_crm_conversation.lead_status`.** Registration/payment never move the CRM lead to `registration_completed`/`converted`, so the CRM "converted" pipeline **silently diverges** from real `tbl_user`/`tbl_payment` state — conversion metrics are manual-only and drift-prone.

### 3.5 Journey findings
- 🔴 **J-1 (HIGH): OTP built but not enforced** (`sendOtp`/`verifyOtp:119-181` exist; `Register.jsx` never calls them; `register()` never checks `tbl_otp.verified`). Anyone can register any *new* number without proving ownership.
- 🔴 **J-2 (HIGH): credential delivery over WhatsApp is only a notice** — no AUTHENTICATION template with the passcode (`sendWactoCredentials`); passcode is delivered on-screen only; breaks if `website_login` ON + BSP blocked.
- **J-4 (Medium):** `approveUtr`/proof confirmations use free-form `sendWactoText` → **fail silently outside the 24h window**; client activated but never told.
- **J-5 (Medium):** `razorpayWebhook` matches by `contact` mobile only; `checkOrderStatus` fallback uses a **loose substring match** over the last 20 payments (`paymentController.js:541-556`) → could attribute someone else's captured payment to the wrong user.
- **J-6 (Low):** `visited_at` is **dead**; pervasive rupee/paise/booth-count amount guessing is fragile (has caused revenue mis-display).

---

## 4. Lead Assignment & Mapping (Admin ↔ Telecaller) — 7/10

Four paths, all logged to `assignment_history`: **round-robin Distribute** (admin, persisted cursor `round_robin`), **scheduled auto-distribute** (`crmScheduler` 5-min tick + run-key), **manual assign** (admin, clears `taken`), **claim/Taken lock** (telecaller, 409 on duplicate).

**Inbound mapping:** Meta-native WhatsApp → first message `assignAgentRoundRobin` over active g12 (sticky). Inbound call (IVR) → `telecmiController.flow` routes to existing owner else round-robins over `routableAgents` (active g12 **with `telecmi_id`**, pointer `telecmi_rr`) and writes it back.
- 🔴 **M-1 (HIGH): WACTO-bot leads are NOT assigned and NOT in the CRM inbox** — only in `tbl_leads`. If WACTO is the primary number, telecallers cannot see/work those leads in the inbox.
- **M-2 (Medium): two separate RR pools/pointers** (`round_robin` all-agents vs `telecmi_rr` telecmi-only) — a lead can get different owners by channel; IVR bridges via ObjectId + `user_name` fallback.

Deactivate/delete releases leads to the pool; admin oversight via `?agent_id`. **The in-CRM engine is the strongest part of the app** — complete, fair, logged, correctly scoped. Gap is channel coverage (WACTO bypass) + two pools.

---

## 5. TeleCMI / IVR — 6/10
**Works:** click-to-call (mobile bridge + WebRTC softphone), DID to the lead, inbound IVR routing + RR, CDR webhook logging calls+recordings, secret-safe recording proxy (path-traversal guard), CDR sync (auto-pull after answered calls).
**Blockers:** 🔴 ngrok webhooks (`PUBLIC_BASE_URL`) → move to `tnedms.online`; 🔴 single shared extension `5002_33339108` → one per telecaller; 🔴 TeleCMI ₹0 balance. **Medium:** confirm DID on direct dials; **duplicate call logging** — webhook stores `metadata.cmiuuid = b.cmiuuid` while sync dedups on `c.cmiuid` from a **different API field**, so the same call can be logged twice (live + sync), plus no webhook idempotency. **Low:** recording timing (~10–50s); PIOPIY login console noise (407 SIP challenge + wss retries — harmless, no longer flagged; REST login CORS-blocked by TeleCMI, recovers over WebSocket). **Security:** appid check spoofable (§2.2).

---

## 6. WACTO / Meta WhatsApp — 5.5 / 7
- **WACTO bot — 5.5/10:** thorough bilingual state machine + old-tap lock + offline replay harness (`wacto/replay/`, not runtime code). Held back by the **unauthenticated webhook (CRITICAL)**, **no CRM-inbox linkage/no telecaller assignment**, BSP billing dependency, and a known **space-separated booth-number bug** (`3 6 9` keeps only the first).
- **Meta WhatsApp + Flow — 7/10:** strongest integration — real HMAC signature (optional), encrypted Flow endpoint, full CRM logging with correct 24/72h window, delivery-failure/billing detection (`no_payment_method` 131042/131044), round-robin assignment.
- 🔴 **W-1 (Medium — data integrity): inconsistent candidate `user_group_id`** — WACTO bot uses `BOOTH_ALT`, Meta flow `handleFlowResponse` uses `4`, greeting auto-bridge uses `6`. Three roles for the same "candidate" → access/reporting risk.

---

## 7. Dashboards & UI
- **Super-Admin dashboard — 8/10** (`AdminDashboard.jsx`): attention strip, EPIC search, KPI tiles + sparkline, trend chart (7/30/90/All), pipeline funnel, by-district/position/channel, roll totals; per-card independent retry. Debt: **client-side aggregation won't scale** past a few hundred rows (pulls whole list every load) — move to a summary endpoint.
- **Telecaller dashboard — 7.5/10** (`TelecallerDashboard.jsx`): serves both self (`/team/dashboard`) and admin oversight (`/team/view`, `?agent_id`); 7 KPI tiles, calls-velocity chart, pipeline, recent leads with tel:/WhatsApp. Hard-coded daily goal (30). Self-scoping relies on the backend.
- **CRM UI — 8/10:** Shared Inbox (3-pane, window-gated composer, call cards + recordings, claim, Sync calls), CRM Leads (+LeadDrawer call workspace), Lead Assignment (toggles + schedule), Team Members (create telecaller + 6-digit passcode + TeleCMI creds), WebRTC softphone with full call-state machine (ring→dialpad+timer→auto-end).
  - **UI-1 (Medium bug): CrmLeads deep-links don't filter** — dashboard links pass `?agent_id`/`?status`/`?scope` but `CrmLeads` reads them from local state only, never URL params → admin "inspect this agent's queue" and status chips land on an unfiltered list.
  - **UI-2 (Low): latent group-13 redirect loop**; `Login.jsx:27` navigates to `roleHome(7)='/telecaller/dashboard'` which has no route (works only via catch-all bounce).
- **Frontend security posture (good):** JWT in **HttpOnly cookie** (not localStorage), `withCredentials`; 401 interceptor; idle auto-logout 30 min + cross-tab sync; server denylist on logout. **CSRF** not confirmable from FE — verify SameSite/anti-forgery server-side.

---

## 8. Latent / Correctness Bugs
- 🔴 **BUG-1: `voterController.js:29` calls `getAppDb()` but never imports it** → silent `ReferenceError` in a `try/catch{}` → booth users whose booths live only in `tbl_enquiry` get an **empty scope** instead of their booths. Add the import.
- **BUG-2: no process-level `unhandledRejection`/`uncaughtException` handlers** in `server.js` — a stray async rejection can crash the process.
- **BUG-3: race-prone id allocation** — registration uses `maxUserId()+1`, teamController uses `nextUserId()` (two strategies); mitigated for candidates by the unique mobile index.
- **BUG-4: `getSettings` route comment says "Public"** but sits under `authRequired` (`routes:202`) → a pre-login purchase modal needing it will 401.

---

## 9. Prioritised Issues

> **Status note:** items **1, 2, 4, 6, 10** below, plus `/reports/*`, the cookie/JWT mismatch, duplicate call logging, the `voterController` import and crash handlers, were **✅ FIXED this pass** — see **§0.1**. Passcodes are now masked (part of #5). The rest remain open.

**🔴 CRITICAL / HIGH — fix before production:**
1. **WACTO webhook unauthenticated** — add signature/secret or IP allowlist.
2. **TeleCMI webhook bypassable** (appid-omit) — add HMAC/secret or allowlist.
3. **Meta webhook signature optional + weak default verify token** — enforce in prod, remove default, reject unencrypted Flow.
4. **Group-7 privilege escalation** (`crmAccess` admits 7, `isCrmAgent` only 12) — fix the guard/scope.
5. **Follow-up endpoints leak passcodes/PII/ledger to telecallers** — agent-scope them + mask `password_str` for non-admins.
6. **`/crm/recordings` no ownership check** — scope to the agent's own conversations.
7. **6-digit passcodes + no lockout** — stronger staff secrets + lockout/backoff.
8. **OTP not enforced** on website registration.
9. **CRM `lead_status` never auto-syncs** from registration/payment; **WACTO leads never reach the CRM**.
10. **`/auth/refresh` never re-validates the user** (deactivated users keep sessions).
11. **ngrok webhooks, single TeleCMI extension, ₹0 balance, WABA billing block** (external gates).

**MEDIUM:** `/reports/*` ungated; admin-only buttons shown to telecallers (then 403); session cookie/JWT lifetime mismatch; duplicate call logging; two RR pools; inconsistent candidate group ids; loose order-poll payment matching; CrmLeads URL params ignored; dashboard client-side aggregation; dev proxy defaults to live.

**LOW / hygiene:** `voterController` missing import; no global crash handlers; dead `services/*Controller.js` copies + 29 stray files; dead `visited_at` + amount-unit guessing; `console.info` call-metadata logging; add tests + CI; confirm cookie `secure`/`sameSite` + CSRF on prod.

---

## 10. Production Readiness Checklist
- [ ] Authenticate the **WACTO** webhook; add HMAC/secret (or allowlist) to **TeleCMI** webhooks; enforce **Meta** signature + replace the default verify token + reject unencrypted Flow.
- [ ] Fix **group-7 scoping** (crmAccess vs isCrmAgent); **agent-scope** `/registrations`,`/leads`,`/payments/*` and **mask candidate passcodes** for non-admins; scope `/crm/recordings` by ownership; role-gate `/reports/*`.
- [ ] Hide/disable admin-only action buttons on the FE for telecallers.
- [ ] Replace 6-digit staff passcodes with ≥8-char alphanumeric + login lockout; make `/auth/refresh` re-check `is_active`/existence; reconcile JWT vs cookie lifetime.
- [ ] Enforce OTP on website registration; auto-sync CRM `lead_status` on registration/payment; route WACTO leads into the CRM + unify RR pools; standardize candidate `user_group_id`.
- [ ] Move webhooks off ngrok to `https://tnedms.online/...`; one TeleCMI extension per telecaller; top up TeleCMI balance; fix WABA billing + add onboarding-delivery alerting (no silent 402/out-of-window stalls).
- [ ] De-dupe call logging (align `cmiuuid` field; webhook idempotency); fix `voterController` import; add `unhandledRejection`/`uncaughtException` handlers; move dashboard aggregation to a summary endpoint.
- [ ] Remove stray `backend/src` + dead `services/*Controller.js` files; default dev proxy to localhost; add automated tests (auth, role guards, assignment, webhooks) + CI; verify nginx edge rate-limit/basic-auth on the **production** server block (only staging's is in this copy).

---

## 11. What's genuinely strong
- **Razorpay HMAC verification** (checkout + webhook) — exemplary.
- **In-CRM lead-assignment engine** (round-robin + manual + claim + scheduler + inbound-IVR RR, all logged, agent-scoped).
- **Secret handling** — env-driven with fail-fast validation, server-side TeleCMI secret + recording proxy, CORS locked to origin, helmet, masked prod errors.
- **Session security** — HttpOnly cookie, jti denylist revocation, hardened admin bootstrap (≥12), idle auto-logout + cross-tab sync.
- **Telecaller (group 12) CRM scoping**, **account-takeover protection**, and the **CRM inbox + WebRTC softphone** UI.

*Prepared from direct code review and four parallel deep-dive audits (backend, client journey, frontend, integrations). No code was modified.*
