import { getAppDb } from '../config/db.js';
import { calculateWardPricing } from './paymentController.js';
import { isPaid, paidFlag, PAID_VALUES } from '../utils/paid.js';
import { markLeadUnregistered } from '../services/leads.js';
import { forgetPaymentClock } from '../services/reminders.js';
import { toObjectId } from '../utils/objectId.js';
import { escapeRegex } from '../utils/escapeRegex.js';

// Mirrors web\admin\DashboardController@registrations* — candidate registrations
// come from tbl_enquiry; passcode falls back to tbl_user; social broadcast
// requests come from tbl_social_request(s) matched by candidate mobile.

const clean = (m) => String(m || '').replace(/\D/g, '');

// Pull social broadcast requests for a set of cleaned mobiles from both the
// Node collection (tbl_social_request) and any legacy PHP one (tbl_social_requests),
// normalising field names so the frontend has one shape.
async function socialRequestsFor(db, mobiles) {
  const list = [...new Set(mobiles.filter(Boolean))];
  if (!list.length) return {};
  const collections = ['tbl_social_request', 'tbl_social_requests'];
  const out = {};
  for (const name of collections) {
    let docs = [];
    try {
      docs = await db.collection(name)
        .find({ $or: [{ candidate_mobile: { $in: list } }, { ward_username: { $in: list } }] })
        .toArray();
    } catch { docs = []; }
    for (const d of docs) {
      const key = clean(d.candidate_mobile || d.ward_username || '');
      if (!key) continue;
      (out[key] ||= []).push({
        service_type: d.service_type,
        message_content: d.message_content ?? d.message ?? '',
        language: d.language || 'English',
        created_at: d.created_at || null,
        all_voters: d.all_voters ?? (d.booth_no === 'All'),
        booth_no: d.booth_no ?? d.booth ?? null,
        section_no: d.section_no || null,
        media_urls: Array.isArray(d.media_urls) ? d.media_urls : (d.image_url ? [d.image_url] : d.audio_url ? [d.audio_url] : []),
        has_image: !!d.has_image || !!d.image_url,
        has_audio: !!d.has_audio || !!d.audio_url,
        image_url: d.image_url || (Array.isArray(d.media_urls) && d.media_urls[0]) || null,
        audio_url: d.audio_url || (Array.isArray(d.media_urls) && d.media_urls[0]) || null,
      });
    }
  }
  // newest first per mobile
  for (const k of Object.keys(out)) {
    out[k].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  }
  return out;
}

export async function list(req, res) {
  try {
    const db = getAppDb();
    const q = {};
    if (req.query.district) q.district = req.query.district;
    if (req.query.body_type) q.body_type = req.query.body_type;
    if (req.query.ward_number) q.ward_number = req.query.ward_number;
    if (req.query.position) {
      const p = req.query.position;
      const map = {
        Corporation: ['Corporation', 'Corporation Ward Member'],
        Municipality: ['Municipality', 'Municipality Ward Member'],
        'Town Panchayat': ['Town Panchayat', 'Town Panchayat Ward Member'],
      };
      q.position = map[p] ? { $in: map[p] } : p;
    }
    if (req.query.search) {
      const safe = escapeRegex(req.query.search);
      q.$or = [
        { full_name: { $regex: safe, $options: 'i' } },
        { mobile: { $regex: safe, $options: 'i' } },
      ];
    }
    const page = Number(req.query.page || 1);
    const pageSize = Number(req.query.pageSize || 25);
    const coll = db.collection('tbl_enquiry');
    const [docs, total] = await Promise.all([
      coll.find(q).sort({ created_at: -1 }).skip((page - 1) * pageSize).limit(pageSize).toArray(),
      coll.countDocuments(q),
    ]);

    const mobiles = docs.map((d) => clean(d.mobile)).filter(Boolean);

    // Passcode & payment status fallback: look up user logins by mobile in one query.
    const users = mobiles.length
      ? await db.collection('tbl_user').find(
          { mobile_no: { $in: docs.map((d) => d.mobile).filter(Boolean) } },
          { projection: { mobile_no: 1, password_str: 1, paid_status: 1, transaction_id: 1, assembly_id: 1, assembly_name: 1, booths: 1 } },
        ).toArray()
      : [];
    const userByMobile = {};
    for (const u of users) userByMobile[clean(u.mobile_no)] = u;

    const reqByMobile = await socialRequestsFor(db, mobiles);

    res.json({
      success: true, total, page, pageSize,
      rows: docs.map((r) => {
        const cm = clean(r.mobile);
        const uRec = userByMobile[cm];
        const rawBooths = Array.isArray(r.booths) && r.booths.length > 0 ? r.booths : (Array.isArray(r.selected_booths) && r.selected_booths.length > 0 ? r.selected_booths : (Array.isArray(uRec?.booths) ? uRec.booths : []));
        const assId = r.assembly_id || r.assembly_no || uRec?.assembly_id || null;
        const assName = r.assembly_name || r.assembly || uRec?.assembly_name || null;
        return {
          _id: r._id,
          id: r.id ?? null,
          full_name: r.full_name || r.firstname || 'No Name',
          mobile: r.mobile || '-',
          district: r.district || '-',
          position: r.position || '-',
          body_type: r.body_type || '-',
          local_body: r.union_or_municipality || r.panchayat_or_corporation || '-',
          ward_number: r.ward_number || '-',
          assembly_id: assId,
          assembly_name: assName,
          booths: rawBooths,
          booth_count: rawBooths.length || r.booth_count || 0,
          passcode: r.passcode || uRec?.password_str || '-',
          paid_status: paidFlag(uRec?.paid_status),
          transaction_id: uRec?.transaction_id || null,
          created_at: r.created_at || '-',
          // just the service types for the compact icon column
          requests: (reqByMobile[cm] || []).map((x) => x.service_type),
        };
      }),
    });
  } catch (e) {
    if (e.message === 'APP_DB_OFFLINE') return res.status(503).json({ success: false, message: 'App database unavailable.' });
    res.status(500).json({ success: false, message: e.message });
  }
}

