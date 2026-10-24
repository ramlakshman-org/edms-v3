// Live-parity check (B4, 2026-10-14). The droplet's backend was edited on the server after the last
// deploy; this guards that our branch is a SUPERSET of it, so a deploy can never remove a working
// route or feature. Manifest: qa/live-routes-<date>.txt = `method path` for every r.<method>('path')
// on the live routes file. Run: node qa/live-parity.mjs   (exit 1 on any gap)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(HERE, '..', p), 'utf8').replace(/\r/g, '');
const manifest = fs.readdirSync(HERE).filter((f) => /^live-routes-.*\.txt$/.test(f)).sort().pop();
const live = read(`qa/${manifest}`).trim().split('\n').map((l) => l.trim()).filter(Boolean);
const ours = new Set(read('src/routes/index.js').split('\n').map((l) => /^r\.([a-z]+)\('([^']+)'/.exec(l.trim())).filter(Boolean).map((m) => `${m[1]} ${m[2]}`));
// Routes removed on purpose (qa/removed-routes.txt, with the decision noted there): skipped here, and they must stay gone.
const removed = new Set(read('qa/removed-routes.txt').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));
const gaps = [];
for (const r of live) if (!ours.has(r) && !removed.has(r)) gaps.push(`route missing: ${r}`);
for (const r of removed) if (ours.has(r)) gaps.push(`route removed on purpose is back: ${r}`);
const vm = read('src/models/voterModel.js');
if (!/filterVoters\([^)]*\{[^}]*mobileFirst/.test(vm) || !/filterVotersMultiAssembly\([^)]*\{[^}]*mobileFirst/.test(vm)) gaps.push('voterModel: filterVoters/filterVotersMultiAssembly must accept mobileFirst (live freemium view; voterController passes it)');
const sv = read('src/server.js');
if (!/app\.listen\(PORT,\s*(process\.env\.[A-Z_]+\s*\|\|\s*)?'127\.0\.0\.1'/.test(sv)) gaps.push("server.js: must bind 127.0.0.1 (nginx fronts it; ufw is inactive on the droplet)");
const roles = read('src/constants/roles.js');
if (!/SUBADMIN:\s*13/.test(roles)) gaps.push('roles.js: SUBADMIN 13 exists on live');
console.log(`manifest ${manifest}: ${live.length} live routes, ${removed.size} removed on purpose, ${ours.size} ours`);
if (gaps.length) { console.log('FAIL\n  ' + gaps.join('\n  ')); process.exit(1); }
console.log('PASS: branch is a superset of live');
