import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../api/client.js';
import Spinner from '../components/Spinner.jsx';
import { localBodiesData, ALL_DISTRICTS } from '../data/wardLocalBodies.js';

// Port of admin/pages/edit_registration.blade.php — edit a candidate registration
// with cascading Body Type -> Position -> (urban) Local Body + Ward dropdowns.
const RURAL_POSITIONS = ['Village Panchayat Ward Member', 'Village Panchayat President', 'Panchayat Union Ward Member', 'District Panchayat Ward Member'];
const URBAN_POSITIONS = ['Town Panchayat', 'Municipality', 'Corporation'];
const PARTIES = ['DMK', 'AIADMK', 'BJP', 'INC', 'NTK', 'PMK', 'VCK', 'MDMK', 'AMMK', 'DMDK', 'TVK', 'Independent', 'Other'];
const ROLES = [
  { v: 'planning', l: 'Planning to Contest' }, { v: 'confirmed', l: 'Confirmed Candidate' },
  { v: 'team', l: 'Campaign Team Member' }, { v: 'functionary', l: 'Party Functionary' },
];

// Normalise legacy "... Ward Member" urban positions.
const normPos = (p) => ({
  'Town Panchayat Ward Member': 'Town Panchayat',
  'Municipality Ward Member': 'Municipality',
  'Corporation Ward Member': 'Corporation',
}[p] || p || '');

const datasetKey = (pos) => (pos === 'Corporation' ? 'corporations' : pos === 'Municipality' ? 'municipalities' : pos === 'Town Panchayat' ? 'town_panchayats' : null);
// Which stored field the urban local-body name lives in.
const bodyField = (pos) => (pos === 'Municipality' ? 'union_or_municipality' : 'panchayat_or_corporation');

