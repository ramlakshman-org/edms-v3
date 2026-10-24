# EDMS WACTO webhook — offline replay harness

Runs scripted WhatsApp conversations through the **real** `backend/src/controllers/wactoWebhookController.js`
with a fake DB (`src/config/db.js`), a fake WACTO sender that records every outgoing message
(`src/services/wactoService.js`) and a fake user model. Nothing touches the network, the real
database or WhatsApp. Test data is synthetic only (mobile `919000000001`, name "Sim").

The fakes share state through `globalThis.__H`, captured at first import — reset it **in place**
between runs, never replace the object.

## Setup (re-run after every controller change)

```bash
cd EDM/wacto/replay
node setup.mjs                              # current.js = working-tree controller
node setup.mjs before=HEAD~1                # + before.js = controller at any git ref
```

## Checks

| Command | What it proves | Expected (2026-10-10, HEAD 43380a0) |
|---|---|---|
| `node replay.mjs src/controllers/current.js ta` | Tamil registration + menu chat: language, one-bubble image+caption, replies, saved enquiry | exit 0, 10 PASS |
| `node replay.mjs src/controllers/current.js en` | same in English | exit 0, 10 PASS |
| `node replay.mjs src/controllers/current.js ta --fail-caption` (and `en`) | caption rejected → image then text fallback | exit 0, 8 PASS |
| `node retap.mjs src/controllers/current.js` | 24 old-tap scenarios: an old button/list tap changes nothing (note only), no re-registration / passcode reset, district never saved as assembly, 31-min pause still completes, Register restarts, menu stays repeatable, language locked during registration (Register in the other menu switches), login image + text in one message, Hi/Hello/Hey/Start/Menu/வணக்கம் start over, "Got it → Next" pointer after a warning, v8 paging buttons ignored | exit 0, ALL 24 PASS |
| `node allrows.mjs src/controllers/current.js ../EDMS_bilingual_v8.json` (and v7) | every role/party/position/district/assembly row of the live flow (EN + TA) is still accepted at its own step | exit 0, 602 options accepted |
| `node content_check.mjs src/controllers/<name>.js out/<name>.json` | dumps every backend message (TA + EN) for diffing | writes the dump |
| `node compare.mjs out/before.json out/current.json` | **pinned to the 2026-10-09 Tamil content change** (commit 43380a0): English untouched, Tamil differs only at the 5 approved strings, saved data identical | with `before=43380a0~1`: exit 0 |

For a new change, first run the checks on the **unpatched** controller (`before=<ref>`): a check
written for the change must FAIL there, otherwise it proves nothing. `replay.mjs` is a general
regression test — it passes on both sides of a content-only change.

## Not covered (known gaps)

- Booth numbers typed with spaces (`3 6 9`) — known bug, keeps only the first booth.
- The flow JSON itself: taps are given as titles; flow↔backend label drift is checked by
  `route_check.py --backend` with the skill's `edms.labels.json`, not here.
- Live WACTO behaviour — this is a local simulation.

Before committing changes here: `python -I ~/.claude/skills/wacto-flow/scripts/privacy_scan.py EDM/wacto/replay`
must exit 0.
