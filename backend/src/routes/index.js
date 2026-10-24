import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authRequired, adminOnly, requireRole } from '../middleware/auth.js';
import { ROLES } from '../constants/roles.js';
import * as auth from '../controllers/authController.js';
import * as dashboard from '../controllers/dashboardController.js';
import * as voters from '../controllers/voterController.js';
import * as assemblies from '../controllers/assemblyController.js';
import * as booths from '../controllers/boothController.js';
import * as users from '../controllers/userController.js';
import * as mla from '../controllers/mlaController.js';
import * as boothLogins from '../controllers/boothLoginController.js';
import * as wardLogins from '../controllers/wardLoginController.js';
import * as registrations from '../controllers/registrationController.js';
import * as payments from '../controllers/paymentController.js';
import * as reports from '../controllers/reportController.js';
import * as cms from '../controllers/cmsController.js';
import * as messaging from '../controllers/messagingController.js';
import * as survey from '../controllers/surveyController.js';
import * as flowImages from '../controllers/flowImageController.js';
import * as ward from '../controllers/wardController.js';
import * as whatsapp from '../controllers/whatsappController.js';
import * as wactoWebhook from '../controllers/wactoWebhookController.js';
import * as flowSim from '../controllers/flowSimController.js';
import * as leads from '../controllers/leadController.js';
import * as features from '../controllers/featureController.js';
import * as crm from '../controllers/crmController.js';
import * as team from '../controllers/teamController.js';
import * as templates from '../controllers/templateController.js';
import * as telecmi from '../controllers/telecmiController.js';

const r = Router();

// Throttle credential endpoints to blunt brute-force / credential-stuffing.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // 20 per 15 min on live. AUTH_RATE_MAX lets STAGING allow more for the end-to-end run (e2e/run.mjs makes ~25 sign-ups/logins).
  max: Number(process.env.AUTH_RATE_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please try again in a few minutes.' },
});

// ---- Public ----
r.post('/auth/login', authLimiter, auth.login);
r.post('/auth/send-otp', authLimiter, auth.sendOtp);
r.post('/auth/verify-otp', authLimiter, auth.verifyOtp);
r.post('/auth/register', authLimiter, auth.register);
r.post('/payments/webhook', payments.razorpayWebhook);

// WhatsApp Meta Webhook & Flow Endpoints (Public)
r.get('/whatsapp/webhook', whatsapp.webhookVerification);
r.post('/whatsapp/webhook', whatsapp.webhookHandler);
r.get('/whatsapp-webhook', whatsapp.webhookVerification);
r.post('/whatsapp-webhook', whatsapp.webhookHandler);
r.post('/whatsapp-flow-endpoint', whatsapp.flowEndpoint);
r.post('/whatsapp/wacto', wactoWebhook.handleWactoWebhook);

// TeleCMI telephony webhooks (public — TeleCMI calls these; each verifies appid):
//   /telecmi/webhook → CDR logger (records every call into the CRM thread)
//   /telecmi/flow    → inbound IVR routing (routes caller to their telecaller / round-robin)
r.post('/telecmi/webhook', telecmi.webhook);
r.post('/telecmi/flow', telecmi.flow);
r.get('/telecmi/flow', telecmi.flow);

// Public Assembly & Booth Lookup for Registration
r.get('/public/assemblies', assemblies.list);
r.get('/public/booths', booths.boothsByAssembly);
// Incomplete registrations (Ram, 2026-10-15): the website form saves name + number after step 1 (and the step after 2)
const leadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { success: true } });
r.post('/public/lead', leadLimiter, leads.publicLead);
r.post('/public/track', leadLimiter, leads.track); // website registration-journey beacon
// WhatsApp features (Ram, 2026-10-16): does the register page say "your login comes on WhatsApp" to everyone
r.get('/public/whatsapp-login', features.publicWebsiteLogin);

// ---- Protected (mirrors Laravel `adminauth` group) ----
r.use(authRequired);
r.get('/auth/me', auth.me);
// nginx auth_request target for /report-files (C10): 204 when logged in, else authRequired's 401
r.get('/auth/check', (req, res) => res.status(204).end());
r.post('/auth/refresh', auth.refresh);
r.post('/auth/logout', auth.logout);

// ── Telecalling / CRM (restored 2026-10-24, now role-guarded) ──
// Team management (create telecaller credentials, list, edit, activate, stats): Super Admin only.
// CRM inbox + lead workflow: Super Admin and CRM Team Members (telecallers, group 12) only — other
// logins (candidates, booth, ward) are rejected. Agents are further scoped to their own assigned
// conversations inside each controller (agentCanAccess / isCrmAgent); admins may pass ?agent_id= to
// view one telecaller's inbox/stats/report without logging in as them.
const crmAccess = requireRole(ROLES.CRM_AGENT);

