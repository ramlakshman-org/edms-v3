// Local mock data for building the new admin without touching the server.
// Shapes copied from the live API (read 2026-10-11); counts and distributions
// match the live data on that date. All PEOPLE are fictional: names, mobiles,
// passcodes and UTRs are generated. Deterministic (seeded) so screens are stable.

let seed = 20261011;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const expand = (counts) => Object.entries(counts).flatMap(([k, n]) => Array(n).fill(k));
const pad = (n, w = 2) => String(n).padStart(w, '0');

export const VOTER_TOTALS = { totalVoters: 56660540, maleVoters: 27606081, femaleVoters: 28828651, otherVoters: 225808 };

/* ---------- Registrations (tbl_enquiry): 80 rows, live distributions ---------- */
const DISTRICTS = { Ariyalur: 1, Chengalpattu: 2, Chennai: 2, Coimbatore: 4, Cuddalore: 2, Dharmapuri: 2, Dindigul: 4, Erode: 1, Kallakurichi: 2, Kanyakumari: 1, Karur: 1, Krishnagiri: 7, Mayiladuthurai: 3, Namakkal: 1, Perambalur: 1, Pudukkottai: 2, Ramanathapuram: 3, Ranipet: 1, Salem: 5, Sivaganga: 3, Thanjavur: 3, Theni: 2, Thoothukudi: 5, Tiruchirappalli: 4, Tirunelveli: 2, Tirupathur: 3, Tiruppur: 4, Tiruvallur: 2, Vellore: 2, Viluppuram: 1, Virudhunagar: 4 };
const RURAL = { 'Village Panchayat President': 26, 'Village Panchayat Ward Member': 10, 'Panchayat Union Ward Member': 11, 'District Panchayat Ward Member': 4 };
const URBAN = { Corporation: 11, Municipality: 9, 'Town Panchayat': 8, Councillor: 1 };

// created_at: Jul 3, Aug 65, Sep 1 (16th), Oct 11 on the live days
function dates() {
  const out = [];
  for (let i = 0; i < 3; i++) out.push(`2026-07-${pad(24 + i * 2)}`);
  for (let i = 0; i < 65; i++) out.push(`2026-08-${pad(1 + Math.floor((i / 65) * 31))}`);
  out.push('2026-09-16');
  for (const [d, n] of [['02', 1], ['03', 3], ['04', 1], ['05', 3], ['08', 1], ['09', 1], ['10', 1]]) for (let i = 0; i < n; i++) out.push(`2026-10-${d}`);
  return out.map((d) => `${d}T${pad(8 + Math.floor(rnd() * 13))}:${pad(Math.floor(rnd() * 60))}:00.000Z`);
}

const FIRST = ['Murugan', 'Selvi', 'Arun', 'Kavitha', 'Senthil', 'Priya', 'Karthik', 'Lakshmi', 'Rajesh', 'Meena', 'Vignesh', 'Deepa', 'Saravanan', 'Revathi', 'Prakash', 'Anitha', 'Ganesh', 'Malathi', 'Suresh', 'Divya', 'Bala', 'Jayanthi', 'Kumar', 'Sangeetha', 'Velu', 'Nithya', 'Ramesh', 'Gowri', 'Siva', 'Uma'];
const INIT = ['A', 'K', 'M', 'P', 'R', 'S', 'T', 'V', 'N', 'G'];

export const REGISTRATIONS = (() => {
  const districts = shuffle(expand(DISTRICTS));
  const positions = shuffle([...expand(RURAL).map((p) => [p, 'rural']), ...expand(URBAN).map((p) => [p, 'urban'])]);
  const created = dates();
  const noBooths = new Set(shuffle([...Array(80).keys()]).slice(0, 9)); // 71 of 80 have booths
  const rows = created.map((c, i) => {
    const [position, body] = positions[i];
    const booths = noBooths.has(i) ? [] : Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => 1 + Math.floor(rnd() * 300));
    const name = `${pick(INIT)}. ${pick(FIRST)}`;
    return {
      _id: `mock${pad(i + 1, 4)}`,
      id: null,
      full_name: name,
      mobile: `9${pad(Math.floor(rnd() * 1e9), 9)}`,
      district: districts[i],
      position,
      body_type: i < 2 && body === 'rural' ? 'Rural' : body, // live data has 2 capitalised "Rural"
      local_body: body === 'urban' ? `${districts[i]} ${position === 'Corporation' ? 'Corporation' : 'Municipality'}` : `${districts[i]} Panchayat Union`,
      ward_number: String(1 + Math.floor(rnd() * 40)),
      assembly_id: 1 + Math.floor(rnd() * 234),
      assembly_name: `${districts[i]} (AC)`,
      booths,
      booth_count: booths.length,
      passcode: pad(Math.floor(rnd() * 1e6), 6),
      paid_status: 'No',
      transaction_id: null,
      created_at: c,
      requests: [],
      source: rnd() > 0.35 ? 'whatsapp_bot' : 'web',
      role: pick(['planning', 'confirmed', 'confirmed', 'team', 'functionary']),
      affiliation: rnd() > 0.3 ? 'affiliated' : 'independent',
      party: pick(['DMK', 'AIADMK', 'BJP', 'INC', 'NTK', 'PMK', 'Independent']),
      union_or_municipality: body === 'urban' && position === 'Municipality' ? `${districts[i]} Municipality` : body === 'rural' ? `${districts[i]} Union` : '',
      panchayat_or_corporation: body === 'urban' && position !== 'Municipality' ? `${districts[i]} ${position}` : body === 'rural' ? `${pick(FIRST)}puram` : '',
    };
  });
  rows[5].paid_status = '1'; // live data: one row stores "1" instead of "Yes"
  // As on live, a registration's paid flag is the user account's; Payments → Received lists the paid
  // accounts. Three rows relate to UTR_PAYMENTS: one consistent, one pending, one marked paid with
  // no payment on record (the live gap: new-type candidates are missing from the received list).
  Object.assign(rows[20], { mobile: '9000000005', paid_status: 'Yes', transaction_id: '555566667777' });
  rows[21].mobile = '9000000001';
  rows[22].paid_status = 'Yes';
  rows[12].requests = [{ service_type: 'sms', status: 'Pending', created_at: '2026-10-09T10:00:00.000Z' }];

  rows[rows.length - 1].full_name = 'WACTO Test'; // live data contains test rows
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
})();

