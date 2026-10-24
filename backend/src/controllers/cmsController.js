import { cmsType, CMS_TYPES } from '../constants/cmsTypes.js';
import { cmsList, cmsGet, cmsCreate, cmsUpdate, cmsDelete } from '../models/cmsModel.js';

function resolve(req, res) {
  const cfg = cmsType(req.params.type);
  if (!cfg) { res.status(404).json({ success: false, message: `Unknown CMS type "${req.params.type}".` }); return null; }
  return cfg;
}

const guard = (fn) => async (req, res) => {
  const cfg = resolve(req, res);
  if (!cfg) return;
  try {
    await fn(cfg, req, res);
  } catch (e) {
    if (e.message === 'APP_DB_OFFLINE') return res.status(503).json({ success: false, message: 'App database unavailable.' });
    res.status(500).json({ success: false, message: e.message });
  }
};

// GET /mobileapp/types — the CMS registry (for building the UI nav).
export function types(req, res) {
  res.json({ success: true, types: Object.entries(CMS_TYPES).map(([key, v]) => ({ key, label: v.label, collection: v.collection })) });
}

export const list = guard(async (cfg, req, res) => {
  const rows = await cmsList(cfg, req.query.assembly_id ?? '');
  res.json({ success: true, rows });
});

export const get = guard(async (cfg, req, res) => {
  const row = await cmsGet(cfg, req.params.id);
  if (!row) return res.status(404).json({ success: false, message: 'Item not found.' });
  res.json({ success: true, row });
});

export const create = guard(async (cfg, req, res) => {
  const row = await cmsCreate(cfg, req.body || {});
  res.json({ success: true, row });
});

export const update = guard(async (cfg, req, res) => {
  const row = await cmsUpdate(cfg, req.params.id, req.body || {});
  res.json({ success: true, row });
});

export const remove = guard(async (cfg, req, res) => {
  await cmsDelete(cfg, req.params.id);
  res.json({ success: true });
});
