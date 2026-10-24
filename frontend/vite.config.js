import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxy target: the live API by default; set EDM_API_TARGET (e.g.
// http://localhost:5055) to run the admin against a local backend.
const API_TARGET = process.env.EDM_API_TARGET || 'https://www.tnedms.com';

// Read-only lock (dev server only; `vite build` never includes it). Whenever the dev proxy points
// anywhere but this computer, i.e. the live site, the admin can read but not change anything:
// every POST/PUT/PATCH/DELETE is stopped here, before it leaves the PC, except signing in and out.
// EDM_READ_ONLY=1 forces it on for a local target too (used to test the lock against the mock).
// There is deliberately no switch to turn it off for a live target; writes need a code change.
const LOCAL_TARGET = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(API_TARGET);
const READ_ONLY = !LOCAL_TARGET || process.env.EDM_READ_ONLY === '1';

const ALLOWED_WRITES = new Set(['POST /api/auth/login', 'POST /api/auth/logout', 'POST /api/auth/refresh']);
// Reads that are still blocked: the voter CSV export (it would put voter data on this PC), report files
// that are documents to save (PDF/CSV/XLSX/ZIP/JSON…), and opening a CRM conversation (the backend marks
// it read, a write). The report HTML pages the admin shows in place, with their images and styles, may be
// viewed (Ram, 2026-10-13).
const BLOCKED_READS = [/^\/api\/voters\/export(\/|$)/, /\/export(\/|$)/, /^\/api\/crm\/conversations\//, /^\/report-files\/.*\.(pdf|csv|tsv|xlsx?|zip|json|txt|docx?)$/, /^\/report-files\/?$/];

function readOnlyLock() {
  return {
    name: 'edm-read-only-lock',
    apply: 'serve',
    configureServer(server) {
      if (!READ_ONLY) return;
      server.config.logger.warn(`\n  [read-only] ON: ${API_TARGET} can be read, not changed.\n`);
      // registered before Vite's own middlewares, so it runs ahead of the /api proxy
      server.middlewares.use((req, res, next) => {
        let path = (req.url || '').split('?')[0];
        try { path = decodeURIComponent(path); } catch { /* keep the raw path */ }
        path = path.toLowerCase().replace(/\/{2,}/g, '/'); // Express routes ignore case and repeated slashes
        if (!/^\/(api|report-files)(\/|$)/.test(path)) return next();
        const method = String(req.method || 'GET').toUpperCase();
        const read = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
        // API data opened directly as a page or download (e.g. Registrations "Export (JSON)", which is
        // window.open on /api/registrations): the browser marks those requests as a navigation.
        const opened = req.headers['sec-fetch-mode'] === 'navigate' && path.startsWith('/api/');
        const blocked = read ? opened || BLOCKED_READS.some((r) => r.test(path)) : !ALLOWED_WRITES.has(`${method} ${path.replace(/\/$/, '')}`);
        if (!blocked) return next();
        server.config.logger.warn(`  [read-only] blocked ${method} ${path}`);
        res.statusCode = 423;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: false, readOnly: true, message: 'Blocked: this local admin is connected to the live site in read-only mode. Nothing was sent.' }));
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [react(), readOnlyLock()],
  define: {
    // the banner only exists in the dev server; a production build always gets false
    __EDM_READ_ONLY__: JSON.stringify(command === 'serve' && READ_ONLY),
    __EDM_API_HOST__: JSON.stringify(API_TARGET.replace(/^https?:\/\//, '').replace(/\/.*$/, '')),
  },
  server: {
    port: 5173,
    // a production build writes dist/; the dev server must not reload open pages because of it
    watch: { ignored: ['**/dist/**'] },
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/report-files': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    emptyOutDir: false,
  },
}));
