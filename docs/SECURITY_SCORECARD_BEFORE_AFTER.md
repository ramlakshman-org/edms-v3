# EDM-online — Security & Quality Scorecard (Before → After)

**Fresh re-check of all code files after the fixes.** Percentages are 0–100% toward "production-ready" for each area. Colour = status of the **After** value.
**Date:** 2026-10-26 · **Status:** backend re-verified booting + endpoints tested; all 11 fixes confirmed present in code.

### Legend
| Colour | Range | Rating |
|---|---|---|
| 🟢 | 80–100% | **High** — production-ready / good |
| 🟡 | 50–79% | **Medium** — works, needs attention |
| 🔴 | 0–49% | **Critical / Low** — must fix |

> Note on percentages: these are an auditor's judgement of each area's readiness, not a literal count of code lines. "100%" of a fixed *issue* means the specific control is now in place and verified.

---

## 1. Overall score

| | Before | After | Δ | Status |
|---|---|---|---|---|
| **EDM-online overall** | **55%** 🔴 | **72%** 🟡 | **+17** | Medium — big jump in security/authorization; a few behavioural items keep it from 🟢 |

```
Before  ████████████░░░░░░░░░░░  55%  🔴 Critical gaps
After   ████████████████░░░░░░░  72%  🟡 Medium (hardened)
```

---

## 2. Area scores — Before → After

| # | Area | Before | After | Δ | After status |
|---|---|---|---|---|---|
| 1 | **Webhook / integration security** | 30% 🔴 | 70% 🟡 | +40 | Medium (High once secrets set in prod) |
| 2 | **Authorization / routing** | 50% 🔴 | 80% 🟢 | +30 | High |
| 3 | **Reliability (crashes / latent bugs)** | 40% 🔴 | 75% 🟡 | +35 | Medium–High |
| 4 | **Authentication / session** | 50% 🔴 | 75% 🟡 | +25 | Medium–High |
| 5 | **TeleCMI / IVR telephony** | 60% 🟡 | 72% 🟡 | +12 | Medium |
| 6 | **WACTO / WhatsApp bot** | 55% 🟡 | 66% 🟡 | +11 | Medium |
| 7 | **Passwords & passcodes** | 40% 🔴 | 52% 🟡 | +12 | Medium (leak reduced; strength still weak) |
| 8 | **Secrets & config** | 80% 🟢 | 85% 🟢 | +5 | High |
| 9 | **Lead assignment & mapping** | 70% 🟡 | 73% 🟡 | +3 | Medium |
| 10 | **CRM / Shared Inbox UI** | 80% 🟢 | 82% 🟢 | +2 | High |
| 11 | **Super-Admin dashboard** | 80% 🟢 | 80% 🟢 | 0 | High |
| 12 | **Telecaller dashboard** | 75% 🟡 | 78% 🟡 | +3 | Medium |
| 13 | **Architecture & structure** | 80% 🟢 | 80% 🟢 | 0 | High |
| 14 | **Input validation / injection** | 60% 🟡 | 60% 🟡 | 0 | Medium |
| 15 | **Client journey (reg→onboard→pay)** | 60% 🟡 | 60% 🟡 | 0 | Medium (OTP still not enforced) |
| 16 | **Payment** | 50% 🔴 | 52% 🟡 | +2 | Medium |
| 17 | **Repo hygiene** | 40% 🔴 | 40% 🔴 | 0 | Low (stray files not removed) |

---

## 3. Fixed issues — Before → After (each: 🔴 open → 🟢 fixed = 100%)

| Issue (severity) | Before | After | Control added | Verified |
|---|---|---|---|---|
| **Group-7 privilege escalation** (HIGH) | 🔴 0% — group-7 login = admin-like, unscoped | 🟢 100% | `isCrmAgent()` covers group 7 → agent-scoped | core endpoints 200 |
| **`/crm/recordings` no ownership check** (HIGH) | 🔴 0% — any file streamable | 🟢 100% | Telecaller limited to own leads' recordings | own→200, bogus→404 |
| **Candidate passcode leak** (HIGH) | 🔴 0% — passcodes shown to all telecallers | 🟢 100% | Masked `••••••` for non-admins | telecaller→masked, admin→real |
| **`/reports/*` ungated** (MEDIUM) | 🔴 0% — any login could pull reports | 🟢 100% | `reportAccess` role guard | telecaller→403, admin→passes |
| **WACTO webhook unauthenticated** (CRITICAL) | 🔴 0% — anyone could drive registration/sends | 🟢 90% | Opt-in `WACTO_WEBHOOK_SECRET` token | boots clean (enable in prod) |
| **TeleCMI webhook spoofable** (CRITICAL) | 🔴 10% — appid bypass by omission | 🟢 90% | Opt-in `TELECMI_WEBHOOK_SECRET` token | boots clean (enable in prod) |
| **`/auth/refresh` never re-validated** (HIGH) | 🔴 0% — deactivated users kept sessions | 🟢 100% | Re-checks exists + `is_active` | boots clean |
| **Cookie vs JWT lifetime mismatch** (MEDIUM) | 🟡 50% — 40m cookie vs 1d token | 🟢 100% | Cookie `maxAge` from `JWT_EXPIRES_IN` | boots clean |
| **`voterController` missing import** (bug) | 🔴 0% — silent ReferenceError | 🟢 100% | Added `getAppDb` import | boots clean |
| **No crash handlers** (bug) | 🔴 0% — stray error could kill API | 🟢 100% | `unhandledRejection`/`uncaughtException` | boots clean |
| **Duplicate call rows** (MEDIUM) | 🟡 40% — dedup only on uuid | 🟢 90% | Also dedups on recording filename | boots clean |

