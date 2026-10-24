import { filterVoters, filterVotersMultiAssembly, getVoter, getVoterGlobal, getVoterScoped, voterExportCursor, updateVoterMobile } from '../models/voterModel.js';
import { findById, findWardMainAdmin } from '../models/userModel.js';
import { ROLES } from '../constants/roles.js';
import { isPaid, paidFlag, PAID_VALUES } from '../utils/paid.js';

// Determines the voter-data scope for the logged-in user:
async function resolveScope(req) {
  const u = req.user || {};
  const g = Number(u.group_id || 0);

  if (g === ROLES.SUPER_ADMIN || g === ROLES.MP || g === ROLES.TELECALLER || g === ROLES.DSA || !g) {
    return { forced: false, assemblyId: req.query.assemblyId || req.body?.assemblyId || '' };
  }

  let rec = null;
  if (u.sub && u.sub !== 'admin') {
    try { rec = await findById(u.sub); } catch { /* offline */ }
  }

  const defaultAssemblyId = rec?.assembly_id ?? u.assembly_id ?? '';

  if (g === ROLES.BOOTH || g === ROLES.BOOTH_ALT) {
    let userBooths = Array.isArray(rec?.booths) && rec.booths.length > 0
      ? rec.booths
      : (Array.isArray(u.booths) && u.booths.length > 0 ? u.booths : []);

    if (!userBooths.length && (rec?.mobile_no || u.mobile_no || u.username)) {
      try {
        const db = getAppDb();
        const mob = (rec?.mobile_no || u.mobile_no || u.username || '').toString().replace(/\D/g, '');
        if (mob) {
          const enq = await db.collection('tbl_enquiry').findOne({ mobile: mob });
          if (enq && Array.isArray(enq.booths) && enq.booths.length > 0) {
            userBooths = enq.booths;
          }
        }
      } catch { /* ignore */ }
    }

    if (userBooths.length > 0) {
      const scopeMap = {};
      for (const b of userBooths) {
        let acNo = defaultAssemblyId;
        let partNo = null;

        if (typeof b === 'object' && b !== null) {
          acNo = b.assembly_no || acNo;
          partNo = parseInt(b.part_no, 10);
        } else if (b != null && b !== '') {
          partNo = parseInt(b, 10);
        }

        if (!acNo || Number.isNaN(partNo)) continue;

        if (!scopeMap[acNo]) {
          scopeMap[acNo] = [];
        }
        if (!scopeMap[acNo].includes(partNo)) {
          scopeMap[acNo].push(partNo);
        }
      }

      if (req.query.boothId) {
        const reqPart = parseInt(req.query.boothId, 10);
        if (!Number.isNaN(reqPart)) {
          const filteredMap = {};
          for (const [ac, parts] of Object.entries(scopeMap)) {
            if (parts.includes(reqPart)) {
              filteredMap[ac] = [reqPart];
            }
          }
          if (Object.keys(filteredMap).length > 0) {
            return { forced: true, isMultiAssembly: true, scopeMap: filteredMap, assemblyId: defaultAssemblyId, userBooths };
          }
        }
      }

      if (Object.keys(scopeMap).length > 0) {
        return { forced: true, isMultiAssembly: true, scopeMap, assemblyId: defaultAssemblyId, userBooths };
      }
    }

    if (req.query.boothId) {
      return { forced: true, assemblyId: defaultAssemblyId, boothId: req.query.boothId, userBooths: [] };
    }
    return { forced: true, assemblyId: defaultAssemblyId, boothId: rec?.booth_id ?? u.booth_id ?? '', userBooths: [] };
  }

  if (g === ROLES.WARD) {
    let booths = Array.isArray(rec?.booths) ? rec.booths : [];

    if (rec?.is_user_login) {
      try {
        const main = await findWardMainAdmin({
          district_id: rec.district_id,
          category_name: rec.category_name,
          ward_id: rec.ward_id,
          candidate_type: rec.candidate_type,
          position: rec.position,
        });
        if (main) {
          booths = Array.isArray(main.booths) ? main.booths : booths;
        }
      } catch { /* ignore */ }
    }

    const scopeMap = {};
    for (const b of booths) {
      let acNo = defaultAssemblyId;
      let partNo = null;

      if (typeof b === 'object' && b !== null) {
        acNo = b.assembly_no || acNo;
        partNo = parseInt(b.part_no, 10);
      } else if (b != null && b !== '') {
        partNo = parseInt(b, 10);
      }

      if (!acNo || Number.isNaN(partNo)) continue;

      if (!scopeMap[acNo]) {
        scopeMap[acNo] = [];
      }
      if (!scopeMap[acNo].includes(partNo)) {
        scopeMap[acNo].push(partNo);
      }
    }

    return { forced: true, isMultiAssembly: true, scopeMap };
  }

  return { forced: true, assemblyId: defaultAssemblyId };
}

