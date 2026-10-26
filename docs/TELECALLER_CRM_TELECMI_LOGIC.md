# Telecaller CRM + TeleCMI — End-to-End Logic

**Project:** EDM-online (Tamil Nadu Election Data Management)
**Scope of this doc:** the Super-Admin panel, the telecaller (CRM Team Member) function with its own login, the lead/CRM workflow, and the full TeleCMI telephony integration (click-to-call, browser softphone, inbound IVR, CDR logging, recordings).
**Stack:** Node/Express (ES modules) + MongoDB, React/Vite frontend, PIOPIY WebRTC softphone, TeleCMI cloud telephony, ngrok for webhooks.

> Everything configurable or secret lives in `backend/.env` (never hardcoded in source). See the **Environment variables** section at the end.

---

## 1. Architecture at a glance

```
                       ┌──────────────────────── Frontend (React/Vite) ────────────────────────┐
                       │  Super-Admin panel            Telecaller workspace                      │
                       │  • Team Members               • Dashboard (own stats)                   │
                       │  • Shared Inbox               • Inbox / My Leads                         │
                       │  • CRM Leads                  • My Reports                               │
                       │  • Lead Assignment            • Browser softphone (CallBar)             │
                       │  • Telecaller View (oversee)                                            │
                       │  • Lead Reports                                                          │
                       └───────────────▲───────────────────────────────▲─────────────────────────┘
                                       │ REST /api/*                    │ WebRTC audio (PIOPIY → SBC)
                       ┌───────────────┴───────────────────────────────┴─────────────────────────┐
                       │                     Backend (Express)                                    │
                       │  auth · team · crm · telecmi controllers                                 │
                       │  services: telecmiService · crmConfig · crmScheduler · whatsappService   │
                       └───────┬──────────────────────┬───────────────────────┬──────────────────┘
                               │ MongoDB              │ TeleCMI REST           │ ngrok public URL
                   ┌───────────┴─────────┐   ┌────────┴──────────┐   ┌─────────┴───────────────┐
                   │ appDb: election_app │   │ rest.telecmi.com  │   │ TeleCMI → our webhooks: │
                   │  tbl_user           │   │  /v2/webrtc/...   │   │  POST /telecmi/webhook  │
                   │  tbl_crm_conversation│  │  /v2/user/*_cdr   │   │  GET/POST /telecmi/flow │
                   │  tbl_crm_message    │   │  /v2/play (rec.)  │   └─────────────────────────┘
                   │  tbl_crm_settings   │   └───────────────────┘
                   │ voterDb: voter_db   │
                   └─────────────────────┘
```

Two MongoDB connections:
- **voterDb** (`voter_db`) — read-only voter roll (Atlas in production).
- **appDb** (`election_app`) — users, conversations, messages, CRM settings, payments.

---

## 2. Roles & access control

Defined in `backend/src/constants/roles.js`:

| group_id | Role | Relevance here |
|---|---|---|
| 1 | `SUPER_ADMIN` | Full access — owns the whole Super-Admin panel |
| 3 | `MLA` | Assembly login (not CRM) |
| 4 | `BOOTH` | Booth login (not CRM) |
| 7 | `TELECALLER` | Legacy telecaller role (maps to telecaller nav) |
| 12 | `CRM_AGENT` | **CRM Team Member = the telecaller** used throughout the CRM |

Middleware (`backend/src/middleware/auth.js`), applied in `routes/index.js`:
- `authRequired` — must be logged in (JWT in `edm_token` cookie or `Authorization` header).
- `adminOnly` — Super-Admin only. Guards all `/team/*` management + admin-only CRM actions.
- `requireRole(ROLES.CRM_AGENT)` → `crmAccess` — **Super-Admin OR telecaller (group 12)**. Guards the CRM inbox + lead workflow. Candidate/booth/ward logins are rejected.

**Per-agent scoping inside controllers** (`crmController.js`):
- `isCrmAgent(req)` — true when `group_id === 12`.
- `currentAgentId(req)` — the agent's own id (`req.user.sub`).
- `agentCanAccess(db, req, mobile)` — a telecaller may only open/act on conversations whose `assigned_agent_id` equals their own id. Admins are unrestricted.
- Admin oversight: an admin may pass `?agent_id=<id>` (or `?agent_id=unassigned`) to view **one telecaller's** inbox / stats / report **without logging in as them**.

---

## 3. Data model (MongoDB — appDb)