export default function RegistrationEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState('');
  const [form, setForm] = useState(null);

  useEffect(() => {
    api.get(`/registrations/${id}`)
      .then(({ data }) => {
        if (!data.success) { setErr(data.message || 'Not found.'); return; }
        const r = data.registration;
        setForm({
          full_name: r.full_name || r.firstname || '',
          mobile: r.mobile || '',
          district: r.district || '',
          role: r.role || '',
          affiliation: r.affiliation || '',
          party: r.party || '',
          body_type: r.body_type || '',
          position: normPos(r.position),
          union_or_municipality: r.union_or_municipality || '',
          panchayat_or_corporation: r.panchayat_or_corporation || '',
          ward_number: r.ward_number || '',
        });
      })
      .catch((e) => setErr(e.response?.data?.message || 'Registration not found.'))
      .finally(() => setLoading(false));
  }, [id]);

  const positions = form?.body_type === 'urban' ? URBAN_POSITIONS : form?.body_type === 'rural' ? RURAL_POSITIONS : [];
  const dsKey = datasetKey(form?.position);
  const isUrban = !!dsKey;

  const localBodies = useMemo(() => {
    if (!dsKey || !form?.district) return [];
    return localBodiesData[dsKey].filter((x) => x.district === form.district);
  }, [dsKey, form?.district]);

  const urbanBodyValue = form ? form[bodyField(form.position)] : '';
  const wardCount = useMemo(() => {
    const lb = localBodies.find((x) => x.name === urbanBodyValue);
    return lb ? lb.wards : 0;
  }, [localBodies, urbanBodyValue]);

  const set = (patch) => setForm((s) => ({ ...s, ...patch }));

  const onBodyType = (v) => set({ body_type: v, position: '', union_or_municipality: '', panchayat_or_corporation: '', ward_number: '' });
  const onPosition = (v) => set({ position: v, union_or_municipality: '', panchayat_or_corporation: '', ward_number: '' });
  const onDistrict = (v) => set({ district: v, union_or_municipality: '', panchayat_or_corporation: '', ward_number: '' });
  const onUrbanBody = (v) => set({ [bodyField(form.position)]: v, ward_number: '' });

  const deleteRegistration = async () => {
    if (!window.confirm(`Delete registration for ${form.full_name} (${form.mobile})? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const { data } = await api.delete(`/registrations/${id}`);
      if (data.success) navigate('/registrations');
      else setErr(data.message || 'Delete failed.');
    } catch (e2) { setErr(e2.response?.data?.message || 'Delete failed.'); }
    finally { setDeleting(false); }
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setSaving(true);
    try {
      const { data } = await api.put(`/registrations/${id}`, form);
      if (data.success) navigate(`/registrations/view/${id}`);
      else setErr(data.message || 'Update failed.');
    } catch (e2) { setErr(e2.response?.data?.message || 'Update failed.'); }
    finally { setSaving(false); }
  };

  if (loading) return <Spinner label="Loading…" />;
  if (!form) return <div><div className="alert err">{err || 'Not found.'}</div><Link to="/registrations" className="btn-link">← Back to Registrations</Link></div>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
        <button className="secondary" onClick={() => navigate(`/registrations/view/${id}`)}>← Back</button>
        <h1 style={{ margin: 0 }}>Edit Registration</h1>
      </div>
      {err && <div className="alert err">{err}</div>}

      <form onSubmit={submit} className="card">
        <div className="row">
          <div style={{ flex: 1 }}><label>Full Name</label><input value={form.full_name} onChange={(e) => set({ full_name: e.target.value })} required style={{ width: '100%' }} /></div>
          <div style={{ flex: 1 }}><label>Mobile Number</label><input value={form.mobile} readOnly style={{ width: '100%', background: '#eef1f6' }} /></div>
        </div>

        <div className="row">
          <div style={{ flex: 1 }}>
            <label>District</label>
            <select value={form.district} onChange={(e) => onDistrict(e.target.value)} required style={{ width: '100%' }}>
              <option value="">Select District</option>
              {ALL_DISTRICTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Role</label>
            <select value={form.role} onChange={(e) => set({ role: e.target.value })} required style={{ width: '100%' }}>
              <option value="">Select Role</option>
              {ROLES.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
            </select>
          </div>
        </div>

        <div className="row">
          <div style={{ flex: 1 }}>
            <label>Political Affiliation</label>
            <select value={form.affiliation} onChange={(e) => set({ affiliation: e.target.value, party: e.target.value === 'affiliated' ? form.party : '' })} required style={{ width: '100%' }}>
              <option value="">Select Affiliation</option>
              <option value="affiliated">Affiliated with a party</option>
              <option value="independent">Independent</option>
            </select>
          </div>
          {form.affiliation === 'affiliated' && (
            <div style={{ flex: 1 }}>
              <label>Party</label>
              <select value={form.party} onChange={(e) => set({ party: e.target.value })} style={{ width: '100%' }}>
                <option value="">Select party</option>
                {PARTIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="row">
          <div style={{ flex: 1 }}>
            <label>Local Body Type</label>
            <select value={form.body_type} onChange={(e) => onBodyType(e.target.value)} required style={{ width: '100%' }}>
              <option value="">Select Body Type</option>
              <option value="rural">Rural Local Body</option>
              <option value="urban">Urban Local Body</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>Position Contesting</label>
            <select value={form.position} onChange={(e) => onPosition(e.target.value)} required disabled={!form.body_type} style={{ width: '100%' }}>
              <option value="">Select Position</option>
              {positions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>

        {isUrban ? (
          <div className="row">
            <div style={{ flex: 1 }}>
              <label>{form.position} Name</label>
              <select value={urbanBodyValue} onChange={(e) => onUrbanBody(e.target.value)} required disabled={!form.district} style={{ width: '100%' }}>
                <option value="">Select {form.position}</option>
                {localBodies.map((lb) => <option key={lb.name} value={lb.name}>{lb.name}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label>Ward Number</label>
              <select value={form.ward_number} onChange={(e) => set({ ward_number: e.target.value })} required disabled={!urbanBodyValue} style={{ width: '100%' }}>
                <option value="">Select Ward</option>
                {Array.from({ length: wardCount }, (_, i) => i + 1).map((n) => {
                  const val = `ward-${n}`;
                  return <option key={n} value={val}>{val}</option>;
                })}
              </select>
            </div>
          </div>
        ) : (
          <div className="row">
            <div style={{ flex: 1 }}><label>Union / Municipality</label><input value={form.union_or_municipality} onChange={(e) => set({ union_or_municipality: e.target.value })} style={{ width: '100%' }} /></div>
            <div style={{ flex: 1 }}><label>Panchayat / Corporation</label><input value={form.panchayat_or_corporation} onChange={(e) => set({ panchayat_or_corporation: e.target.value })} style={{ width: '100%' }} /></div>
            <div style={{ flex: 1 }}><label>Ward Number</label><input value={form.ward_number} onChange={(e) => set({ ward_number: e.target.value })} style={{ width: '100%' }} /></div>
          </div>
        )}

        <div style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
          <button disabled={saving || deleting}>{saving ? 'Updating…' : 'Update Details'}</button>
          <button type="button" className="secondary" onClick={() => navigate(`/registrations/view/${id}`)}>Cancel</button>
          <button
            type="button"
            disabled={deleting || saving}
            onClick={deleteRegistration}
            style={{ marginLeft: 'auto', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', cursor: 'pointer', opacity: (deleting || saving) ? 0.6 : 1 }}
          >
            {deleting ? 'Deleting…' : 'Delete Registration'}
          </button>
        </div>
      </form>
    </div>
  );
}
