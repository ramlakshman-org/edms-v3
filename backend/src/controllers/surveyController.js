import { getAppDb } from '../config/db.js';
import { toObjectId } from '../utils/objectId.js';

// Mirrors web\admin\SurveyController — survey CRUD scoped by assembly_id (tbl_survey).
const COLL = 'tbl_survey';

export async function list(req, res) {
  try {
    const db = getAppDb();
    const q = {};
    if (req.query.assembly_id) q.assembly_id = req.query.assembly_id;
    const rows = await db.collection(COLL).find(q).sort({ created_at: -1 }).toArray();
    res.json({ success: true, rows });
  } catch (e) {
    if (e.message === 'APP_DB_OFFLINE') return res.status(503).json({ success: false, message: 'App database unavailable.' });
    res.status(500).json({ success: false, message: e.message });
  }
}

export async function create(req, res) {
  try {
    const db = getAppDb();
    const doc = { ...req.body, created_at: new Date().toISOString() };
    delete doc._id; delete doc.id;
    const r = await db.collection(COLL).insertOne(doc);
    res.json({ success: true, row: { _id: r.insertedId, ...doc } });
  } catch (e) {
    if (e.message === 'APP_DB_OFFLINE') return res.status(503).json({ success: false, message: 'App database unavailable.' });
    res.status(500).json({ success: false, message: e.message });
  }
}

export async function update(req, res) {
  try {
    const db = getAppDb();
    const oid = toObjectId(req.params.id);
    const $set = { ...req.body, updated_at: new Date().toISOString() };
    delete $set._id; delete $set.id;
    await db.collection(COLL).updateOne({ _id: oid }, { $set });
    res.json({ success: true, row: await db.collection(COLL).findOne({ _id: oid }) });
  } catch (e) {
    if (e.message === 'APP_DB_OFFLINE') return res.status(503).json({ success: false, message: 'App database unavailable.' });
    res.status(500).json({ success: false, message: e.message });
  }
}

export async function remove(req, res) {
  try {
    await getAppDb().collection(COLL).deleteOne({ _id: toObjectId(req.params.id) });
    res.json({ success: true });
  } catch (e) {
    if (e.message === 'APP_DB_OFFLINE') return res.status(503).json({ success: false, message: 'App database unavailable.' });
    res.status(500).json({ success: false, message: e.message });
  }
}
