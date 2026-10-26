import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserPlus, Shuffle, Headphones, Pencil, Trash2, Power, Eye, Phone, PhoneCall, ThumbsUp, ThumbsDown, PhoneOff, Sparkles, Users } from 'lucide-react';
import api from '../../api/client.js';
import { PageHeader, Card, Kpi, Pill } from '../../civic/kit.jsx';
import { DataTable, Button, Modal, Field, Input, Secret, RowMenu, loadError, fmtDateTime, waLink } from '../../civic/ui.jsx';

const EMPTY = { name: '', username: '', mobile: '', password: '', telecmi_id: '', telecmi_password: '' };

// Super-Admin: manage the telecalling team — create login credentials, activate/deactivate,
// see each telecaller's live lead stats, and share unassigned WhatsApp leads round-robin.
export default function TeamMembers() {
  const [members, setMembers] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState(null); // null = closed; object = create/edit
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([api.get('/team/members'), api.get('/team/stats')])
      .then(([m, s]) => { setMembers(m.data.members || []); setStats(s.data.stats || null); setErr(''); })
      .catch((e) => setErr(loadError(e, 'the team')))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const openCreate = () => { setEditId(null); setForm({ ...EMPTY }); };
  const openEdit = (m) => { setEditId(m.id); setForm({ name: m.name, username: m.username, mobile: m.mobile, password: '', telecmi_id: m.telecmi_id || '', telecmi_password: '' }); };

  const save = () => {
    if (!form.name.trim() || !form.username.trim() || (!editId && !form.password.trim())) {
      setErr('Name, username and password are required.'); return;
    }
    setSaving(true); setErr('');
    const req = editId
      ? api.put(`/team/members/${editId}`, form)
      : api.post('/team/members', form);
    req.then(({ data }) => { setMsg(data.message || 'Saved.'); setForm(null); load(); })
      .catch((e) => setErr(e?.response?.data?.message || 'Could not save the team member.'))
      .finally(() => setSaving(false));
  };

  const toggleActive = (m) => {
    setBusy(true);
    api.put(`/team/members/${m.id}`, { is_active: !m.is_active })
      .then(({ data }) => { setMsg(data.message || 'Updated.'); load(); })
      .catch((e) => setErr(e?.response?.data?.message || 'Could not update.'))
      .finally(() => setBusy(false));
  };

  const remove = (m) => {
    if (!window.confirm(`Delete telecaller "${m.name}"? Their assigned leads are released back to the pool.`)) return;
    setBusy(true);
    api.delete(`/team/members/${m.id}`)
      .then(({ data }) => { setMsg(data.message || 'Deleted.'); load(); })
      .catch((e) => setErr(e?.response?.data?.message || 'Could not delete.'))
      .finally(() => setBusy(false));
  };

  const distribute = () => {
    if (!window.confirm('Distribute all unassigned WhatsApp conversations across active team members (round-robin)?')) return;
    setBusy(true);
    api.post('/crm/distribute-leads', {})
      .then(({ data }) => { setMsg(data.message || 'Distributed.'); load(); })
      .catch((e) => setErr(e?.response?.data?.message || 'Could not distribute leads.'))
      .finally(() => setBusy(false));
  };

  const columns = [
    { key: 'name', label: 'Telecaller', primary: true, render: (m) => (
      <div>
        <strong>{m.name}</strong>
        <div className="cv-muted" style={{ fontSize: 12 }}>@{m.username}{m.mobile ? ` · ${m.mobile}` : ''}</div>
      </div>
    ) },
    { key: 'passcode', label: 'Passcode', render: (m) => <Secret value={m.password_str} /> },
    { key: 'status', label: 'Status', render: (m) => <Pill tone={m.is_active ? 'ok' : 'bad'} dot>{m.is_active ? 'Active' : 'Inactive'}</Pill> },
    { key: 'handled', label: 'Leads', align: 'right', render: (m) => (m.stats?.total_handled ?? 0).toLocaleString('en-IN') },
    { key: 'calls', label: 'Calls', align: 'right', medium: false, render: (m) => (m.stats?.calls_completed ?? 0).toLocaleString('en-IN') },
    { key: 'interested', label: 'Interested', align: 'right', medium: false, render: (m) => (m.stats?.interested ?? 0).toLocaleString('en-IN') },
    { key: 'pro', label: 'Pro', align: 'right', medium: false, render: (m) => (m.stats?.pro_users ?? 0).toLocaleString('en-IN') },
    { key: 'actions', label: '', render: (m) => (
      <RowMenu items={[
        { label: 'View dashboard', icon: Eye, href: `/team/view?agent=${m.id}` },
        m.mobile && { label: 'Call', icon: Phone, href: `tel:${m.mobile}`, external: true },
        { label: 'Edit', icon: Pencil, onClick: () => openEdit(m) },
        { label: m.is_active ? 'Deactivate' : 'Activate', icon: Power, onClick: () => toggleActive(m) },
        { label: 'Delete', icon: Trash2, onClick: () => remove(m) },
      ]} />
    ) },
  ];

  return (
    <div className="cv-page">
      <PageHeader
        eyebrow="Telecalling"
        title="Team Members"
        subtitle="Create telecaller logins, track each person's leads, and share WhatsApp conversations round-robin."
        actions={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="ghost" icon={Shuffle} onClick={distribute} disabled={busy}>Distribute (round-robin)</Button>
            <Button icon={UserPlus} onClick={openCreate}>Create Credentials</Button>
          </div>
        )}
      />

      {err && <div className="cv-alert cv-alert--bad" style={{ marginBottom: 12 }}>{err}</div>}
      {msg && <div className="cv-alert cv-alert--ok" style={{ marginBottom: 12 }} onClick={() => setMsg('')}>{msg}</div>}

      {stats && (
        <div className="cv-kpis" style={{ marginBottom: 16 }}>
          <Kpi icon={Headphones} label="Team members" value={(stats.total_team_members || 0).toLocaleString('en-IN')} />
          <Kpi icon={Users} label="Total leads" value={(stats.total_leads || 0).toLocaleString('en-IN')} />
          <Kpi icon={PhoneCall} label="Calls done" value={(stats.calls_completed || 0).toLocaleString('en-IN')} />
          <Kpi icon={ThumbsUp} label="Interested" value={(stats.interested || 0).toLocaleString('en-IN')} tone="ok" />
          <Kpi icon={ThumbsDown} label="Not interested" value={(stats.not_interested || 0).toLocaleString('en-IN')} tone="bad" />
          <Kpi icon={PhoneOff} label="Unreachable" value={((stats.switch_off || 0) + (stats.not_answered || 0) + (stats.will_call_back || 0)).toLocaleString('en-IN')} tone="warn" />
          <Kpi icon={Sparkles} label="Active Pro" value={(stats.pro_users || 0).toLocaleString('en-IN')} tone="info" />
        </div>
      )}

      <Card flush>
        <DataTable
          columns={columns}
          rows={members}
          rowKey={(m) => m.id}
          loading={loading}
          empty="No telecallers yet. Click “Create Credentials” to add your first team member."
        />
      </Card>

      <Modal open={!!form} title={editId ? 'Edit Team Member' : 'Create New Team Member Credentials'} onClose={() => setForm(null)} width={520}>
        {form && (
          <>
            <Field label="Full Name" required>
              <Input data-autofocus value={form.name} placeholder="e.g. Arun Kumar" onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Username (for CRM login)" required>
              <Input value={form.username} placeholder="e.g. arun_crm" onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </Field>
            <Field label="Mobile Number" hint="Optional — used for calling and as a fallback login.">
              <Input value={form.mobile} placeholder="10-digit mobile number" onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
            </Field>
            <Field label="TeleCMI User ID" hint="Optional — the agent's TeleCMI user id (enables click-to-call & IVR routing).">
              <Input value={form.telecmi_id} placeholder="e.g. 5002_33339108" onChange={(e) => setForm({ ...form, telecmi_id: e.target.value })} />
            </Field>
            <Field label="TeleCMI Softphone Password" hint={editId ? 'Leave blank to keep. Enables browser calling (talk through the computer, no mobile ring).' : 'Enables browser calling — talk through the computer, no mobile ring.'}>
              <Input value={form.telecmi_password} placeholder="TeleCMI user's softphone password" onChange={(e) => setForm({ ...form, telecmi_password: e.target.value })} />
            </Field>
            <Field label={editId ? 'New Password / Passcode' : 'Password / Passcode'} required={!editId} hint={editId ? 'Leave blank to keep the current passcode.' : undefined}>
              <Input value={form.password} placeholder="Set login passcode" onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
              <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : (editId ? 'Save Changes' : 'Create Credentials')}</Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