// GET /registrations/:id — full registration + its social broadcast requests.
export async function detail(req, res) {
  try {
    const db = getAppDb();
    const coll = db.collection('tbl_enquiry');
    let reg = null;
    const oid = toObjectId(req.params.id);
    if (oid) reg = await coll.findOne({ _id: oid });
    if (!reg && /^\d+$/.test(req.params.id)) reg = await coll.findOne({ id: parseInt(req.params.id, 10) });

    if (!reg) {
      let uDoc = null;
      if (oid) uDoc = await db.collection('tbl_user').findOne({ _id: oid });
      if (!uDoc && /^\d+$/.test(req.params.id)) uDoc = await db.collection('tbl_user').findOne({ id: parseInt(req.params.id, 10) });

      if (uDoc?.mobile_no) {
        reg = await coll.findOne({ mobile: uDoc.mobile_no });
        if (!reg) {
          reg = {
            _id: uDoc._id,
            full_name: [uDoc.first_name, uDoc.last_name].filter(Boolean).join(' ') || uDoc.mobile_no || 'Ward User',
            mobile: uDoc.mobile_no,
            district: uDoc.district_id || '-',
            position: uDoc.candidate_type || 'Ward Member',
            body_type: uDoc.candidate_type ? (['Corporation', 'Municipality', 'Town Panchayat'].includes(uDoc.candidate_type) ? 'urban' : 'rural') : 'urban',
            union_or_municipality: uDoc.category_name || '-',
            panchayat_or_corporation: uDoc.category_name || '-',
            ward_number: uDoc.ward_id || '-',
            created_at: uDoc.created_at || new Date().toISOString(),
          };
        }
      }
    }

    if (!reg) return res.status(404).json({ success: false, message: 'Registration not found.' });

    const reqByMobile = await socialRequestsFor(db, [clean(reg.mobile)]);
    
    // Passcode & Payment lookup
    let passcode = reg.passcode || '';
    let userRec = null;
    let paymentDoc = null;

    if (reg.mobile) {
      userRec = await db.collection('tbl_user').findOne({ mobile_no: reg.mobile });
      if (userRec?.password_str) passcode = userRec.password_str;

      if (isPaid(userRec?.paid_status) || userRec?.transaction_id) {
        // the current transaction first; otherwise the NEWEST row for this candidate (pass 2 on staging found an
        // old ₹3 manual row shown instead of the ₹5,900 one just written)
        paymentDoc = (userRec.transaction_id && await db.collection('tbl_payment').findOne({ payment_id: userRec.transaction_id }))
          || await db.collection('tbl_payment').findOne({ $or: [{ user_id: String(userRec._id) }, { mobile_no: reg.mobile }] }, { sort: { created_at: -1 } });
      }
    }

    res.json({
      success: true,
      registration: {
        ...reg,
        passcode,
        paid_status: paidFlag(userRec?.paid_status),
        transaction_id: userRec?.transaction_id || paymentDoc?.payment_id || null,
        payment: paymentDoc ? {
          payment_id: paymentDoc.payment_id,
          order_id: paymentDoc.order_id,
          amount: Number(paymentDoc.amount) > 100000 ? Number(paymentDoc.amount) / 100 : Number(paymentDoc.amount), // paise only above a lakh (₹5,900 used to show as ₹59)
          status: paymentDoc.status || 'Paid',
          booth_count: paymentDoc.booth_count || (Array.isArray(userRec?.booths) ? userRec.booths.length : 1),
          created_at: paymentDoc.created_at,
        } : (isPaid(userRec?.paid_status) ? {
          payment_id: userRec.transaction_id || 'Captured',
          amount: reg.mobile === '8106811285' ? 1 : 2360,
          status: 'Paid',
        } : null),
      },
      socialRequests: reqByMobile[clean(reg.mobile)] || [],
    });
  } catch (e) {
    if (e.message === 'APP_DB_OFFLINE') return res.status(503).json({ success: false, message: 'App database unavailable.' });
    res.status(500).json({ success: false, message: e.message });
  }
}

