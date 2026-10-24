// WACTO export → simulator model. Mirrors the rules in the wacto-flow skill:
// edges drive routing (one edge per option title, keyword = the visible title),
// WACTO keeps ONE destination per title account-wide, root keeps its own keywords.
// Also ports the essential checks of verify_flow.py / route_check.py so a flow
// author sees problems before pushing to WACTO.

export const LIMITS = { rowTitle: 24, rowDesc: 72, buttonTitle: 20, buttons: 3, rows: 10, sectionTitle: 24, body: 1024, header: 60, footer: 60, caption: 1024 };

export const isTamil = (s = '') => /[஀-௿]/.test(s);
export const len = (s = '') => Array.from(String(s)).length; // code points, like Python len()

export function optionsOf(node) {
  if (!node || node.type !== 'interactive') return [];
  const a = node.data?.action || {};
  if (node.data?.interactiveType === 'button') return (a.buttons || []).map((b) => ({ id: b.reply?.id, title: b.reply?.title || '', description: '', kind: 'button' }));
  return (a.sections || []).flatMap((s) => (s.rows || []).map((r) => ({ id: r.id, title: r.title || '', description: r.description || '', section: s.title || '', kind: 'row' })));
}

export function parseFlow(raw) {
  const doc = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!doc || !Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) throw new Error('Not a WACTO export: expected top-level "nodes" and "edges" arrays.');
  const nodes = new Map();
  for (const n of doc.nodes) nodes.set(n.nodeId, n);
  const root = nodes.get('root') || doc.nodes[0];
  const out = new Map();   // nodeId -> [{title, to, edge}]
  const into = new Map();  // nodeId -> count
  const byTitle = new Map(); // title -> Set(toNodeId)
  for (const e of doc.edges) {
    for (const title of e.keywords || []) {
      if (!out.has(e.fromNodeId)) out.set(e.fromNodeId, []);
      out.get(e.fromNodeId).push({ title, to: e.toNodeId, delay: e.delay || 0 });
      if (!byTitle.has(title)) byTitle.set(title, new Set());
      byTitle.get(title).add(e.toNodeId);
    }
    into.set(e.toNodeId, (into.get(e.toNodeId) || 0) + 1);
  }
  const model = { name: doc.chatbot?.name || 'Untitled flow', doc, nodes, rootId: root?.nodeId, out, into, byTitle, order: doc.nodes.map((n) => n.nodeId) };
  model.checks = runChecks(model);
  return model;
}

// Where does a tapped title go? Prefer the tapped message's own edge, but report
// every other destination the same title has (WACTO keeps only one per title).
export function resolve(model, fromNodeId, title) {
  const own = (model.out.get(fromNodeId) || []).find((o) => o.title === title);
  const all = [...(model.byTitle.get(title) || [])];
  const to = own?.to || all[0] || null;
  const clashes = all.filter((id) => id !== to);
  return { to: to && model.nodes.has(to) ? to : null, dangling: !!to && !model.nodes.has(to), clashes, viaOwnEdge: !!own };
}

export function matchKeyword(model, text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;
  const root = model.nodes.get(model.rootId);
  if ((root?.keywords || []).some((k) => String(k).toLowerCase() === t)) return model.rootId;
  for (const [title, set] of model.byTitle) if (title.toLowerCase() === t) return [...set][0];
  return null;
}