// Team members (Super Admin)
r.get('/team/members', adminOnly, team.listTeamMembers);
r.post('/team/members', adminOnly, team.createTeamMember);
r.put('/team/members/:id', adminOnly, team.updateTeamMember);
r.delete('/team/members/:id', adminOnly, team.deleteTeamMember);
r.get('/team/stats', adminOnly, team.getTeamStats);

// CRM conversations + lead workflow (Super Admin + telecallers)
r.get('/crm/conversations', crmAccess, crm.listConversations);
r.get('/crm/conversations/:phone', crmAccess, crm.getConversationHistory);
r.post('/crm/conversations/:phone/status', crmAccess, crm.updateStatus);
r.post('/crm/conversations/:phone/lead-status', crmAccess, crm.updateLeadStatus);
r.post('/crm/conversations/:phone/notes', crmAccess, crm.updateLeadNotes);
r.post('/crm/conversations/:phone/assign', adminOnly, crm.assignConversation);
r.post('/crm/conversations/:phone/send-media', crmAccess, crm.sendMedia);
r.post('/crm/conversations/:phone/react', crmAccess, crm.reactToMessage);
r.post('/crm/conversations/:phone/call', crmAccess, crm.callLead); // TeleCMI click-to-call (mobile bridge)
r.get('/crm/softphone', crmAccess, crm.softphoneCreds); // browser softphone (WebRTC) credentials
r.post('/crm/conversations/:phone/call-log', crmAccess, crm.logSoftphoneCall); // log a web-softphone call outcome
r.delete('/crm/conversations/:phone/clear', crmAccess, crm.clearChat);
r.post('/crm/messages/send', crmAccess, crm.sendMessage);
r.post('/crm/send-credentials', crmAccess, crm.sendCredentials);
r.post('/crm/send-flow', crmAccess, crm.sendFlow);
r.get('/crm/agents', adminOnly, crm.listAgents);
r.post('/crm/distribute-leads', adminOnly, crm.distributeLeads);
r.get('/crm/settings', crmAccess, crm.getCrmSettings);        // telecallers read (to know if claim is on)
r.put('/crm/settings', adminOnly, crm.updateCrmSettings);     // only admin changes
r.post('/crm/conversations/:phone/claim', crmAccess, crm.claimLead);
r.get('/crm/recordings', crmAccess, telecmi.getRecording); // stream a TeleCMI call recording
r.post('/crm/sync-recordings', adminOnly, crm.syncTelecmiRecordings); // import real TeleCMI call logs + recordings
r.get('/crm/team-stats', crmAccess, crm.teamStats);
r.get('/crm/team-report', crmAccess, crm.teamReport);

// WhatsApp message templates used by the CRM inbox when the 24h window is closed (Super Admin + telecallers)
r.get('/crm/templates', crmAccess, templates.list);
r.post('/crm/templates', adminOnly, templates.create);
r.post('/crm/templates/setup-defaults', adminOnly, templates.setupDefaults);
r.post('/crm/conversations/:phone/send-template', crmAccess, templates.sendToContact);

// Dashboard
r.get('/dashboard/stats', dashboard.stats);
// Admin only (2026-10-17, EDMS-13): returned any voter's full record statewide to every login. Only admin pages use it.
r.get('/dashboard/search-epic', adminOnly, dashboard.searchEpic);

// Voters
r.get('/voters', voters.list);
r.get('/voters/export', voters.exportCsv);
// Admin only (2026-10-17, EDMS-13): any login could overwrite a voter's mobile number. No page uses it.
r.post('/voters/update-mobile', adminOnly, voters.updateMobile);
r.get('/voters/detail', voters.detail);

// Assemblies
r.get('/assemblies', assemblies.list);
r.get('/assemblies/:no', assemblies.detail);
r.put('/assemblies/:no', adminOnly, assemblies.update);

// Booths
r.get('/booths', booths.boothsByAssembly);

// Per-assembly MLA credentials (Super Admin only — exposes/creates login secrets)
r.get('/assembly-credentials', adminOnly, users.assemblyCredentials);
r.post('/assembly-credentials/:no/generate', adminOnly, users.generateCredentials);

// MLA images — profile photos (per constituency) + party flags (per party)
r.get('/mla/images', mla.list);
r.post('/mla/profile-upload', adminOnly, mla.uploadProfile);
r.post('/mla/flag-upload', adminOnly, mla.uploadFlag);
r.delete('/mla/profile/:no', adminOnly, mla.removeProfile);
r.delete('/mla/flag/:party', adminOnly, mla.removeFlag);

// Assembly-wise / Booth-wise login generation (Super Admin only)
r.get('/booth-logins', adminOnly, boothLogins.list);
r.post('/booth-logins/generate', adminOnly, boothLogins.generate);