// PUT /registrations/:id/assign-booths — admin assigns specific booths to a WhatsApp registrant.
// Writes to both tbl_enquiry.booths and tbl_user.booths so effectiveBooths() finds them.
export async function assignBooths(req, res) {
  try {
    const db = getAppDb();
    const oid = toObjectId(req.params.id);
    const filter = oid ? { _id: oid } : (/^\d+$/.test(req.params.id) ? { id: parseInt(req.params.id, 10) } : null);
    if (!filter) return res.status(400).json({ success: false, message: 'Invalid id.' });

    const enquiry = await db.collection('tbl_enquiry').findOne(filter);
    if (!enquiry) return res.status(404).json({ success: false, message: 'Registration not found.' });

    const incoming = Array.isArray(req.body.booths) ? req.body.booths : [];
    if (!incoming.length) return res.status(422).json({ success: false, message: 'At least one booth is required.' });

    const seen = new Set();
    const booths = [];
    for (const b of incoming) {
      const assembly_no = parseInt(b.assembly_no, 10);
      const part_no = parseInt(b.part_no, 10);
      if (Number.isNaN(assembly_no) || Number.isNaN(part_no)) continue;
      const key = `${assembly_no}_${part_no}`;
      if (seen.has(key)) continue;
      seen.add(key);
      booths.push({
        assembly_no,
        assembly_name: b.assembly_name || `AC ${assembly_no}`,
        part_no,
        booth_name: b.booth_name || `Booth ${part_no}`,
      });
    }
    if (!booths.length) return res.status(422).json({ success: false, message: 'No valid booths provided.' });

    const now = new Date().toISOString();
    await db.collection('tbl_enquiry').updateOne(filter, {
      $set: { booths, booth_count: booths.length, updated_at: now },
    });

    if (enquiry.mobile) {
      const assemblyNo = booths[0].assembly_no;
      const assemblyName = booths[0].assembly_name;
      await db.collection('tbl_user').updateOne(
        { mobile_no: enquiry.mobile },
        { $set: { booths, assembly_id: assemblyNo, assembly_name: assemblyName, updated_at: now } },
      );
    }

    res.json({ success: true, message: `${booths.length} booth(s) assigned successfully.`, booths });
  } catch (e) {
    if (e.message === 'APP_DB_OFFLINE') return res.status(503).json({ success: false, message: 'App database unavailable.' });
    res.status(500).json({ success: false, message: e.message });
  }
}

