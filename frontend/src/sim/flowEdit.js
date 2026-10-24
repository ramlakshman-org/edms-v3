// Editing a WACTO export + exporting it with fresh ids. Mirrors the wacto-flow
// skill: edges drive routing (one edge per option title, keyword = visible title),
// ids are account-wide and must never be reused (reid_flow.py), root keeps its id
// and keywords, WACTO overwrites non-root keywords with the last incoming edge.
import { optionsOf, LIMITS } from './flowModel.js';

export const uuid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); }));
export const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

const BASE_NODE = () => ({ interactiveId: null, keywords: [], parentNodeId: null, assignedAgent: null, assignedAgents: [], enabledNotify: false, notifyConfig: {}, funnelStageConfig: { enabled: false }, variableConfig: {}, canvasPosition: { x: 0, y: 0 } });

// New node in the exact shape of a working export (list nodes carry WACTO's dummy "Button 1").
export function newNode(kind, { name = 'New message', near = null } = {}) {
  const pos = near ? { x: (near.canvasPosition?.x || 0) + 320, y: (near.canvasPosition?.y || 0) + 60 } : { x: 0, y: 0 };
  if (kind === 'media') return { nodeId: uuid(), type: 'media', name, interactiveId: uuid(), data: { body: '', link: '', mediaType: 'image' }, ...BASE_NODE(), canvasPosition: pos };
  const action = kind === 'button'
    ? { buttons: [{ type: 'reply', reply: { id: uuid(), title: 'Option 1', payload: '' } }], sections: [], dynamicRows: { enabled: false }, button: '' }
    : { buttons: [{ type: 'reply', reply: { id: uuid(), title: 'Button 1' } }], sections: [{ title: 'Select option', rows: [{ id: uuid(), title: 'Option 1', description: '' }] }], dynamicRows: { enabled: false }, button: 'Choose' };
  return { nodeId: uuid(), type: 'interactive', name, interactiveId: null, data: { body: 'New message', header: { type: 'none', text: '' }, footer: '', action, interactiveType: kind === 'button' ? 'button' : 'list' }, ...BASE_NODE(), canvasPosition: pos };
}

export const nodeOf = (doc, id) => doc.nodes.find((n) => n.nodeId === id);