### `tbl_user`
One row per login (admin, telecallers, candidates…). Telecaller rows have `user_group_id = 12`:
- `first_name`, `last_name`, `user_name`, `mobile_no`
- `password` (bcrypt hash), `password_str` (plain, for admin to re-share)
- `telecmi_id` — the telecaller's TeleCMI User ID (softphone extension)
- `telecmi_password` — the telecaller's TeleCMI softphone password (server-side only; never returned in lists)
- `is_active` (1/0)

### `tbl_crm_conversation`  (one per lead/phone)
- `clean_mobile` (last-10 digits — the key), `phone`, `contact_name`
- `status` — thread status: `open` / `resolved` / `archived`
- `lead_status` — the CRM lead state (see §5)
- `assigned_agent_id`, `assigned_agent_name`, `assigned_at`, `assigned_by` (`manual` / `distribute` / `claim`)
- `taken`, `taken_by`, `taken_at` — the claim lock
- `status_history[]` — append-only log: `{ status, note, by, at, source, direction, duration, recording, ivr }`
- `assignment_history[]` — append-only log of (re)assignments
- `last_message`, `last_message_at`, `unread_count`
- WhatsApp window fields: `window_expires_at`, `window_source`, `window_hours`, `last_inbound_at`

### `tbl_crm_message`  (chat + call timeline)
- `clean_mobile`, `phone`, `direction` (`incoming`/`outgoing`), `type` (`text`/`interactive`/`template`/`image`/`video`/`call`…), `body`, `created_at`
- `metadata` — e.g. `{ telecmi, cmiuuid, recording, answeredsec, agent, action, headerUrl… }`
- Call recordings are referenced by `metadata.recording` (a TeleCMI filename) and deduped on import by `metadata.cmiuuid`.

### `tbl_crm_settings`  (singleton-ish config docs)
- `_id: 'crm_config'` — assignment configuration (§6)
- `_id: 'round_robin'` — `{ last_agent_id }` cursor for the Distribute button
- `_id: 'telecmi_rr'` — `{ last }` cursor for inbound IVR round-robin
- `_id: 'auto_distribute_run'` — `{ key }` guard so the scheduler runs once per window

---

## 4. Authentication

`POST /api/auth/login` (`authController.login`), rate-limited (20 / 15 min):

1. **Admin bootstrap** — if `ADMIN_USERNAME` / `ADMIN_PASSWORD` are set to a **strong, non-default** password, and the submitted credentials match, a Super-Admin token is minted directly (claims `{ sub:'admin', group_id:1 }`). This is the `admin` / strong-password path. It is deliberately disabled for weak/default passwords.
2. **Normal login** — `findByCredentials(username, password)` matches a `tbl_user` row by `user_name`/`mobile_no` + bcrypt password. Inactive users are blocked (except MLA). A JWT is signed with `{ sub: <user _id>, name, group_id }` and set as the `edm_token` cookie (and returned in the body).
3. **Landing route by role** (`roleHome`): Super-Admin → `/dashboard`; telecaller (12) → `/team/dashboard`; (7) → `/telecaller/dashboard`.

**Telecaller login:** the credentials are the **username + passcode the Super-Admin created** in Team Members. On login they land on their own telecaller workspace (nav below), scoped to their assigned leads only.

Nav per role (`frontend/src/civic/nav.js`, `navFor`):
- **Super-Admin → `ADMIN_NAV`**, "Telecalling" section: Team Members, Shared Inbox, CRM Leads, Lead Assignment, Telecaller View, Lead Reports.
- **Telecaller (12/7) → `TELECALLER_NAV`**: My work (Dashboard, Inbox, My Leads/Chats), Follow-up (Incomplete regs, Registrations, Payments), Reports (My Reports).

---

## 5. Lead lifecycle & statuses

Status vocabulary lives in `frontend/src/civic/leadStatus.js` and is mirrored by `validStatuses` in `crmController.updateLeadStatus`. Each status has a label/emoji/`bucket` (the dashboard KPI grouping).

| status | label | bucket |
|---|---|---|
| `new` / `none` | New | new |
| `assigned` | Assigned | open |
| `contacted` | Contacted | open |
| `interested` | 🟢 Interested | interested |
| `call_back` / `will_call_back` | 📱 Call back | unreachable |
| `not_answered` | 📵 Not answered | unreachable |
| `switch_off` | 📴 Switched off | unreachable |
| `unreachable` | Unreachable | unreachable |
| `first_call_complete` | 📞 1st call done | calls |
| `second_call_complete` | 📞 2nd call done | calls |
| `third_call_complete` | 📞 3rd call done | calls |
| `call_completed` | Call completed | calls |
| `registration_incomplete` | 📝 Reg. incomplete | incomplete |
| `registration_completed` | ✅ Registered | registered |
| `converted` | ⭐ Converted | converted |
| `not_interested` | 🔴 Not interested | not_interested |

