// ─── Shared API response envelope ───────────────────────────────────────────
// Mirrors the JSONB envelope returned by api.* database functions

export interface ApiEnvelope<T = unknown> {
  ok: boolean;
  code: ApiErrorCode;
  message: string;
  data: T | null;
}

export type ApiErrorCode =
  | 'OK'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PERMISSION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'PROVIDER_FAILURE'
  | 'DB_FAILURE'
  | 'INTERNAL_ERROR'
  | 'RATE_LIMITED';

// ─── Pagination ──────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

// ─── Auth types ───────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  clinicId: string;
  clinicName: string;
  clinicTimezone?: string;
  roles: string[];
  tenantId: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface SignupRequest {
  clinicName: string;
  email: string;
  fullName: string;
  password: string;
  timezone?: string;
  phone?: string;
}

export interface SignupResponse {
  user: AuthUser;
  clinic: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
  };
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// ─── Clinic types ─────────────────────────────────────────────────────────────

export interface Clinic {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  timezone: string;
  locale: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ClinicUpdateRequest {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  country?: string;
  timezone?: string;
  locale?: string;
}

// ─── Appointment types ────────────────────────────────────────────────────────

export type AppointmentStatus =
  | 'pending'
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'no_show'
  | 'rescheduled';

export interface Appointment {
  id: string;
  clinicId: string;
  clinicTimezone?: string;
  patientId: string;
  doctorId: string;
  serviceId: string | null;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  confirmationCode: string | null;
  notes: string | null;
  cancellationReason: string | null;
  cancelledAt: string | null;
  rescheduledFrom: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  // Relations (may be included)
  patient?: PatientSummary;
  doctor?: DoctorSummary;
  service?: ServiceSummary;
}

export interface AppointmentListItem {
  id: string;
  patientName: string;
  patientPhone: string;
  doctorName: string;
  serviceName: string | null;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  confirmationCode: string | null;
  clinicTimezone?: string;
}

export interface BookAppointmentRequest {
  doctorId: string;
  patientId: string;
  serviceId: string;
  startsAt: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface CancelAppointmentRequest {
  reason: string;
}

export interface RescheduleAppointmentRequest {
  newStartsAt: string;
  reason?: string;
}

export interface AppointmentFilters extends PaginationParams {
  status?: AppointmentStatus;
  doctorId?: string;
  serviceId?: string;
  patientId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  sortBy?: 'startsAt' | 'createdAt' | 'status' | 'patientName';
  sortOrder?: 'asc' | 'desc';
}

// ─── Patient types ────────────────────────────────────────────────────────────

export interface Patient {
  id: string;
  clinicId: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PatientSummary {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
}

export interface PatientFilters extends PaginationParams {
  search?: string;
  isActive?: boolean;
  sortBy?: 'lastName' | 'firstName' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
}

export interface UpsertPatientRequest {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  dateOfBirth?: string;
  gender?: string;
  notes?: string;
}

// ─── Doctor types ─────────────────────────────────────────────────────────────

export interface Doctor {
  id: string;
  clinicId: string;
  displayName: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  title?: string | null;
  qualifications?: string | null;
  specialty?: string | null;
  specialization?: string | null;
  experienceYears?: number | null;
  licenseNumber?: string | null;
  bio?: string | null;
  email?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  active: boolean;
  isActive: boolean;
  defaultBufferMinutes: number;
  color?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface DoctorSummary {
  id: string;
  displayName: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  title?: string | null;
  qualifications?: string | null;
  specialty?: string | null;
  specialization?: string | null;
  experienceYears?: number | null;
  color?: string | null;
}

export interface UpsertDoctorRequest {
  displayName?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  title?: string | null;
  qualifications?: string | null;
  specialty?: string | null;
  specialization?: string | null;
  experienceYears?: number | null;
  licenseNumber?: string | null;
  bio?: string | null;
  email?: string | null;
  phone?: string | null;
  active?: boolean;
  isActive?: boolean;
  defaultBufferMinutes?: number;
  color?: string | null;
}

// ─── Service types ────────────────────────────────────────────────────────────

export interface Service {
  id: string;
  clinicId: string;
  code?: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  bufferMinutes?: number;
  price: number | null;
  currency: string | null;
  pricingModel?: 'fixed' | 'starting_from' | 'quote_required';
  category?: string | null;
  isActive: boolean;
  active?: boolean;
  preparationInstructions?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ServiceSummary {
  id: string;
  name: string;
  durationMinutes: number;
  price: number | null;
  currency: string | null;
  pricingModel?: string;
}

export interface UpsertServiceRequest {
  name: string;
  code?: string;
  description?: string;
  durationMinutes: number;
  bufferMinutes?: number;
  price?: number | null;
  currency?: string;
  pricingModel?: 'fixed' | 'starting_from' | 'quote_required';
  category?: string;
  active?: boolean;
  preparationInstructions?: string;
}

export interface HolidayOverride {
  id: string;
  clinicId: string;
  holidayDate: string; // YYYY-MM-DD
  holidayName: string;
  countryCode: string;
  action: 'closed' | 'working_day' | 'modified_hours';
  customOpensAt: string | null;
  customClosesAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocationHoliday {
  date: string; // YYYY-MM-DD
  name: string;
  countryCode: string;
  isPublicHoliday: boolean;
  status: 'closed' | 'working_day' | 'modified_hours' | 'custom_closure';
  opensAt?: string;
  closesAt?: string;
  notes?: string;
  overrideId?: string;
  scheduleBlockId?: string;
}

// ─── Availability types ───────────────────────────────────────────────────────

export interface AvailabilitySlot {
  startsAt: string;
  endsAt: string;
  available: boolean;
  doctorId: string;
}

export interface SearchAvailabilityParams {
  doctorId?: string;
  serviceId: string;
  date: string; // ISO date YYYY-MM-DD
}

// ─── Working hours ────────────────────────────────────────────────────────────

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0=Sunday

export interface WorkingHours {
  id: string;
  clinicId: string;
  doctorId: string | null;
  dayOfWeek: DayOfWeek;
  opensAt: string; // HH:MM
  closesAt: string; // HH:MM
  isOpen: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ClinicClosure {
  id: string;
  clinicId: string;
  date: string; // YYYY-MM-DD
  reason: string | null;
  isFullDay: boolean;
  opensAt: string | null;
  closesAt: string | null;
  createdAt: string;
}

// ─── Conversation types ───────────────────────────────────────────────────────

export type ConversationStatus = 'open' | 'closed' | 'pending' | 'handoff';
export type ConversationChannel = 'whatsapp' | 'sms' | 'email' | 'voice' | 'web';

export interface Conversation {
  id: string;
  clinicId: string;
  patientId: string | null;
  channel: ConversationChannel;
  status: ConversationStatus;
  contactPhone: string | null;
  contactName: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
  patient?: PatientSummary;
  messageCount?: number;
  lastMessage?: string;
}

export interface ConversationFilters extends PaginationParams {
  status?: ConversationStatus;
  channel?: ConversationChannel;
  patientId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}

// ─── Message types ────────────────────────────────────────────────────────────

export type MessageDirection = 'inbound' | 'outbound';
export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface Message {
  id: string;
  conversationId: string;
  clinicId: string;
  direction: MessageDirection;
  content: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  status: MessageStatus;
  providerMessageId: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failureReason: string | null;
  sentAt: string | null;
  createdAt: string;
}

// ─── Handoff types ────────────────────────────────────────────────────────────

export type HandoffStatus = 'pending' | 'accepted' | 'resolved' | 'escalated';
export type HandoffPriority = 'low' | 'medium' | 'high' | 'urgent';
export type HandoffChannel = 'whatsapp' | 'phone' | 'email' | 'web';

export interface Handoff {
  id: string;
  clinicId: string;
  conversationId: string | null;
  patientId: string | null;
  channel: HandoffChannel;
  status: HandoffStatus;
  priority: HandoffPriority;
  reason: string | null;
  context: Record<string, unknown> | null;
  assignedTo: string | null;
  acceptedAt: string | null;
  resolvedAt: string | null;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
  patient?: PatientSummary;
  conversation?: Pick<Conversation, 'id' | 'channel' | 'contactPhone' | 'contactName'>;
  assignee?: TeamMemberSummary;
}

export interface HandoffFilters extends PaginationParams {
  status?: HandoffStatus;
  priority?: HandoffPriority;
  assignedTo?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface ResolveHandoffRequest {
  resolution: string;
}

// ─── Notification types ───────────────────────────────────────────────────────

export type NotificationType =
  | 'appointment_reminder'
  | 'appointment_confirmation'
  | 'appointment_cancelled'
  | 'appointment_rescheduled'
  | 'handoff_assigned'
  | 'general';

export type NotificationStatus = 'pending' | 'claimed' | 'sent' | 'failed' | 'skipped';

export interface Notification {
  id: string;
  clinicId: string;
  type: NotificationType;
  channel: string;
  recipient: string;
  content: Record<string, unknown>;
  status: NotificationStatus;
  attempts: number;
  lastAttemptAt: string | null;
  sentAt: string | null;
  failureReason: string | null;
  scheduledFor: string | null;
  createdAt: string;
}

// ─── Team types ───────────────────────────────────────────────────────────────

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export interface TeamMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  isActive: boolean;
  invitationStatus: InvitationStatus | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface TeamMemberSummary {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface InviteTeamMemberRequest {
  email: string;
  firstName: string;
  lastName: string;
  role: string;
}

// ─── Configuration / Knowledge base ──────────────────────────────────────────

export interface ClinicConfiguration {
  id: string;
  clinicId: string;
  key: string;
  value: unknown;
  updatedAt: string;
}

export interface ReceptionistSettings {
  enabled: boolean;
  greeting: string | null;
  tone: 'professional' | 'friendly' | 'formal' | null;
  bookingEnabled: boolean;
  handoffEnabled: boolean;
  afterHoursBehavior: 'message' | 'voicemail' | 'off' | null;
  fallbackMessage: string | null;
}

// ─── Integration types ────────────────────────────────────────────────────────

export type IntegrationStatus = 'not_configured' | 'configured' | 'error' | 'healthy';

export interface WhatsAppIntegration {
  id: string;
  clinicId: string;
  status: IntegrationStatus;
  businessPhoneNumber: string | null;
  displayName: string | null;
  isActive: boolean;
  lastHealthCheckAt: string | null;
  lastHealthCheckStatus: 'ok' | 'error' | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Dashboard metrics ────────────────────────────────────────────────────────

export interface DashboardMetrics {
  today: {
    total: number;
    confirmed: number;
    pending: number;
    completed: number;
    cancelled: number;
    noShow: number;
  };
  upcoming: {
    next7Days: number;
    next30Days: number;
  };
  patients: {
    total: number;
    newThisMonth: number;
  };
  conversations: {
    openCount: number;
    pendingHandoffs: number;
    unread: number;
  };
  dentists: {
    active: number;
    total: number;
  };
  generatedAt: string;
}

// ─── Reports ──────────────────────────────────────────────────────────────────

export interface AppointmentReport {
  dateRange: { from: string; to: string };
  total: number;
  byStatus: Record<AppointmentStatus, number>;
  byDoctor: Array<{ doctorId: string; doctorName: string; count: number }>;
  byService: Array<{ serviceId: string; serviceName: string; count: number }>;
  byDay: Array<{ date: string; count: number }>;
}

// ─── Audit log ────────────────────────────────────────────────────────────────

export interface AuditLogEntry {
  id: string;
  clinicId: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  changes: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

// ─── FAQ ──────────────────────────────────────────────────────────────────────

export interface Faq {
  id: string;
  clinicId: string;
  question: string;
  answer: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertFaqRequest {
  question: string;
  answer: string;
  isActive?: boolean;
  sortOrder?: number;
}
