import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquareText, Mic, MessageCircle, Check, CircleAlert, Info, Upload, X, FileText, Send } from 'lucide-react';
import api from '../../api/client.js';
import { PageHeader, Card, Pill } from '../../civic/kit.jsx';
import { Button, Alert, Field, Select, Textarea } from '../../civic/ui.jsx';

// Broadcast request (Civic Ops step 10). Same APIs as the old Social Media page:
// GET /ward/social-media → {isSample, boothList, existingRequests}
// GET /ward/social-media/booth-sections?assembly_no&part_no&is_sample → [sections]
// POST /ward/social-media/request. One open request per service at a time.

const SERVICES = [
  { key: 'sms', title: 'SMS broadcast', desc: 'A short text to every voter phone in the audience', icon: MessageSquareText, max: 70, needs: 'text' },
  { key: 'voice', title: 'Audio call', desc: 'Your recorded appeal, delivered as an automated call', icon: Mic, needs: 'audio' },
  { key: 'whatsapp', title: 'WhatsApp broadcast', desc: 'An image with your message, straight to WhatsApp', icon: MessageCircle, max: 100, needs: 'text+image' },
];
const blank = { all_voters: false, booth: '', section_no: '', language: 'English', message: '' };
const toDataUrl = (file) => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => fail(new Error('Could not read the file.')); r.readAsDataURL(file); });

