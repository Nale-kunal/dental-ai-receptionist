export const APP_NAME = 'Dental Clinic Dashboard';
export const API_VERSION = 'v1';
export const API_PREFIX = `/api/${API_VERSION}`;

// ─── Appointment status labels (clinic-friendly) ──────────────────────────────
export const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  completed: 'Completed',
  no_show: 'No Show',
  rescheduled: 'Rescheduled',
};

export const APPOINTMENT_STATUS_COLORS: Record<string, string> = {
  pending: 'yellow',
  confirmed: 'blue',
  cancelled: 'red',
  completed: 'green',
  no_show: 'orange',
  rescheduled: 'purple',
};

// ─── Handoff status labels ────────────────────────────────────────────────────
export const HANDOFF_STATUS_LABELS: Record<string, string> = {
  pending: 'Waiting',
  accepted: 'In Progress',
  resolved: 'Resolved',
  escalated: 'Escalated',
};

export const HANDOFF_PRIORITY_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

// ─── Notification type labels ─────────────────────────────────────────────────
export const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  appointment_reminder: 'Appointment Reminder',
  appointment_confirmation: 'Booking Confirmation',
  appointment_cancelled: 'Cancellation Notice',
  appointment_rescheduled: 'Rescheduling Notice',
  handoff_assigned: 'Handoff Assigned',
  general: 'General',
};

// ─── Conversation channel labels ──────────────────────────────────────────────
export const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'Email',
  voice: 'Phone',
  web: 'Web',
};

// ─── Day of week labels ───────────────────────────────────────────────────────
export const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ─── Pagination defaults ──────────────────────────────────────────────────────
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// ─── Roles ────────────────────────────────────────────────────────────────────
export const CLINIC_ROLES = {
  OWNER: 'clinic_owner',
  ADMIN: 'clinic_admin',
  RECEPTIONIST: 'clinic_receptionist',
  VIEWER: 'clinic_viewer',
} as const;

export const CLINIC_ROLE_LABELS: Record<string, string> = {
  clinic_owner: 'Owner',
  clinic_admin: 'Administrator',
  clinic_receptionist: 'Receptionist',
  clinic_viewer: 'View Only',
};

// ─── Integration statuses ─────────────────────────────────────────────────────
export const INTEGRATION_STATUS_LABELS: Record<string, string> = {
  not_configured: 'Not Configured',
  configured: 'Configured',
  healthy: 'Connected',
  error: 'Connection Error',
};