// Non-PRO registered users see a limited, masked view of the voter list.
const FREE_PAGES = 2;

// Is the logged-in user "PRO" (full access)? Privileged internal roles always
// are; scoped/registered users are PRO only once they've paid (paid_status Yes).
async function isProUser(req) {
  const u = req.user || {};
  const g = Number(u.group_id || 0);
  if (!g || [ROLES.SUPER_ADMIN, ROLES.MP, ROLES.TELECALLER, ROLES.DSA].includes(g)) return true;
  if (!u.sub || u.sub === 'admin') return true;
  try {
    const rec = await findById(u.sub);
    if (isPaid(rec?.paid_status)) return true;
    // Ward sub-logins inherit the main candidate's paid status.
    if (g === ROLES.WARD && rec?.is_user_login) {
      const main = await findWardMainAdmin({
        district_id: rec.district_id, category_name: rec.category_name,
        ward_id: rec.ward_id, candidate_type: rec.candidate_type, position: rec.position,
      });
      if (isPaid(main?.paid_status)) return true;
    }
  } catch { /* on DB error, default to locked (safer) */ }
  return false;
}

// Mask a mobile number for the free view, e.g. 8106811285 -> 810*****85.
function maskMobile(m) {
  const d = String(m ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 5) return `${d.slice(0, 1)}****`;
  return `${d.slice(0, 3)}${'*'.repeat(d.length - 5)}${d.slice(-2)}`;
}

// Mask an EPIC for the free view, same shape as mobiles, e.g. YXB1331081 -> YXB*****81.
function maskEpic(e) {
  const s = String(e ?? '').trim();
  if (!s) return '';
  if (s.length <= 5) return `${s.slice(0, 1)}****`;
  return `${s.slice(0, 3)}${'*'.repeat(s.length - 5)}${s.slice(-2)}`;
}

// Page size caps: free users get the fixed 25-row view (a large pageSize would
// otherwise pull the whole assembly into the "free" pages).
const FREE_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 200;

const EXPORT_FIELDS = ['EPIC_NO', 'PART_NO', 'VOTER_NAME_EN', 'VOTER_NAME', 'RELATION_NAME_EN', 'RELATION_NAME', 'MOBILE_NUMBER', 'AGE', 'GENDER', 'SECTION_NAME', 'BOOTH_NAME'];
const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function list(req, res) {
  const scope = await resolveScope(req);
  const pro = await isProUser(req);
  const page = Math.max(1, Math.floor(Number(req.query.page)) || 1);
  const pageSize = Math.min(pro ? MAX_PAGE_SIZE : FREE_PAGE_SIZE, Math.max(1, Math.floor(Number(req.query.pageSize)) || 25));

  const filters = {
    min_age: req.query.min_age, max_age: req.query.max_age,
    boothId: req.query.boothId, gender: req.query.gender,
    has_mobile: req.query.has_mobile, search_text: req.query.search_text,
  };

  try {
    let result;
    let scopeInfo;

    if (scope.isMultiAssembly) {
      result = await filterVotersMultiAssembly(scope.scopeMap, filters, { page, pageSize, mobileFirst: !pro });
      scopeInfo = { forced: true, multiAssembly: true, userBooths: scope.userBooths || [], assemblyId: scope.assemblyId || '' };
    } else {
      if (!scope.assemblyId) {
        return res.status(400).json({ success: false, message: scope.forced ? 'No assembly is assigned to your account.' : 'assemblyId is required.' });
      }
      if (scope.boothId) filters.boothId = scope.boothId;
      if (scope.partNos) filters.partNos = scope.partNos;
      result = await filterVoters(scope.assemblyId, filters, { page, pageSize, mobileFirst: !pro });
      scopeInfo = { assemblyId: scope.assemblyId, boothId: scope.boothId ?? null, forced: scope.forced };
    }

    // Freemium view for non-PRO users: mask mobiles + lock pages beyond FREE_PAGES.
    result.isPro = pro;
    if (!pro) {
      result.freePages = FREE_PAGES;
      result.locked = true;
      if (page > FREE_PAGES) {
        result.rows = []; // locked page — content withheld until upgrade
      } else {
        result.rows = result.rows.map((r) => ({ ...r, MOBILE_NUMBER: maskMobile(r.MOBILE_NUMBER), EPIC_NO: maskEpic(r.EPIC_NO) }));
      }
    }

    return res.json({ success: true, scope: scopeInfo, ...result });
  } catch (e) {
    if (e.message === 'VOTER_DB_OFFLINE') {
      return res.status(503).json({ success: false, message: 'Voter database is currently unavailable.' });
    }
    return res.status(500).json({ success: false, message: e.message });
  }
}

