import { ObjectId } from 'mongodb';

// Mirrors the importer's tolerance: 24-hex -> ObjectId; shorter hex (e.g. a
// 23-char id that lost a leading zero on export) is left-padded to 24.
export function toObjectId(val) {
  const v = String(val || '').trim();
  if (/^[0-9a-fA-F]{24}$/.test(v)) return new ObjectId(v);
  if (/^[0-9a-fA-F]{1,24}$/.test(v)) return new ObjectId(v.padStart(24, '0'));
  return null;
}
