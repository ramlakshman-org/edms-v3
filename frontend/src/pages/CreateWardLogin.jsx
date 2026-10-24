import { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../api/client.js';
import {
  localBodiesData, RURAL_POSITIONS, URBAN_POSITIONS, ALL_DISTRICTS, datasetKeyForPosition,
} from '../data/wardLocalBodies.js';

// Port of admin/pages/wardlogins/create.blade.php — two-step create form with
// cascading Body Type -> Position -> District -> Local Body -> Ward dropdowns,
// a duplicate-combination check, and EPIC-based booth assignment.
export default function CreateWardLogin() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  // Step 1 — location
  const [candidateType, setCandidateType] = useState('');
  const [position, setPosition] = useState('');
  const [district, setDistrict] = useState('');
  const [localBody, setLocalBody] = useState('');
  const [ward, setWard] = useState('');
  const [checking, setChecking] = useState(false);
  const [existsAlert, setExistsAlert] = useState(false);
  const [err, setErr] = useState('');

  // Step 2 — booths
  const [epic, setEpic] = useState('');
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState(null);
  const [booths, setBooths] = useState([]);
  const [boothErr, setBoothErr] = useState('');
  const [saving, setSaving] = useState(false);

  const positions = candidateType === 'urban' ? URBAN_POSITIONS : candidateType === 'rural' ? RURAL_POSITIONS : [];
  const dataset = datasetKeyForPosition(position);

  // Districts available for the chosen position.
  const districts = useMemo(() => {
    if (!position) return [];
    if (!dataset) return ALL_DISTRICTS;
    const set = new Set(localBodiesData[dataset].map((x) => x.district));
    return [...set].sort();
  }, [position, dataset]);

  // Local bodies for the chosen district (+ ward count). Panchayat Union → single generic option.
  const localBodies = useMemo(() => {
    if (!district) return [];
    if (!dataset) return [{ name: 'Panchayat Union', wards: 50 }];
    return localBodiesData[dataset].filter((x) => x.district === district);
  }, [district, dataset]);

  const wardCount = useMemo(() => {
    const lb = localBodies.find((x) => x.name === localBody);
    return lb ? lb.wards : 0;
  }, [localBodies, localBody]);

  // --- cascading resets ---
  const onBodyType = (v) => { setCandidateType(v); setPosition(''); setDistrict(''); setLocalBody(''); setWard(''); setExistsAlert(false); };
  const onPosition = (v) => { setPosition(v); setDistrict(''); setLocalBody(''); setWard(''); setExistsAlert(false); };
  const onDistrict = (v) => { setDistrict(v); setLocalBody(''); setWard(''); setExistsAlert(false); };
  const onLocalBody = (v) => { setLocalBody(v); setWard(''); setExistsAlert(false); };

  const goToStep2 = async () => {
    setErr(''); setExistsAlert(false);
    if (!candidateType || !position || !district || !localBody || !ward) {
      setErr('Please select all location details (Body Type, Position, District, Local Body, and Ward Number) before continuing.');
      return;
    }
    setChecking(true);
    try {
      const { data } = await api.post('/ward-logins/check-exists', {
        candidate_type: candidateType, position, district_id: district, category_name: localBody, ward_id: ward,
      });
      if (data.exists) setExistsAlert(true);
      else setStep(2);
    } catch (e) {
      setErr(e.response?.data?.message || 'Error verifying ward availability.');
    } finally { setChecking(false); }
  };

  const searchEpic = async () => {
    const val = epic.trim().toUpperCase();
    if (!val) { setBoothErr('Please enter an EPIC number.'); return; }
    setBoothErr(''); setFound(null); setSearching(true);
    try {
      const { data } = await api.get('/dashboard/search-epic', { params: { epic: val } });
      if (data.success && data.voter) setFound({ voter: data.voter, assembly_name: data.assembly_name });
      else setBoothErr(`No voter found with EPIC number: ${val}`);
    } catch (e) {
      setBoothErr(e.response?.data?.message || 'Search failed.');
    } finally { setSearching(false); }
  };

  const addBooth = () => {
    if (!found?.voter) return;
    const v = found.voter;
    const booth = {
      assembly_no: parseInt(v.ASSEMBLY_NO, 10),
      assembly_name: found.assembly_name || v.AC_NAME || `AC ${v.ASSEMBLY_NO}`,
      part_no: parseInt(v.PART_NO, 10),
      booth_name: v.BOOTH_NAME || `Booth ${v.PART_NO}`,
    };
    if (booths.some((b) => b.assembly_no === booth.assembly_no && b.part_no === booth.part_no)) {
      setBoothErr(`This booth (Assembly ${booth.assembly_no}, Booth ${booth.part_no}) has already been added to this ward!`);
      return;
    }
    setBoothErr('');
    setBooths((s) => [...s, booth]);
    setFound(null); setEpic('');
  };

  const removeBooth = (i) => setBooths((s) => s.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (!booths.length && !confirm("You haven't assigned any booths to this ward. Save anyway?")) return;
    setErr(''); setSaving(true);
    try {
      const { data } = await api.post('/ward-logins', {
        candidate_type: candidateType, position, district_id: district,
        category_name: localBody, ward_id: ward, booths,
      });
      if (data.success) navigate('/ward-logins');
      else setErr(data.message || 'Create failed.');
    } catch (e) {
      setErr(e.response?.data?.message || 'Create failed.');
    } finally { setSaving(false); }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>Create New Ward Login</h1>
        <Link to="/ward-logins" className="btn-link">← Back to List</Link>
      </div>

      {/* Stepper */}
      <div className="stepper">
        <div className={`step ${step === 1 ? 'active' : 'done'}`}>
          <span className="step-num">{step > 1 ? '✓' : '1'}</span> Location Details
        </div>
        <div className={`step ${step === 2 ? 'active' : ''}`}>
          <span className="step-num">2</span> Assign Booths &amp; Submit
        </div>
      </div>

      {err && <div className="alert err">{err}</div>}

      {step === 1 && (
        <div className="card">
          <div className="row">
            <div>
              <label>Body Type *</label>
              <select value={candidateType} onChange={(e) => onBodyType(e.target.value)}>
                <option value="">-- Select Body Type --</option>
                <option value="urban">Urban</option>
                <option value="rural">Rural</option>
              </select>
            </div>
            <div>
              <label>Position you are contesting *</label>
              <select value={position} onChange={(e) => onPosition(e.target.value)} disabled={!candidateType}>
                <option value="">-- Select Position --</option>
                {positions.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          {position && (
            <div className="row">
              <div>
                <label>District *</label>
                <select value={district} onChange={(e) => onDistrict(e.target.value)}>
                  <option value="">-- Select District --</option>
                  {districts.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label>{position} Name *</label>
                <select value={localBody} onChange={(e) => onLocalBody(e.target.value)} disabled={!district}>
                  <option value="">-- Select Local Body --</option>
                  {localBodies.map((lb) => <option key={lb.name} value={lb.name}>{lb.name}</option>)}
                </select>
              </div>
              <div>
                <label>Ward Number *</label>
                <select value={ward} onChange={(e) => { setWard(e.target.value); setExistsAlert(false); }} disabled={!localBody}>
                  <option value="">-- Select Ward --</option>
                  {Array.from({ length: wardCount }, (_, i) => i + 1).map((n) => <option key={n} value={n}>Ward {n}</option>)}
                </select>
              </div>
            </div>
          )}

          {existsAlert && (
            <div className="alert err" style={{ marginTop: 12 }}>
              This Ward Login combination already exists! Please select a different ward.
            </div>
          )}

          <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Link to="/ward-logins" className="btn secondary" style={{ textDecoration: 'none' }}>Cancel</Link>
            <button onClick={goToStep2} disabled={checking}>{checking ? 'Verifying…' : 'Continue to Step 2 →'}</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <>
          <div className="card">
            <div className="muted" style={{ marginBottom: 10 }}>
              <strong>{district} — {localBody} — Ward {ward}</strong> · {position} · {candidateType}
            </div>
            <h3 style={{ marginTop: 0 }}>Assign Booths via EPIC Search</h3>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <label>Enter EPIC Number</label>
                <input value={epic} onChange={(e) => setEpic(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') searchEpic(); }}
                  placeholder="e.g. ALF2230738" style={{ width: '100%' }} />
              </div>
              <button onClick={searchEpic} disabled={searching}>{searching ? 'Searching…' : 'Search EPIC'}</button>
            </div>
            {boothErr && <div className="alert err" style={{ marginTop: 10 }}>{boothErr}</div>}

            {found && (
              <div className="epic-result">
                <div className="epic-col">
                  <h4>Detected Booth</h4>
                  <p>
                    <strong>Assembly No:</strong> {found.voter.ASSEMBLY_NO}<br />
                    <strong>Assembly Name:</strong> {found.assembly_name || found.voter.AC_NAME || `AC ${found.voter.ASSEMBLY_NO}`}<br />
                    <strong>Booth / Part No:</strong> {found.voter.PART_NO}<br />
                    <strong>Booth Name:</strong> <span style={{ color: '#1565c0', fontWeight: 600 }}>{found.voter.BOOTH_NAME || `Booth ${found.voter.PART_NO}`}</span>
                  </p>
                  <button className="success" onClick={addBooth}>+ Add Booth to Ward</button>
                </div>
                <div className="epic-col">
                  <h4>Voter Information</h4>
                  <p>
                    <strong>Name:</strong> {found.voter.VOTER_NAME_EN} / {found.voter.VOTER_NAME || ''}<br />
                    <strong>Relation:</strong> {(found.voter.RELATION_TYPE || 'Relation')}: {found.voter.RELATION_NAME_EN || ''} / {found.voter.RELATION_NAME || ''}<br />
                    <strong>Age / Gender:</strong> {found.voter.AGE} / {found.voter.GENDER}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Assigned Booths List</h3>
            <table>
              <thead><tr><th>Assembly No</th><th>Assembly Name</th><th>Part / Booth No</th><th>Booth Name / Address</th><th style={{ textAlign: 'center' }}>Action</th></tr></thead>
              <tbody>
                {booths.map((b, i) => (
                  <tr key={`${b.assembly_no}-${b.part_no}-${i}`}>
                    <td>{b.assembly_no}</td>
                    <td>{b.assembly_name}</td>
                    <td>{b.part_no}</td>
                    <td><strong>{b.booth_name}</strong></td>
                    <td style={{ textAlign: 'center' }}><button className="danger" onClick={() => removeBooth(i)}>Delete</button></td>
                  </tr>
                ))}
                {!booths.length && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 14 }}>No booths assigned yet. Use the EPIC search above to locate and add booths.</td></tr>}
              </tbody>
            </table>

            <div style={{ marginTop: 18, display: 'flex', justifyContent: 'space-between' }}>
              <button className="secondary" onClick={() => setStep(1)}>← Back to Step 1</button>
              <button className="success" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save and Create Ward Login'}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
