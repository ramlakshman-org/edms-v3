import bcrypt from 'bcryptjs';
import { getAppDb } from '../config/db.js';
import { toObjectId } from '../utils/objectId.js';
import {
  nextUserId, existsByMobile, insertUser, wardLogins, blankUser,
} from '../models/userModel.js';

// Mirrors UserManagementController@wardLoginsIndex — one row per unique
// combination (district + local body + ward + position + body type). Legacy
// duplicates are collapsed here, preferring the "main admin" record.
export async function list(req, res) {
  try {
    const db = getAppDb();
    const all = await db.collection('tbl_user').find({ user_group_id: 6 }).toArray();
    const key = (u) => [u.district_id, u.category_name, String(u.ward_id).replace(/[^0-9]/g, ''), u.position, u.candidate_type].join('|');
    const isMainAdmin = (u) => u.is_user_login !== true && !/^\d+$/.test(String(u.mobile_no || ''));
    const byCombo = new Map();
    for (const u of all) {
      const k = key(u);
      const cur = byCombo.get(k);
      // prefer the main-admin record (non-numeric username, not a user login)
      if (!cur || (isMainAdmin(u) && !isMainAdmin(cur))) byCombo.set(k, u);
    }
    const rows = [...byCombo.values()].map((u) => ({
      _id: u._id, id: u.id, description: u.first_name, username: u.mobile_no, passcode: u.password_str,
      district: u.district_id, local_body: u.category_name, ward_id: u.ward_id,
      position: u.position, candidate_type: u.candidate_type,
      booths: u.booths || [], is_active: u.is_active,
    }));
    res.json({ success: true, rows });
  } catch (e) {
    res.status(503).json({ success: false, message: 'App database unavailable.' });
  }
}

// Mirrors UserManagementController@wardLoginsStore
export async function store(req, res) {
  const { ward_id, district_id, category_name, position, candidate_type } = req.body || {};
  if (!ward_id || !district_id || !category_name || !position || !candidate_type) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }
  try {
    const cleanCategory = String(category_name).toLowerCase().replace(/\s+/g, '');
    const base = `${cleanCategory}_w${ward_id}`;
    let username = base, counter = 1;
    while (await existsByMobile(username)) username = `${base}_${counter++}`;

    const passcode = String(Math.floor(100000 + Math.random() * 900000));
    const id = await nextUserId();
    const booths = Array.isArray(req.body.booths) ? req.body.booths : [];

    const doc = {
      ...blankUser(),
      id,
      uuid: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      user_group_id: 6,
      first_name: `${district_id} - ${category_name} - Ward ${ward_id}`,
      mobile_no: username,
      password: await bcrypt.hash(passcode, 10),
      password_str: passcode,
      candidate_type,
      position,
      district_id,
      category_name,
      ward_id,
      booths,
      is_active: 1,
    };
    await insertUser(doc);
    res.json({ success: true, message: 'Ward login created successfully.', username, passcode });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
}

// Resolve a ward user by numeric `id` or Mongo `_id` (mirrors PHP where('id')->orWhere('_id')).
async function findWard(db, id) {
  let ward = null;
  if (/^\d+$/.test(String(id))) {
    ward = await db.collection('tbl_user').findOne({ id: parseInt(id, 10) });
  }
  if (!ward) {
    const oid = toObjectId(id);
    if (oid) ward = await db.collection('tbl_user').findOne({ _id: oid });
  }
  return ward;
}

