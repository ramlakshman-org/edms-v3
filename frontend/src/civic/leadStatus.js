// Shared CRM lead-status vocabulary (frontend + mirrored in crmController validStatuses).
// `bucket` groups the detailed statuses into the dashboard KPI cards.

export const LEAD_STATUS = {
  new:                      { label: 'New lead',        tone: 'neutral', emoji: '🆕', bucket: 'new' },
  assigned:                 { label: 'Assigned',        tone: 'info',    emoji: '📌', bucket: 'open' },
  contacted:                { label: 'Contacted',       tone: 'info',    emoji: '📲', bucket: 'open' },
  interested:               { label: 'Interested',      tone: 'ok',      emoji: '🟢', bucket: 'interested' },
  call_back:                { label: 'Call back',       tone: 'warn',    emoji: '📱', bucket: 'unreachable' },
  will_call_back:           { label: 'Call back',       tone: 'warn',    emoji: '📱', bucket: 'unreachable' },
  not_answered:             { label: 'Not answered',    tone: 'warn',    emoji: '📵', bucket: 'unreachable' },
  switch_off:               { label: 'Switched off',    tone: 'warn',    emoji: '📴', bucket: 'unreachable' },
  unreachable:              { label: 'Unreachable',     tone: 'warn',    emoji: '📵', bucket: 'unreachable' },
  first_call_complete:      { label: '1st call done',   tone: 'info',    emoji: '📞', bucket: 'calls' },
  second_call_complete:     { label: '2nd call done',   tone: 'info',    emoji: '📞', bucket: 'calls' },
  third_call_complete:      { label: '3rd call done',   tone: 'info',    emoji: '📞', bucket: 'calls' },
  call_completed:           { label: 'Call completed',  tone: 'info',    emoji: '📞', bucket: 'calls' },
  registration_incomplete:  { label: 'Reg. incomplete', tone: 'warn',    emoji: '📝', bucket: 'incomplete' },
  registration_completed:   { label: 'Registered',      tone: 'ok',      emoji: '✅', bucket: 'registered' },
  converted:                { label: 'Converted',       tone: 'ok',      emoji: '⭐', bucket: 'converted' },
  not_interested:           { label: 'Not interested',  tone: 'bad',     emoji: '🔴', bucket: 'not_interested' },
  none:                     { label: 'New',             tone: 'neutral', emoji: '⚪', bucket: 'new' },
};

// The outcome buttons a telecaller taps on a call (order shown in the drawer).
export const STATUS_BUTTONS = [
  'contacted', 'interested', 'call_back', 'not_answered', 'switch_off',
  'first_call_complete', 'second_call_complete', 'third_call_complete',
  'registration_incomplete', 'registration_completed', 'converted', 'not_interested',
];

export const statusMeta = (k) => LEAD_STATUS[k] || LEAD_STATUS.none;
