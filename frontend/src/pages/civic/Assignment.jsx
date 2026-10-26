import { useEffect, useState } from 'react';
import { Shuffle, Save, Clock, Hand, UserCog } from 'lucide-react';
import api from '../../api/client.js';
import { PageHeader, Card } from '../../civic/kit.jsx';
import { Button, Select, loadError } from '../../civic/ui.jsx';

// A professional on/off switch.
function Toggle({ on, onChange, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}
      style={{ width: 46, height: 26, borderRadius: 999, border: 'none', cursor: disabled ? 'default' : 'pointer', padding: 3, background: on ? '#16a34a' : '#cbd5e1', transition: 'background .15s', opacity: disabled ? 0.5 : 1, flex: 'none' }}>
      <span style={{ display: 'block', width: 20, height: 20, borderRadius: '50%', background: '#fff', transform: on ? 'translateX(20px)' : 'translateX(0)', transition: 'transform .15s', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />
    </button>
  );
}

function Row({ icon: Icon, title, desc, children }) {
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '14px 0', borderBottom: '1px solid var(--cv-line-soft, #eef1f5)' }}>
      {Icon && <span style={{ flex: 'none', width: 36, height: 36, borderRadius: 9, background: 'var(--cv-subtle,#f1f5f9)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#475569' }}><Icon size={18} /></span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14.5 }}>{title}</div>
        <div className="cv-muted" style={{ fontSize: 13, marginTop: 2 }}>{desc}</div>
      </div>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>{children}</div>
    </div>
  );
}

// Super-Admin: control how leads are assigned to telecallers.
export default function Assignment() {
  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.get('/crm/settings').then(({ data }) => setCfg(data.config)).catch((e) => setErr(loadError(e, 'assignment settings'))).finally(() => setLoading(false));
  }, []);

  const set = (patch) => setCfg((c) => ({ ...c, ...patch }));
  const setAuto = (patch) => setCfg((c) => ({ ...c, auto_distribute: { ...c.auto_distribute, ...patch } }));

  const save = () => {
    setSaving(true); setErr(''); setMsg('');
    api.put('/crm/settings', cfg)
      .then(({ data }) => { setCfg(data.config); setMsg('Assignment settings saved.'); })
      .catch((e) => setErr(e?.response?.data?.message || 'Could not save.'))
      .finally(() => setSaving(false));
  };
  const distribute = () => {
    if (!window.confirm('Distribute all unassigned WhatsApp conversations across active team members now (round-robin)?')) return;
    setBusy(true); setErr(''); setMsg('');
    api.post('/crm/distribute-leads', {})
      .then(({ data }) => setMsg(data.message || 'Distributed.'))
      .catch((e) => setErr(e?.response?.data?.message || 'Could not distribute.'))
      .finally(() => setBusy(false));
  };

  if (loading || !cfg) {
    return (<><PageHeader eyebrow="Telecalling" title="Lead Assignment" /><Card><p className="cv-muted" style={{ padding: 8 }}>{err || 'Loading…'}</p></Card></>);
  }

  return (
    <div className="cv-page">
      <PageHeader
        eyebrow="Telecalling"
        title="Lead Assignment"
        subtitle="Control how WhatsApp leads are shared across your telecallers."
        actions={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="ghost" icon={Shuffle} onClick={distribute} disabled={busy}>Distribute now</Button>
            <Button icon={Save} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
          </div>
        )}
      />
      {err && <div className="cv-alert cv-alert--bad" style={{ marginBottom: 12 }}>{err}</div>}
      {msg && <div className="cv-alert cv-alert--ok" style={{ marginBottom: 12 }} onClick={() => setMsg('')}>{msg}</div>}

      <Card title="Assignment mode">
        <Row icon={Shuffle} title="Round-robin distribution" desc="New and unassigned leads are shared out evenly, in turn, among active telecallers.">
          <Toggle on={cfg.round_robin} onChange={(v) => set({ round_robin: v })} />
        </Row>
        <Row icon={UserCog} title="Manual assignment" desc="You can assign (and reassign) any lead to a specific telecaller from the CRM.">
          <Toggle on={cfg.manual_assign} onChange={(v) => set({ manual_assign: v })} />
        </Row>
        <Row icon={Hand} title="Let telecallers claim unassigned leads" desc="When on, a telecaller can take ownership of an unassigned lead themselves (it locks to them).">
          <Toggle on={cfg.claim_unassigned} onChange={(v) => set({ claim_unassigned: v })} />
        </Row>
      </Card>

      <Card title="Automatic redistribution" meta="Share out unassigned leads on a schedule — no manual clicking." style={{ marginTop: 16 }}>
        <Row icon={Clock} title="Auto-distribute on a schedule" desc="Runs round-robin automatically. Requires round-robin to be on.">
          <Toggle on={cfg.auto_distribute.enabled} onChange={(v) => setAuto({ enabled: v })} disabled={!cfg.round_robin} />
        </Row>
        {cfg.auto_distribute.enabled && (
          <div style={{ display: 'flex', gap: 12, padding: '14px 0 2px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="cv-muted" style={{ fontSize: 13 }}>Run</span>
            <Select value={cfg.auto_distribute.frequency} onChange={(e) => setAuto({ frequency: e.target.value })} style={{ width: 140 }}>
              <option value="hourly">Every hour</option>
              <option value="daily">Every day</option>
              <option value="weekly">Every Monday</option>
            </Select>
            {cfg.auto_distribute.frequency !== 'hourly' && (
              <>
                <span className="cv-muted" style={{ fontSize: 13 }}>at</span>
                <Select value={cfg.auto_distribute.hour} onChange={(e) => setAuto({ hour: Number(e.target.value) })} style={{ width: 110 }}>
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                </Select>
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
