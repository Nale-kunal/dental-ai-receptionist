/**
 * API Client for Dental AI Receptionist Clinic Admin Dashboard
 * Direct integration with Node/Express backend on port 3001
 *
 * Supports transparent, production-isolated Demo Mode delegation.
 * When demoMode is active, all operations delegate to demoStore in memory.
 * No HTTP requests are dispatched to backend or database.
 */

import { demoStore } from '../demo/demoStore';

const API_BASE = '/api/v1';

export interface ApiResponse<T> {
  ok: boolean;
  code: string;
  message: string;
  data: T;
  errors?: Array<{ field: string; message: string }>;
}

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  clinicId: string;
  clinicName: string;
  clinicTimezone?: string;
  role: string;
  roles: string[];
}

export interface WhatsAppIntegrationData {
  clinicId: string;
  phoneNumberId: string | null;
  wabaId: string | null;
  enabled: boolean;
  status: 'unconfigured' | 'unvalidated' | 'valid' | 'invalid' | 'expired';
  hasToken: boolean;
  maskedToken: string;
  tokenExpiresAt: string | null;
  lastValidatedAt: string | null;
  lastError: string | null;
}

export interface UpdateWhatsAppIntegrationPayload {
  phoneNumberId?: string;
  wabaId?: string;
  accessToken?: string;
  enabled?: boolean;
  validateNow?: boolean;
}

export interface ValidateIntegrationResult {
  valid: boolean;
  status: 'valid' | 'invalid' | 'unvalidated' | 'unconfigured' | 'expired';
  message: string;
  verifiedName?: string;
  displayPhoneNumber?: string;
  qualityRating?: string;
  codeVerificationStatus?: string;
}

function isTokenExpired(token: string | null): boolean {
  if (!token) return true;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return true;
    const base64Url = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64Url)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const parsed = JSON.parse(jsonPayload);
    if (!parsed.exp) return false;
    // Check if expired or within 45 seconds of expiring
    return parsed.exp * 1000 < Date.now() + 45000;
  } catch {
    return true;
  }
}

class ApiClient {
  private token: string | null = null;
  private refreshToken: string | null = null;
  private user: AuthUser | null = null;
  private authPromise: Promise<boolean> | null = null;
  private demoMode: boolean = false;

  constructor() {
    this.token = localStorage.getItem('dental_token');
    this.refreshToken = localStorage.getItem('dental_refresh_token');
    const savedUser = localStorage.getItem('dental_user');
    if (savedUser) {
      try {
        this.user = JSON.parse(savedUser);
      } catch (e) {
        this.user = null;
      }
    }
  }

  // --- Demo Mode Control ---

  public isDemoMode(): boolean {
    return this.demoMode;
  }

  public setDemoMode(enabled: boolean): void {
    this.demoMode = enabled;
  }

  public getToken(): string | null {
    if (this.demoMode) return 'demo-synthetic-session-token';
    return this.token;
  }

  public getUser(): AuthUser | null {
    if (this.demoMode) {
      return demoStore.getUser();
    }
    return this.user;
  }

  public setSession(token: string, user: AuthUser, refreshToken?: string) {
    this.token = token;
    this.user = user;
    if (refreshToken) {
      this.refreshToken = refreshToken;
      localStorage.setItem('dental_refresh_token', refreshToken);
    }
    localStorage.setItem('dental_token', token);
    localStorage.setItem('dental_user', JSON.stringify(user));
  }

  public clearSession() {
    this.token = null;
    this.refreshToken = null;
    this.user = null;
    localStorage.removeItem('dental_token');
    localStorage.removeItem('dental_refresh_token');
    localStorage.removeItem('dental_user');
  }

  public async ensureAuthenticated(): Promise<boolean> {
    // If in demo mode, session is always valid and authenticated
    if (this.demoMode) {
      return true;
    }

    // If active and valid token exists, return immediately
    if (this.token && !isTokenExpired(this.token) && this.user) {
      return true;
    }

    // Deduplicate in-flight authentication attempts
    if (this.authPromise) {
      return this.authPromise;
    }

    this.authPromise = (async () => {
      try {
        // 1. Try refresh token if available
        if (this.refreshToken) {
          try {
            const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refreshToken: this.refreshToken }),
            });
            const refreshJson: any = await refreshRes.json();
            if (refreshRes.ok && refreshJson.ok && refreshJson.data?.accessToken) {
              this.token = refreshJson.data.accessToken;
              localStorage.setItem('dental_token', this.token!);
              return true;
            }
          } catch {
            // Refresh failed
          }
        }