**Status change logic** (`POST /crm/conversations/:phone/lead-status`):
- Validates the status, checks `agentCanAccess`.
- Writes `lead_status`, `last_handled_by`, `updated_at`; optionally `agent_notes`.
- If the lead has no owner yet, the acting agent claims it (sets `assigned_agent_id`).
- **Appends every click** to `status_history` as `{ status, note, by, at }` — even repeats (so 3 calls to the same lead are all logged with timestamps). This history is the source of truth for the reports and the "calls done" counts.

Notes/comments: `POST /crm/conversations/:phone/notes` saves `agent_notes` (free text) on the conversation.

Website registration journey (brief): `POST /public/track` + `/public/lead` beacons stamp `visited_at/started_at/submitted_at/completed_at`, and successful registration flips the lead toward `registration_completed`/`converted`.

---

## 6. Assignment engine (Super-Admin "Lead Assignment")

Config doc `tbl_crm_settings/_id:'crm_config'` (`services/crmConfig.js`):

```js
DEFAULT_CONFIG = {
  round_robin: true,        // auto round-robin on inbound + the Distribute button
  manual_assign: true,      // admin can assign leads manually
  claim_unassigned: false,  // telecallers may claim unassigned leads themselves
  auto_distribute: { enabled: false, frequency: 'daily', hour: 9 },
}
```
- `GET /crm/settings` (telecallers may read, to know if claiming is on) · `PUT /crm/settings` (admin only).

**Four ways a lead gets an owner:**

1. **Round-robin Distribute button** — `POST /crm/distribute-leads` → `runDistribute(db, {reassignAll})`:
   - Pulls active agents (`getActiveAgents`), cycles through unassigned conversations (or all, if `reassign_all`), assigning each to the next agent.
   - Uses `tbl_crm_settings/_id:'round_robin'.last_agent_id` as a persistent cursor so distribution continues fairly across runs.
   - Records a `assignment_history` entry per lead and resets `taken:false`.

2. **Manual assign** — `POST /crm/conversations/:phone/assign` (admin): assign to a chosen active agent; **overrides** the `taken` claim lock.

3. **Claim (Taken lock)** — `POST /crm/conversations/:phone/claim` (telecaller): only allowed when `claim_unassigned` is on. Sets `taken:true`, `taken_by`. If the lead is already owned by someone else, returns **409 "Already taken by …"** (prevents duplicates). Admins can always claim/override.

4. **Scheduled auto-distribute** — `services/crmScheduler.js` (`startCrmScheduler`, started in `server.js`):
   - Ticks every 5 minutes; runs `runDistribute` when `round_robin` **and** `auto_distribute.enabled` are on and the window matches (`hourly` / `daily`-at-`hour` / `weekly` Monday-at-`hour`).
   - A persisted run-key (`auto_distribute_run`) prevents double runs within a window and across restarts.

**Release on deactivate/delete** (`teamController`): when a telecaller is deactivated or deleted, their open leads are released (`assigned_agent_id:null`) back to the pool so nothing is stuck on an inactive agent; inbound round-robin already skips inactive agents.

**Inbound-call round-robin** is separate (see §9.4) and uses its own `telecmi_rr` cursor.

---

## 7. Super-Admin: Team Members

CRUD over telecaller accounts (`teamController.js`, all `adminOnly`):

- **`GET /team/members`** — lists every CRM Team Member with **live per-agent stats** aggregated from `tbl_crm_conversation` (interested, not_interested, 1st/2nd/3rd call done, switch_off, not_answered, will_call_back, calls_completed, pro_users, total_handled). Returns `telecmi_id` and `has_softphone` (boolean — the softphone password itself is **never** exposed).
- **`POST /team/members`** — create a telecaller: name, username, mobile, password (+ optional `telecmi_id`, `telecmi_password`). Stores `user_group_id:12`, bcrypt password + `password_str`, `is_active:1`. Rejects duplicate username/mobile.
- **`PUT /team/members/:id`** — edit name/username/mobile/password/active + TeleCMI creds. Deactivating releases their leads.
- **`DELETE /team/members/:id`** — delete + release leads.
- **`GET /team/stats`** — org-wide totals across all telecallers (Total Leads, Interested, Not Interested, each call-done bucket, Calls Completed, Pro Users, Total Team Members).

