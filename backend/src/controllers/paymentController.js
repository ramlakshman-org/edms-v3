import crypto from 'crypto';
import { getAppDb } from '../config/db.js';
import { findById, updateUser } from '../models/userModel.js';
import { isPaid, paidFlag, PAID_VALUES } from '../utils/paid.js';
import { getPaymentSettings, savePaymentSettings, priceFor } from '../services/paymentSettings.js';
import { recordProof, storeScreenshot, PROOF_COLL, proofApprovedMessage, proofRejectedMessage } from '../services/paymentProof.js';
import { markCrmLeadStatus } from '../services/leads.js';
import { loadBotContent } from '../services/botContent.js';
import { sendWactoText, wactoConfigured } from '../services/wactoService.js';
import * as cloudinary from '../services/cloudinaryService.js';

const RAZORPAY_KEY = process.env.RAZORPAY_KEY;
const RAZORPAY_SECRET = process.env.RAZORPAY_SECRET;

// Timeout wrapper for outbound Razorpay calls (avoids hung workers on outages).
const _fetch = globalThis.fetch;
const fetch = (url, opts = {}) => _fetch(url, { signal: AbortSignal.timeout(15000), ...opts });

// Calculate Ward subscription pricing based on booth count:
//   - 1 Booth:      2,000 + 18% GST (360)   = 2,360
//   - 2–5 Booths:   5,000 + 18% GST (900)   = 5,900
//   - 6–10 Booths: 10,000 + 18% GST (1,800) = 11,800
//   - 11–25 Booths: 25,000 + 18% GST (4,500) = 29,500
//   - 26–100 Booths: 50,000 + 18% GST (9,000) = 59,000
export function calculateWardPricing(boothCount = 1, mobile = '') {
  const count = Math.max(1, parseInt(boothCount, 10) || 1);

  let basePrice = 2000;
  let tierLabel = '1 Booth Tier';

  if (count > 25) {
    basePrice = 50000;
    tierLabel = '26 to 100 Booths Tier';
  } else if (count > 10) {
    basePrice = 25000;
    tierLabel = '11 to 25 Booths Tier';
  } else if (count > 5) {
    basePrice = 10000;
    tierLabel = '6 to 10 Booths Tier';
  } else if (count > 1) {
    basePrice = 5000;
    tierLabel = '2 to 5 Booths Tier';
  }

  const gst = Math.round(basePrice * 0.18);
  const totalAmount = basePrice + gst;
  const amountPaise = totalAmount * 100;

  return {
    boothCount: count,
    basePrice,
    gst,
    gstRate: '18%',
    totalAmount,
    amountPaise,
    tierLabel,
  };
}

// GET /payments/ward-pricing?boothCount=N — returns calculated pricing tier details
export async function getWardPricingApi(req, res) {
  const count = Number(req.query.boothCount || 1);
  // Pass logged-in user mobile for test override
  const mobile = req.user?.mobile || req.user?.username || '';
  const pricing = calculateWardPricing(count, mobile);
  res.json({ success: true, pricing, razorpay_key: RAZORPAY_KEY });
}

