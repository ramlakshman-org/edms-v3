import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Flow Simulator: serve the WACTO flow exports kept in the repo's wacto/ folder
// (read-only; admin). Override the folder with WACTO_FLOWS_DIR.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = process.env.WACTO_FLOWS_DIR || path.resolve(HERE, '..', '..', '..', 'wacto');
const SAFE = /^[\w .()-]+\.json$/;

export async function listFlows(req, res) {
  try {
    let names = [];
    try { names = (await fs.readdir(DIR)).filter((f) => SAFE.test(f)); } catch { names = []; }
    const flows = [];
    for (const name of names) {
      try {
        const st = await fs.stat(path.join(DIR, name));
        let title = '';
        let nodes = 0;
        try { const j = JSON.parse(await fs.readFile(path.join(DIR, name), 'utf8')); title = j.chatbot?.name || ''; nodes = Array.isArray(j.nodes) ? j.nodes.length : 0; } catch { /* unreadable */ }
        flows.push({ name, title, nodes, size: st.size, modified: st.mtime.toISOString() });
      } catch { /* skip */ }
    }
    flows.sort((a, b) => (a.modified < b.modified ? 1 : -1));
    res.json({ success: true, dir: DIR, flows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
}

export async function getFlow(req, res) {
  const name = String(req.params.name || '');
  if (!SAFE.test(name)) return res.status(400).json({ success: false, message: 'Invalid flow name.' });
  try {
    const raw = await fs.readFile(path.join(DIR, name), 'utf8');
    res.type('application/json').send(raw);
  } catch {
    res.status(404).json({ success: false, message: 'Flow file not found.' });
  }
}