**Telecaller View (oversight):** the admin opens any telecaller's dashboard/inbox/report by passing `?agent_id=<id>` to the CRM endpoints — no need to log in as the telecaller.

---

## 8. Shared Inbox / CRM conversations (WATI-style)

Endpoints under `crmAccess` (`crmController.js`):

- **`GET /crm/conversations`** — the inbox list. Telecallers see only their assigned leads (plus the unassigned pool when `claim_unassigned` is on). Admins see all, or one agent via `?agent_id=`. Supports `search`, `status`, `lead_status`, pagination. Each row is enriched with registration/paid (`is_registered`, `is_pro`, district, assembly, passcode…).
- **`GET /crm/conversations/:phone`** — full message history + contact card + **the WhatsApp messaging window** (`resolveWindow`): 24h for direct, 72h for ad-sourced, computed from the last inbound message. Resets `unread_count`.
- **Sending (window-aware):**
  - `POST /crm/messages/send` — free-form text. **Blocked (403 `window_closed`) when the 24h/72h window is closed** — a template must be used instead.
  - `POST /crm/conversations/:phone/send-media` — Cloudinary upload → WhatsApp image/video/doc (window-gated).
  - `POST /crm/send-credentials` — sends the candidate's login (interactive button inside the window; falls back to the approved `edms_welcome` template when closed — passcode can't go in a template, so it's a login nudge).
  - `POST /crm/send-flow` — sends the WhatsApp registration Flow (falls back to the `edms_reg_flow` template when closed).
  - `POST /crm/conversations/:phone/send-template` — approved templates when the window is closed.
  - `POST /crm/conversations/:phone/react` — emoji reaction.
- **Workflow:**
  - `POST /crm/conversations/:phone/lead-status` — change lead status (§5).
  - `POST /crm/conversations/:phone/notes` — save notes/comments.
  - `POST /crm/conversations/:phone/status` — open/resolved/archived.
  - `POST /crm/conversations/:phone/assign` (admin) · `POST .../claim` (telecaller).
  - `DELETE /crm/conversations/:phone/clear` — delete this thread's messages + its **own** Cloudinary media (never shared flow assets); keeps the contact, status, owner.
- **Calls in the inbox:** `type:'call'` messages render as voice-call cards; recorded calls embed an inline `<audio>` player pointing at the recording proxy (§9.5). A **"Sync calls"** button (admin) pulls real TeleCMI logs on demand (§9.6).

Billing note: when a template send fails because the WhatsApp Business account has no payment method, the API returns **402 `no_payment_method`** with a clear message.

---

## 9. TeleCMI integration (end-to-end)

Service: `backend/src/services/telecmiService.js`. Controller: `backend/src/controllers/telecmiController.js`.
Base URL `TELECMI_BASE` (`https://rest.telecmi.com`); app identity `TELECMI_APP_ID` + `TELECMI_APP_SECRET`; default caller ID (DID) `TELECMI_CALLER_ID`; SBC `TELECMI_SBC`. The app **secret stays server-side only** — it never reaches the browser.

Number normalization (`toDialNumber`): a 10-digit Indian mobile becomes `91XXXXXXXXXX`.

### 9.1 Click-to-call — `click2call({ userId, to, callerid, followme })`
`POST /v2/webrtc/click2call` with `{ user_id, secret, to, webrtc, followme, callerid, extra_params }`.
- `followme:true` → `webrtc:false` → rings the agent's **registered mobile** first, then dials the lead.
- `followme:false` → `webrtc:true` → rings the agent's **browser softphone** (no mobile ring).
- Either way TeleCMI originates the call and **passes the DID (`callerid`) per call**, so the lead sees `918031406056` — this sidesteps the per-user `callerid:null` limitation (and the 403 on `/v2/set_callerid`).
- Error mapping: 400 (missing/no method) · 404 (bad user id) · 407 (bad secret).

### 9.2 Calling a lead — `POST /crm/conversations/:phone/call` (`callLead`)
- Checks `agentCanAccess`.
- **Who rings:** a telecaller calls through **their own** `telecmi_id` (400 if not set). An admin rings the lead's **assigned** telecaller's `telecmi_id` (so the right person talks to the lead), or `?telecmi_id=` to force one.
- `body.web === true` → browser softphone (`followme:false`); otherwise mobile bridge (`followme:true`).
- Logs a `type:'call'` message into the thread with the `request_id`.