// Ward-wise logins management (Super Admin only)
r.get('/ward-logins', adminOnly, wardLogins.list);
r.post('/ward-logins', adminOnly, wardLogins.store);
r.post('/ward-logins/:id/add-booth', adminOnly, wardLogins.addBooth);
r.post('/ward-logins/:id/delete-booth', adminOnly, wardLogins.deleteBooth);
r.post('/ward-logins/:id/save-booths', adminOnly, wardLogins.saveBooths);
r.post('/ward-logins/check-exists', adminOnly, wardLogins.checkExists);
r.delete('/ward-logins/:id', adminOnly, wardLogins.remove);

// Registrations (Super Admin only — candidate PII), Payments ledgers, Reports
r.get('/registrations', adminOnly, registrations.list);
r.get('/registrations/:id', adminOnly, registrations.detail);
// Added on the server 2026-10-07 (live ahead of git): booth assignment, paid flag, delete.
r.put('/registrations/:id/assign-booths', adminOnly, registrations.assignBooths);
r.put('/registrations/:id/set-paid', adminOnly, registrations.setPaid);
r.put('/registrations/:id', adminOnly, registrations.update);
r.delete('/registrations/:id', adminOnly, registrations.remove);
r.get('/leads', adminOnly, leads.list);
r.put('/leads/:id', adminOnly, leads.update);
// WhatsApp features: on/off switches, test numbers, template names, reminder plan + log (Super Admin)
r.get('/whatsapp-features', adminOnly, features.get);
r.put('/whatsapp-features', adminOnly, features.update);
// (wrapped so Express's `next` is never taken for the injectable sender)
r.post('/whatsapp-features/test-send', adminOnly, (req, res) => features.testSend(req, res));
r.get('/whatsapp-features/templates', adminOnly, (req, res) => features.templates(req, res));
r.get('/payments/subscriptions', adminOnly, payments.subscriptions);
r.get('/payments/ledger', adminOnly, payments.payments);
r.get('/payments/ward-pricing', payments.getWardPricingApi);
r.post('/payments/order', payments.createOrder);
r.post('/payments/ward-order', payments.createWardOrder);
r.post('/payments/verify-ward-payment', payments.verifyWardPayment);
r.get('/payments/check-paid', payments.checkPaid);
r.post('/payments/check-order-status', payments.checkOrderStatus);
r.post('/payments/submit-utr', payments.submitUtr);
r.get('/payments/pending-utrs', adminOnly, payments.pendingUtrs);
r.post('/payments/approve-utr', adminOnly, payments.approveUtr);
r.get('/payments/settings', payments.getSettings);
r.put('/payments/settings', adminOnly, payments.updateSettings);
r.get('/reports/booth', reports.boothReport);
r.get('/reports/documents', reports.documents);
r.get('/reports/booth-report-list', reports.boothReportList);
r.get('/reports/assembly-analytics', reports.assemblyAnalyticsReport);

// Phase 5 — Mobile-app CMS (generic CRUD over 13 content collections)
r.get('/mobileapp/types', cms.types);
r.get('/mobileapp/:type', cms.list);
r.post('/mobileapp/:type', adminOnly, cms.create);
r.get('/mobileapp/:type/:id', cms.get);
r.put('/mobileapp/:type/:id', adminOnly, cms.update);
r.delete('/mobileapp/:type/:id', adminOnly, cms.remove);

// Messaging reports — used by the Ward "Social Media Reports" page (tbl_sms_report).
r.get('/messaging/reports', messaging.reports);

r.get('/survey', survey.list);
r.post('/survey', adminOnly, survey.create);
r.put('/survey/:id', adminOnly, survey.update);
r.delete('/survey/:id', adminOnly, survey.remove);

r.get('/flow-images', flowImages.list);
r.get('/flow-images/messages', flowImages.getMessages);
r.get('/flow-images/bot', adminOnly, flowImages.botContent);
r.get('/flow-sim/flows', adminOnly, flowSim.listFlows);
r.get('/flow-sim/flows/:name', adminOnly, flowSim.getFlow);
r.post('/flow-images/bot/texts', adminOnly, flowImages.saveBotTexts);
r.post('/flow-images/messages', adminOnly, flowImages.saveMessages);
r.post('/flow-images/upload', adminOnly, flowImages.upload);
r.delete('/flow-images/:id', adminOnly, flowImages.remove);

// Ward-wise login home (sample/preview vs assigned booths) + social-media requests
r.get('/ward/home', ward.home);
r.get('/ward/sample-voters', ward.sampleVoters);
r.get('/ward/social-media', ward.socialMedia);
r.get('/ward/social-media/booth-sections', ward.boothSections);
r.post('/ward/social-media/request', ward.socialMediaRequest);

export default r;
