import { getAppDb, getVoterDb } from '../config/db.js';
import { collectionForAc } from './voterModel.js';

const MAP = 'tbl_assembly_consitituency';

export async function listAssemblies() {
  const db = getAppDb();
  return db.collection(MAP).find({}).sort({ assembly_no: 1 }).toArray();
}

export async function getAssembly(assemblyNo) {
  const db = getAppDb();
  return db.collection(MAP).findOne({ assembly_no: parseInt(assemblyNo, 10) });
}

// Mirrors AssemblyController@updateAssembly — edit editable metadata fields.
export async function updateAssembly(assemblyNo, data) {
  const db = getAppDb();
  const allowed = ['assembly_name', 'district', 'parliament_id', 'district_id',
    'total_voters', 'male_voters', 'female_voters', 'third_gender_voters', 'table_name'];
  const $set = {};
  for (const k of allowed) if (data[k] !== undefined) $set[k] = data[k];
  $set.updated_at = new Date().toISOString();
  await db.collection(MAP).updateOne({ assembly_no: parseInt(assemblyNo, 10) }, { $set });
  return db.collection(MAP).findOne({ assembly_no: parseInt(assemblyNo, 10) });
}

// Live gender counts straight from the voter collection for one assembly.
export async function assemblyGenderCounts(assemblyNo) {
  const db = getVoterDb();
  const coll = db.collection(collectionForAc(assemblyNo));
  const agg = await coll
    .aggregate([{ $group: { _id: '$GENDER', c: { $sum: 1 } } }])
    .toArray();
  let total = 0, male = 0, female = 0;
  for (const g of agg) {
    total += g.c;
    if (g._id === 'Male') male = g.c;
    else if (g._id === 'Female') female = g.c;
  }
  return { total, male, female, other: total - male - female };
}
