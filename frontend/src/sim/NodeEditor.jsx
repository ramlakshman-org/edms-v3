import { useState } from 'react';
import { Play, Copy, Trash2, Plus, ArrowUp, ArrowDown, X, CircleAlert, AlertTriangle, Info, Link2 } from 'lucide-react';
import { Button, Field, Input, Select, Textarea } from '../civic/ui.jsx';
import { Pill } from '../civic/kit.jsx';
import { optionsOf, LIMITS, len, resolve } from './flowModel.js';

// Node editor for the Flow Builder. Every change goes through onEdit(key, mutator)
// so the page can clone the doc, record undo history and rebuild the model.
const Counter = ({ value, max }) => <span className={`cv-count ${len(value) > max ? 'cv-text-bad' : ''}`}>{len(value)} / {max}</span>;

export default function NodeEditor({ model, doc, nodeId, checks, onEdit, onSelect, onShow, onAdd, onDuplicate, onDelete, isLive }) {
  const [confirmDel, setConfirmDel] = useState(false);
  const n = model.nodes.get(nodeId);
  if (!n) return null;
  const d = n.data || {};
  const isMedia = n.type === 'media';
  const kind = isMedia ? 'media' : d.interactiveType === 'button' ? 'button' : 'list';
  const opts = optionsOf(n);
  const nodes = [...model.nodes.values()].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  const maxOpts = kind === 'button' ? LIMITS.buttons : LIMITS.rows;
  const edit = (key, fn) => onEdit(`${nodeId}:${key}`, fn);
  const header = d.header || { type: 'none' };

  return (
    <div className="ed">
      <div className="ed-head">
        <Input value={n.name || ''} onChange={(e) => edit('name', (doc, m) => m.setField(doc, nodeId, 'name', e.target.value))} placeholder="Node name (for you, not shown to the user)" className="ed-name" aria-label="Node name" />
        <div className="cv-row-actions">
          {isLive && <Pill tone="ok" dot>On screen</Pill>}
          <Button size="sm" icon={Play} onClick={onShow}>Show on phone</Button>
        </div>
      </div>
      <div className="ed-row">
        <Field label="Type">
          {isMedia ? <span className="cv-locked-ac">Media (image + caption)</span> : (
            <Select value={kind} onChange={(e) => edit('type', (doc, m) => m.setType(doc, nodeId, e.target.value))}>
              <option value="list">List message (up to 10 rows)</option>
              <option value="button">Reply buttons (up to 3)</option>
            </Select>
          )}
        </Field>
        <Field label="Node id"><span className="cv-mono-sm cv-muted">{nodeId === 'root' ? 'root (kept on export)' : `${nodeId.slice(0, 8)}… (fresh id on export)`}</span></Field>
      </div>

      {nodeId === 'root' && (
        <Field label="Start keywords" hint="Typing any of these starts the bot here. Comma separated.">
          <Input value={(n.keywords || []).join(', ')} onChange={(e) => edit('kw', (doc, m) => m.setRootKeywords(doc, e.target.value.split(',')))} />
        </Field>
      )}

      {isMedia ? (
        <>
          <Field label="Image / video link" required hint="Public https URL (Cloudinary works)">
            <Input value={d.link || ''} onChange={(e) => edit('link', (doc, m) => m.setField(doc, nodeId, 'data.link', e.target.value))} placeholder="https://…" />
          </Field>
          {d.link && (d.mediaType === 'video' ? <video className="ed-preview" src={d.link} controls /> : <img className="ed-preview" src={d.link} alt="" />)}
          <Field label="Media type"><Select value={d.mediaType || 'image'} onChange={(e) => edit('mt', (doc, m) => m.setField(doc, nodeId, 'data.mediaType', e.target.value))}><option value="image">Image</option><option value="video">Video</option></Select></Field>
          <Field label={<>Caption <Counter value={d.body} max={LIMITS.caption} /></>}>
            <Textarea rows={10} value={d.body || ''} onChange={(e) => edit('body', (doc, m) => m.setField(doc, nodeId, 'data.body', e.target.value))} />
          </Field>
          <p className="cv-hint">A media node ends the WACTO flow. If our backend should follow up, that is set in the backend (dual options), not here.</p>
        </>
      ) : (
        <>
          <div className="ed-row">
            <Field label="Header">
              <Select value={header.type || 'none'} onChange={(e) => edit('hdr', (doc, m) => m.setHeader(doc, nodeId, e.target.value, e.target.value === 'text' ? (header.text || '') : (header.link || header.url || '')))}>
                <option value="none">None</option><option value="text">Text</option>
                {kind === 'button' && <><option value="image">Image</option><option value="video">Video (mp4, max 16 MB)</option><option value="document">Document (PDF)</option></>}
              </Select>
            </Field>
            {header.type === 'text' && <Field label={<>Header text <Counter value={header.text} max={LIMITS.header} /></>}><Input value={header.text || ''} onChange={(e) => edit('hdrt', (doc, m) => m.setHeader(doc, nodeId, 'text', e.target.value))} /></Field>}
            {['image', 'video', 'document'].includes(header.type) && <Field label={`Header ${header.type} URL`}><Input value={header.link || header.url || ''} onChange={(e) => edit('hdru', (doc, m) => m.setHeader(doc, nodeId, header.type, e.target.value))} placeholder="https://…" /></Field>}
          </div>
          <Field label={<>Body <Counter value={d.body} max={LIMITS.body} /></>} required hint="*bold* _italic_ ```mono``` as on WhatsApp">
            <Textarea rows={9} value={d.body || ''} onChange={(e) => edit('body', (doc, m) => m.setField(doc, nodeId, 'data.body', e.target.value))} />
          </Field>
          <div className="ed-row">
            <Field label={<>Footer <Counter value={d.footer} max={LIMITS.footer} /></>}><Input value={d.footer || ''} onChange={(e) => edit('footer', (doc, m) => m.setField(doc, nodeId, 'data.footer', e.target.value))} placeholder="Small grey line under the message" /></Field>
            {kind === 'list' && <Field label={<>List button text <Counter value={d.action?.button} max={20} /></>}><Input value={d.action?.button || ''} onChange={(e) => edit('lbtn', (doc, m) => m.setField(doc, nodeId, 'data.action.button', e.target.value))} placeholder="e.g. Choose" /></Field>}
          </div>

          <div className="ed-opts-head">
            <strong>{kind === 'list' ? 'Rows' : 'Buttons'} <span className="cv-muted">{opts.length} / {maxOpts}</span></strong>
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => edit('addopt', (doc, m) => m.addOption(doc, nodeId))} disabled={opts.length >= maxOpts}>Add {kind === 'list' ? 'row' : 'button'}</Button>
          </div>
          {kind === 'list' && (d.action?.sections || []).length > 0 && (d.action.sections.length > 1 || d.action.sections[0].title) && (
            <div className="ed-row">{d.action.sections.map((s, si) => <Field key={si} label={<>Section {si + 1} title <Counter value={s.title} max={LIMITS.sectionTitle} /></>}><Input value={s.title || ''} onChange={(e) => edit(`sec${si}`, (doc, m) => m.setSectionTitle(doc, nodeId, si, e.target.value))} /></Field>)}</div>
          )}
          <div className="ed-opts">
            {opts.map((o, i) => {
              const r = resolve(model, nodeId, o.title);
              const max = kind === 'list' ? LIMITS.rowTitle : LIMITS.buttonTitle;
              return (
                <div key={o.id || i} className="ed-opt">
                  <div className="ed-opt-main">
                    <div className="ed-opt-title"><Input value={o.title} onChange={(e) => edit(`opt${i}t`, (doc, m) => m.setOption(doc, nodeId, i, { title: e.target.value }))} placeholder="Title (what the user taps)" /><Counter value={o.title} max={max} /></div>
                    {kind === 'list' && <div className="ed-opt-title"><Input value={o.description} onChange={(e) => edit(`opt${i}d`, (doc, m) => m.setOption(doc, nodeId, i, { description: e.target.value }))} placeholder="Description (optional)" /><Counter value={o.description} max={LIMITS.rowDesc} /></div>}
                    <div className="ed-opt-dest">
                      <Link2 size={14} />
                      <Select value={r.viaOwnEdge ? r.to : ''} onChange={(e) => { const v = e.target.value; if (v === '__new_list' || v === '__new_button' || v === '__new_media') onAdd(v.replace('__new_', ''), { name: `After: ${o.title}`, fromTitle: o.title }); else edit(`opt${i}e`, (doc, m) => m.setDestination(doc, nodeId, o.title, v || null)); }} aria-label={`Destination of ${o.title}`}>
                        <option value="">No edge (backend answers, or dead end)</option>
                        <optgroup label="Create and link">
                          <option value="__new_list">+ New list message</option><option value="__new_button">+ New buttons message</option><option value="__new_media">+ New media message</option>
                        </optgroup>
                        <optgroup label="Existing nodes">{nodes.map((x) => <option key={x.nodeId} value={x.nodeId}>{x.name || x.nodeId.slice(0, 8)}</option>)}</optgroup>
                      </Select>
                      {r.to && <button type="button" className="cv-link" onClick={() => onSelect(r.to)}>open</button>}
                    </div>
                    {!r.viaOwnEdge && r.to && <div className="cv-text-bad" style={{ fontSize: 12 }}>No edge from this node, but “{o.title}” already leads to {model.nodes.get(r.to)?.name} elsewhere — WACTO will open that.</div>}
                    {r.clashes.length > 0 && <div className="cv-text-bad" style={{ fontSize: 12 }}>Same title also leads to {r.clashes.map((id) => model.nodes.get(id)?.name || id.slice(0, 8)).join(', ')} — WACTO keeps one destination per title.</div>}
                  </div>
                  <div className="ed-opt-actions">
                    <button type="button" className="cv-icon-btn cv-icon-btn--sm" aria-label="Move up" onClick={() => edit(`mv${i}`, (doc, m) => m.moveOption(doc, nodeId, i, -1))} disabled={i === 0}><ArrowUp size={13} /></button>
                    <button type="button" className="cv-icon-btn cv-icon-btn--sm" aria-label="Move down" onClick={() => edit(`mv${i}`, (doc, m) => m.moveOption(doc, nodeId, i, 1))} disabled={i === opts.length - 1}><ArrowDown size={13} /></button>
                    <button type="button" className="cv-icon-btn cv-icon-btn--sm" aria-label="Remove" onClick={() => edit(`rm${i}`, (doc, m) => m.removeOption(doc, nodeId, i))}><X size={13} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {checks.length > 0 && <ul className="sim-checks" style={{ marginTop: 12 }}>{checks.map((c, i) => <li key={i} className={`sim-check sim-check--${c.level}`}>{c.level === 'error' ? <CircleAlert size={13} /> : c.level === 'warn' ? <AlertTriangle size={13} /> : <Info size={13} />}<span>{c.text}</span></li>)}</ul>}

      <div className="ed-foot">
        <Button size="sm" variant="ghost" icon={Copy} onClick={onDuplicate}>Duplicate</Button>
        {nodeId !== 'root' && (confirmDel
          ? <span className="cv-row-actions"><span className="cv-text-bad" style={{ fontSize: 12.5 }}>Delete “{n.name}” and its edges?</span><Button size="sm" className="cv-btn--danger-solid" onClick={() => { setConfirmDel(false); onDelete(); }}>Delete</Button><Button size="sm" variant="ghost" onClick={() => setConfirmDel(false)}>Keep</Button></span>
          : <Button size="sm" variant="ghost" icon={Trash2} className="cv-btn--danger" onClick={() => setConfirmDel(true)}>Delete node</Button>)}
        <span style={{ flex: 1 }} />
        <Select value="" onChange={(e) => { if (e.target.value) onAdd(e.target.value, { name: 'New message' }); }} aria-label="Add node" style={{ width: 'auto' }}>
          <option value="">+ Add node…</option><option value="list">List message</option><option value="button">Buttons message</option><option value="media">Media message</option>
        </Select>
      </div>
    </div>
  );
}