// Mirrors UserManagementController@wardLoginsAddBooth — booth resolved from an EPIC
// search on the client; body carries { assembly_no, assembly_name, part_no, booth_name }.
// Dedupes on assembly_no + part_no, then appends the booth object.
export async function addBooth(req, res) {
  try {
    const db = getAppDb();
    const ward = await findWard(db, req.params.id);
    if (!ward) return res.status(404).json({ success: false, message: 'Ward not found.' });

    // Accept either { booth: {...} } or the booth fields directly on the body.
    const src = req.body.booth || req.body || {};
    const assembly_no = parseInt(src.assembly_no, 10);
    const part_no = parseInt(src.part_no, 10);
    if (Number.isNaN(assembly_no) || Number.isNaN(part_no)) {
      return res.status(422).json({ success: false, message: 'assembly_no and part_no are required.' });
    }

    const booths = Array.isArray(ward.booths) ? ward.booths : [];
    const duplicate = booths.some((b) => Number(b.assembly_no) === assembly_no && Number(b.part_no) === part_no);
    if (duplicate) {
      return res.status(422).json({ success: false, message: 'This booth is already added to this ward.' });
    }

    const newBooth = {
      assembly_no,
      assembly_name: src.assembly_name || `AC ${assembly_no}`,
      part_no,
      booth_name: src.booth_name || `Booth ${part_no}`,
    };
    booths.push(newBooth);

    await db.collection('tbl_user').updateOne(
      { _id: ward._id },
      { $set: { booths, updated_at: new Date().toISOString() } }
    );
    res.json({ success: true, booth: newBooth });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
}

// Mirrors UserManagementController@wardLoginsDeleteBooth — remove by assembly_no + part_no.
export async function deleteBooth(req, res) {
  try {
    const db = getAppDb();
    const ward = await findWard(db, req.params.id);
    if (!ward) return res.status(404).json({ success: false, message: 'Ward not found.' });

    const src = req.body.booth || req.body || {};
    const assembly_no = parseInt(src.assembly_no, 10);
    const part_no = parseInt(src.part_no, 10);
    const booths = Array.isArray(ward.booths) ? ward.booths : [];
    const filtered = booths.filter((b) => !(Number(b.assembly_no) === assembly_no && Number(b.part_no) === part_no));

    await db.collection('tbl_user').updateOne(
      { _id: ward._id },
      { $set: { booths: filtered, updated_at: new Date().toISOString() } }
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
}

// Save the full booths list for a ward in one shot (bulk). Dedupes on
// assembly_no + part_no and normalises the stored booth objects.
export async function saveBooths(req, res) {
  try {
    const db = getAppDb();
    const ward = await findWard(db, req.params.id);
    if (!ward) return res.status(404).json({ success: false, message: 'Ward not found.' });

    const incoming = Array.isArray(req.body.booths) ? req.body.booths : [];
    const seen = new Set();
    const booths = [];
    for (const b of incoming) {
      const assembly_no = parseInt(b.assembly_no, 10);
      const part_no = parseInt(b.part_no, 10);
      if (Number.isNaN(assembly_no) || Number.isNaN(part_no)) continue;
      const key = `${assembly_no}_${part_no}`;
      if (seen.has(key)) continue;
      seen.add(key);
      booths.push({
        assembly_no,
        assembly_name: b.assembly_name || `AC ${assembly_no}`,
        part_no,
        booth_name: b.booth_name || `Booth ${part_no}`,
      });
    }

    await db.collection('tbl_user').updateOne(
      { _id: ward._id },
      { $set: { booths, updated_at: new Date().toISOString() } }
    );
    res.json({ success: true, booths });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
}

// Mirrors UserManagementController@checkWardExists — true if a main-admin ward
// login already exists for this exact combination (checks string & int ward_id).
export async function checkExists(req, res) {
  const { candidate_type, position, district_id, category_name, ward_id } = req.body || {};
  try {
    const db = getAppDb();
    const base = {
      user_group_id: 6,
      is_user_login: { $ne: true },
      candidate_type, position, district_id, category_name,
    };
    let exists = !!(await db.collection('tbl_user').findOne({ ...base, ward_id }, { projection: { _id: 1 } }));
    if (!exists && ward_id != null && /^\d+$/.test(String(ward_id))) {
      exists = !!(await db.collection('tbl_user').findOne({ ...base, ward_id: parseInt(ward_id, 10) }, { projection: { _id: 1 } }));
    }
    res.json({ exists });
  } catch (e) {
    res.status(500).json({ exists: false, message: e.message });
  }
}

export async function remove(req, res) {
  try {
    const db = getAppDb();
    await db.collection('tbl_user').deleteOne({ _id: toObjectId(req.params.id) });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
}
