import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Trash2, Save, CircleAlert } from 'lucide-react';
import api from '../../api/client.js';
import { PageHeader, Card } from '../../civic/kit.jsx';
import { Field, Input, Select, Button, Alert, Modal } from '../../civic/ui.jsx';
import { localBodiesData, ALL_DISTRICTS } from '../../data/wardLocalBodies.js';

// Same rules as the previous edit page: body type -> position -> (urban) local
// body + ward. Rural positions keep free-text union / panchayat names.
const RURAL_POSITIONS = ['Village Panchayat Ward Member', 'Village Panchayat President', 'Panchayat Union Ward Member', 'District Panchayat Ward Member'];
const URBAN_POSITIONS = ['Town Panchayat', 'Municipality', 'Corporation'];
const PARTIES = ['DMK', 'AIADMK', 'BJP', 'INC', 'NTK', 'PMK', 'VCK', 'MDMK', 'AMMK', 'DMDK', 'TVK', 'Independent', 'Other'];
const ROLES = [['planning', 'Planning to contest'], ['confirmed', 'Confirmed candidate'], ['team', 'Campaign team member'], ['functionary', 'Party functionary']];
const normPos = (p) => ({ 'Town Panchayat Ward Member': 'Town Panchayat', 'Municipality Ward Member': 'Municipality', 'Corporation Ward Member': 'Corporation' }[p] || p || '');
const datasetKey = (pos) => (pos === 'Corporation' ? 'corporations' : pos === 'Municipality' ? 'municipalities' : pos === 'Town Panchayat' ? 'town_panchayats' : null);
const bodyField = (pos) => (pos === 'Municipality' ? 'union_or_municipality' : 'panchayat_or_corporation');