        // Clean tenant isolation: Never automatically fall back to demo clinic credentials.
        // If unauthenticated or token expired, return false so the user is directed to LoginView.
        this.clearSession();
        return false;
      } catch (e) {
        console.warn('Session verification notice:', e);
        this.clearSession();
        return false;
      } finally {
        this.authPromise = null;
      }
    })();

    return this.authPromise;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    // Fail-closed safety guard: Never issue live HTTP calls while in demo mode
    if (this.demoMode) {
      throw new Error(`Demo Mode Safety Violation: Attempted live HTTP request to ${endpoint}`);
    }

    // Make sure we have a valid unexpired token before firing request
    if (!endpoint.includes('/auth/login') && !endpoint.includes('/auth/signup') && isTokenExpired(this.token)) {
      await this.ensureAuthenticated();
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    let response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    if (response.status === 401 && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/signup')) {
      // Try refresh once
      const reAuthed = await this.ensureAuthenticated();
      if (reAuthed && this.token) {
        headers['Authorization'] = `Bearer ${this.token}`;
        response = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
      } else {
        this.clearSession();
      }
    }

    const json: ApiResponse<T> = await response.json();
    if (!response.ok || !json.ok) {
      const errorMsg = json.message || `Request failed with status ${response.status}`;
      const err: any = new Error(errorMsg);
      err.data = json.data;
      err.code = json.code;
      err.status = response.status;
      throw err;
    }

    return json.data;
  }

  // --- Auth ---
  public async login(email: string, password: string) {
    if (this.demoMode) {
      return {
        user: demoStore.getUser(),
        accessToken: 'demo-synthetic-session-token',
        refreshToken: 'demo-synthetic-refresh-token',
      };
    }
    const res = await this.request<{ user: AuthUser; accessToken: string; refreshToken?: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.setSession(res.accessToken, res.user, res.refreshToken);
    return res;
  }

  public async signup(data: {
    clinicName: string;
    email: string;
    fullName: string;
    password: string;
    timezone?: string;
    phone?: string;
  }) {
    if (this.demoMode) {
      const user = demoStore.getUser();
      const clinic = demoStore.getClinic();
      return {
        user,
        clinic,
        accessToken: 'demo-synthetic-session-token',
        refreshToken: 'demo-synthetic-refresh-token',
      };
    }
    const res = await this.request<{
      user: AuthUser;
      clinic: { id: string; name: string; slug: string; timezone: string };
      accessToken: string;
      refreshToken: string;
    }>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    this.setSession(res.accessToken, res.user, res.refreshToken);
    return res;
  }

  public async logout() {
    if (this.demoMode) {
      this.setDemoMode(false);
      return;
    }
    try {
      if (this.refreshToken) {
        await fetch(`${API_BASE}/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: this.refreshToken }),
        });
      }
    } catch {
      // Ignore network errors on logout
    } finally {
      this.clearSession();
    }
  }

  // --- Appointments ---
  public async getAppointments(params?: {
    page?: number;
    pageSize?: number;
    status?: string;
    doctorId?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
  }) {
    if (this.demoMode) {
      return demoStore.getAppointments(params);
    }
    const query = new URLSearchParams();
    if (params?.page) query.set('page', params.page.toString());
    if (params?.pageSize) query.set('pageSize', params.pageSize.toString());
    if (params?.status && params.status !== 'all') query.set('status', params.status);
    if (params?.doctorId && params.doctorId !== 'all') query.set('doctorId', params.doctorId);
    if (params?.dateFrom) query.set('dateFrom', params.dateFrom);
    if (params?.dateTo) query.set('dateTo', params.dateTo);
    if (params?.search) query.set('search', params.search);

    const qs = query.toString();
    return this.request<{
      items: any[];
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    }>(`/appointments${qs ? `?${qs}` : ''}`);
  }

  public async getAppointment(id: string) {
    if (this.demoMode) {
      return demoStore.getAppointment(id);
    }
    return this.request<any>(`/appointments/${id}`);
  }

  public async bookAppointment(data: {
    doctorId: string;
    patientId: string;
    serviceId: string;
    startsAt: string;
    notes?: string;
  }) {
    if (this.demoMode) {
      return demoStore.bookAppointment(data);
    }
    return this.request<any>('/appointments', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public async rescheduleAppointment(id: string, newStartsAt: string, reason?: string) {
    if (this.demoMode) {
      return demoStore.rescheduleAppointment(id, newStartsAt, reason);
    }
    return this.request<any>(`/appointments/${id}/reschedule`, {
      method: 'POST',
      body: JSON.stringify({ newStartsAt, reason }),
    });
  }

  public async cancelAppointment(id: string, reason: string) {
    if (this.demoMode) {
      return demoStore.cancelAppointment(id, reason);
    }
    return this.request<any>(`/appointments/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  public async getAppointmentHistory(id: string) {
    if (this.demoMode) {
      return demoStore.getAppointmentHistory(id);
    }
    return this.request<any[]>(`/appointments/${id}/history`);
  }

  // --- Patients ---
  public async getPatients(params?: { page?: number; pageSize?: number; search?: string }) {
    if (this.demoMode) {
      return demoStore.getPatients(params);
    }
    const query = new URLSearchParams();
    if (params?.page) query.set('page', params.page.toString());
    if (params?.pageSize) query.set('pageSize', params.pageSize.toString());
    if (params?.search) query.set('search', params.search);
    const qs = query.toString();
    return this.request<{
      items: any[];
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    }>(`/patients${qs ? `?${qs}` : ''}`);
  }

  public async getPatient(id: string) {
    if (this.demoMode) {
      return demoStore.getPatient(id);
    }
    return this.request<any>(`/patients/${id}`);
  }

  public async createPatient(data: {
    fullName: string;
    phone: string;
    email?: string;
    dateOfBirth?: string;
    notes?: string;
    whatsappId?: string;
  }) {
    if (this.demoMode) {
      return demoStore.createPatient(data);
    }
    return this.request<any>('/patients', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public async updatePatient(
    id: string,
    data: {
      fullName?: string;
      phone?: string;
      email?: string;
      dateOfBirth?: string;
      notes?: string;
    }
  ) {
    if (this.demoMode) {
      return demoStore.updatePatient(id, data);
    }
    return this.request<any>(`/patients/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  public async getPatientAppointments(patientId: string) {
    if (this.demoMode) {
      return demoStore.getPatientAppointments(patientId);
    }
    return this.request<any[]>(`/patients/${patientId}/appointments`);
  }

  // --- Doctors / Dentists ---
  public async getDoctors() {
    if (this.demoMode) {
      return demoStore.getDoctors();
    }
    return this.request<any[]>('/doctors');
  }

  public async getDoctor(id: string) {
    if (this.demoMode) {
      return demoStore.getDoctor(id);
    }
    return this.request<any>(`/doctors/${id}`);
  }

  public async createDoctor(data: {
    displayName: string;
    title?: string;
    qualifications?: string;
    specialty?: string;
    experienceYears?: number;
    licenseNumber?: string;
    bio?: string;
    defaultBufferMinutes?: number;
    active?: boolean;
  }) {
    if (this.demoMode) {
      return demoStore.createDoctor(data);
    }
    return this.request<any>('/doctors', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public async updateDoctor(
    id: string,
    data: {
      displayName?: string;
      title?: string;
      qualifications?: string;
      specialty?: string;
      experienceYears?: number;
      licenseNumber?: string;
      bio?: string;
      defaultBufferMinutes?: number;
      active?: boolean;
    }
  ) {
    if (this.demoMode) {
      return demoStore.updateDoctor(id, data);
    }
    return this.request<any>(`/doctors/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  public async deleteDoctor(id: string) {
    if (this.demoMode) {
      return demoStore.deleteDoctor(id);
    }
    return this.request<any>(`/doctors/${id}`, {
      method: 'DELETE',
    });
  }

  public async setDoctorStatus(id: string, active: boolean) {
    if (this.demoMode) {
      return demoStore.setDoctorStatus(id, active);
    }
    return this.request<any>(`/doctors/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ active }),
    });
  }

  // --- Services ---
  public async getServices() {
    if (this.demoMode) {
      return demoStore.getServices();
    }
    return this.request<any[]>('/services');
  }

  public async getService(id: string) {
    if (this.demoMode) {
      return demoStore.getService(id);
    }
    return this.request<any>(`/services/${id}`);
  }

  public async createService(data: {
    name: string;
    code?: string;
    durationMinutes: number;
    bufferMinutes?: number;
    price?: number | null;
    currency?: string;
    pricingModel?: 'fixed' | 'starting_from' | 'quote_required';
    description?: string | null;
    category?: string | null;
    active?: boolean;
  }) {
    if (this.demoMode) {
      return demoStore.createService(data);
    }
    return this.request<any>('/services', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public async updateService(id: string, data: {
    name?: string;
    code?: string;
    durationMinutes?: number;
    bufferMinutes?: number;
    price?: number | null;
    currency?: string;
    pricingModel?: 'fixed' | 'starting_from' | 'quote_required';
    description?: string | null;
    category?: string | null;
    active?: boolean;
  }) {
    if (this.demoMode) {
      return demoStore.updateService(id, data);
    }
    return this.request<any>(`/services/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  public async deleteService(id: string) {
    if (this.demoMode) {
      return demoStore.deleteService(id);
    }
    return this.request<any>(`/services/${id}`, {
      method: 'DELETE',
    });
  }

  // --- Handoffs ---
  public async getHandoffs(status?: string) {
    if (this.demoMode) {
      return demoStore.getHandoffs(status);
    }
    const qs = status ? `?status=${status}` : '';
    return this.request<{
      items: any[];
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    }>(`/handoffs${qs}`);
  }

  public async resolveHandoff(id: string, notes: string) {
    if (this.demoMode) {
      return demoStore.resolveHandoff(id, notes);
    }
    return this.request<any>(`/handoffs/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    });
  }

  // --- Conversations & Messages ---
  public async getConversations(params?: { page?: number; pageSize?: number; search?: string }) {
    if (this.demoMode) {
      return demoStore.getConversations(params);
    }
    const query = new URLSearchParams();
    if (params?.page) query.set('page', params.page.toString());
    if (params?.pageSize) query.set('pageSize', params.pageSize.toString());
    if (params?.search) query.set('search', params.search);
    const qs = query.toString();
    return this.request<{
      items: any[];
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    }>(`/conversations${qs ? `?${qs}` : ''}`);
  }

  public async getConversation(id: string) {
    if (this.demoMode) {
      return demoStore.getConversation(id);
    }
    return this.request<{ conversation: any; messages: any[] }>(`/conversations/${id}`);
  }

  public async sendMessage(conversationId: string, body: string, resolveHandoff = false) {
    if (this.demoMode) {
      return demoStore.sendMessage(conversationId, body, resolveHandoff);
    }
    return this.request<{
      id: string;
      conversationId: string;
      direction: string;
      kind: string;
      body: string;
      content: string;
      deliveryStatus: string;
      providerStatus: string;
      providerMessage?: string;
      providerMessageId?: string;
      createdAt: string;
      handoffResolved?: boolean;
      conversationDeletedConcurrently?: boolean;
      deliveryHistoryPreserved?: boolean;
    }>(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body, resolveHandoff }),
    });
  }

  public async closeConversation(id: string, reason = 'staff_action') {
    if (this.demoMode) {
      return demoStore.closeConversation(id, reason);
    }
    return this.request<any>(`/conversations/${id}/close`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    });
  }

  public async deleteConversation(id: string) {
    if (this.demoMode) {
      return demoStore.deleteConversation(id);
    }
    return this.request<{ id: string; deleted: boolean }>(`/conversations/${id}`, {
      method: 'DELETE',
    });
  }

  public async deleteConversationsBulk(conversationIds: string[]) {
    if (this.demoMode) {
      return demoStore.deleteConversationsBulk(conversationIds);
    }
    return this.request<{ deletedCount: number; deletedIds: string[] }>('/conversations/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ conversationIds }),
    });
  }

  public async deleteAllConversations() {
    if (this.demoMode) {
      return demoStore.deleteAllConversations();
    }
    return this.request<{ deletedCount: number; deletedIds: string[] }>('/conversations/delete-all', {
      method: 'POST',
      body: JSON.stringify({ confirm: true }),
    });
  }

  public async syncConversations(since?: string, conversationId?: string) {
    if (this.demoMode) {
      return demoStore.syncConversations(since, conversationId);
    }
    const query = new URLSearchParams();
    if (since) query.set('since', since);
    if (conversationId) query.set('conversationId', conversationId);
    const qs = query.toString();
    return this.request<{
      messages: any[];
      serverTime: string;
    }>(`/conversations/sync${qs ? `?${qs}` : ''}`);
  }

  public async getStreamTicket(): Promise<string> {
    if (this.demoMode) {
      return demoStore.getStreamTicket();
    }
    const res = await this.request<{ ticket: string }>('/conversations/stream-ticket', {
      method: 'POST',
    });
    return res.ticket;
  }

  public getConversationStreamUrl(ticket?: string): string {
    if (this.demoMode) {
      return demoStore.getConversationStreamUrl(ticket);
    }
    return ticket
      ? `${API_BASE}/conversations/stream?ticket=${encodeURIComponent(ticket)}`
      : `${API_BASE}/conversations/stream`;
  }

  // --- Schedules ---
  public async getClinicHours() {
    if (this.demoMode) {
      return demoStore.getClinicHours();
    }
    return this.request<any[]>('/schedules/clinic');
  }

  public async updateClinicHours(hours: Array<{
    dayOfWeek: number;
    isOpen: boolean;
    opensAt: string;
    closesAt: string;
  }>) {
    if (this.demoMode) {
      return demoStore.updateClinicHours(hours);
    }
    return this.request<any[]>('/schedules/clinic', {
      method: 'PUT',
      body: JSON.stringify({ hours }),
    });
  }

  public async getDoctorSchedules(doctorId: string) {
    if (this.demoMode) {
      return demoStore.getDoctorSchedules(doctorId);
    }
    return this.request<any[]>(`/schedules/doctors/${doctorId}`);
  }

  public async updateDoctorSchedule(doctorId: string, schedules: Array<{
    dayOfWeek: number;
    isWorking: boolean;
    startsAt: string;
    endsAt: string;
  }>) {
    if (this.demoMode) {
      return demoStore.updateDoctorSchedule(doctorId, schedules);
    }
    return this.request<any[]>(`/schedules/doctors/${doctorId}`, {
      method: 'PUT',
      body: JSON.stringify({ schedules }),
    });
  }

  public async getScheduleBlocks(dentistId?: string) {
    if (this.demoMode) {
      return demoStore.getScheduleBlocks(dentistId);
    }
    const qs = dentistId ? `?dentistId=${dentistId}` : '';
    return this.request<any[]>(`/schedules/blocks${qs}`);
  }

  public async checkBlockConflicts(data: { startsAt: string; endsAt: string; dentistId?: string | null }) {
    if (this.demoMode) {
      return demoStore.checkBlockConflicts(data);
    }
    return this.request<{
      hasConflicts: boolean;
      conflictCount: number;
      conflicts: any[];
    }>('/schedules/blocks/check-conflicts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public async createScheduleBlock(data: {
    kind: string;
    startsAt: string;
    endsAt: string;
    reason: string;
    dentistId?: string | null;
    ignoreConflicts?: boolean;
  }) {
    if (this.demoMode) {
      return demoStore.createScheduleBlock(data);
    }
    return this.request<any>('/schedules/blocks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public async updateScheduleBlock(id: string, data: {
    kind: string;
    startsAt: string;
    endsAt: string;
    reason: string;
    dentistId?: string | null;
  }) {
    if (this.demoMode) {
      return demoStore.updateScheduleBlock(id, data);
    }
    return this.request<any>(`/schedules/blocks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  public async deleteScheduleBlock(id: string) {
    if (this.demoMode) {
      return demoStore.deleteScheduleBlock(id);
    }
    return this.request<{ id: string }>(`/schedules/blocks/${id}`, {
      method: 'DELETE',
    });
  }

  // --- Location-Aware Public Holidays & Clinic Overrides ---
  public async getHolidays(year?: number) {
    if (this.demoMode) {
      return demoStore.getHolidays(year);
    }
    return this.request<{
      countryCode: string;
      year: number;
      holidays: any[];
    }>(`/schedules/holidays${year ? `?year=${year}` : ''}`);
  }

  public async setHolidayOverride(data: {
    holidayDate: string;
    holidayName: string;
    action: 'closed' | 'working_day' | 'modified_hours';
    customOpensAt?: string;
    customClosesAt?: string;
    notes?: string;
  }) {
    if (this.demoMode) {
      return demoStore.setHolidayOverride(data);
    }
    return this.request<any>('/schedules/holidays/override', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  public async deleteHolidayOverride(overrideId: string) {
    if (this.demoMode) {
      return demoStore.deleteHolidayOverride(overrideId);
    }
    return this.request<any>(`/schedules/holidays/override/${overrideId}`, {
      method: 'DELETE',
    });
  }

  // --- Availability ---
  public async getAvailability(params: { date: string; doctorId?: string; serviceId?: string }) {
    if (this.demoMode) {
      return demoStore.getAvailability(params);
    }
    const query = new URLSearchParams();
    query.set('date', params.date);
    if (params.doctorId) query.set('doctorId', params.doctorId);
    if (params.serviceId) query.set('serviceId', params.serviceId);
    return this.request<{ date: string; doctorId?: string; serviceId?: string; slots: any[] }>(
      `/availability/slots?${query.toString()}`
    );
  }

  // --- Receptionist Settings ---
  public async getReceptionistSettings() {
    if (this.demoMode) {
      return demoStore.getReceptionistSettings();
    }
    return this.request<any>('/receptionist/settings');
  }

  public async updateReceptionistSettings(settings: any) {
    if (this.demoMode) {
      return demoStore.updateReceptionistSettings(settings);
    }
    return this.request<any>('/receptionist/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  // --- WhatsApp Cloud API Integration ---
  public async getWhatsAppIntegration(): Promise<WhatsAppIntegrationData> {
    if (this.demoMode) {
      return demoStore.getWhatsAppIntegration();
    }
    return this.request<WhatsAppIntegrationData>('/receptionist/integration');
  }

  public async updateWhatsAppIntegration(data: UpdateWhatsAppIntegrationPayload): Promise<{
    clinicId: string;
    phoneNumberId: string | null;
    wabaId: string | null;
    enabled: boolean;
    status: string;
    hasToken: boolean;
    maskedToken: string;
    validation?: ValidateIntegrationResult | null;
  }> {
    if (this.demoMode) {
      return demoStore.updateWhatsAppIntegration(data);
    }
    return this.request('/receptionist/integration', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  public async validateWhatsAppIntegration(): Promise<ValidateIntegrationResult> {
    if (this.demoMode) {
      return demoStore.validateWhatsAppIntegration();
    }
    try {
      const res = await this.request<ValidateIntegrationResult>('/receptionist/integration/validate', {
        method: 'POST',
      });
      return res;
    } catch (err: any) {
      if (err.data && typeof err.data.valid === 'boolean') {
        return err.data as ValidateIntegrationResult;
      }
      throw err;
    }
  }

  // --- Reports & Analytics ---
  public async getReportsSummary(from?: string, to?: string) {
    if (this.demoMode) {
      return demoStore.getReportsSummary(from, to);
    }
    const query = new URLSearchParams();
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    const qs = query.toString();
    return this.request<any>(`/reports/summary${qs ? `?${qs}` : ''}`);
  }

  public async getStatusBreakdown() {
    if (this.demoMode) {
      return demoStore.getStatusBreakdown();
    }
    return this.request<any[]>('/reports/appointments-by-status');
  }

  public async getHourlyDistribution() {
    if (this.demoMode) {
      return demoStore.getHourlyDistribution();
    }
    return this.request<any[]>('/reports/peak-hours');
  }

  // --- Clinic Profile & Context ---
  public async getClinic() {
    if (this.demoMode) {
      return demoStore.getClinic();
    }
    return this.request<any>('/clinic');
  }

  public async updateClinic(data: any) {
    if (this.demoMode) {
      return demoStore.updateClinic(data);
    }
    return this.request<any>('/clinic', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  public async getClinicContext() {
    if (this.demoMode) {
      return demoStore.getClinicContext();
    }
    return this.request<any>('/clinic/context');
  }

  // --- Audit Trail ---
  public async getAuditLog(params?: { page?: number; pageSize?: number }) {
    if (this.demoMode) {
      return demoStore.getAuditLog(params);
    }
    const query = new URLSearchParams();
    if (params?.page) query.set('page', params.page.toString());
    if (params?.pageSize) query.set('pageSize', params.pageSize.toString());
    const qs = query.toString();
    return this.request<{
      items: any[];
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    }>(`/audit${qs ? `?${qs}` : ''}`);
  }
}

export const api = new ApiClient();
