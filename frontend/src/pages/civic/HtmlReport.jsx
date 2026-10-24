import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ExternalLink, Download, FileText, Landmark, CircleAlert, Info } from 'lucide-react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Segmented, Skeleton } from '../../civic/kit.jsx';
import { Select, Alert } from '../../civic/ui.jsx';

// Candidate Briefing / Field Operations: pre-built Assembly_Reports HTML shown in-page,
// Civic Ops design. Same API as before: GET /reports/documents[?assemblyId] → documents[{key,label,url,exists}].
// Admins choose the assembly (?ac=, kept when switching between the two documents);
// MLAs get their own assembly. Reloads whenever the document or assembly changes
// (the old page kept showing the previous document after switching in-app).
const DOCS = [
  { id: 'candidate-briefing', label: 'Candidate briefing', path: '/candidate-briefing' },
  { id: 'field-operations', label: 'Field operations', path: '/field-operations' },
];

export default function HtmlReport({ docKey, title }) {
  const { user } = useAuth();
  const group = Number(user?.group_id || user?.user_group_id || 0);
  const isAdmin = group === 1;
  const isCandidate = [4, 6, 11].includes(group); // Round 1 (2026-10-14): candidates read the assembly documents too
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const ac = isAdmin ? params.get('ac') || '' : 'mine';
  const [assemblies, setAssemblies] = useState([]);
  const [state, setState] = useState({ loading: false, doc: null, where: '', err: '' });

  useEffect(() => { api.get('/assemblies').then(({ data }) => setAssemblies(data.assemblies || [])).catch(() => {}); }, []);
  useEffect(() => {
    if (!ac) { setState({ loading: false, doc: null, where: '', err: '' }); return undefined; }
    let alive = true;
    setState({ loading: true, doc: null, where: '', err: '' });
    api.get('/reports/documents', { params: isAdmin ? { assemblyId: ac } : {} })
      .then(({ data }) => {
        if (!alive) return;
        const doc = (data.documents || []).find((d) => d.key === docKey);
        const where = data.assemblyNo ? String(data.assemblyNo) : ''; // the API returns the number only
        if (!doc) setState({ loading: false, doc: null, where, err: 'This document is not available for this assembly.' });
        else if (!doc.exists) setState({ loading: false, doc: null, where, err: 'This document has not been generated for this assembly yet.' });
        else setState({ loading: false, doc, where, err: '' });
      })
      .catch((e) => alive && setState({ loading: false, doc: null, where: '', err: e.response?.data?.message || 'Could not load the document.' }));
    return () => { alive = false; };
  }, [ac, docKey, isAdmin]);

  const acNo = state.where || (isAdmin ? ac : '');
  const assembly = assemblies.find((a) => String(a.assembly_no) === String(acNo));
  const name = assembly?.assembly_name || (!isAdmin ? user?.assembly_name || '' : ''); // MLAs only ever get their own assembly
  const where = acNo ? `${acNo}${name ? ` — ${name}` : ''}` : '';
  const { doc } = state;

  return (
    <div className="cv-page">
      <PageHeader
        title={title}
        subtitle={where ? `${where} · pre-built assembly document` : 'Pre-built document for each assembly'}
        actions={<>
          <Segmented options={DOCS} value={docKey} onChange={(id) => navigate(`${DOCS.find((d) => d.id === id).path}${isAdmin && ac ? `?ac=${ac}` : ''}`)} />
          {isAdmin && (
            <Select value={ac} onChange={(e) => setParams(e.target.value ? { ac: e.target.value } : {})} aria-label="Assembly" className="cv-filters-assembly">
              <option value="">Select assembly</option>
              {assemblies.map((a) => <option key={a.assembly_no} value={a.assembly_no}>{a.assembly_no} — {a.assembly_name}</option>)}
            </Select>
          )}
        </>}
      />

      {isCandidate && <Alert tone="info"><Info size={16} /> Prepared for the 2026 Assembly election, for the whole assembly — the bigger picture your ward sits in.</Alert>}

      {!ac ? (
        <Card><div className="cv-table-empty"><Landmark size={20} /> Choose an assembly to open its {title.toLowerCase()}.</div></Card>
      ) : state.loading ? (
        <Card flush><Skeleton h={480} /></Card>
      ) : state.err ? (
        <Card><div className="cv-table-empty"><CircleAlert size={20} /> {state.err}</div></Card>
      ) : doc ? (
        <>
          <div className="cv-doc-bar">
            <span className="cv-doc-icon"><FileText size={16} /></span>
            <strong>{doc.label || title}</strong>
            <span className="cv-row-actions" style={{ marginLeft: 'auto' }}>
              <a className="cv-btn cv-btn--ghost cv-btn--sm" href={doc.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open full page</a>
              <a className="cv-btn cv-btn--ghost cv-btn--sm" href={doc.url} download><Download size={13} /> Download</a>
            </span>
          </div>
          <Card flush><iframe key={doc.url} title={title} src={doc.url} className="cv-doc-frame cv-doc-frame--tall" /></Card>
        </>
      ) : <Alert tone="info">Nothing to show.</Alert>}
    </div>
  );
}