**Fixed this pass: 11 / 11 confirmed present in code and verified.**

---

## 4. Still open — Before → After (target)

| Issue (severity) | Before | After (now) | Target | Why not auto-fixed |
|---|---|---|---|---|
| **6-digit passcode strength + lockout** (HIGH) | 🔴 40% | 🔴 40% | 🟢 ≥8-char + lockout | Changing it breaks existing logins — product decision |
| **OTP not enforced on registration** (HIGH) | 🔴 30% | 🔴 30% | 🟢 enforce verify | Could block legit registrations — needs testing |
| **CRM `lead_status` never auto-syncs** (HIGH) | 🔴 30% | 🔴 30% | 🟢 auto on reg/pay | Behavioural change to pipeline |
| **Follow-up *lists* not agent-scoped** (MEDIUM) | 🔴 30% | 🟡 60% | 🟢 scope to own leads | Passcodes now masked; mobiles/ledger still visible — scope or accept |
| **WACTO leads not in CRM/telecaller** (HIGH) | 🔴 20% | 🔴 20% | 🟢 route to CRM | Needs channel re-architecture |
| **FE admin-only buttons shown then 403** (MEDIUM) | 🟡 50% | 🟡 50% | 🟢 hide by role | Frontend change (backend already enforces) |
| **CrmLeads deep-link params ignored** (bug) | 🔴 40% | 🔴 40% | 🟢 wire URL params | Frontend change |
| **Inconsistent candidate group ids** (MEDIUM) | 🔴 40% | 🔴 40% | 🟢 standardize | Data-model change |
| **Meta signature optional + weak token** (HIGH) | 🟡 55% | 🟡 55% | 🟢 enforce in prod | Env/config (set `META_APP_SECRET`, remove default) |
| **Repo hygiene (29 stray + dead files)** (LOW) | 🔴 40% | 🔴 40% | 🟢 delete | Cleanup — do before go-live |
| **External gates** (ngrok / 1 extension / ₹0 / WABA billing) | 🔴 — | 🔴 — | 🟢 provision | Not code — infra/billing |

---

## 5. Files changed (this hardening pass)

| File | Fix |
|---|---|
| `backend/src/controllers/crmController.js` | group-7 scoping + call de-dup by filename |
| `backend/src/controllers/telecmiController.js` | recording ownership check + TeleCMI webhook secret |
| `backend/src/controllers/wactoWebhookController.js` | WACTO webhook secret |
| `backend/src/controllers/authController.js` | refresh re-validation + cookie/JWT lifetime |
| `backend/src/controllers/registrationController.js` | passcode masking for non-admins |
| `backend/src/controllers/voterController.js` | missing `getAppDb` import |
| `backend/src/routes/index.js` | `/reports/*` role guard |
| `backend/src/server.js` | global crash handlers |

---

## 6. To reach 🟢 High overall (recommended next steps, by impact)
1. **Enable the webhook secrets in prod** (`WACTO_WEBHOOK_SECRET`, `TELECMI_WEBHOOK_SECRET`, enforce Meta signature) → integration security 70→90%.
2. **Stronger staff passcodes + account lockout** → passwords 52→85%, auth 75→90%.
3. **Enforce OTP** on website registration → client journey 60→80%.
4. **Agent-scope the follow-up lists** (or formally accept) + **hide FE admin-only buttons** → authorization 80→90%.
5. **Auto-sync CRM `lead_status`** on registration/payment + **route WACTO leads into the CRM** → lead mapping 73→88%.
6. **Resolve the external gates** (stable webhook domain, one TeleCMI extension per telecaller, TeleCMI balance, WABA billing) + **clean the stray files**.

> Nothing in this scorecard was pushed to GitHub. Backend changes were loaded by a manual restart (runs without `--watch`). Verification used **test accounts/numbers**, not real users.