export default function Broadcast() {
  const [meta, setMeta] = useState({ isSample: false, boothList: [], existingRequests: {} });
  const [service, setService] = useState('');
  const [form, setForm] = useState(blank);
  const [sections, setSections] = useState([]);
  const [file, setFile] = useState(null); // { file, preview }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState('');
  const fileRef = useRef(null);

  const load = () => api.get('/ward/social-media').then(({ data }) => setMeta({ isSample: !!data.isSample, boothList: data.boothList || [], existingRequests: data.existingRequests || {} })).catch((e) => setErr(e.response?.data?.message || 'Could not load your booths.'));
  useEffect(() => { load(); }, []);

  const cfg = SERVICES.find((s) => s.key === service);
  const pick = (key) => { if (meta.existingRequests[key]) return; setService(key); setForm(blank); setSections([]); setFile(null); setErr(''); setFlash(''); };
  const onBooth = async (val) => {
    setForm((f) => ({ ...f, booth: val, section_no: '' })); setSections([]);
    if (!val) return;
    const [assembly_no, part_no] = val.split('_');
    try { const { data } = await api.get('/ward/social-media/booth-sections', { params: { assembly_no, part_no, is_sample: meta.isSample ? 1 : 0 } }); setSections(Array.isArray(data) ? data : []); } catch { setSections([]); }
  };
  const onFile = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    if (cfg?.needs === 'audio' && !/^audio\//.test(f.type)) { setErr('Choose an audio file (mp3, m4a, wav).'); return; }
    if (cfg?.needs !== 'audio' && !/^image\//.test(f.type)) { setErr('Choose an image (JPG or PNG).'); return; }
    if (f.size > 8 * 1024 * 1024) { setErr('File is too large (max 8 MB).'); return; }
    setErr(''); setFile({ file: f, preview: URL.createObjectURL(f) });
  };

  const msgLen = form.message.trim().length;
  const audienceOk = form.all_voters || !!form.booth;
  const valid = cfg && audienceOk && (cfg.key === 'sms' ? msgLen > 0 && msgLen <= 70 : cfg.key === 'voice' ? !!file : msgLen > 0 && msgLen <= 100 && !!file);

  const submit = async () => {
    if (!valid) return;
    setBusy(true); setErr(''); setFlash('');
    try {
      const file_data_url = file ? await toDataUrl(file.file) : '';
      const { data } = await api.post('/ward/social-media/request', {
        service_type: service, all_voters: form.all_voters ? '1' : '', booth: form.all_voters ? '' : form.booth, section_no: form.all_voters ? '' : form.section_no, language: form.language,
        sms_message_content: service === 'sms' ? form.message : '', whatsapp_message_content: service === 'whatsapp' ? form.message : '',
        has_image: service !== 'voice' && !!file, has_audio: service === 'voice' && !!file, file_data_url, file_name: file?.file.name || '',
      });
      if (!data.success) throw new Error(data.message || 'Request failed.');
      setFlash(data.message || 'Request submitted. Our team calls you within 4 hours to confirm audience, message and pricing.');
      setService(''); setFile(null); load();
    } catch (e) { setErr(e.response?.data?.message || e.message); } finally { setBusy(false); }
  };

  const audienceLabel = form.all_voters ? 'All my voters' : form.booth ? `Booth ${form.booth.split('_')[1]}${form.section_no ? ` · section ${form.section_no}` : ''}` : '';

  return (
    <div className="cv-page">
      <PageHeader title="Broadcast request" subtitle="Reach the voters in your booths by SMS, recorded call or WhatsApp. Our team confirms the audience, message and price with you before anything is sent." actions={<Link className="cv-btn cv-btn--ghost" to="/broadcast/reports"><FileText size={15} /> Past broadcasts</Link>} />
      {err && <Alert tone="bad"><CircleAlert size={16} /> {err}</Alert>}
      {flash && <Alert tone="ok"><Check size={16} /> {flash}</Alert>}
      {meta.isSample && <Alert tone="info"><Info size={16} /> Your booths are not assigned yet, so this request would target sample booths. You can still send it; our team maps it to your real booths.</Alert>}

      <div className="cv-services">
        {SERVICES.map((s) => {
          const Icon = s.icon; const done = !!meta.existingRequests[s.key]; const on = service === s.key;
          return (
            <button key={s.key} type="button" className={`cv-service ${on ? 'cv-on' : ''} ${done ? 'cv-service--done' : ''}`} onClick={() => pick(s.key)} disabled={done}>
              <span className="cv-service-icon"><Icon size={20} /></span>
              <span className="cv-service-text"><strong>{s.title}</strong><span>{s.desc}</span></span>
              {done ? <Pill tone="ok" dot>Requested</Pill> : on ? <Pill tone="info">Selected</Pill> : null}
            </button>
          );
        })}
      </div>

      {cfg && (
        <div className="cv-grid-2-1">
          <Card title={cfg.title} meta="Step 1 audience · Step 2 message · Step 3 send">
            <div className="cv-form-grid">
              <Field label="Audience" required>
                <Select value={form.all_voters ? 'all' : 'booth'} onChange={(e) => setForm({ ...form, all_voters: e.target.value === 'all', booth: '', section_no: '' })}>
                  <option value="booth">One booth (optionally one section)</option>
                  <option value="all">All voters in my booths</option>
                </Select>
              </Field>
              <Field label="Language"><Select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}><option>English</option><option>Tamil</option></Select></Field>
              {!form.all_voters && (
                <>
                  <Field label="Booth" required>
                    <Select value={form.booth} onChange={(e) => onBooth(e.target.value)}>
                      <option value="">Choose a booth</option>
                      {meta.boothList.map((b) => <option key={`${b.assembly_no}_${b.part_no}`} value={`${b.assembly_no}_${b.part_no}`}>Booth {b.part_no} · {b.booth_name || b.assembly_name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Section" hint="Leave empty for the whole booth">
                    <Select value={form.section_no} onChange={(e) => setForm({ ...form, section_no: e.target.value })} disabled={!form.booth}>
                      <option value="">All sections</option>
                      {sections.map((s) => <option key={s} value={s}>Section {s}</option>)}
                    </Select>
                  </Field>
                </>
              )}
            </div>
            {cfg.needs !== 'audio' && (
              <Field label={cfg.key === 'sms' ? 'SMS text' : 'WhatsApp message'} required hint={`${msgLen} / ${cfg.max} characters${cfg.key === 'sms' ? ' · one SMS' : ''}`}>
                <Textarea rows={4} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder={cfg.key === 'sms' ? 'Vote for … on polling day. Booth 12, symbol …' : 'Dear voter, …'} />
                {msgLen > cfg.max && <span className="cv-text-bad">Too long — keep it under {cfg.max} characters.</span>}
              </Field>
            )}
            <input ref={fileRef} type="file" accept={cfg.needs === 'audio' ? 'audio/*' : 'image/*'} onChange={onFile} style={{ display: 'none' }} />
            <Field label={cfg.needs === 'audio' ? 'Audio file' : 'Image'} required={cfg.needs !== 'text'} hint={cfg.needs === 'audio' ? 'mp3 / m4a, up to 8 MB, under 60 seconds works best' : cfg.key === 'whatsapp' ? 'JPG or PNG, shown above your message' : 'Optional: a flyer image our team can attach'}>
              {file ? (
                <div className="cv-file-row">
                  {cfg.needs === 'audio' ? <audio controls src={file.preview} /> : <img src={file.preview} alt="" className="cv-shot cv-shot--lg" />}
                  <span className="cv-muted">{file.file.name}</span>
                  <button type="button" className="cv-icon-btn cv-icon-btn--sm" onClick={() => setFile(null)} aria-label="Remove file"><X size={14} /></button>
                </div>
              ) : <Button variant="ghost" icon={Upload} onClick={() => fileRef.current?.click()}>Choose file</Button>}
            </Field>
            <div className="cv-modal-actions">
              <Button variant="ghost" onClick={() => setService('')}>Cancel</Button>
              <Button icon={Send} onClick={submit} disabled={!valid || busy}>{busy ? 'Sending…' : 'Submit request'}</Button>
            </div>
          </Card>
          <div className="cv-stack">
            <Card title="Preview">
              {cfg.key === 'whatsapp' ? (
                <div className="cv-wa"><div className="cv-wa-bubble">{file && <img src={file.preview} alt="" className="cv-wa-img" />}<div className="cv-wa-text">{form.message || 'Your message appears here'}</div></div></div>
              ) : cfg.key === 'sms' ? (
                <div className="cv-sms"><span className="cv-sms-from">EDMS</span><p>{form.message || 'Your SMS appears here'}</p></div>
              ) : (
                <div className="cv-table-empty"><Mic size={20} /> {file ? 'Listen to your recording above.' : 'Upload the recording to preview it.'}</div>
              )}
              <dl className="cv-kv" style={{ marginTop: 12 }}>
                <div><dt>Audience</dt><dd>{audienceLabel || '—'}</dd></div>
                <div><dt>Language</dt><dd>{form.language}</dd></div>
              </dl>
            </Card>
            <Card title="How it works">
              <ol className="cv-steps">
                <li>You submit the request here.</li>
                <li>Our team calls within 4 hours to confirm the audience, the final text and the price.</li>
                <li>Once you approve, it goes out and the report appears under Broadcast reports.</li>
              </ol>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
