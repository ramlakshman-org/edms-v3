import { getVoterDb } from '../config/db.js';
import { collectionForAc } from '../models/voterModel.js';

// Mirrors BoothController@getBoothbyAssembly — distinct PART_NO (booths) for an assembly.
export async function boothsByAssembly(req, res) {
  const { assemblyId } = req.query;
  if (!assemblyId) return res.status(400).json({ success: false, message: 'assemblyId is required.' });
  try {
    const db = getVoterDb();
    const coll = db.collection(collectionForAc(assemblyId));
    const parts = await coll.aggregate([
      { $group: {
          _id: '$PART_NO', section: { $first: '$SECTION_NAME' }, booth: { $first: '$BOOTH_NAME' },
          latitude: { $first: '$LATITUDE' }, longitude: { $first: '$LONGITUDE' },
      } },
      { $sort: { _id: 1 } },
    ]).toArray();
    const hasCoord = (v) => v !== null && v !== undefined && String(v).trim() !== '' && Number(v) !== 0;
    const booths = parts
      .filter((p) => p._id !== null && p._id !== undefined && p._id !== '')
      .map((p) => ({
        part_no: p._id, booth_name: p.booth || '', section_name: p.section || '',
        has_coords: hasCoord(p.latitude) && hasCoord(p.longitude),
        // Round 1b (2026-10-14): the public register page draws the chosen assembly with its booths. Polling-station
        // coordinates are not personal data; voter rows are never on this route.
        latitude: hasCoord(p.latitude) ? Number(p.latitude) : null,
        longitude: hasCoord(p.longitude) ? Number(p.longitude) : null,
      }));
    res.json({ success: true, booths });
  } catch (e) {
    if (e.message === 'VOTER_DB_OFFLINE') {
      return res.status(503).json({ success: false, message: 'Voter database is currently unavailable.' });
    }
    res.status(500).json({ success: false, message: e.message });
  }
}