// PUT /registrations/:id/set-paid — admin manually marks a user as paid or unpaid.
// Always writes to tbl_user. If marking paid, creates a tbl_payment audit record.
export async function setPaid(req, res) {
  try {
    const db = getAppDb();
    const oid = toObjectId(req.params.id);
    const filter = oid ? { _id: oid } : (/^\d+$/.test(req.params.id) ? { id: parseInt(req.params.id, 10) } : null);
    if (!filter) return res.status(400).json({ success: false, message: 'Invalid id.' });

    const enquiry = await db.collection('tbl_enquiry').findOne(filter);
    if (!enquiry) return res.status(404).json({ success: false, message: 'Registration not found.' });
    if (!enquiry.mobile) return res.status(422).json({ success: false, message: 'No mobile on this registration.' });

    const markPaid = req.body.paid_status === 'Yes';
    const note = String(req.body.note || '').trim() || (markPaid ? 'Manual approval' : 'Marked unpaid by admin');
    const now = new Date().toISOString();

    if (markPaid) {
      const userRec = await db.collection('tbl_user').findOne({ mobile_no: enquiry.mobile });
      const boothCount = Array.isArray(userRec?.booths) ? userRec.booths.length : (enquiry.booth_count || 1);
      const manualTxnId = `MANUAL-${Date.now()}`;
      const pricing = calculateWardPricing(boothCount);

      await db.collection('tbl_user').updateOne(
        { mobile_no: enquiry.mobile },
        { $set: { paid_status: 'Yes', transaction_id: manualTxnId, updated_at: now } },
      );
      await db.collection('tbl_payment').insertOne({
        mobile_no: enquiry.mobile,
        payment_id: manualTxnId,
        order_id: null,
        user_id: userRec?._id ? String(userRec._id) : null,
        user_name: [userRec?.first_name, userRec?.last_name].filter(Boolean).join(' ') || enquiry.full_name || '',
        base_amount: pricing.basePrice,
        gst_amount: pricing.gst,
        amount: pricing.totalAmount, // was the booth count — reports read this as rupees
        currency: 'INR',
        status: 'Manual',
        method: 'manual',
        note,
        booth_count: boothCount,
        created_at: now,
      });
      res.json({ success: true, message: 'Marked as paid.', paid_status: 'Yes', transaction_id: manualTxnId });
    } else {
      await db.collection('tbl_user').updateOne(
        { mobile_no: enquiry.mobile },
        { $set: { paid_status: 'No', updated_at: now }, $unset: { transaction_id: '' } },
      );
      res.json({ success: true, message: 'Marked as unpaid.', paid_status: 'No' });
    }
  } catch (e) {
    if (e.message === 'APP_DB_OFFLINE') return res.status(503).json({ success: false, message: 'App database unavailable.' });
    res.status(500).json({ success: false, message: e.message });
  }
}

// DELETE /registrations/:id — remove enquiry from tbl_enquiry (admin testing / cleanup).
export async function remove(req, res) {
  try {
    const db = getAppDb();
    const oid = toObjectId(req.params.id);
    const filter = oid ? { _id: oid } : (/^\d+$/.test(req.params.id) ? { id: parseInt(req.params.id, 10) } : null);
    if (!filter) return res.status(400).json({ success: false, message: 'Invalid id.' });
    // Read mobile before deleting so we can clean up tbl_user too
    const enquiry = await db.collection('tbl_enquiry').findOne(filter);
    if (!enquiry) return res.status(404).json({ success: false, message: 'Registration not found.' });
    await db.collection('tbl_enquiry').deleteOne(filter);
    // Remove tbl_user so the WhatsApp bot treats this number as completely new
    if (enquiry.mobile) await db.collection('tbl_user').deleteOne({ mobile_no: enquiry.mobile });
    // 2026-10-17: the number is incomplete again — back to "To follow up", and its old payment-reminder clock is dropped
    if (enquiry.mobile) { await markLeadUnregistered(db, enquiry.mobile); await forgetPaymentClock(db, enquiry.mobile); }
    res.json({ success: true, message: 'Registration deleted.' });
  } catch (e) {
    if (e.message === 'APP_DB_OFFLINE') return res.status(503).json({ success: false, message: 'App database unavailable.' });
    res.status(500).json({ success: false, message: e.message });
  }
}

// PUT /registrations/:id — update editable candidate fields (mirrors updateRegistration).
export async function update(req, res) {
  try {
    const db = getAppDb();
    const coll = db.collection('tbl_enquiry');
    const oid = toObjectId(req.params.id);
    const filter = oid ? { _id: oid } : (/^\d+$/.test(req.params.id) ? { id: parseInt(req.params.id, 10) } : null);
    if (!filter) return res.status(400).json({ success: false, message: 'Invalid id.' });

    const b = req.body || {};
    const set = {
      firstname: b.full_name || '',
      full_name: b.full_name || '',
      district: b.district || '',
      role: b.role || '',
      affiliation: b.affiliation || '',
      party: b.party || '',
      body_type: b.body_type || '',
      position: b.position || '',
      union_or_municipality: b.union_or_municipality || '',
      panchayat_or_corporation: b.panchayat_or_corporation || '',
      ward_number: b.ward_number || '',
      updated_at: new Date().toISOString(),
    };
    const r = await coll.updateOne(filter, { $set: set });
    if (!r.matchedCount) return res.status(404).json({ success: false, message: 'Registration not found.' });
    res.json({ success: true, message: 'Registration details updated successfully.' });
  } catch (e) {
    if (e.message === 'APP_DB_OFFLINE') return res.status(503).json({ success: false, message: 'App database unavailable.' });
    res.status(500).json({ success: false, message: e.message });
  }
}
