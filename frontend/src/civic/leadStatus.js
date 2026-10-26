// Shared CRM lead-status vocabulary (frontend + mirrored in crmController validStatuses).
// Uses Lucide icons and clean status dots instead of emojis.
import {
  Circle,
  UserCheck,
  PhoneCall,
  CheckCircle2,
  Clock,
  PhoneMissed,
  PhoneOff,
  PhoneForwarded,
  Check,
  FileEdit,
  Sparkles,
  XCircle,
} from 'lucide-react';

export const LEAD_STATUS = {
  new:                      { label: 'New lead',        tone: 'neutral', icon: Circle,          emoji: '', bucket: 'new' },
  assigned:                 { label: 'Assigned',        tone: 'info',    icon: UserCheck,       emoji: '', bucket: 'open' },
  contacted:                { label: 'Contacted',       tone: 'info',    icon: PhoneCall,       emoji: '', bucket: 'open' },
  interested:               { label: 'Interested',      tone: 'ok',      icon: CheckCircle2,    emoji: '', bucket: 'interested' },
  call_back:                { label: 'Call back',       tone: 'warn',    icon: Clock,           emoji: '', bucket: 'unreachable' },
  will_call_back:           { label: 'Call back',       tone: 'warn',    icon: Clock,           emoji: '', bucket: 'unreachable' },
  not_answered:             { label: 'Not answered',    tone: 'warn',    icon: PhoneMissed,     emoji: '', bucket: 'unreachable' },
  switch_off:               { label: 'Switched off',    tone: 'bad',     icon: PhoneOff,        emoji: '', bucket: 'unreachable' },
  unreachable:              { label: 'Unreachable',     tone: 'bad',     icon: PhoneOff,        emoji: '', bucket: 'unreachable' },
  first_call_complete:      { label: '1st call done',   tone: 'info',    icon: PhoneForwarded,  emoji: '', bucket: 'calls' },
  second_call_complete:     { label: '2nd call done',   tone: 'info',    icon: PhoneForwarded,  emoji: '', bucket: 'calls' },
  third_call_complete:      { label: '3rd call done',   tone: 'info',    icon: PhoneForwarded,  emoji: '', bucket: 'calls' },
  call_completed:           { label: 'Call completed',  tone: 'info',    icon: Check,           emoji: '', bucket: 'calls' },
  registration_incomplete:  { label: 'Reg. incomplete', tone: 'warn',    icon: FileEdit,        emoji: '', bucket: 'incomplete' },
  registration_completed:   { label: 'Registered',      tone: 'ok',      icon: CheckCircle2,    emoji: '', bucket: 'registered' },
  converted:                { label: 'Converted',       tone: 'ok',      icon: Sparkles,        emoji: '', bucket: 'converted' },
  not_interested:           { label: 'Not interested',  tone: 'bad',     icon: XCircle,         emoji: '', bucket: 'not_interested' },
  none:                     { label: 'New',             tone: 'neutral', icon: Circle,          emoji: '', bucket: 'new' },
};

// The outcome buttons a telecaller taps on a call (order shown in the drawer).
export const STATUS_BUTTONS = [
  'contacted', 'interested', 'call_back', 'not_answered', 'switch_off',
  'first_call_complete', 'second_call_complete', 'third_call_complete',
  'registration_incomplete', 'registration_completed', 'converted', 'not_interested',
];

export const statusMeta = (k) => LEAD_STATUS[k] || LEAD_STATUS.none;