export default function RegistrationEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState(null);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [del, setDel] = useState({ open: false, busy: false, err: '' });

  useEffect(() => {
    api.get(`/registrations/${id}`)
      .then(({ data }) => {
        if (!data.success) { setErr(data.message || 'Not found.'); return; }
        const r = data.registration;
        setForm({
          full_name: r.full_name || r.firstname || '', mobile: r.mobile || '', district: r.district || '', role: r.role || '',
          affiliation: r.affiliation || '', party: r.party || '', body_type: String(r.body_type || '').toLowerCase(), position: normPos(r.position),
          union_or_municipality: r.union_or_municipality || '', panchayat_or_corporation: r.panchayat_or_corporation || '', ward_number: r.ward_number || '',
        });
      })
      .catch((e) => setErr(e.response?.data?.message || 'Registration not found.'));
  }, [id]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const positions = form?.body_type === 'urban' ? URBAN_POSITIONS : form?.body_type === 'rural' ? RURAL_POSITIONS : [];
  const dsKey = datasetKey(form?.position);
  const localBodies = useMemo(() => (dsKey && form?.district ? localBodiesData[dsKey].filter((x) => x.district === form.district) : []), [dsKey, form?.district]);
  const selectedBody = dsKey ? localBodies.find((x) => x.name === form[bodyField(form.position)]) : null;
  const wards = selectedBody ? Array.from({ length: selectedBody.wards }, (_, i) => String(i + 1)) : [];

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setErr('');
    try {
      const { data } = await api.put(`/registrations/${id}`, form);
      if (!data.success) throw new Error(data.message || 'Save failed.');
      navigate(`/registrations/view/${id}`);
    } catch (e2) {
      setErr(e2.response?.data?.message || e2.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDel((d) => ({ ...d, busy: true, err: '' }));
    try {
      const { data } = await api.delete(`/registrations/${id}`);
      if (!data.success) throw new Error(data.message || 'Delete failed.');
      navigate('/registrations');
    } catch (e2) {
      setDel((d) => ({ ...d, busy: false, err: e2.response?.data?.message || e2.message }));
    }
  };

  if (!form && !err) return <div className="cv-page"><PageHeader title="Edit registration" subtitle="Loading…" /></div>;
  if (!form) return <div className="cv-page"><Alert tone="bad"><CircleAlert size={16} /> {err}</Alert><Link to="/registrations" className="cv-link"><ArrowLeft size={14} /> Back</Link></div>;

  return (
    <div className="cv-page cv-page--narrow">
      <PageHeader eyebrow={<Link to={`/registrations/view/${id}`} className="cv-back"><ArrowLeft size={14} /> {form.full_name || 'Registration'}</Link>} title="Edit registration" subtitle="Changes apply to the candidate's profile immediately" />
      <form onSubmit={save} className="cv-stack">
        <Card title="Candidate">
          <div className="cv-form-grid">
            <Field label="Full name" required><Input value={form.full_name} onChange={(e) => set({ full_name: e.target.value })} required /></Field>
            <Field label="Mobile" hint="The mobile is the login username and cannot be changed here."><Input value={form.mobile} readOnly className="cv-input--ro" /></Field>
            <Field label="Role"><Select value={form.role} onChange={(e) => set({ role: e.target.value })}><option value="">Select role</option>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
            <Field label="Affiliation"><Select value={form.affiliation} onChange={(e) => set({ affiliation: e.target.value, party: e.target.value === 'independent' ? '' : form.party })}><option value="">Select affiliation</option><option value="affiliated">Affiliated with a party</option><option value="independent">Independent</option></Select></Field>
            {form.affiliation === 'affiliated' && <Field label="Party"><Select value={form.party} onChange={(e) => set({ party: e.target.value })}><option value="">Select party</option>{PARTIES.map((p) => <option key={p}>{p}</option>)}</Select></Field>}
          </div>
        </Card>

        <Card title="Constituency">
          <div className="cv-form-grid">
            <Field label="District" required><Select value={form.district} onChange={(e) => set({ district: e.target.value, union_or_municipality: '', panchayat_or_corporation: '', ward_number: '' })} required><option value="">Select district</option>{ALL_DISTRICTS.map((d) => <option key={d}>{d}</option>)}</Select></Field>
            <Field label="Local body type" required><Select value={form.body_type} onChange={(e) => set({ body_type: e.target.value, position: '', union_or_municipality: '', panchayat_or_corporation: '', ward_number: '' })} required><option value="">Select body type</option><option value="urban">Urban local body</option><option value="rural">Rural local body</option></Select></Field>
            <Field label="Position contesting" required><Select value={form.position} onChange={(e) => set({ position: e.target.value, union_or_municipality: '', panchayat_or_corporation: '', ward_number: '' })} required disabled={!positions.length}><option value="">Select position</option>{positions.map((p) => <option key={p}>{p}</option>)}</Select></Field>
            {dsKey ? (
              <>
                <Field label={`${form.position} name`} hint={!form.district ? 'Choose a district first' : undefined}>
                  <Select value={form[bodyField(form.position)]} onChange={(e) => set({ [bodyField(form.position)]: e.target.value, ward_number: '' })} disabled={!localBodies.length}>
                    <option value="">{localBodies.length ? `Select ${form.position.toLowerCase()}` : 'No entries for this district'}</option>
                    {localBodies.map((lb) => <option key={lb.name} value={lb.name}>{lb.name}</option>)}
                  </Select>
                </Field>
                <Field label="Ward number"><Select value={form.ward_number} onChange={(e) => set({ ward_number: e.target.value })} disabled={!wards.length}><option value="">{wards.length ? 'Select ward' : 'Pick the local body first'}</option>{wards.map((w) => <option key={w} value={w}>Ward {w}</option>)}</Select></Field>
              </>
            ) : form.body_type === 'rural' ? (
              <>
                <Field label="Panchayat union"><Input value={form.union_or_municipality} onChange={(e) => set({ union_or_municipality: e.target.value })} /></Field>
                <Field label="Village panchayat"><Input value={form.panchayat_or_corporation} onChange={(e) => set({ panchayat_or_corporation: e.target.value })} /></Field>
                <Field label="Ward number"><Input value={form.ward_number} onChange={(e) => set({ ward_number: e.target.value })} /></Field>
              </>
            ) : null}
          </div>
        </Card>

        {err && <Alert tone="bad"><CircleAlert size={16} /> {err}</Alert>}
        <div className="cv-form-foot">
          <Button variant="ghost" icon={Trash2} onClick={() => setDel({ open: true, busy: false, err: '' })} className="cv-btn--danger">Delete registration</Button>
          <div className="cv-actions">
            <Button variant="ghost" onClick={() => navigate(`/registrations/view/${id}`)}>Cancel</Button>
            <Button type="submit" icon={Save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
          </div>
        </div>
      </form>

      <Modal open={del.open} title="Delete this registration?" onClose={() => setDel((d) => ({ ...d, open: false }))}>
        <p className="cv-modal-text">This removes <strong>{form.full_name}</strong> ({form.mobile}) and their login. It cannot be undone.</p>
        {del.err && <Alert tone="bad">{del.err}</Alert>}
        <div className="cv-modal-actions">
          <Button variant="ghost" onClick={() => setDel((d) => ({ ...d, open: false }))}>Keep</Button>
          <Button className="cv-btn--danger-solid" onClick={remove} disabled={del.busy}>{del.busy ? 'Deleting…' : 'Delete permanently'}</Button>
        </div>
      </Modal>
    </div>
  );
}