// GET /payments/check-paid — returns whether the current user has paid and transaction details
export async function checkPaid(req, res) {
  try {
    const userId = req.user?.sub;
    if (!userId || userId === 'admin') {
      return res.json({ success: true, paid: false });
    }
    const userRec = await findById(userId);
    if (!userRec) return res.json({ success: true, paid: false });

    if (isPaid(userRec.paid_status)) {
      const db = getAppDb();
      const payment = userRec.transaction_id
        ? await db.collection('tbl_payment').findOne({ payment_id: userRec.transaction_id })
        : null;
      const mobileNum = req.user?.mobile || '';
      const pricing = calculateWardPricing(1, mobileNum);
      return res.json({
        success: true,
        paid: true,
        transaction_id: userRec.transaction_id || null,
        amount: payment ? (Number(payment.amount) > 1000 ? Number(payment.amount) / 100 : Number(payment.amount)) : pricing.totalAmount,
      });
    }

    // Not paid yet — is a proof waiting for verification?
    const pending = await getAppDb().collection(PROOF_COLL).findOne(
      { status: 'pending', $or: [{ user_id: String(userRec._id) }, { mobile_no: String(userRec.mobile_no || '') }] },
    );
    res.json({ success: true, paid: false, pending: !!pending, pending_since: pending?.submitted_at || null, pending_has_screenshot: !!pending?.screenshot_url });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
}


// GET /payments/subscriptions — paid candidates: MLA (3), ward (6) and booth-plan (11) logins
// dates come as ISO strings from the Node code and as Date objects from older/bot-written records
const dayOf = (d) => { if (!d) return null; const s = d instanceof Date ? d.toISOString() : String(d); return s.split('T')[0]; };

export async function subscriptions(req, res) {
  try {
    const db = getAppDb();
    // Pagination with a hard ceiling to avoid loading the whole collection.
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 100);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

    const users = await db.collection('tbl_user')
      // Ram, 2026-10-14 (C11): booth-plan candidates (group 11) were left out, so an approved payment never
      // showed as received and revenue stayed ₹0. Group 4 stays out: 30k generated booth logins all flagged paid.
      .find({ paid_status: { $in: PAID_VALUES }, user_group_id: { $in: [3, 6, 11] } })
      .sort({ updated_at: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray();

    // Only fetch the payment records for the users on this page.
    const userIds = users.map((u) => String(u._id));
    const txnIds = users.map((u) => String(u.transaction_id)).filter(Boolean);
    const mobiles = users.map((u) => u.mobile_no).filter(Boolean);
    const digits = (m) => String(m || '').replace(/\D/g, '').slice(-10);
    const mobileKeys = mobiles.map(digits).filter(Boolean);
    // Ram, 2026-10-14 (C11): a payment's user_id can point at a record that no longer exists (a candidate who
    // re-registered), so the ledger and the approved proof are also matched by mobile number.
    const [assemblies, payments, proofs] = await Promise.all([
      db.collection('tbl_assembly_consitituency').find({}).toArray(),
      db.collection('tbl_payment').find({ $or: [{ user_id: { $in: userIds } }, { payment_id: { $in: txnIds } }, { mobile_no: { $in: [...mobiles, ...mobileKeys] } }] }).toArray(),
      db.collection(PROOF_COLL).find({ status: 'approved', $or: [{ user_id: { $in: userIds } }, { mobile_no: { $in: [...mobiles, ...mobileKeys] } }] }).toArray(),
    ]);

    const enquiries = mobiles.length
      ? await db.collection('tbl_enquiry').find({ mobile: { $in: mobiles } }).toArray()
      : [];
    const enqByMobile = Object.fromEntries(enquiries.map((e) => [String(e.mobile).replace(/\D/g, ''), e]));

    const asmById = Object.fromEntries(assemblies.map((a) => [String(a.assembly_no), a]));
    const payByTxn = Object.fromEntries(payments.map((p) => [String(p.payment_id), p]));
    const payByUser = Object.fromEntries(payments.map((p) => [String(p.user_id), p]));
    const payByMobile = Object.fromEntries(payments.filter((p) => digits(p.mobile_no)).map((p) => [digits(p.mobile_no), p]));
    const proofByUser = Object.fromEntries(proofs.map((p) => [String(p.user_id), p]));
    const proofByMobile = Object.fromEntries(proofs.filter((p) => digits(p.mobile_no)).map((p) => [digits(p.mobile_no), p]));
    const TIER_TOTALS = [1, 2, 6, 11, 26].map((n) => calculateWardPricing(n).totalAmount);

    const rows = users.map((u) => {
      const isWard = Number(u.user_group_id) === 6;
      const isBooth = Number(u.user_group_id) === 11;
      const a = asmById[String(u.assembly_id)];
      const mob = digits(u.mobile_no);
      const p = payByTxn[String(u.transaction_id)] || payByUser[String(u._id)] || payByMobile[mob];
      const proof = proofByUser[String(u._id)] || proofByMobile[mob];
      const boothCount = p?.booth_count || proof?.booth_count || (Array.isArray(u.booths) ? u.booths.length : 1);

      let assemblyName = a?.assembly_name || '-';
      let district = a?.district || u.district_id || '-';

      if (isWard) {
        assemblyName = [u.candidate_type, u.category_name, u.ward_id ? `Ward ${u.ward_id}` : null].filter(Boolean).join(' - ') || 'Ward Login';
        district = u.district_id || a?.district || '-';
      }

      // amount: the ledger (paise→rupees for old Razorpay rows; a booth COUNT written as the amount by the old
      // manual mark-paid is not a price), else the approved proof, else the booth tier (group 3: the MLA plan)
      const ledgerAmount = p ? Number(p.amount) : NaN;
      const ledgerRupees = ledgerAmount > 100000 ? ledgerAmount / 100 // old Razorpay rows are in paise (no plan costs a lakh)
        : ledgerAmount >= 100 ? ledgerAmount // rupees
        : NaN; // under ₹100 is the booth COUNT the old manual mark-paid wrote, not a price
      const rawAmount = ledgerRupees || (Number(proof?.amount) > 0 ? Number(proof.amount) : 0)
        || (isWard || isBooth ? calculateWardPricing(boothCount).totalAmount : 25000);

      const cleanMob = String(u.mobile_no || '').replace(/\D/g, '');
      const enq = enqByMobile[cleanMob];
      const targetId = enq ? String(enq._id) : String(u._id);

      let localBodyType = u.candidate_type || enq?.position || (enq?.body_type ? (enq.body_type.charAt(0).toUpperCase() + enq.body_type.slice(1)) : null) || (isWard ? 'Urban' : 'Assembly');

      return {
        _id: targetId,
        user_id: u._id,
        name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.mobile_no || 'User',
        mobile_no: u.mobile_no,
        email: u.email || '-',
        user_group_id: u.user_group_id,
        role_label: isBooth ? 'Candidate' : isWard ? 'Ward User' : 'MLA',
        local_body_type: localBodyType,
        assembly_id: u.assembly_id || '-',
        assembly_name: assemblyName,
        district,
        booth_count: boothCount,
        transaction_id: u.transaction_id || p?.payment_id || proof?.utr || '-',
        amount: rawAmount,
        amount_source: ledgerRupees ? 'ledger' : Number(proof?.amount) > 0 ? 'proof' : 'tier',
        payment_date: dayOf(p?.created_at) || dayOf(proof?.reviewed_at) || dayOf(u.updated_at) || '-',
      };
    });

    res.json({ success: true, subscriptions: rows, page, limit });
  } catch (e) {
    if (e.message === 'APP_DB_OFFLINE') return res.status(503).json({ success: false, message: 'App database unavailable.' });
    console.error('[payments/subscriptions]', e.message); // production masks 500 messages; the log must say why
    res.status(500).json({ success: false, message: e.message });
  }
}

// Raw payment ledger (tbl_payment).
export async function payments(req, res) {
  try {
    const db = getAppDb();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 100);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const rows = await db.collection('tbl_payment')
      .find({}).sort({ created_at: -1 })
      .skip((page - 1) * limit).limit(limit).toArray();
    res.json({ success: true, payments: rows, page, limit });
  } catch (e) {
    if (e.message === 'APP_DB_OFFLINE') return res.status(503).json({ success: false, message: 'App database unavailable.' });
    res.status(500).json({ success: false, message: e.message });
  }
}

// Order creation for generic payments
export async function createOrder(req, res) {
  const amount = Number(req.body?.amount || 0);
  if (!amount) return res.status(400).json({ success: false, message: 'amount (in paise) is required.' });

  try {
    const auth = Buffer.from(`${RAZORPAY_KEY}:${RAZORPAY_SECRET}`).toString('base64');
    const resp = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, currency: req.body.currency || 'INR', receipt: req.body.receipt || `rcpt_${Date.now()}` }),
    });
    const order = await resp.json();
    if (!resp.ok) return res.status(resp.status).json({ success: false, message: order?.error?.description || 'Razorpay error.' });
    res.json({ success: true, order, key: RAZORPAY_KEY });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
}