export async function exportCsv(req, res) {
  // Export exposes full mobile numbers — restrict to PRO/paid users.
  if (!(await isProUser(req))) {
    return res.status(403).json({ success: false, message: 'Upgrade to PRO to export voter data.' });
  }
  const scope = await resolveScope(req);
  const assemblyId = scope.assemblyId;
  if (!assemblyId && !scope.isMultiAssembly) return res.status(400).json({ success: false, message: scope.forced ? 'No assembly is assigned to your account.' : 'assemblyId is required.' });
  try {
    const filters = {
      min_age: req.query.min_age, max_age: req.query.max_age, boothId: req.query.boothId,
      gender: req.query.gender, has_mobile: req.query.has_mobile, search_text: req.query.search_text,
    };

    if (scope.isMultiAssembly) {
      const result = await filterVotersMultiAssembly(scope.scopeMap, filters, { page: 1, pageSize: 50000 });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="ward_voters.csv"`);
      res.write(EXPORT_FIELDS.join(',') + '\n');
      for (const doc of result.rows) {
        res.write(EXPORT_FIELDS.map((f) => csvCell(doc[f])).join(',') + '\n');
      }
      return res.end();
    }

    if (scope.boothId) filters.boothId = scope.boothId;
    if (scope.partNos) filters.partNos = scope.partNos;
    const cursor = voterExportCursor(assemblyId, filters, EXPORT_FIELDS);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="voters_ac_${assemblyId}.csv"`);
    res.write(EXPORT_FIELDS.join(',') + '\n');
    for await (const doc of cursor) {
      res.write(EXPORT_FIELDS.map((f) => csvCell(doc[f])).join(',') + '\n');
    }
    res.end();
  } catch (e) {
    if (res.headersSent) return res.end();
    if (e.message === 'VOTER_DB_OFFLINE') {
      return res.status(503).json({ success: false, message: 'Voter database is currently unavailable.' });
    }
    res.status(500).json({ success: false, message: e.message });
  }
}

export async function updateMobile(req, res) {
  const { assemblyId, id, mobile } = req.body || {};
  if (!id) return res.status(400).json({ success: false, message: 'id is required.' });
  try {
    const ok = await updateVoterMobile(assemblyId, id, mobile);
    if (!ok) return res.status(404).json({ success: false, message: 'Voter not found.' });
    res.json({ success: true, message: 'Mobile number updated.' });
  } catch (e) {
    if (e.message === 'VOTER_DB_OFFLINE') {
      return res.status(503).json({ success: false, message: 'Voter database is currently unavailable.' });
    }
    res.status(500).json({ success: false, message: e.message });
  }
}

export async function detail(req, res) {
  const { assemblyId, id } = req.query;
  if (!id) return res.status(400).json({ success: false, message: 'id is required.' });
  try {
    // 2026-10-17 (EDMS-13): a non-admin login sees a voter only inside its own assembly / booths — the same scope as
    // the voter list. Outside it the answer is "Voter not found.", which says nothing about the voter.
    const scope = await resolveScope(req);
    let voter;
    if (!scope.forced) voter = await getVoterGlobal(id, assemblyId);
    else {
      const places = scope.isMultiAssembly
        ? Object.entries(scope.scopeMap || {}).map(([ac, parts]) => ({ ac, parts }))
        : [{ ac: scope.assemblyId, parts: scope.partNos?.length ? scope.partNos : (scope.boothId ? [scope.boothId] : null) }];
      voter = await getVoterScoped(id, places);
    }
    if (!voter) return res.status(404).json({ success: false, message: 'Voter not found.' });
    const pro = await isProUser(req);
    if (!pro && voter.MOBILE_NUMBER) voter.MOBILE_NUMBER = maskMobile(voter.MOBILE_NUMBER);
    if (!pro && voter.EPIC_NO) voter.EPIC_NO = maskEpic(voter.EPIC_NO);
    res.json({ success: true, voter, isPro: pro });
  } catch (e) {
    if (e.message === 'VOTER_DB_OFFLINE') {
      return res.status(503).json({ success: false, message: 'Voter database is currently unavailable.' });
    }
    res.status(500).json({ success: false, message: e.message });
  }
}
