import { listAssemblies, getAssembly, assemblyGenderCounts, updateAssembly } from '../models/assemblyModel.js';

// Mirrors AssemblyController@index / assemblydetails (sorted by assembly_no).
export async function list(req, res) {
  try {
    const assemblies = await listAssemblies();
    res.json({ success: true, assemblies });
  } catch (e) {
    res.status(503).json({ success: false, message: 'App database unavailable.' });
  }
}

// Mirrors AssemblyController@viewDetail
export async function detail(req, res) {
  try {
    const assembly = await getAssembly(req.params.no);
    if (!assembly) return res.status(404).json({ success: false, message: 'Assembly not found.' });
    let liveCounts = null;
    try { liveCounts = await assemblyGenderCounts(req.params.no); } catch { /* voter db offline */ }
    res.json({ success: true, assembly, liveCounts });
  } catch (e) {
    res.status(503).json({ success: false, message: 'App database unavailable.' });
  }
}

// Mirrors AssemblyController@updateAssembly
export async function update(req, res) {
  try {
    const existing = await getAssembly(req.params.no);
    if (!existing) return res.status(404).json({ success: false, message: 'Assembly not found.' });
    const assembly = await updateAssembly(req.params.no, req.body || {});
    res.json({ success: true, assembly });
  } catch (e) {
    if (e.message === 'APP_DB_OFFLINE') return res.status(503).json({ success: false, message: 'App database unavailable.' });
    res.status(500).json({ success: false, message: e.message });
  }
}
