# EDM-online — copy of www.tnedms.online (downloaded 2026-10-24)

Base for the IVR integration. Downloaded read-only from the droplet (168.144.219.177); nothing on the server changed.

## Where it came from
| Folder | Source | Proof |
|---|---|---|
| `backend/` | server `/var/www/edm-staging/backend` (PM2 `edm-staging`, port 5054) | sha256 of every file = server (`_server/server-sha256.txt`) |
| `frontend/dist/` | server `/var/www/edm-staging/frontend` (website `index-MyAlskw3.js`, `index-C5kQQRY9.css`) | sha256 = server |
| `frontend/` (source) | `EDM` repo commit `ecd1b8d` (branch `feat/payment-screenshot`) | `vite build` of this commit reproduces `index-MyAlskw3.js` + CSS byte for byte |
| `wacto/` | server `/var/www/edm-staging/wacto` (flow JSONs v6–v18 + replay harness) | sha256 = server |
| `_server/` | archive as downloaded, server hash list, staging nginx site (`nginx-edm-staging.conf`) | — |

`backend/src` equals `EDM` HEAD `867d7d1` (= `ecd1b8d`; line endings ignored). The server also carries 29 stray files in `backend/src` (old `*.bak*` copies, files in the wrong folders such as `controllers/voterModel.js`, `services/authController.js`, CRM controllers) — not imported by the app; kept here only to mirror the server.

## Left out on purpose
- `backend/.env` (secrets) — `backend/.env.example` from git is included instead.
- `backend/node_modules` — run `npm ci` in `backend/` and `frontend/`.
- `/var/www/edm-staging/reports` (196 MB of assembly/booth reports with voter data).
- `wacto/replay/node_modules` — on the server it is a broken link to a Windows path.

## Notes
- `frontend/vite.config.js` dev proxy defaults to the LIVE API — set `EDM_API_TARGET` to a local backend before `npm run dev`.
- Staging backend binds 127.0.0.1:5054 behind nginx basic auth; DB = `election_app_staging` (copy of live data, real PII) + read-only `edm_voter_db`.
- `EDM` HEAD has 2 commits not on staging: `bcbecc6` (2-line `entry.css` change + device-sweep QA) and `867d7d1` (booth-map audit script).