export function runChecks(model) {
  const checks = [];
  const add = (level, nodeId, text) => checks.push({ level, nodeId, text, node: model.nodes.get(nodeId)?.name || nodeId || '' });
  const ids = new Set();
  for (const [id, n] of model.nodes) {
    if (ids.has(id)) add('error', id, 'Duplicate nodeId');
    ids.add(id);
    const d = n.data || {};
    if (n.type === 'interactive') {
      const body = d.body || '';
      if (!body.trim()) add('error', id, 'Empty body');
      if (len(body) > LIMITS.body) add('error', id, `Body ${len(body)} > ${LIMITS.body}`);
      if (d.header?.type === 'text' && len(d.header.text) > LIMITS.header) add('error', id, `Header ${len(d.header.text)} > ${LIMITS.header}`);
      if (len(d.footer) > LIMITS.footer) add('error', id, `Footer ${len(d.footer)} > ${LIMITS.footer}`);
      const ht = d.header?.type;
      if (['image', 'video', 'document'].includes(ht)) {
        if (d.interactiveType === 'list') add('error', id, `List messages can only have a text header, not ${ht}`);
        if (!d.header.link && !d.header.url) add('error', id, `${ht} header without a link`);
      }
      const opts = optionsOf(n);
      if (!opts.length) add('error', id, 'Interactive node with no options');
      const seen = new Set();
      for (const o of opts) {
        if (!o.title.trim()) add('error', id, 'Option with empty title');
        if (seen.has(o.title)) add('error', id, `Duplicate option title "${o.title}"`);
        seen.add(o.title);
        if (o.kind === 'button' && len(o.title) > LIMITS.buttonTitle) add('error', id, `Button "${o.title}" is ${len(o.title)} chars (max ${LIMITS.buttonTitle})`);
        if (o.kind === 'row' && len(o.title) > LIMITS.rowTitle) add('error', id, `Row "${o.title}" is ${len(o.title)} chars (max ${LIMITS.rowTitle})`);
        if (o.kind === 'row' && len(o.description) > LIMITS.rowDesc) add('error', id, `Row description for "${o.title}" is ${len(o.description)} chars (max ${LIMITS.rowDesc})`);
      }
      if (d.interactiveType === 'button' && opts.length > LIMITS.buttons) add('error', id, `${opts.length} buttons (max ${LIMITS.buttons})`);
      if (d.interactiveType === 'list') {
        if (opts.length > LIMITS.rows) add('error', id, `${opts.length} list rows (max ${LIMITS.rows})`);
        for (const s of d.action?.sections || []) if (len(s.title) > LIMITS.sectionTitle) add('warn', id, `Section title "${s.title}" is ${len(s.title)} chars (max ${LIMITS.sectionTitle})`);
        if (len(d.action?.button || d.button || '') > 20) add('error', id, 'List button text > 20 chars');
      }
      // every option should lead somewhere, unless the backend answers it
      const outs = model.out.get(id) || [];
      const covered = new Set(outs.map((o) => o.title));
      const missing = opts.filter((o) => !covered.has(o.title));
      if (missing.length && missing.length === opts.length && opts.length > 1) add('info', id, 'No option has an edge — backend-answered node, or a dead end');
    } else if (n.type === 'media') {
      if (!d.link) add('error', id, 'Media node without a link');
      if (len(d.body) > LIMITS.caption) add('error', id, `Caption ${len(d.body)} > ${LIMITS.caption}`);
    }
  }
  // edges
  for (const e of model.doc.edges) {
    const from = model.nodes.get(e.fromNodeId); const to = model.nodes.get(e.toNodeId);
    if (!from) add('error', e.fromNodeId, 'Edge from a node that does not exist');
    if (!to) add('error', e.fromNodeId, `Edge "${(e.keywords || []).join(', ')}" points to a node that does not exist`);
    if (from) {
      const titles = new Set(optionsOf(from).map((o) => o.title));
      for (const k of e.keywords || []) if (!titles.has(k)) add('error', e.fromNodeId, `Edge keyword "${k}" is not an option title of this node`);
    }
  }
  // one destination per title (account-wide rule)
  for (const [title, set] of model.byTitle) if (set.size > 1) add('error', [...set][0], `"${title}" leads to ${set.size} different nodes — WACTO keeps only one (${[...set].map((id) => model.nodes.get(id)?.name || id).join(' / ')})`);
  // reachability from root
  const seen = new Set(); const stack = [model.rootId];
  while (stack.length) { const id = stack.pop(); if (!id || seen.has(id)) continue; seen.add(id); for (const o of model.out.get(id) || []) stack.push(o.to); }
  for (const id of model.nodes.keys()) if (!seen.has(id)) add('error', id, 'Not reachable from root by edges (orphan)');
  const rank = { error: 0, warn: 1, info: 2 };
  return checks.sort((a, b) => rank[a.level] - rank[b.level]);
}

// WhatsApp inline formatting → React-free token list: [{t:'text'|'b'|'i'|'code'|'br', v}]
export function waTokens(text) {
  const parts = String(text || '').split(/(\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`|```[\s\S]+?```|\n)/g).filter(Boolean);
  return parts.map((p) => {
    if (p === '\n') return { t: 'br' };
    if (/^```[\s\S]+```$/.test(p)) return { t: 'code', v: p.slice(3, -3) };
    if (/^\*[^*]+\*$/.test(p)) return { t: 'b', v: p.slice(1, -1) };
    if (/^_[^_]+_$/.test(p)) return { t: 'i', v: p.slice(1, -1) };
    if (/^`[^`]+`$/.test(p)) return { t: 'code', v: p.slice(1, -1) };
    return { t: 'text', v: p };
  });
}
