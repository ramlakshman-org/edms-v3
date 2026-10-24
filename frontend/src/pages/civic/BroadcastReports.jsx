import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Megaphone, RefreshCw, CircleAlert } from 'lucide-react';
import api from '../../api/client.js';
import { PageHeader, Card, Pill, inr } from '../../civic/kit.jsx';
import { DataTable, Button, Alert, fmtDateTime } from '../../civic/ui.jsx';

// Broadcast reports (Civic Ops step 10): GET /messaging/reports?type=Text|Audio|WhatsApp
const TYPES = [['Text', 'SMS'], ['Audio', 'Audio calls'], ['WhatsApp', 'WhatsApp']];

export default function BroadcastReports() {
  const [type, setType] = useState('Text');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = (t = type) => {
    setLoading(true); setErr('');
    api.get('/messaging/reports', { params: { type: t } }).then(({ data }) => setRows(data.rows || [])).catch((e) => setErr(e.response?.data?.message || 'Could not load reports.')).finally(() => setLoading(false));
  };
  useEffect(() => { load(type); }, [type]);

  const columns = [
    { key: 'created_at', label: 'Sent', render: (r) => fmtDateTime(r.created_at) },
    { key: 'message', label: 'Message', primary: true, render: (r) => <span style={{ whiteSpace: 'normal' }}>{r.message || '—'}</span> },
    { key: 'sender_id', label: 'Sender / to', render: (r) => <span className="cv-mono-sm">{r.sender_id || r.to || '—'}</span> },
    { key: 'total_number', label: 'Numbers', align: 'right', render: (r) => <strong>{r.total_number != null ? inr(r.total_number) : '—'}</strong> },
    { key: 'status', label: 'Status', render: (r) => (r.status ? <Pill tone={/fail|error/i.test(r.status) ? 'bad' : /pending|queue/i.test(r.status) ? 'warn' : 'ok'} dot>{r.status}</Pill> : <Pill tone="neutral">Sent</Pill>) },
  ];

  return (
    <div className="cv-page">
      <PageHeader title="Broadcast reports" subtitle="What went out, to how many numbers, and when" actions={<><Link className="cv-btn cv-btn--ghost" to="/broadcast"><Megaphone size={15} /> New request</Link><Button variant="ghost" icon={RefreshCw} onClick={() => load()} disabled={loading}>Refresh</Button></>} />
      {err && <Alert tone="bad"><CircleAlert size={16} /> {err}</Alert>}
      <Card flush>
        <div className="cv-tabs-row"><div className="cv-tabs" role="tablist">{TYPES.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={type === id} className={`cv-tab ${type === id ? 'cv-tab--on' : ''}`} onClick={() => setType(id)}>{label}</button>)}</div></div>
        <DataTable columns={columns} rows={rows} rowKey={(r, i) => r._id || i} loading={loading} empty="Nothing sent yet for this channel. Requests you submit appear here after our team sends them." />
      </Card>
    </div>
  );
}
