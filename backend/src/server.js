import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { connectDbs, closeDbs, isVoterDbOnline, isAppDbOnline } from './config/db.js';
import apiRoutes from './routes/index.js';
import { REPORTS_DIR } from './controllers/reportController.js';
import { authRequired } from './middleware/auth.js';
import { startReminderJob } from './services/reminderJob.js';
import { startCrmScheduler } from './services/crmScheduler.js';

const app = express();

// Behind the nginx reverse proxy — required for correct client IP (rate limiting)
// and X-Forwarded-* handling.
app.set('trust proxy', 1);

// Security headers. CSP is disabled because the pre-generated static HTML reports
// use inline scripts + relative asset paths; cross-origin resource policy is
// relaxed so images/reports load from the SPA origin.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS — restrict to the configured client origin (no wildcard fallback).
const clientOrigin = process.env.CLIENT_ORIGIN || 'https://tnedms.com';
app.use(cors({ origin: clientOrigin, credentials: true }));

// Capture the raw body so webhook HMAC signatures (Razorpay, Meta) can be
// verified against the exact bytes that were signed.
app.use(express.json({ limit: '15mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Don't leak internal error detail to clients in production — generic 5xx message.
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    if (process.env.NODE_ENV === 'production' && res.statusCode >= 500
        && payload && typeof payload === 'object' && typeof payload.message === 'string') {
      payload = { ...payload, message: 'Internal server error. Please try again later.' };
    }
    return originalJson(payload);
  };
  next();
});

// Static HTML reports (Assembly_Reports / Booth_Reports). Booth reports load a
// relative lib/ (echarts) so they must be served as files, not inlined.
// Which assembly/booth a user may open is governed by /api/reports/documents.
// Ram, 2026-10-14 (C10): a login is required — the pre-built reports used to be open to anyone with the link.
// nginx enforces the same rule in front (auth_request → /api/auth/check); this guards the direct path too.
app.use('/report-files', authRequired, express.static(REPORTS_DIR));

app.get('/health', (req, res) =>
  res.json({ ok: true, voterDb: isVoterDbOnline(), appDb: isAppDbOnline() })
);

app.use('/api', apiRoutes);

app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found.' }));

const PORT = process.env.PORT || 5000;

// Fail fast if critical configuration is missing or left at insecure defaults,
// rather than booting a mis-configured / insecure server.
function validateEnv() {
  const missing = ['JWT_SECRET', 'MONGO_APP_URL', 'MONGO_VOTER_URL'].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`[edm] FATAL: missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
  const secret = process.env.JWT_SECRET;
  const weak = secret === 'change-this-to-a-long-random-string' || secret.length < 16;
  if (weak && process.env.NODE_ENV === 'production') {
    console.error('[edm] FATAL: JWT_SECRET is the placeholder or too short. Set a strong secret (>=16 chars).');
    process.exit(1);
  }
}

// A stray rejection/throw in a fire-and-forget path (webhooks ack 200 then work
// async) must not take the whole API down. Log and keep serving; in production the
// process manager (PM2) can still be configured to restart on repeated failures.
process.on('unhandledRejection', (reason) => {
  console.error('[edm] unhandledRejection:', reason && reason.stack ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[edm] uncaughtException:', err && err.stack ? err.stack : err);
});

(async () => {
  validateEnv();
  await connectDbs();
  // Localhost only (as on the droplet): nginx fronts the API and ufw is inactive there.
  const server = app.listen(PORT, process.env.BIND_HOST || '127.0.0.1', () => console.log(`[edm] API listening on http://localhost:${PORT}`));
  startReminderJob(); // WhatsApp reminders (2026-10-16): does nothing while their switches are off
  startCrmScheduler(); // CRM auto round-robin distribution (does nothing while the switch is off)
  const shutdown = async () => { await closeDbs(); server.close(() => process.exit(0)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})();