/* ---------- Payments ---------- */
export const UTR_PAYMENTS = [
  { _id: 'utr1', utr: '12345522224324', user_name: 'G. Mock', mobile_no: '9000000001', amount: 5900, booth_count: 2, status: 'pending', submitted_at: '2026-08-27T13:24:50.000Z', reviewed_at: null, candidate_type: 'urban', category_name: 'Municipality', district_id: 'Salem', ward_id: '4', user_id: 'u1' },
  { _id: 'utr2', utr: '1234567897', user_name: 'G. Mock Two', mobile_no: '9000000002', amount: 2360, booth_count: 1, status: 'pending', submitted_at: '2026-08-27T13:17:18.000Z', reviewed_at: null, candidate_type: 'rural', category_name: 'Village Panchayat President', district_id: 'Theni', ward_id: '2', user_id: 'u2' },
  { _id: 'utr3', utr: '123456789', user_name: 'J. Mock', mobile_no: '9000000003', amount: 2360, booth_count: 1, status: 'pending', submitted_at: '2026-08-27T12:58:34.000Z', reviewed_at: null, candidate_type: 'rural', category_name: 'Village Panchayat Ward Member', district_id: 'Karur', ward_id: '7', user_id: 'u3' },
  { _id: 'utr4', utr: 'TEST123456', user_name: 'perambalur_w1', mobile_no: '9000000004', amount: 5900, booth_count: 2, status: 'pending', submitted_at: '2026-08-27T12:52:57.000Z', reviewed_at: null, candidate_type: 'urban', category_name: 'Municipality', district_id: 'Perambalur', ward_id: '1', user_id: 'u4' },
  { _id: 'utr5', utr: '412398765432', user_name: 'S. Mock', mobile_no: '9000000005', amount: 5900, booth_count: 3, status: 'approved', submitted_at: '2026-08-20T09:12:00.000Z', reviewed_at: '2026-08-20T11:40:00.000Z', candidate_type: 'rural', category_name: 'Panchayat Union Ward Member', district_id: 'Salem', ward_id: '9', user_id: 'u5' },
];

/* ---------- CRM ---------- */
export const CRM_TEAM_STATS = {
  total: 12, interested: 2, not_interested: 1, pro: 0, registered: 7, calls_today: 0, calls_total: 5,
  status_breakdown: [
    { status: 'interested', count: 2 }, { status: 'not_interested', count: 1 }, { status: 'call_completed', count: 1 },
    { status: 'switch_off', count: 3 }, { status: 'not_answered', count: 2 }, { status: 'will_call_back', count: 0 },
  ],
  calls_last_7_days: ['04', '05', '06', '07', '08', '09', '10'].map((d, i) => ({ day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i], count: 0, date: `2026-10-${d}` })),
};
export const TEAM_STATS = { total_leads: 12, interested: 2, not_interested: 1, first_call_complete: 0, second_call_complete: 0, third_call_complete: 0, switch_off: 3, not_answered: 2, will_call_back: 0, calls_completed: 1, pro_users: 0, total_team_members: 3 };

/* ---------- Voter lookup (fictional) ---------- */
export const EPIC_SAMPLE = {
  EPIC_NO: 'TAU3799648', VOTER_NAME_EN: 'Muruganandham K', VOTER_NAME: 'முருகானந்தம் க', RELATION_TYPE: 'F', RELATION_NAME_EN: 'Karuppiah', RELATION_NAME: 'கருப்பையா',
  AGE: 46, GENDER: 'Male', ASSEMBLY_NO: 19, PART_NO: 24, SECTION_NO: 2, SLNO: 102, MOBILE_NUMBER: '9840100000', HOUSE_NO: '14/2', DISTRICT: 'Chennai',
};

export const ADMIN_USER = { sub: 'admin', name: 'Super', first_name: 'Super', group_id: 1, role: 'Super Admin', home: '/dashboard', mobile: '', mobile_no: '', paid_status: 'Yes', booths: [], assembly_id: null, booth_id: null, ward_id: null, district_id: '', category_name: '', candidate_type: '', assembly_name: '' };
