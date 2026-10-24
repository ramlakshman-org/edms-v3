import { getAppDb } from '../config/db.js';
import { toObjectId } from '../utils/objectId.js';

// Generic CRUD over any mobileapp CMS collection, scoped by assembly_id —
// mirrors the getAll/save/get/delete methods shared by every CMS model.
export async function cmsList(cfg, assemblyId) {
  const db = getAppDb();
  const q = {};
  if (assemblyId !== undefined && assemblyId !== null && assemblyId !== '') q.assembly_id = assemblyId;
  let cursor = db.collection(cfg.collection).find(q);
  if (cfg.created) cursor = cursor.sort({ [cfg.created]: -1 });
  return cursor.toArray();
}

export async function cmsGet(cfg, id) {
  const db = getAppDb();
  return db.collection(cfg.collection).findOne({ _id: toObjectId(id) });
}

export async function cmsCreate(cfg, data) {
  const db = getAppDb();
  const now = new Date().toISOString();
  const doc = { ...data };
  delete doc.id; delete doc._id;
  if (cfg.created) doc[cfg.created] = now;
  if (cfg.updated) doc[cfg.updated] = now;
  const res = await db.collection(cfg.collection).insertOne(doc);
  return { _id: res.insertedId, ...doc };
}

export async function cmsUpdate(cfg, id, data) {
  const db = getAppDb();
  const oid = toObjectId(id);
  const $set = { ...data };
  delete $set.id; delete $set._id;
  if (cfg.updated) $set[cfg.updated] = new Date().toISOString();
  await db.collection(cfg.collection).updateOne({ _id: oid }, { $set });
  return db.collection(cfg.collection).findOne({ _id: oid });
}

export async function cmsDelete(cfg, id) {
  const db = getAppDb();
  return db.collection(cfg.collection).deleteOne({ _id: toObjectId(id) });
}