### 9.3 Browser softphone (WebRTC) — `GET /crm/softphone` (`softphoneCreds`)
- Returns the **logged-in telecaller's own** `{ user_id, password, sbc, caller_id, name }` so the frontend can register the **PIOPIY** web phone (`frontend/src/civic/webphone.jsx`, `WebPhoneProvider` + `CallBar` dialer).
- Admins get `softphone:null` (no extension) — they must sign in as a telecaller to talk through the browser.
- Missing creds → `softphone:null` with a message to add them in Team Members.
- `POST /crm/conversations/:phone/call-log` records a web-softphone call's outcome (`answered`/`missed`/`failed`, seconds, note) into `status_history` + a call message.

### 9.4 Inbound IVR routing — `GET|POST /telecmi/flow` (`flow`) — **public**
TeleCMI calls this with `{ from, to, cmiuuid, appid }`; we reply with routing JSON. Verifies `appid`.
1. If the caller already has a conversation with an `assigned_agent_id` that has a `telecmi_id` → route to that agent.
2. Otherwise **round-robin** among active telecallers that have a `telecmi_id` (`routableAgents`), advancing the `telecmi_rr` cursor, and stamp the new owner onto the conversation (upserting it).
3. Reply `{ code:200, followme:true, result:[{ agent_id, phone? }], welcome_music, waiting_music, timeout }`. If nobody is routable → greet and stop.

### 9.5 CDR webhook (live call logging) — `POST /telecmi/webhook` (`webhook`) — **public**
- Verifies `appid`; only acts on `type:'cdr'` (ignores interim event pings); **always returns 200** so TeleCMI never retries on our errors.
- Identifies the lead (dialed number on outbound, caller on inbound) and the handling telecaller (`tbl_user.telecmi_id === b.user`).
- Status = `call_completed` if `answeredsec > 0` else `not_answered`.
- **Upserts** the conversation, pushes a `status_history` entry (with `duration`, `recording` filename, `ivr`), and writes a `type:'call'` message into the thread — so every live call shows up in the inbox with its recording.

### 9.6 Recording playback — `GET /crm/recordings?file=…` (`getRecording`)
- Streams `GET /v2/play?appid&secret&file` through the backend (12s timeout) so the **secret never reaches the browser**. Returns `audio/mpeg`/`wav` inline; the inbox `<audio>` player points here. Rejects path traversal in `file`.

### 9.7 Recording/CDR sync (on-demand import) — `POST /crm/sync-recordings` (admin, `syncTelecmiRecordings`)
- For every telecaller that has `telecmi_id` + `telecmi_password`, calls `fetchUserCdr` which logs in (`POST /v2/user/login` → token) and pages through `/v2/user/out_cdr` + `/v2/user/in_cdr` (answered + missed), normalizing each CDR to `{ cmiuid, direction, answered, duration, filename, number, time, name }`.
- Imports each call into `tbl_crm_message` (type `call`, real timestamp, recording filename) and updates the conversation's `status_history` + `last_message` — **deduped by `metadata.cmiuuid`** so re-syncing never double-counts.
- Body `{ days? }` (default 3, max 30). Returns `{ imported, skipped }`.

---

## 10. Reports & dashboards

- **`GET /crm/team-stats`** — the logged-in telecaller's dashboard (admin can scope with `?agent_id=`): `total`, `interested`, `not_interested`, `converted`, `contacted`, `pending`, `conversion_rate`, `pro`, `registered`, **`calls_today`**, **`calls_total`**, a `status_breakdown` for the chart, and **`calls_last_7_days`**. Calls are counted from `status_history` entries whose status is `first/second/third_call_complete` or `call_completed` (so multiple calls to one lead all count).
- **`GET /crm/team-report`** — lead list for the report table / PDF, with each lead's `status_timeline` (status, at, note, by) and `status_changes` count. Supports a `from`/`to` date range for daily/weekly/monthly reports.
- **`GET /team/stats`** (admin) — org-wide rollup across all telecallers.
- Registered/Pro are computed live against `tbl_user`/`tbl_enquiry` (`paid_status` = Yes → Pro), so dashboards never disagree with the lead rows.

---

## 11. API reference (telecalling surface)