// POST /payments/ward-order — create Razorpay order & hosted payment link (rzp.io) for Ward User subscription
export async function createWardOrder(req, res) {
  try {
    const boothCount = Number(req.body?.booth_count || 1);
    const mobile = req.user?.mobile || req.user?.username || '';
    const pricing = calculateWardPricing(boothCount, mobile);

    const auth = Buffer.from(`${RAZORPAY_KEY}:${RAZORPAY_SECRET}`).toString('base64');
    
    // 1. Create standard Razorpay order
    const resp = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: pricing.amountPaise,
        currency: 'INR',
        receipt: `ward_rcpt_${Date.now()}`,
        notes: {
          booth_count: pricing.boothCount,
          tier: pricing.tierLabel,
          user_id: req.user?.sub || '',
        },
      }),
    });

    const order = await resp.json();
    if (!resp.ok) {
      return res.status(resp.status).json({ success: false, message: order?.error?.description || 'Razorpay order creation failed.' });
    }

    // 2. Create Hosted Payment Link (rzp.io) — works across ANY domain without domain lock
    let paymentLinkUrl = null;
    let paymentLinkId = null;
    try {
      const origin = req.headers.origin || 'https://tnedms.com';
      const rawMobile = String(mobile || req.user?.mobile || req.user?.username || '').replace(/\D/g, '');
      const formattedContact = rawMobile.length === 10 ? `+91${rawMobile}` : (rawMobile ? `+${rawMobile}` : undefined);
      
      let userRec = null;
      if (req.user?.sub && req.user?.sub !== 'admin') {
        try { userRec = await findById(req.user.sub); } catch { /* ignore */ }
      }
      const userName = [userRec?.first_name, userRec?.last_name].filter(Boolean).join(' ') || req.user?.name || 'Ward Candidate';
      const userEmail = userRec?.email || req.user?.email || (rawMobile ? `${rawMobile}@election2026.in` : undefined);

      const plinkResp = await fetch('https://api.razorpay.com/v1/payment_links', {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: pricing.amountPaise,
          currency: 'INR',
          accept_partial: false,
          description: `Ward Subscription (${pricing.boothCount} Booths)`,
          reference_id: order.id || `ref_${Date.now()}`,
          customer: {
            name: userName,
            contact: formattedContact,
            email: userEmail,
          },
          notes: {
            booth_count: pricing.boothCount,
            user_id: req.user?.sub || '',
          },
          callback_url: `${origin}/ward/dashboard?payment=success&order_id=${order.id || ''}`,
          callback_method: 'get',
        }),
      });
      const plinkData = await plinkResp.json();
      if (plinkResp.ok && plinkData.short_url) {
        const contactClean = rawMobile || '';
        const nameClean = encodeURIComponent(userName);
        const emailClean = userEmail ? encodeURIComponent(userEmail) : '';

        paymentLinkUrl = `${plinkData.short_url}?contact=${contactClean}&name=${nameClean}&email=${emailClean}`;
        paymentLinkId = plinkData.id;
      }
    } catch { /* ignore */ }

    res.json({
      success: true,
      order,
      payment_link_url: paymentLinkUrl,
      payment_link_id: paymentLinkId,
      key: RAZORPAY_KEY,
      pricing,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
}

// POST /payments/verify-ward-payment — verify signature & mark user as paid
export async function verifyWardPayment(req, res) {
  try {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature, email, booth_count } = req.body || {};

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Missing Razorpay payment parameters.' });
    }

    // Verify HMAC SHA256 Signature
    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Invalid Razorpay payment signature.' });
    }

    const userId = req.user?.sub;
    let userRec = null;
    if (userId && userId !== 'admin') {
      try { userRec = await findById(userId); } catch { /* ignore */ }
    }

    const count = Number(booth_count || (Array.isArray(userRec?.booths) ? userRec.booths.length : 1));
    const pricing = calculateWardPricing(count);

    // Update user record in DB: paid_status = 'Yes', transaction_id = payment_id, optional email
    if (userId && userId !== 'admin') {
      const updateData = {
        paid_status: 'Yes',
        transaction_id: razorpay_payment_id,
      };
      if (email && email.trim()) {
        updateData.email = email.trim();
      }
      await updateUser(userId, updateData);
    }

    // Save payment record in tbl_payment collection for payment history / admin ledger
    const db = getAppDb();
    const paymentDoc = {
      payment_id: razorpay_payment_id,
      order_id: razorpay_order_id,
      user_id: userId || null,
      user_group_id: userRec?.user_group_id || 6,
      user_name: userRec ? [userRec.first_name, userRec.last_name].filter(Boolean).join(' ') : (req.user?.name || 'Ward Candidate'),
      mobile_no: userRec?.mobile_no || req.user?.username || '',
      email: email || userRec?.email || '',
      district_id: userRec?.district_id || '',
      category_name: userRec?.category_name || '',
      ward_id: userRec?.ward_id || '',
      candidate_type: userRec?.candidate_type || '',
      booth_count: pricing.boothCount,
      base_amount: pricing.basePrice,
      gst_amount: pricing.gst,
      amount: pricing.amountPaise,
      currency: 'INR',
      status: 'Paid',
      created_at: new Date().toISOString(),
    };

    await db.collection('tbl_payment').insertOne(paymentDoc);

    res.json({
      success: true,
      message: 'Payment verified successfully! PRO features unlocked.',
      transaction_id: razorpay_payment_id,
      amount: pricing.totalAmount,
      pricing,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
}

// POST /payments/webhook — Razorpay webhook (no auth, raw body, HMAC verified)
export async function razorpayWebhook(req, res) {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || RAZORPAY_SECRET;
    const signature = req.headers['x-razorpay-signature'] || '';
    // Verify over the EXACT raw bytes Razorpay signed (not a re-serialized body).
    const raw = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));

    // Reject when the signature is missing — never skip verification.
    if (!signature) {
      return res.status(400).json({ success: false, message: 'Missing webhook signature.' });
    }
    const expectedSig = crypto.createHmac('sha256', webhookSecret).update(raw).digest('hex');
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return res.status(400).json({ success: false, message: 'Invalid webhook signature.' });
    }

    const event = req.body?.event;
    const paymentEntity = req.body?.payload?.payment?.entity;

    if (event === 'payment.captured' && paymentEntity) {
      const { id: payment_id, order_id, contact, notes } = paymentEntity;
      const db = getAppDb();

      // Find user by order_id in tbl_payment or by mobile
      let userRec = null;
      const mobile = String(contact || '').replace(/\D/g, '');
      if (mobile) {
        userRec = await db.collection('tbl_user').findOne({ mobile_no: mobile });
      }

      if (userRec && !isPaid(userRec.paid_status)) {
        const mobile_str = String(userRec.mobile_no || '');
        const pricing = calculateWardPricing(
          Array.isArray(userRec.booths) ? userRec.booths.length : 1,
          mobile_str
        );
        await db.collection('tbl_user').updateOne(
          { _id: userRec._id },
          { $set: { paid_status: 'Yes', transaction_id: payment_id } }
        );
        await markCrmLeadStatus(db, mobile_str, 'converted', 'Payment received (webhook)'); // sync CRM pipeline
        // Save payment doc if not already saved
        const exists = await db.collection('tbl_payment').findOne({ payment_id });
        if (!exists) {
          await db.collection('tbl_payment').insertOne({
            payment_id,
            order_id,
            user_id: String(userRec._id),
            user_group_id: userRec.user_group_id || 6,
            user_name: [userRec.first_name, userRec.last_name].filter(Boolean).join(' '),
            mobile_no: mobile,
            email: userRec.email || '',
            district_id: userRec.district_id || '',
            category_name: userRec.category_name || '',
            ward_id: userRec.ward_id || '',
            candidate_type: userRec.candidate_type || '',
            booth_count: pricing.boothCount,
            base_amount: pricing.basePrice,
            gst_amount: pricing.gst,
            amount: pricing.amountPaise,
            currency: 'INR',
            status: 'Paid',
            source: 'webhook',
            created_at: new Date().toISOString(),
          });
        }
      }
    }
    res.json({ success: true });
  } catch (e) {
    console.error('[webhook]', e.message);
    res.status(500).json({ success: false });
  }
}


