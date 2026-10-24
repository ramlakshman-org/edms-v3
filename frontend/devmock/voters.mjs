// Fictional voter roll for local development. Deterministic per assembly so
// paging is stable. Every name, EPIC and mobile here is invented.
import { VOTER_TOTALS } from './data.mjs';

const FIRST_M = ['Murugan', 'Senthil', 'Arun', 'Karthik', 'Rajesh', 'Vignesh', 'Saravanan', 'Prakash', 'Ganesh', 'Suresh', 'Bala', 'Kumar', 'Velu', 'Ramesh', 'Siva', 'Muthu', 'Selvam', 'Ravi', 'Dinesh', 'Mani'];
const FIRST_F = ['Selvi', 'Kavitha', 'Priya', 'Lakshmi', 'Meena', 'Deepa', 'Revathi', 'Anitha', 'Malathi', 'Divya', 'Jayanthi', 'Sangeetha', 'Nithya', 'Gowri', 'Uma', 'Vijaya', 'Chitra', 'Kala', 'Radha', 'Sumathi'];
const TAMIL_M = ['முருகன்', 'செந்தில்', 'அருண்', 'கார்த்திக்', 'ராஜேஷ்', 'விக்னேஷ்', 'சரவணன்', 'பிரகாஷ்', 'கணேஷ்', 'சுரேஷ்', 'பாலா', 'குமார்', 'வேலு', 'ரமேஷ்', 'சிவா', 'முத்து', 'செல்வம்', 'ரவி', 'தினேஷ்', 'மணி'];
const TAMIL_F = ['செல்வி', 'கவிதா', 'பிரியா', 'லட்சுமி', 'மீனா', 'தீபா', 'ரேவதி', 'அனிதா', 'மாலதி', 'திவ்யா', 'ஜெயந்தி', 'சங்கீதா', 'நித்யா', 'கௌரி', 'உமா', 'விஜயா', 'சித்ரா', 'கலா', 'ராதா', 'சுமதி'];
const INITIALS = ['A', 'K', 'M', 'P', 'R', 'S', 'T', 'V', 'N', 'G'];
const STREETS = ['Gandhi Street', 'Bharathiyar Nagar', 'Anna Salai', 'Kamarajar Road', 'Periyar Nagar', 'Nehru Street', 'Thiruvalluvar Nagar', 'Mettu Street'];
const SCHOOLS = ['Panchayat Union Primary School', 'Govt. High School', 'Govt. Hr. Sec. School', 'Panchayat Union Middle School'];
const PREFIX = ['TAU', 'AYR', 'KLP', 'MDU', 'TNV', 'CBE'];

const DISTRICT_OF = (ac) => ['Tiruvallur', 'Chennai', 'Kancheepuram', 'Vellore', 'Krishnagiri', 'Dharmapuri', 'Salem', 'Coimbatore', 'Dindigul', 'Madurai', 'Tirunelveli', 'Thoothukudi'][ac % 12];

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const cache = new Map();
export function votersFor(assemblyNo) {
  const ac = Number(assemblyNo) || 1;
  if (cache.has(ac)) return cache.get(ac);
  const r = rng(ac * 7919 + 17);
  const booths = 40 + Math.floor(r() * 20);
  const rows = [];
  let serial = 1;
  for (let part = 1; part <= booths; part++) {
    const n = 45 + Math.floor(r() * 30);
    // AC 27 booth 5 copies a live-data quirk: a station name stored without spaces (and with a pincode
    // containing "12"), which must wrap on a phone and must not outrank booth 12 in a "12" search.
    const school = ac === 27 && part === 5 ? 'GovtHigherSecondarySchool,4thCrossStreetKamarajarNagarWestBlock,Chennai600012,NorthFaceRoomNo2' : `${SCHOOLS[part % 4]}, ${STREETS[part % 8]}`;
    for (let i = 0; i < n; i++) {
      const female = r() < 0.51;
      const fi = Math.floor(r() * 20);
      const rel = Math.floor(r() * 20);
      const age = 18 + Math.floor(r() * 62);
      const hasMobile = r() < 0.41;
      rows.push({
        _id: `${ac}-${part}-${i + 1}`,
        ID: serial++,
        EPIC_NO: `${PREFIX[(ac + part) % 6]}${String(1000000 + Math.floor(r() * 9000000))}`,
        ASSEMBLY_NO: ac,
        ASSEMBLY_NAME: `Assembly ${ac}`,
        PART_NO: part,
        SLNO: i + 1,
        SECTION_NO: 1 + (i % 4),
        SECTION_NAME: STREETS[(part + i) % 8],
        VOTER_NAME_EN: `${female ? FIRST_F[fi] : FIRST_M[fi]} ${INITIALS[(fi + part) % 10]}`,
        VOTER_NAME: female ? TAMIL_F[fi] : TAMIL_M[fi],
        RELATION_TYPE: female && age > 24 ? 'H' : 'F',
        RELATION_NAME_EN: FIRST_M[rel],
        RELATION_NAME: TAMIL_M[rel],
        AGE: age,
        GENDER: r() < 0.001 ? 'Other' : female ? 'Female' : 'Male',
        MOBILE_NUMBER: hasMobile ? `9${String(Math.floor(r() * 1e9)).padStart(9, '0')}` : '',
        HOUSE_NO: `${1 + Math.floor(r() * 120)}${r() < 0.2 ? '/A' : ''}`,
        BOOTH_NAME: school,
        POLLING_STATION_EN: school,
        POLLING_STATION_TA: `${SCHOOLS[part % 4]} (தமிழ்)`,
        DISTRICT: DISTRICT_OF(ac),
        PINCODE: String(600001 + ((ac * 37 + part) % 900)),
      });
    }
  }
  cache.set(ac, rows);
  return rows;
}

export function filterVoters(rows, f) {
  const q = String(f.search_text || '').trim().toLowerCase();
  return rows.filter((v) => {
    if (f.gender && v.GENDER !== f.gender) return false;
    if (f.has_mobile === '1' && !v.MOBILE_NUMBER) return false;
    if (f.has_mobile === '0' && v.MOBILE_NUMBER) return false;
    if (f.min_age && v.AGE < Number(f.min_age)) return false;
    if (f.max_age && v.AGE > Number(f.max_age)) return false;
    if (f.boothId && Number(v.PART_NO) !== Number(f.boothId)) return false;
    if (q && !(v.EPIC_NO.toLowerCase().includes(q) || v.VOTER_NAME_EN.toLowerCase().includes(q) || v.MOBILE_NUMBER.includes(q))) return false;
    return true;
  });
}

export const ASSEMBLY_LIST = Array.from({ length: 234 }, (_, i) => ({ assembly_no: i + 1, assembly_name: ['Gummidipoondi', 'Ponneri', 'Tiruttani', 'Thiruvallur', 'Poonamallee', 'Avadi', 'Maduravoyal', 'Ambattur', 'Madavaram', 'Thiruvottiyur'][i] || `Assembly ${i + 1}`, district: DISTRICT_OF(i + 1), total_voters: Math.round(VOTER_TOTALS.totalVoters / 234) }));