| Method & path | Guard | Purpose |
|---|---|---|
| `POST /auth/login` | public | Admin + telecaller login |
| `GET /team/members` | admin | List telecallers + live stats |
| `POST /team/members` | admin | Create telecaller (+TeleCMI creds) |
| `PUT /team/members/:id` | admin | Edit / activate / deactivate |
| `DELETE /team/members/:id` | admin | Delete (releases leads) |
| `GET /team/stats` | admin | Org-wide stats |
| `GET /crm/conversations` | crm | Inbox list (scoped) |
| `GET /crm/conversations/:phone` | crm | Thread history + window |
| `POST /crm/messages/send` | crm | Free-form text (window-gated) |
| `POST /crm/conversations/:phone/send-media` | crm | Media (window-gated) |
| `POST /crm/send-credentials` | crm | Send login creds / nudge |
| `POST /crm/send-flow` | crm | Send registration Flow |
| `POST /crm/conversations/:phone/send-template` | crm | Approved template |
| `POST /crm/conversations/:phone/react` | crm | Emoji reaction |
| `POST /crm/conversations/:phone/lead-status` | crm | Change lead status (logged) |
| `POST /crm/conversations/:phone/notes` | crm | Save notes/comments |
| `POST /crm/conversations/:phone/status` | crm | open/resolved/archived |
| `POST /crm/conversations/:phone/assign` | admin | Manual assign |
| `POST /crm/conversations/:phone/claim` | crm | Claim (Taken lock, 409 dup) |
| `DELETE /crm/conversations/:phone/clear` | crm | Clear chat + own media |
| `GET /crm/agents` | admin | Active agents (assign dropdown) |
| `POST /crm/distribute-leads` | admin | Round-robin distribute |
| `GET /crm/settings` | crm | Read assignment config |
| `PUT /crm/settings` | admin | Change assignment config |
| `GET /crm/team-stats` | crm | Dashboard stats |
| `GET /crm/team-report` | crm | Report rows (date-ranged) |
| `POST /crm/conversations/:phone/call` | crm | TeleCMI click-to-call / web |
| `GET /crm/softphone` | crm | Browser softphone creds |
| `POST /crm/conversations/:phone/call-log` | crm | Log web-softphone outcome |
| `GET /crm/recordings?file=` | crm | Stream recording (proxied) |
| `POST /crm/sync-recordings` | admin | Import real CDRs + recordings |
| `POST /telecmi/webhook` | public | CDR logger (appid-verified) |
| `GET\|POST /telecmi/flow` | public | Inbound IVR routing |
| `POST /public/track` · `POST /public/lead` | public | Website journey beacons |

---

## 12. Security notes

- All secrets (JWT secret, admin password, Atlas URL, TeleCMI app secret + caller ID, telecaller softphone passwords) live in `backend/.env`, which is **gitignored**. `.env.example` documents the variables with placeholders only.
- The TeleCMI **app secret** is used only server-side (click-to-call, CDR login, recording proxy). The browser only ever receives the telecaller's own softphone extension creds via `GET /crm/softphone`.
- Public telephony webhooks (`/telecmi/webhook`, `/telecmi/flow`) **verify `appid`** so they can't be spoofed.
- Telecallers are strictly scoped to their assigned leads (`agentCanAccess`); the softphone password is never returned in any list (`has_softphone` boolean only).
- Auth endpoints are rate-limited; the admin-bootstrap login is disabled for weak/default passwords.

---

## 13. Environment variables (`backend/.env`)

```
# Auth / admin bootstrap
JWT_SECRET=<long random string>
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<strong password>

# Databases
MONGO_VOTER_URL=<Atlas voter roll URL>      MONGO_VOTER_DB_NAME=voter_db
MONGO_APP_URL=mongodb://127.0.0.1:27017      MONGO_APP_DB_NAME=election_app

# TeleCMI telephony
TELECMI_BASE=https://rest.telecmi.com
TELECMI_APP_ID=<app id>
TELECMI_APP_SECRET=<app secret>              # server-side only
TELECMI_CALLER_ID=<DID shown to the lead>    # e.g. 918031406056
TELECMI_SBC=sbcind.telecmi.com               # WebRTC SBC for the browser softphone
# optional IVR hold music
TELECMI_WELCOME=<url>   TELECMI_WAITING=<url>

# Public base for TeleCMI webhooks (ngrok tunnel to port 5000)
PUBLIC_BASE_URL=<https ngrok url>
```

Per-telecaller TeleCMI creds (`telecmi_id`, `telecmi_password`) are **not** env vars — the Super-Admin sets them per team member in the Team Members screen, and they are stored on each `tbl_user` row.