// POST /payments/check-order-status — frontend polls this or calls on callback to detect payment

// POST /payments/check-order-status — frontend polls this or calls on callback to detect payment
export async function checkOrderStatus(req, res) {
  try {
    const { order_id, payment_link_id } = req.body || {};
    const userId = req.user?.sub;
    let userRec = null;
    if (userId && userId !== 'admin') {
      try { userRec = await findById(userId); } catch { /* ignore */ }
    }

    const auth = Buffer.from(`${RAZORPAY_KEY}:${RAZORPAY_SECRET}`).toString('base64');
    let captured = null;
    let payment_id = null;
    let amountPaise = 0;

    // 1. Try order payments
    if (order_id) {
      try {
        const resp = await fetch(`https://api.razorpay.com/v1/orders/${order_id}/payments`, {
          headers: { Authorization: `Basic ${auth}` },
        });
        const rzData = await resp.json();
        const match = (rzData.items || []).find((p) => p.status === 'captured' || p.status === 'authorized');
        if (match) {
          captured = match;
          payment_id = match.id;
          amountPaise = match.amount;
        }
      } catch { /* ignore */ }
    }

    // 2. Try payment_link status
    if (!captured && payment_link_id) {
      try {
        const resp = await fetch(`https://api.razorpay.com/v1/payment_links/${payment_link_id}`, {
          headers: { Authorization: `Basic ${auth}` },
        });
        const plData = await resp.json();
        if (plData.status === 'paid') {
          captured = plData;
          payment_id = plData.id;
          amountPaise = plData.amount_paid || plData.amount;
        }
      } catch { /* ignore */ }
    }

    // 3. Fallback: Search recent captured payments for user ID or mobile
    if (!captured && (userId || userRec?.mobile_no)) {
      try {
        const resp = await fetch('https://api.razorpay.com/v1/payments?count=20', {
          headers: { Authorization: `Basic ${auth}` },
        });
        const pData = await resp.json();
        const mobileNorm = userRec?.mobile_no ? String(userRec.mobile_no).replace(/\D/g, '') : '';
        const uidStr = String(userId || userRec?._id || '');

        const match = (pData.items || []).find((p) => {
          if (p.status !== 'captured' && p.status !== 'authorized') return false;
          const pNoteUid = String(p.notes?.user_id || '');
          const pContact = String(p.contact || '').replace(/\D/g, '');
          return (uidStr && pNoteUid === uidStr) || (mobileNorm && pContact.length >= 10 && mobileNorm.includes(pContact.slice(-10)));
        });

        if (match) {
          captured = match;
          payment_id = match.id;
          amountPaise = match.amount;
        }
      } catch { /* ignore */ }
    }

    if (!captured) {
      return res.json({ success: true, paid: false });
    }

    // Payment captured — now verify and update user
    if (userRec) {
      const mobile = String(userRec.mobile_no || req.user?.mobile || '');
      const count = Array.isArray(userRec.booths) ? userRec.booths.length : 1;
      const pricing = calculateWardPricing(count, mobile);
      await updateUser(String(userRec._id), { paid_status: 'Yes', transaction_id: payment_id });

      const db = getAppDb();
      const exists = await db.collection('tbl_payment').findOne({ payment_id });
      if (!exists) {
        await db.collection('tbl_payment').insertOne({
          payment_id,
          order_id: order_id || captured.order_id || '-',
          user_id: String(userRec._id),
          user_group_id: userRec.user_group_id || 6,
          user_name: [userRec.first_name, userRec.last_name].filter(Boolean).join(' ') || 'Ward Candidate',
          mobile_no: mobile,
          email: userRec.email || '',
          district_id: userRec.district_id || '',
          category_name: userRec.category_name || '',
          ward_id: userRec.ward_id || '',
          candidate_type: userRec.candidate_type || '',
          booth_count: pricing.boothCount,
          base_amount: pricing.basePrice,
          gst_amount: pricing.gst,
          amount: (amountPaise === 100) ? 1 : (amountPaise > 1000 ? Math.round(amountPaise / 100) : amountPaise),
          currency: 'INR',
          status: 'Paid',
          source: 'order-poll',
          created_at: new Date().toISOString(),
        });
      }
    }

    res.json({
      success: true,
      paid: true,
      transaction_id: payment_id,
      amount: amountPaise / 100,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
}

// POST /payments/submit-utr — candidate submits payment proof from the website:
// a screenshot (data URL, already downscaled by the browser) and/or the UTR.
export async function submitUtr(req, res) {
  try {
    const { utr = '', screenshot = '', mime = 'image/jpeg', booth_count } = req.body || {};
    const userId = req.user?.sub;
    const cleanUtr = String(utr || '').trim();
    const hasShot = /^data:image\/(png|jpe?g|webp);base64,/.test(String(screenshot));
    if (!hasShot && cleanUtr.length < 6) {
      return res.status(400).json({ success: false, message: 'Upload the payment screenshot or enter the UTR / transaction ID.' });
    }
    if (cleanUtr && !/^[A-Za-z0-9-]{6,32}$/.test(cleanUtr)) {
      return res.status(400).json({ success: false, message: 'The UTR should be the 12-digit number shown in your UPI app.' });
    }

    const db = getAppDb();
    let userRec = null;
    if (userId && userId !== 'admin') { try { userRec = await findById(userId); } catch { /* ignore */ } }
    if (!userRec) return res.status(403).json({ success: false, message: 'Please log in with your candidate account to submit payment proof.' });
    if (isPaid(userRec.paid_status)) return res.json({ success: true, already_paid: true, message: 'Your subscription is already active.' });

    let shot = null;
    if (hasShot) {
      const b64 = String(screenshot).replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(b64, 'base64');
      if (buffer.length > 6 * 1024 * 1024) return res.status(413).json({ success: false, message: 'Screenshot is too large (max 6 MB).' });
      shot = await storeScreenshot(buffer, String(mime).startsWith('image/') ? mime : 'image/jpeg', String(userRec.mobile_no || ''));
    }
    if (booth_count && !(Array.isArray(userRec.booths) && userRec.booths.length)) userRec = { ...userRec, booth_count: Number(booth_count) };

    const { outcome, doc } = await recordProof(db, {
      user: userRec, mobile: String(userRec.mobile_no || req.user?.username || ''), source: 'website', utr: cleanUtr, screenshot: shot,
    });
    if (outcome === 'duplicate') return res.status(400).json({ success: false, message: 'This UTR has already been submitted from another account.' });

    const settings = await getPaymentSettings(db);
    res.json({
      success: true, outcome, pending_since: doc.submitted_at, expected_amount: doc.expected_amount,
      message: `Payment proof received. We verify it within ${settings.activation_minutes} minutes and activate your account.`,
    });
  } catch (e) {
    if (e.message === 'APP_DB_OFFLINE') return res.status(503).json({ success: false, message: 'App database unavailable.' });
    res.status(500).json({ success: false, message: e.message });
  }
}

// GET /payments/pending-utrs — admin lists payment proofs (status=pending|approved|rejected|all)
export async function pendingUtrs(req, res) {
  try {
    const db = getAppDb();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 200);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const statusFilter = req.query.status || 'pending';

    const query = statusFilter === 'all' ? {} : { status: statusFilter };
    const rows = await db.collection(PROOF_COLL)
      .find(query)
      .sort({ submitted_at: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray();

    const total = await db.collection(PROOF_COLL).countDocuments(query);

    res.json({ success: true, rows, total, page, limit });
  } catch (e) {
    if (e.message === 'APP_DB_OFFLINE') return res.status(503).json({ success: false, message: 'App database unavailable.' });
    res.status(500).json({ success: false, message: e.message });
  }
}

// POST /payments/approve-utr {utr_id, action: approve|reject, reason?, amount?}
// Approve: user → paid, ledger row with the real tier amount, WhatsApp confirmation.
// Reject: proof → rejected with the reason, WhatsApp asks for a clearer screenshot.
export async function approveUtr(req, res) {
  try {
    const { utr_id, action, reason = '', amount } = req.body || {};
    if (!utr_id || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, message: 'utr_id and action (approve/reject) are required.' });
    }

    const db = getAppDb();
    const { ObjectId } = await import('mongodb');
    const utrDoc = await db.collection(PROOF_COLL).findOne({ _id: new ObjectId(utr_id) });

    if (!utrDoc) return res.status(404).json({ success: false, message: 'Payment proof not found.' });
    if (utrDoc.status !== 'pending') {
      return res.status(400).json({ success: false, message: `This submission is already ${utrDoc.status}.` });
    }

    const reviewer = req.user?.name || req.user?.username || 'admin';
    const now = new Date().toISOString();
    const settings = await getPaymentSettings(db);
    await loadBotContent(db);
    const session = await db.collection('tbl_wacto_sessions').findOne({ phone: `91${String(utrDoc.mobile_no || '').replace(/\D/g, '').slice(-10)}` });
    const lang = session?.lang || 'en';
    const notify = async (text) => {
      if (!wactoConfigured() || !utrDoc.mobile_no) return false;
      try { await sendWactoText(String(utrDoc.mobile_no), text); return true; }
      catch (e) { console.warn('[approve-utr] WhatsApp notify failed:', e.message); return false; }
    };

    if (action === 'reject') {
      await db.collection(PROOF_COLL).updateOne(
        { _id: utrDoc._id },
        { $set: { status: 'rejected', reject_reason: String(reason || '').trim(), reviewed_at: now, reviewed_by: reviewer } },
      );
      const notified = await notify(proofRejectedMessage(settings, lang, { reason: String(reason || '').trim() }));
      return res.json({ success: true, notified, message: `Payment rejected${notified ? ' — the candidate was told on WhatsApp.' : '.'}` });
    }

    // Approve — real tier amount (not the booth count) in the ledger
    // the proof's user_id can be stale (the candidate re-registered: seen on live 2026-10-14) → fall back to the mobile
    let userRec = utrDoc.user_id && utrDoc.user_id !== 'admin' ? await findById(String(utrDoc.user_id)).catch(() => null) : null;
    if (!userRec && utrDoc.mobile_no) {
      const mob = String(utrDoc.mobile_no).replace(/\D/g, '').slice(-10);
      userRec = await db.collection('tbl_user').findOne({ $or: [{ mobile_no: mob }, { mobile_no: String(utrDoc.mobile_no) }] });
    }
    const boothCount = (Array.isArray(userRec?.booths) && userRec.booths.length) || Number(utrDoc.booth_count) || 1;
    const price = priceFor(boothCount, settings);
    const paidAmount = Number(amount) > 0 ? Number(amount) : price.total;
    const txnId = utrDoc.utr || `QR-${now.slice(0, 10).replace(/-/g, '')}-${String(utrDoc._id).slice(-6).toUpperCase()}`;

    if (userRec?._id) await updateUser(String(userRec._id), { paid_status: 'Yes', transaction_id: txnId });
    await markCrmLeadStatus(db, utrDoc.mobile_no, 'converted', 'Payment approved'); // sync CRM pipeline

    await db.collection('tbl_payment').insertOne({
      payment_id: txnId,
      order_id: 'QR-PAYMENT',
      user_id: userRec?._id ? String(userRec._id) : (utrDoc.user_id || null),
      user_group_id: userRec?.user_group_id || 11,
      user_name: utrDoc.user_name || '',
      mobile_no: utrDoc.mobile_no || '',
      email: userRec?.email || '',
      district_id: utrDoc.district_id || '',
      category_name: utrDoc.category_name || '',
      ward_id: utrDoc.ward_id || '',
      candidate_type: utrDoc.candidate_type || '',
      booth_count: boothCount,
      base_amount: price.base,
      gst_amount: price.gst,
      amount: paidAmount,
      currency: 'INR',
      status: 'Paid',
      source: utrDoc.source === 'whatsapp' ? 'qr-whatsapp' : 'qr-utr',
      proof_id: String(utrDoc._id),
      screenshot_url: utrDoc.screenshot_url || '',
      reviewed_by: reviewer,
      created_at: now,
    });

    await db.collection(PROOF_COLL).updateOne(
      { _id: utrDoc._id },
      { $set: { status: 'approved', amount: paidAmount, transaction_id: txnId, reviewed_at: now, reviewed_by: reviewer } },
    );

    const notified = await notify(proofApprovedMessage(settings, lang, { name: utrDoc.user_name, boothCount, amount: paidAmount, mobile: utrDoc.mobile_no }));
    res.json({ success: true, notified, transaction_id: txnId, amount: paidAmount, message: `Payment approved. Account activated${notified ? ' and the candidate was told on WhatsApp.' : '.'}` });
  } catch (e) {
    if (e.message === 'APP_DB_OFFLINE') return res.status(503).json({ success: false, message: 'App database unavailable.' });
    res.status(500).json({ success: false, message: e.message });
  }
}

// GET /payments/settings — UPI ID, payee, QR image, proof instructions, tiers.
// Public: the purchase modal needs it before the candidate has paid.
export async function getSettings(req, res) {
  try {
    const s = await getPaymentSettings();
    res.json({ success: true, settings: s });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
}

// PUT /payments/settings (admin) — any editable field; qr_base64 + qr_mime replaces the QR image.
export async function updateSettings(req, res) {
  try {
    const db = getAppDb();
    const body = req.body || {};
    const patch = { ...body };
    delete patch.qr_base64; delete patch.qr_mime;
    if (body.qr_base64) {
      const b64 = String(body.qr_base64).replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(b64, 'base64');
      if (buffer.length > 4 * 1024 * 1024) return res.status(413).json({ success: false, message: 'QR image is too large (max 4 MB).' });
      const current = await getPaymentSettings(db);
      const up = await cloudinary.upload(buffer, `payment-qr-${Date.now()}.${(String(body.qr_mime || 'image/jpeg').split('/')[1] || 'jpg')}`, 'image', 'payment-setup');
      if (current.qr_public_id) await cloudinary.destroy(current.qr_public_id, 'image').catch(() => {});
      patch.qr_url = up.url; patch.qr_public_id = up.public_id;
    }
    const saved = await savePaymentSettings(db, patch, req.user?.name || req.user?.username || 'admin');
    res.json({ success: true, settings: saved, message: 'Payment setup saved. The website and the bot use it from now on.' });
  } catch (e) {
    if (e.message === 'APP_DB_OFFLINE') return res.status(503).json({ success: false, message: 'App database unavailable.' });
    res.status(400).json({ success: false, message: e.message });
  }
}
