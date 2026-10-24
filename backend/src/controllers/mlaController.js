import { getAppDb } from '../config/db.js';
import * as cloudinary from '../services/cloudinaryService.js';

// MLA images — profile photos (per constituency) and party flags (per party),
// stored on Cloudinary. Kept separate from Flow Images (which is reserved for
// WhatsApp). Collections: mla_profiles { constituency_no, url, public_id },
// mla_party_flags { party, url, public_id }.
const PROFILES = 'mla_profiles';
const FLAGS = 'mla_party_flags';

const b64ToBuffer = (fileBase64) => {
  const b64 = String(fileBase64 || '').replace(/^data:[^;]+;base64,/, '');
  return Buffer.from(b64, 'base64');
};

// GET /mla/images — maps for the list + upload pages.
export async function list(req, res) {
  try {
    const db = getAppDb();
    const [profiles, flags] = await Promise.all([
      db.collection(PROFILES).find({}).toArray(),
      db.collection(FLAGS).find({}).toArray(),
    ]);
    const profileMap = {};
    for (const p of profiles) profileMap[p.constituency_no] = p.url;
    const flagMap = {};
    for (const f of flags) flagMap[f.party] = f.url;
    res.json({ success: true, profiles: profileMap, flags: flagMap });
  } catch (e) {
    if (e.message === 'APP_DB_OFFLINE') return res.status(503).json({ success: false, message: 'App database unavailable.' });
    res.status(500).json({ success: false, message: e.message });
  }
}

// POST /mla/profile-upload — { constituency_no, filename, mime, fileBase64 }
export async function uploadProfile(req, res) {
  const { constituency_no, filename, mime, fileBase64 } = req.body || {};
  const no = parseInt(constituency_no, 10);
  if (Number.isNaN(no) || !fileBase64) return res.status(400).json({ success: false, message: 'constituency_no and file are required.' });
  if (String(mime || '').includes('video')) return res.status(400).json({ success: false, message: 'Only image files are allowed.' });
  try {
    const coll = getAppDb().collection(PROFILES);
    const old = await coll.findOne({ constituency_no: no });
    if (old?.public_id) await cloudinary.destroy(old.public_id, 'image');
    const up = await cloudinary.upload(b64ToBuffer(fileBase64), filename, 'image', 'mla-profiles');
    await coll.updateOne({ constituency_no: no }, { $set: { constituency_no: no, url: up.url, public_id: up.public_id, updated_at: new Date().toISOString() } }, { upsert: true });
    res.json({ success: true, url: up.url });
  } catch (e) {
    if (e.message === 'APP_DB_OFFLINE') return res.status(503).json({ success: false, message: 'App database unavailable.' });
    res.status(500).json({ success: false, message: e.message });
  }
}

// POST /mla/flag-upload — { party, filename, mime, fileBase64 }
export async function uploadFlag(req, res) {
  const { party, filename, mime, fileBase64 } = req.body || {};
  if (!party || !fileBase64) return res.status(400).json({ success: false, message: 'party and file are required.' });
  if (String(mime || '').includes('video')) return res.status(400).json({ success: false, message: 'Only image files are allowed.' });
  try {
    const coll = getAppDb().collection(FLAGS);
    const old = await coll.findOne({ party });
    if (old?.public_id) await cloudinary.destroy(old.public_id, 'image');
    const up = await cloudinary.upload(b64ToBuffer(fileBase64), filename, 'image', 'mla-flags');
    await coll.updateOne({ party }, { $set: { party, url: up.url, public_id: up.public_id, updated_at: new Date().toISOString() } }, { upsert: true });
    res.json({ success: true, url: up.url });
  } catch (e) {
    if (e.message === 'APP_DB_OFFLINE') return res.status(503).json({ success: false, message: 'App database unavailable.' });
    res.status(500).json({ success: false, message: e.message });
  }
}

// DELETE /mla/profile/:no  and  DELETE /mla/flag/:party
export async function removeProfile(req, res) {
  const no = parseInt(req.params.no, 10);
  try {
    const coll = getAppDb().collection(PROFILES);
    const doc = await coll.findOne({ constituency_no: no });
    if (doc?.public_id) await cloudinary.destroy(doc.public_id, 'image');
    await coll.deleteOne({ constituency_no: no });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
}

export async function removeFlag(req, res) {
  try {
    const coll = getAppDb().collection(FLAGS);
    const doc = await coll.findOne({ party: req.params.party });
    if (doc?.public_id) await cloudinary.destroy(doc.public_id, 'image');
    await coll.deleteOne({ party: req.params.party });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
}
