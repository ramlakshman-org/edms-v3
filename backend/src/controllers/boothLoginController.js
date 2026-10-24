import { getVoterDb } from '../config/db.js';
import { getAssembly } from '../models/assemblyModel.js';
import { collectionForAc } from '../models/voterModel.js';
import {
  nextUserId, existingBoothIds, boothLoginsForAssembly, mlaPasscode, insertManyUsers, blankUser,
} from '../models/userModel.js';

// Distinct PART_NO (booths) from the voter roll for an assembly.
async function distinctBooths(assemblyId) {
  const db = getVoterDb();
  const parts = await db.collection(collectionForAc(assemblyId)).distinct('PART_NO');
  return parts
    .map((p) => parseInt(p, 10))
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);
}

function boothUserDoc({ id, assembly, assemblyId, boothNo, passcode }) {
  const assemblyName = assembly.assembly_name || '';
  const username = assemblyName.toLowerCase().replace(/\s+/g, '_') + '_b' + boothNo;
  return {
    ...blankUser(),
    id,
    user_group_id: 4,
    first_name: `Booth ${boothNo} - ${assemblyName}`,
    mobile_no: username,
    parliament_id: assembly.parliament_id ?? '',
    district_id: assembly.district_id ?? 0,
    booth_id: String(boothNo),
    assembly_id: parseInt(assemblyId, 10),
    assembly_no: parseInt(assemblyId, 10),
    password_str: `${passcode}${boothNo}`,
    is_active: 1,
    paid_status: 'Yes',
  };
}

// Mirrors AssemblyController@boothLoginAjax — list existing, else generate on the fly.
export async function list(req, res) {
  const assemblyId = req.query.assembly_id;
  if (!assemblyId) return res.json({ success: true, rows: [] });
  try {
    const assembly = await getAssembly(assemblyId);
    if (!assembly) return res.status(404).json({ success: false, message: 'Assembly not found.' });

    const existing = await boothLoginsForAssembly(assemblyId);
    if (existing.length) {
      const rows = existing
        .map((u) => ({ booth_no: parseInt(u.booth_id || 0, 10), username: u.mobile_no, passcode: u.password_str, status: 'Created' }))
        .sort((a, b) => a.booth_no - b.booth_no);
      return res.json({ success: true, rows });
    }

    // none yet -> preview from voter rolls (does not persist here; use /generate to persist)
    const booths = await distinctBooths(assemblyId);
    const passcode = await mlaPasscode(assemblyId);
    const rows = booths.map((b) => ({
      booth_no: b,
      username: (assembly.assembly_name || '').toLowerCase().replace(/\s+/g, '_') + '_b' + b,
      passcode: `${passcode}${b}`,
      status: 'Not created',
    }));
    return res.json({ success: true, rows });
  } catch (e) {
    if (e.message === 'VOTER_DB_OFFLINE' || e.message === 'APP_DB_OFFLINE') return res.status(503).json({ success: false, message: 'Database unavailable.' });
    return res.status(500).json({ success: false, message: e.message });
  }
}

// Mirrors AssemblyController@boothLoginGenerate — create missing booth logins.
export async function generate(req, res) {
  const assemblyId = req.body?.assembly_id || req.query.assembly_id;
  if (!assemblyId) return res.status(400).json({ success: false, message: 'Assembly is required.' });
  try {
    const assembly = await getAssembly(assemblyId);
    if (!assembly) return res.status(404).json({ success: false, message: 'Assembly not found.' });

    const booths = await distinctBooths(assemblyId);
    if (!booths.length) return res.json({ success: false, message: 'No booths found in the voter rolls for this assembly.' });

    const passcode = await mlaPasscode(assemblyId);
    const existing = await existingBoothIds(assemblyId);
    let id = await nextUserId();
    const docs = [];
    for (const boothNo of booths) {
      if (existing.includes(String(boothNo))) continue;
      docs.push(boothUserDoc({ id: id++, assembly, assemblyId, boothNo, passcode }));
    }
    await insertManyUsers(docs);
    return res.json({ success: true, message: `Successfully generated ${docs.length} new booth logins.`, created: docs.length });
  } catch (e) {
    if (e.message === 'VOTER_DB_OFFLINE' || e.message === 'APP_DB_OFFLINE') return res.status(503).json({ success: false, message: 'Database unavailable.' });
    return res.status(500).json({ success: false, message: e.message });
  }
}