// ── mutations (each takes the doc and changes it in place) ────────────────────
export function setField(doc, id, path, value) {
  const n = nodeOf(doc, id); if (!n) return;
  const keys = path.split('.'); let o = n;
  for (const k of keys.slice(0, -1)) { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
  o[keys[keys.length - 1]] = value;
}

export function setHeader(doc, id, type, value = '') {
  const n = nodeOf(doc, id); if (!n || n.type !== 'interactive') return;
  // WACTO's builder stores a media header's file as header.link (the older hand-built EDMS node used url)
  n.data.header = type === 'text' ? { type: 'text', text: value } : ['image', 'video', 'document'].includes(type) ? { type, link: value } : { type: 'none', text: '' };
}

export function setType(doc, id, kind) {
  const n = nodeOf(doc, id); if (!n || n.type !== 'interactive' || n.data.interactiveType === kind) return;
  const opts = optionsOf(n);
  const a = n.data.action;
  if (kind === 'button') { a.buttons = opts.slice(0, LIMITS.buttons).map((o) => ({ type: 'reply', reply: { id: o.id || uuid(), title: o.title, payload: '' } })); a.sections = []; a.button = ''; }
  else { a.sections = [{ title: 'Select option', rows: opts.slice(0, LIMITS.rows).map((o) => ({ id: o.id || uuid(), title: o.title, description: o.description || '' })) }]; a.buttons = [{ type: 'reply', reply: { id: uuid(), title: 'Button 1' } }]; a.button = a.button || 'Choose'; }
  n.data.interactiveType = kind;
  const keep = new Set(optionsOf(n).map((o) => o.title));
  doc.edges = doc.edges.filter((e) => e.fromNodeId !== id || (e.keywords || []).every((k) => keep.has(k)));
}

function optionRefs(n) {
  const a = n.data?.action || {};
  if (n.data?.interactiveType === 'button') return (a.buttons || []).map((b) => ({ get: () => b.reply, kind: 'button' }));
  return (a.sections || []).flatMap((s) => (s.rows || []).map((r) => ({ get: () => r, kind: 'row' })));
}

export function setOption(doc, id, index, patch) {
  const n = nodeOf(doc, id); if (!n) return;
  const ref = optionRefs(n)[index]; if (!ref) return;
  const o = ref.get();
  if (patch.title !== undefined && patch.title !== o.title) {
    for (const e of doc.edges) if (e.fromNodeId === id && (e.keywords || []).includes(o.title)) { e.keywords = [patch.title]; e.intentName = patch.title; }
    o.title = patch.title;
  }
  if (patch.description !== undefined && ref.kind === 'row') o.description = patch.description;
}

export function addOption(doc, id) {
  const n = nodeOf(doc, id); if (!n) return;
  const a = n.data.action;
  if (n.data.interactiveType === 'button') { if ((a.buttons || []).length >= LIMITS.buttons) return; a.buttons.push({ type: 'reply', reply: { id: uuid(), title: `Option ${a.buttons.length + 1}`, payload: '' } }); return; }
  if (!a.sections?.length) a.sections = [{ title: 'Select option', rows: [] }];
  const total = a.sections.reduce((s, x) => s + (x.rows || []).length, 0);
  if (total >= LIMITS.rows) return;
  a.sections[a.sections.length - 1].rows.push({ id: uuid(), title: `Option ${total + 1}`, description: '' });
}

export function removeOption(doc, id, index) {
  const n = nodeOf(doc, id); if (!n) return;
  const a = n.data.action;
  if (n.data.interactiveType === 'button') { const [b] = a.buttons.splice(index, 1); if (b) doc.edges = doc.edges.filter((e) => !(e.fromNodeId === id && (e.keywords || []).includes(b.reply.title))); return; }
  let i = index;
  for (const s of a.sections || []) { if (i < (s.rows || []).length) { const [r] = s.rows.splice(i, 1); if (r) doc.edges = doc.edges.filter((e) => !(e.fromNodeId === id && (e.keywords || []).includes(r.title))); return; } i -= s.rows.length; }
}

export function moveOption(doc, id, index, dir) {
  const n = nodeOf(doc, id); if (!n) return;
  const a = n.data.action;
  const list = n.data.interactiveType === 'button' ? a.buttons : (a.sections || []).flatMap((s) => s.rows || []);
  const j = index + dir; if (j < 0 || j >= list.length) return;
  if (n.data.interactiveType === 'button') { [a.buttons[index], a.buttons[j]] = [a.buttons[j], a.buttons[index]]; return; }
  // rows may span sections: flatten, swap, redistribute by original section sizes
  const sizes = a.sections.map((s) => (s.rows || []).length);
  [list[index], list[j]] = [list[j], list[index]];
  let k = 0; a.sections.forEach((s, si) => { s.rows = list.slice(k, k + sizes[si]); k += sizes[si]; });
}

export function setSectionTitle(doc, id, si, title) { const n = nodeOf(doc, id); if (n?.data?.action?.sections?.[si]) n.data.action.sections[si].title = title; }

export function setDestination(doc, fromId, title, toId) {
  doc.edges = doc.edges.filter((e) => !(e.fromNodeId === fromId && (e.keywords || []).includes(title)));
  if (toId) doc.edges.push({ fromNodeId: fromId, toNodeId: toId, keywords: [title], intentName: title, delay: 0 });
  const to = toId && nodeOf(doc, toId); if (to && !to.parentNodeId && to.nodeId !== 'root') to.parentNodeId = fromId;
}

export function addNode(doc, kind, { name, nearId } = {}) {
  const n = newNode(kind, { name, near: nearId ? nodeOf(doc, nearId) : null });
  doc.nodes.push(n);
  return n.nodeId;
}

export function duplicateNode(doc, id) {
  const src = nodeOf(doc, id); if (!src) return null;
  const n = clone(src);
  n.nodeId = uuid(); n.name = `${src.name || 'Node'} (copy)`; n.keywords = []; n.parentNodeId = null;
  n.canvasPosition = { x: (src.canvasPosition?.x || 0) + 60, y: (src.canvasPosition?.y || 0) + 120 };
  if (n.interactiveId) n.interactiveId = uuid();
  for (const b of n.data?.action?.buttons || []) if (b.reply) b.reply.id = uuid();
  for (const s of n.data?.action?.sections || []) for (const r of s.rows || []) r.id = uuid();
  doc.nodes.push(n);
  // copy outgoing edges so the copy routes the same way
  for (const e of doc.edges.filter((x) => x.fromNodeId === id)) doc.edges.push({ ...e, fromNodeId: n.nodeId });
  return n.nodeId;
}

export function deleteNode(doc, id) {
  if (id === 'root') return false;
  doc.nodes = doc.nodes.filter((n) => n.nodeId !== id);
  doc.edges = doc.edges.filter((e) => e.fromNodeId !== id && e.toNodeId !== id);
  for (const n of doc.nodes) if (n.parentNodeId === id) n.parentNodeId = null;
  return true;
}

export function setRootKeywords(doc, list) { const r = nodeOf(doc, 'root'); if (r) r.keywords = list.map((s) => s.trim()).filter(Boolean); }

// ── export with fresh ids (reid_flow.py in the browser) ─────────────────────
export function collectIds(doc) {
  const ids = new Set();
  for (const n of doc.nodes || []) {
    if (n.nodeId && n.nodeId !== 'root') ids.add(n.nodeId);
    if (n.interactiveId) ids.add(n.interactiveId);
    for (const b of n.data?.action?.buttons || []) if (b.reply?.id) ids.add(b.reply.id);
    for (const s of n.data?.action?.sections || []) for (const r of s.rows || []) if (r.id) ids.add(r.id);
  }
  return ids;
}

export function reidExport(doc, name) {
  const out = clone(doc);
  const map = new Map();
  const fresh = (old) => (old === 'root' || old == null ? old : (map.has(old) ? map.get(old) : (map.set(old, uuid()), map.get(old))));
  for (const n of out.nodes) {
    n.nodeId = fresh(n.nodeId);
    if (n.interactiveId) n.interactiveId = uuid();
    for (const b of n.data?.action?.buttons || []) if (b.reply) b.reply.id = uuid();
    for (const s of n.data?.action?.sections || []) for (const r of s.rows || []) r.id = uuid();
  }
  for (const n of out.nodes) n.parentNodeId = n.parentNodeId ? (map.get(n.parentNodeId) || null) : null;
  for (const e of out.edges) { e.fromNodeId = fresh(e.fromNodeId); e.toNodeId = fresh(e.toNodeId); }
  // keywords: root keeps its own; others get the last incoming edge's keyword (what WACTO does on import)
  const last = new Map();
  for (const e of out.edges) last.set(e.toNodeId, e.keywords || []);
  for (const n of out.nodes) if (n.nodeId !== 'root') n.keywords = last.get(n.nodeId) ? [...last.get(n.nodeId)] : [];
  out.chatbot = { ...(out.chatbot || {}), name };
  out.manualResolution = [];
  const oldIds = collectIds(doc); const newIds = collectIds(out);
  const survived = [...newIds].filter((id) => oldIds.has(id));
  return { out, newIds, survived, renamed: map.size };
}
