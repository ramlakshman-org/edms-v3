// B7 (Ram, 2026-10-14): the mock must never answer a route the real backend does not have. The three
// "waiting pages" gap was hidden exactly this way: the mock served /payments/settings, /flow-images/bot and
// /flow-sim/flows while live answered 404. Every mock route (literal keys and param routes) must exist in
// backend/src/routes/index.js (or be a declared exception). Run: node qa/mock-parity.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(HERE, '..', p), 'utf8').replace(/\r/g, '');

// backend: r.<method>('/path', ...) under /api, params → :p
const backend = new Set(read('../backend/src/routes/index.js').split('\n')
  .map((l) => /^r\.(get|post|put|patch|delete)\('([^']+)'/.exec(l.trim())).filter(Boolean)
  .map((m) => `${m[1].toUpperCase()} /api${m[2].replace(/:[A-Za-z_]+/g, ':p')}`));

// mock: literal keys 'METHOD /api/...' ...
const mockSrc = read('devmock/server.mjs');
const literal = [...mockSrc.matchAll(/^\s*'(GET|POST|PUT|PATCH|DELETE) (\/api\/[^'?]+)'/gm)].map((m) => `${m[1]} ${m[2]}`);
// ... and param routes ['METHOD', /^\/api\/...\/(...)$/, fn]: the regex literal ends at the "/, " before fn
const params = [...mockSrc.matchAll(/^\s*\['(GET|POST|PUT|PATCH|DELETE)', \/(.+?)\/, /gm)]
  .map((m) => `${m[1]} ${m[2].replace(/^\^/, '').replace(/\$$/, '').replace(/\\\//g, '/').replace(/\([^)]*\)/g, ':p')}`);
const mock = [...new Set([...literal, ...params])];

// mock-only knobs that exist on purpose (none today — add here with a reason, never silently)
const EXCEPTIONS = new Set([]);

const missing = mock.filter((r) => !backend.has(r) && !EXCEPTIONS.has(r));
console.log(`backend routes ${backend.size}, mock routes ${mock.length} (${literal.length} literal + ${params.length} with params)`);
if (missing.length) {
  console.log(`FAIL — the mock answers ${missing.length} route(s) the backend does not have:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
console.log('PASS: every mock route exists on the backend');
