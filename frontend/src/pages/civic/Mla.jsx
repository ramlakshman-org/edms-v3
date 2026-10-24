import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Upload, Trash2, Flag, UserRound, Check, CircleAlert, ImageOff } from 'lucide-react';
import api from '../../api/client.js';
import { PageHeader, Card, Pill, Kpi, inr } from '../../civic/kit.jsx';
import { DataTable, Pager, Select, Button, Modal, Alert, cloudThumb } from '../../civic/ui.jsx';
import { MLA_MEMBERS, PARTIES } from '../../data/mlaMembers.js';

// MLA (Civic Ops step 5): directory of the 234 sitting members with their
// photo, plus party flags. Same API as before: GET /mla/images (profile + flag
// maps), POST /mla/profile-upload | /mla/flag-upload {filename, mime,
// fileBase64, constituency_no | party}, DELETE /mla/profile/:no | /mla/flag/:party.
const PAGE_SIZE = 30;
const MAX_MB = 2;
// PARTIES is [[abbr, { full, flag }], …]; tolerate other shapes too.
const partyList = (Array.isArray(PARTIES) ? PARTIES : Object.entries(PARTIES || {})).map((p) => {
  const [abbr, meta] = Array.isArray(p) ? p : [p.abbr || p.code || p.party, p];
  const name = typeof meta === 'string' ? meta : meta?.full || meta?.name || meta?.label || '';
  return { abbr, name };
});
const partyName = (abbr) => partyList.find((p) => p.abbr === abbr)?.name || '';

const readAsBase64 = (file) => new Promise((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1] || '');
  r.onerror = () => fail(new Error('Could not read the file.'));
  r.readAsDataURL(file);
});

function Thumb({ src, alt, kind }) {
  if (!src) return <span className={`cv-thumb cv-thumb--empty cv-thumb--${kind}`} title="No image">{kind === 'flag' ? <Flag size={14} /> : <UserRound size={16} />}</span>;
  return <img src={kind === 'flag' ? cloudThumb(src, 30, 20) : cloudThumb(src, 36, 36)} alt={alt} className={`cv-thumb cv-thumb--${kind}`} loading="lazy" />;
}

