// Runs the WhatsApp reminder jobs (services/reminders.js) every 2 minutes inside the API process (Ram, 2026-10-16).
// While both reminder switches are "off" a pass reads one settings document and does nothing else.
// A lock document (tbl_job_locks) makes sure only one pass runs at a time, even with more than one process.
// REMINDER_JOB=off in the environment stops the timer completely.
import { getAppDb, isAppDbOnline } from '../config/db.js';
import { runReminders } from './reminders.js';
import { sendWactoTemplate, sendWactoText } from './wactoService.js';

const EVERY_MS = 2 * 60 * 1000;
const LOCK_MS = 10 * 60 * 1000;

export const wactoSender = {
  sendTemplate: (mobile, name, lang, params) => sendWactoTemplate({ mobile, templateName: name, language: lang, bodyParams: params }),
  sendText: (mobile, text) => sendWactoText(mobile, text),
};

async function takeLock(db) {
  const now = Date.now();
  const locks = db.collection('tbl_job_locks');
  const cur = await locks.findOne({ _id: 'reminders' });
  if (cur && new Date(cur.until).getTime() > now) return false;
  const r = await locks.updateOne(
    { _id: 'reminders', until: cur ? cur.until : { $exists: false } },
    { $set: { until: new Date(now + LOCK_MS).toISOString(), pid: process.pid } },
    { upsert: !cur },
  ).catch((e) => (e?.code === 11000 ? { matchedCount: 0, upsertedCount: 0 } : Promise.reject(e)));
  return (r.matchedCount || 0) + (r.upsertedCount || 0) > 0;
}

async function releaseLock(db) {
  await db.collection('tbl_job_locks').updateOne({ _id: 'reminders' }, { $set: { until: new Date(0).toISOString() } }).catch(() => {});
}

export async function reminderPass() {
  if (!isAppDbOnline()) return null;
  const db = getAppDb();
  if (!(await takeLock(db))) return null;
  try {
    const out = await runReminders(db, wactoSender);
    const did = out.payment.sent + out.payment.dry + out.payment.failed + out.incomplete.sent + out.incomplete.dry + out.incomplete.failed;
    if (did) console.log(`[reminders] ${new Date().toISOString()} payment ${JSON.stringify(out.payment)} incomplete ${JSON.stringify(out.incomplete)}`);
    return out;
  } finally {
    await releaseLock(db);
  }
}

export function startReminderJob() {
  if (String(process.env.REMINDER_JOB || '').toLowerCase() === 'off') { console.log('[reminders] timer off (REMINDER_JOB=off)'); return; }
  const tick = () => reminderPass().catch((e) => console.error(`[reminders] ${new Date().toISOString()} pass failed: ${e.message}`));
  setTimeout(tick, 60 * 1000);
  setInterval(tick, EVERY_MS).unref();
}