export default function Mla() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'flags' ? 'flags' : 'directory';
  const page = Math.max(1, Number(params.get('page') || 1));
  const q = params.get('q') || '';
  const party = params.get('party') || '';
  const photo = params.get('photo') || '';
  const [draft, setDraft] = useState(q);
  const [maps, setMaps] = useState({ profiles: {}, flags: {} });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [confirm, setConfirm] = useState(null); // { kind: 'profile'|'flag', key, label }
  const fileInput = useRef(null);
  const pendingTarget = useRef(null); // { kind, key }

  useEffect(() => { setDraft(q); }, [q]);
  const load = () => {
    setLoading(true); setErr('');
    api.get('/mla/images').then(({ data }) => setMaps({ profiles: data.profiles || {}, flags: data.flags || {} })).catch((e) => setErr(e.response?.data?.message || 'Could not load MLA images.')).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const setP = (patch) => { const n = new URLSearchParams(params); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); setParams(n); };

  const members = useMemo(() => MLA_MEMBERS.map(([no, constituency, member, abbr]) => ({ no, constituency, member, abbr })), []);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return members.filter((m) => (!party || m.abbr === party) && (!photo || (photo === 'yes') === !!maps.profiles[m.no]) && (!t || String(m.no) === t || m.constituency.toLowerCase().includes(t) || m.member.toLowerCase().includes(t) || m.abbr.toLowerCase().includes(t)));
  }, [members, q, party, photo, maps.profiles]);
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const withPhoto = members.filter((m) => maps.profiles[m.no]).length;
  const partiesInHouse = useMemo(() => { const c = {}; members.forEach((m) => { c[m.abbr] = (c[m.abbr] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1]); }, [members]);

  const pickFile = (kind, key) => { pendingTarget.current = { kind, key }; fileInput.current?.click(); };
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const target = pendingTarget.current;
    if (!file || !target) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) { setErr('Please choose a PNG or JPG image.'); return; }
    if (file.size > MAX_MB * 1024 * 1024) { setErr(`Image is larger than ${MAX_MB} MB.`); return; }
    const k = `${target.kind}:${target.key}`;
    setBusyKey(k); setErr(''); setFlash('');
    try {
      const fileBase64 = await readAsBase64(file);
      const payload = { filename: file.name, mime: file.type, fileBase64 };
      const { data } = target.kind === 'profile'
        ? await api.post('/mla/profile-upload', { ...payload, constituency_no: target.key })
        : await api.post('/mla/flag-upload', { ...payload, party: target.key });
      if (!data.success) throw new Error(data.message || 'Upload failed.');
      setMaps((m) => target.kind === 'profile' ? { ...m, profiles: { ...m.profiles, [target.key]: data.url } } : { ...m, flags: { ...m.flags, [target.key]: data.url } });
      setFlash(target.kind === 'profile' ? `Photo updated for AC ${target.key}.` : `Flag updated for ${target.key}.`);
    } catch (e2) {
      setErr(e2.response?.data?.message || e2.message);
    } finally {
      setBusyKey('');
    }
  };
  const remove = async () => {
    if (!confirm) return;
    const k = `${confirm.kind}:${confirm.key}`;
    setBusyKey(k); setConfirm((c) => c && { ...c, err: '' });
    try {
      if (confirm.kind === 'profile') await api.delete(`/mla/profile/${confirm.key}`); else await api.delete(`/mla/flag/${encodeURIComponent(confirm.key)}`);
      setMaps((m) => { const next = { profiles: { ...m.profiles }, flags: { ...m.flags } }; delete next[confirm.kind === 'profile' ? 'profiles' : 'flags'][confirm.key]; return next; });
      setFlash(`${confirm.label} removed.`);
      setConfirm(null);
    } catch (e2) {
      setConfirm((c) => c && { ...c, err: e2.response?.data?.message || 'Could not remove the image.' }); // shown inside the dialog
    } finally {
      setBusyKey('');
    }
  };

  const columns = [
    { key: 'photo', label: '', width: 56, render: (m) => <Thumb src={maps.profiles[m.no]} alt={m.member} kind="profile" /> },
    { key: 'no', label: 'AC', align: 'right', render: (m) => <span className="cv-num-strong">{m.no}</span> },
    { key: 'member', label: 'Member', primary: true, render: (m) => <div className="cv-two"><strong>{m.member}</strong><span className="cv-muted">{m.constituency}</span></div> },
    { key: 'abbr', label: 'Party', render: (m) => <span className="cv-party"><Thumb src={maps.flags[m.abbr]} alt={m.abbr} kind="flag" /><span>{m.abbr}</span></span> },
    { key: 'status', label: 'Photo', render: (m) => (maps.profiles[m.no] ? <Pill tone="ok" dot>Uploaded</Pill> : <Pill tone="neutral">Missing</Pill>) },
    { key: 'actions', label: '', render: (m) => (
      <span className="cv-row-actions">
        <Button size="sm" variant="ghost" icon={Upload} onClick={() => pickFile('profile', m.no)} disabled={busyKey === `profile:${m.no}`}>{busyKey === `profile:${m.no}` ? 'Uploading…' : maps.profiles[m.no] ? 'Replace' : 'Upload'}</Button>
        {maps.profiles[m.no] && <button type="button" className="cv-icon-btn cv-icon-btn--sm cv-btn--danger" title="Remove photo" onClick={() => setConfirm({ kind: 'profile', key: m.no, label: `Photo of ${m.member} (AC ${m.no})` })}><Trash2 size={14} /></button>}
      </span>
    ) },
  ];

  return (
    <div className="cv-page">
      <PageHeader
        title="MLA"
        subtitle="Sitting members of the Tamil Nadu Legislative Assembly, their photos and party flags"
      />
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onFile} />

      {err && <Alert tone="bad"><CircleAlert size={16} /> {err}</Alert>}
      {flash && <Alert tone="ok"><Check size={16} /> {flash}</Alert>}

      <div className="cv-kpis cv-kpis--4 cv-kpis--line">
        <Kpi label="Constituencies" value={inr(members.length)} note="one sitting member each" />
        <Kpi label="Photos uploaded" value={`${inr(withPhoto)}`} note={`${inr(members.length - withPhoto)} missing`} tone={withPhoto < members.length ? 'warn' : undefined} />
        <Kpi label="Parties" value={inr(partiesInHouse.length)} note={partiesInHouse.slice(0, 3).map(([a, n]) => `${a} ${n}`).join(' · ')} />
        <Kpi label="Flags uploaded" value={inr(partyList.filter((p) => maps.flags[p.abbr]).length)} note={`of ${partyList.length} parties`} />
      </div>

      <Card flush>
        <div className="cv-tabs-row">
          <div className="cv-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'directory'} className={`cv-tab ${tab === 'directory' ? 'cv-tab--on' : ''}`} onClick={() => setP({ tab: '', page: '' })}>Directory<span className="cv-tab-count">{members.length}</span></button>
            <button type="button" role="tab" aria-selected={tab === 'flags'} className={`cv-tab ${tab === 'flags' ? 'cv-tab--on' : ''}`} onClick={() => setP({ tab: 'flags', page: '' })}>Parties & flags<span className="cv-tab-count">{partyList.length}</span></button>
          </div>
        </div>

        {tab === 'directory' ? (
          <>
            <form className="cv-filters" onSubmit={(e) => { e.preventDefault(); setP({ q: draft, page: '' }); }}>
              <label className="cv-search cv-filters-search"><Search size={15} /><input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Constituency, member, party or AC number…" aria-label="Search" /></label>
              <Select value={party} onChange={(e) => setP({ party: e.target.value, page: '' })} aria-label="Party"><option value="">All parties</option>{partiesInHouse.map(([a, n]) => <option key={a} value={a}>{a} ({n})</option>)}</Select>
              <Select value={photo} onChange={(e) => setP({ photo: e.target.value, page: '' })} aria-label="Photo status"><option value="">With or without photo</option><option value="yes">Photo uploaded</option><option value="no">Photo missing</option></Select>
              <Button type="submit">Search</Button>
            </form>
            <DataTable columns={columns} rows={rows} rowKey={(m) => m.no} loading={loading} empty="No members match." />
            <Pager page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={(p) => setP({ page: String(p) })} />
          </>
        ) : (
          <div className="cv-card-body" style={{ paddingTop: 16 }}>
            <p className="cv-hint" style={{ margin: '0 0 12px' }}>Flags appear next to each member in the directory and in the WhatsApp bot. PNG or JPG, up to {MAX_MB} MB.</p>
            <div className="cv-flag-grid">
              {partyList.map((p) => {
                const url = maps.flags[p.abbr];
                const seats = partiesInHouse.find(([a]) => a === p.abbr)?.[1] || 0;
                const k = `flag:${p.abbr}`;
                return (
                  <div key={p.abbr} className="cv-flag-card">
                    <div className="cv-flag-img">{url ? <img src={cloudThumb(url, 120, 72, 'fit')} alt={`${p.abbr} flag`} /> : <span className="cv-muted"><ImageOff size={18} /></span>}</div>
                    <div className="cv-two"><strong>{p.abbr}</strong><span className="cv-muted">{p.name || partyName(p.abbr) || '—'}{seats ? ` · ${seats} seat${seats === 1 ? '' : 's'}` : ''}</span></div>
                    <div className="cv-row-actions">
                      <Button size="sm" variant="ghost" icon={Upload} onClick={() => pickFile('flag', p.abbr)} disabled={busyKey === k}>{busyKey === k ? 'Uploading…' : url ? 'Replace' : 'Upload'}</Button>
                      {url && <button type="button" className="cv-icon-btn cv-icon-btn--sm cv-btn--danger" title="Remove flag" onClick={() => setConfirm({ kind: 'flag', key: p.abbr, label: `${p.abbr} flag` })}><Trash2 size={14} /></button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      <Modal open={!!confirm} title="Remove this image?" onClose={() => setConfirm(null)}>
        <p className="cv-modal-text">{confirm?.label} will be removed. You can upload a new one any time.</p>
        {confirm?.err && <Alert tone="bad"><CircleAlert size={16} /> {confirm.err}</Alert>}
        <div className="cv-modal-actions">
          <Button variant="ghost" onClick={() => setConfirm(null)}>Keep</Button>
          <Button className="cv-btn--danger-solid" onClick={remove} disabled={!!busyKey}>Remove</Button>
        </div>
      </Modal>
    </div>
  );
}
