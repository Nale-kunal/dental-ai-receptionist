/**
 * In-Memory Demo Store for BrightSmile Dental Studio
 *
 * Provides a fully functional, production-isolated in-memory data store for the
 * live demo mode. All mutations (create, update, reschedule, cancel, delete)
 * operate exclusively on in-memory state. Zero network requests or database
 * operations occur while demo mode is active.
 *
 * Calling reset() restores the immutable baseline dataset.
 */

import { createDemoBaseline, DemoBaselineData } from './fixtures';

export interface DemoWhatsAppIntegrationData {
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

export interface DemoUpdateWhatsAppIntegrationPayload {
  phoneNumberId?: string;
  wabaId?: string;
  accessToken?: string;
  enabled?: boolean;
  validateNow?: boolean;
}

export interface DemoValidateIntegrationResult {
  valid: boolean;
  status: 'valid' | 'invalid' | 'unvalidated' | 'unconfigured' | 'expired';
  message: string;
  verifiedName?: string;
  displayPhoneNumber?: string;
  qualityRating?: string;
  codeVerificationStatus?: string;
}

export class DemoStore {
  private data!: DemoBaselineData;

  constructor() {
    this.reset();
  }

  /**
   * Resets the working demo state to a freshly anchored baseline.
   */
  public reset(): void {
    // Deep clone baseline to prevent reference sharing
    this.data = JSON.parse(JSON.stringify(createDemoBaseline(new Date())));
  }

  // --- Clinic & User Profile ---

  public getClinic(): any {
    return { ...this.data.clinic };
  }

  public updateClinic(updates: any): any {
    this.data.clinic = {
      ...this.data.clinic,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    return { ...this.data.clinic };
  }

  public getUser(): any {
    return { ...this.data.user };
  }

  public getClinicContext(): any {
    return {
      clinic: { ...this.data.clinic },
      settings: { ...this.data.receptionistSettings },
      doctors: [...this.data.doctors],
      services: [...this.data.services],
    };
  }

  // --- Appointments ---

  public getAppointments(params?: {
    page?: number;
    pageSize?: number;
    status?: string;
    doctorId?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
  }): {
    items: any[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  } {
    let list = [...this.data.appointments];

    // Status filter
    if (params?.status && params.status !== 'all') {
      const targetStatus = params.status.toLowerCase();
      list = list.filter((a) => (a.status || '').toLowerCase() === targetStatus);
    }

    // Doctor filter
    if (params?.doctorId && params.doctorId !== 'all') {
      list = list.filter((a) => a.doctorId === params.doctorId);
    }

    // Date range filter
    if (params?.dateFrom) {
      const fromTime = new Date(params.dateFrom).getTime();
      list = list.filter((a) => new Date(a.startsAt).getTime() >= fromTime);
    }
    if (params?.dateTo) {
      const toTime = new Date(params.dateTo).getTime();
      list = list.filter((a) => new Date(a.startsAt).getTime() <= toTime);
    }

    // Search filter
    if (params?.search && params.search.trim()) {
      const q = params.search.trim().toLowerCase();
      list = list.filter((a) => {
        const patName = (a.patient?.fullName || a.patientName || '').toLowerCase();
        const docName = (a.doctor?.displayName || a.doctorName || '').toLowerCase();
        const srvName = (a.service?.name || a.serviceName || '').toLowerCase();
        const notes = (a.notes || '').toLowerCase();
        const phone = (a.patient?.phone || '').toLowerCase();
        return (
          patName.includes(q) ||
          docName.includes(q) ||
          srvName.includes(q) ||
          notes.includes(q) ||
          phone.includes(q)
        );
      });
    }

    // Sort by startsAt ascending
    list.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

    const total = list.length;
    const page = Math.max(1, params?.page || 1);
    const pageSize = Math.max(1, params?.pageSize || 10);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const startIdx = (page - 1) * pageSize;
    const items = list.slice(startIdx, startIdx + pageSize);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages,
    };
  }

  public getAppointment(id: string): any {
    const appt = this.data.appointments.find((a) => a.id === id);
    if (!appt) {
      throw new Error(`Appointment ${id} not found in demo workspace.`);
    }
    return { ...appt };
  }

  public bookAppointment(data: {
    doctorId: string;
    patientId: string;
    serviceId: string;
    startsAt: string;
    notes?: string;
  }): any {
    const doctor = this.data.doctors.find((d) => d.id === data.doctorId);
    const patient = this.data.patients.find((p) => p.id === data.patientId);

    if (patient?.isArchived) {
      throw new Error(`Cannot book appointment for archived patient ${patient.fullName}. Please restore the patient first.`);
    }

    const service = this.data.services.find((s) => s.id === data.serviceId);

    const duration = service?.durationMinutes || 45;
    const startDate = new Date(data.startsAt);
    const endDate = new Date(startDate.getTime() + duration * 60000);

    const newAppt = {
      id: `demo-appt-${Date.now()}`,
      clinicId: this.data.clinic.id,
      doctorId: data.doctorId,
      doctor: doctor ? { ...doctor } : { displayName: 'Assigned Practitioner' },
      patientId: data.patientId,
      patient: patient
        ? { ...patient }
        : { fullName: 'Walk-in Patient', phone: '+1 512-555-0199' },
      serviceId: data.serviceId,
      service: service
        ? { ...service }
        : { name: 'General Dental Service', price: 120 },
      startsAt: data.startsAt,
      endsAt: endDate.toISOString(),
      status: 'CONFIRMED',
      source: 'web_admin',
      notes: data.notes || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.data.appointments.unshift(newAppt);

    // Also record audit event
    this.recordAudit({
      action: 'APPOINTMENT_BOOKED',
      entityType: 'appointment',
      entityId: newAppt.id,
      details: `Booked ${newAppt.service.name} for ${newAppt.patient.fullName} with ${newAppt.doctor.displayName}.`,
    });

    return newAppt;
  }

  public rescheduleAppointment(id: string, newStartsAt: string, reason?: string): any {
    const appt = this.data.appointments.find((a) => a.id === id);
    if (!appt) {
      throw new Error(`Appointment ${id} not found to reschedule.`);
    }

    const duration = appt.service?.durationMinutes || 45;
    const startDate = new Date(newStartsAt);
    const endDate = new Date(startDate.getTime() + duration * 60000);

    appt.startsAt = newStartsAt;
    appt.endsAt = endDate.toISOString();
    appt.status = 'CONFIRMED';
    appt.updatedAt = new Date().toISOString();
    if (reason) {
      appt.rescheduleReason = reason;
    }

    this.recordAudit({
      action: 'APPOINTMENT_RESCHEDULED',
      entityType: 'appointment',
      entityId: id,
      details: `Rescheduled appointment for ${appt.patient?.fullName || 'patient'} to ${newStartsAt}. Reason: ${reason || 'Patient request'}`,
    });

    return { ...appt };
  }

  public cancelAppointment(id: string, reason: string): any {
    const appt = this.data.appointments.find((a) => a.id === id);
    if (!appt) {
      throw new Error(`Appointment ${id} not found to cancel.`);
    }

    appt.status = 'CANCELLED';
    appt.cancellationReason = reason;
    appt.cancelledAt = new Date().toISOString();
    appt.updatedAt = new Date().toISOString();

    this.recordAudit({
      action: 'APPOINTMENT_CANCELLED',
      entityType: 'appointment',
      entityId: id,
      details: `Cancelled appointment for ${appt.patient?.fullName || 'patient'}. Reason: ${reason}`,
    });

    return { ...appt };
  }

  public getAppointmentHistory(id: string): any[] {
    const appt = this.data.appointments.find((a) => a.id === id);
    if (!appt) return [];

    return [
      {
        id: `hist-1-${id}`,
        appointmentId: id,
        action: 'CREATED',
        performedBy: 'Alex Morgan (AI Receptionist)',
        timestamp: appt.createdAt,
        details: 'Initial appointment booking confirmed via WhatsApp interaction.',
      },
      ...(appt.status === 'CANCELLED'
        ? [
            {
              id: `hist-2-${id}`,
              appointmentId: id,
              action: 'CANCELLED',
              performedBy: 'Clinic Admin',
              timestamp: appt.cancelledAt || appt.updatedAt,
              details: `Cancelled: ${appt.cancellationReason || 'Patient request'}`,
            },
          ]
        : []),
    ];
  }

  // --- Patients ---

  public getPatients(params?: {
    page?: number;
    pageSize?: number;
    search?: string;
  }): {
    items: any[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  } {
    let list = this.data.patients.filter((p) => p.isArchived !== true);

    if (params?.search && params.search.trim()) {
      const q = params.search.trim().toLowerCase();
      list = list.filter((p) => {
        const name = (p.fullName || '').toLowerCase();
        const phone = (p.phone || '').toLowerCase();
        const email = (p.email || '').toLowerCase();
        return name.includes(q) || phone.includes(q) || email.includes(q);
      });
    }

    const total = list.length;
    const page = Math.max(1, params?.page || 1);
    const pageSize = Math.max(1, params?.pageSize || 10);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const startIdx = (page - 1) * pageSize;
    const items = list.slice(startIdx, startIdx + pageSize);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages,
    };
  }

  public getArchivedPatients(params?: {
    page?: number;
    pageSize?: number;
    search?: string;
  }): {
    items: any[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  } {
    let list = this.data.patients.filter((p) => p.isArchived === true);

    if (params?.search && params.search.trim()) {
      const q = params.search.trim().toLowerCase();
      list = list.filter((p) => {
        const name = (p.fullName || '').toLowerCase();
        const phone = (p.phone || '').toLowerCase();
        const email = (p.email || '').toLowerCase();
        return name.includes(q) || phone.includes(q) || email.includes(q);
      });
    }

    const total = list.length;
    const page = Math.max(1, params?.page || 1);
    const pageSize = Math.max(1, params?.pageSize || 10);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const startIdx = (page - 1) * pageSize;
    const items = list.slice(startIdx, startIdx + pageSize);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages,
    };
  }

  public getArchivedPatientsCount(): number {
    return this.data.patients.filter((p) => p.isArchived === true).length;
  }

  public archivePatient(id: string, reason?: string): any {
    const patient = this.data.patients.find((p) => p.id === id);
    if (!patient) {
      throw new Error(`Patient ${id} not found.`);
    }
    if (patient.isArchived) {
      return { ...patient };
    }

    // Check for active upcoming appointments
    const now = new Date();
    const hasUpcoming = this.data.appointments.some((a) => {
      if (a.patientId !== id) return false;
      const status = (a.status || '').toLowerCase();
      const isPendingOrConfirmed = status === 'pending' || status === 'confirmed';
      const isUpcoming = new Date(a.startsAt).getTime() >= now.getTime();
      return isPendingOrConfirmed && isUpcoming;
    });

    if (hasUpcoming) {
      throw new Error('Cannot archive patient with active upcoming appointments. Please reschedule, complete, or cancel all upcoming appointments first.');
    }

    patient.isArchived = true;
    patient.archivedAt = new Date().toISOString();
    patient.archivedBy = this.data.user.id || 'usr-admin';
    patient.archiveReason = reason || null;
    patient.restoredAt = null;
    patient.restoredBy = null;
    patient.updatedAt = new Date().toISOString();

    this.recordAudit({
      action: 'PATIENT_ARCHIVED',
      entityType: 'patient',
      entityId: patient.id,
      details: `Archived patient ${patient.fullName}. Reason: ${reason || 'No reason provided'}`,
    });

    return { ...patient };
  }

  public restorePatient(id: string): any {
    const patient = this.data.patients.find((p) => p.id === id);
    if (!patient) {
      throw new Error(`Patient ${id} not found.`);
    }
    if (!patient.isArchived) {
      return { ...patient };
    }

    patient.isArchived = false;
    patient.restoredAt = new Date().toISOString();
    patient.restoredBy = this.data.user.id || 'usr-admin';
    patient.updatedAt = new Date().toISOString();

    this.recordAudit({
      action: 'PATIENT_RESTORED',
      entityType: 'patient',
      entityId: patient.id,
      details: `Restored patient ${patient.fullName} to active directory.`,
    });

    return { ...patient };
  }

  public getPatient(id: string): any {
    const patient = this.data.patients.find((p) => p.id === id);
    if (!patient) {
      throw new Error(`Patient ${id} not found in demo workspace.`);
    }
    const appts = this.data.appointments.filter((a) => a.patientId === id);
    return {
      ...patient,
      appointments: appts,
      appointmentCount: appts.length,
    };
  }

  public createPatient(data: {
    fullName: string;
    phone: string;
    email?: string;
    dateOfBirth?: string;
    notes?: string;
    whatsappId?: string;
  }): any {
    const newPatient = {
      id: `demo-pat-${Date.now()}`,
      clinicId: this.data.clinic.id,
      fullName: data.fullName,
      phone: data.phone,
      email: data.email || null,
      dateOfBirth: data.dateOfBirth || null,
      notes: data.notes || '',
      whatsappId: data.whatsappId || data.phone.replace(/[^0-9]/g, ''),
      isArchived: false,
      archivedAt: null,
      archivedBy: null,
      archiveReason: null,
      restoredAt: null,
      restoredBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.data.patients.unshift(newPatient);

    this.recordAudit({
      action: 'PATIENT_CREATED',
      entityType: 'patient',
      entityId: newPatient.id,
      details: `Registered new patient profile for ${newPatient.fullName} (${newPatient.phone}).`,
    });

    return newPatient;
  }

  public updatePatient(
    id: string,
    data: {
      fullName?: string;
      phone?: string;
      email?: string;
      dateOfBirth?: string;
      notes?: string;
    }
  ): any {
    const patient = this.data.patients.find((p) => p.id === id);
    if (!patient) {
      throw new Error(`Patient ${id} not found to update.`);
    }

    Object.assign(patient, {
      ...data,
      updatedAt: new Date().toISOString(),
    });

    return { ...patient };
  }

  public getPatientAppointments(patientId: string): any[] {
    return this.data.appointments.filter((a) => a.patientId === patientId);
  }

  // --- Doctors / Dentists ---

  public getDoctors(): any[] {
    return [...this.data.doctors];
  }

  public getDoctor(id: string): any {
    const doc = this.data.doctors.find((d) => d.id === id);
    if (!doc) {
      throw new Error(`Doctor ${id} not found.`);
    }
    return { ...doc };
  }

  public createDoctor(data: {
    displayName: string;
    title?: string;
    qualifications?: string;
    specialty?: string;
    experienceYears?: number;
    licenseNumber?: string;
    bio?: string;
    defaultBufferMinutes?: number;
    active?: boolean;
  }): any {
    const newDoc = {
      id: `demo-doc-${Date.now()}`,
      clinicId: this.data.clinic.id,
      name: data.displayName,
      displayName: data.displayName,
      title: data.title || 'Doctor of Dental Surgery',
      qualifications: data.qualifications || '',
      specialty: data.specialty || 'General Dentistry',
      specialization: data.specialty || 'General Dentistry',
      experienceYears: data.experienceYears ?? 5,
      licenseNumber: data.licenseNumber || `TX-DDS-${Math.floor(10000 + Math.random() * 90000)}`,
      email: `${data.displayName.toLowerCase().replace(/[^a-z]/g, '')}@brightsmiledental.example`,
      phone: '+1 512-555-0100',
      bio: data.bio || '',
      defaultBufferMinutes: data.defaultBufferMinutes ?? 10,
      active: data.active ?? true,
      isActive: data.active ?? true,
      color: '#0d9488',
      createdAt: new Date().toISOString(),
    };

    this.data.doctors.push(newDoc);

    // Initialize default doctor schedule
    this.data.doctorSchedules[newDoc.id] = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
      doctorId: newDoc.id,
      dayOfWeek,
      isWorking: true,
      startsAt: '09:00',
      endsAt: '17:00',
    }));

    this.recordAudit({
      action: 'DOCTOR_CREATED',
      entityType: 'doctor',
      entityId: newDoc.id,
      details: `Added new practitioner profile: ${newDoc.displayName}.`,
    });

    return newDoc;
  }

  public updateDoctor(
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
  ): any {
    const doc = this.data.doctors.find((d) => d.id === id);
    if (!doc) {
      throw new Error(`Doctor ${id} not found to update.`);
    }

    if (data.displayName) doc.displayName = data.displayName;
    if (data.title !== undefined) doc.title = data.title;
    if (data.qualifications !== undefined) doc.qualifications = data.qualifications;
    if (data.specialty !== undefined) {
      doc.specialty = data.specialty;
      doc.specialization = data.specialty;
    }
    if (data.experienceYears !== undefined) doc.experienceYears = data.experienceYears;
    if (data.licenseNumber !== undefined) doc.licenseNumber = data.licenseNumber;
    if (data.bio !== undefined) doc.bio = data.bio;
    if (data.defaultBufferMinutes !== undefined) doc.defaultBufferMinutes = data.defaultBufferMinutes;
    if (data.active !== undefined) {
      doc.active = data.active;
      doc.isActive = data.active;
    }

    return { ...doc };
  }

  public deleteDoctor(id: string): any {
    const idx = this.data.doctors.findIndex((d) => d.id === id);
    if (idx !== -1) {
      const removed = this.data.doctors.splice(idx, 1)[0];
      delete this.data.doctorSchedules[id];
      this.recordAudit({
        action: 'DOCTOR_DELETED',
        entityType: 'doctor',
        entityId: id,
        details: `Removed practitioner profile ${removed.displayName}.`,
      });
    }
    return { id };
  }

  public setDoctorStatus(id: string, active: boolean): any {
    const doc = this.data.doctors.find((d) => d.id === id);
    if (doc) {
      doc.active = active;
      doc.isActive = active;
    }
    return { ...doc };
  }

  // --- Services ---

  public getServices(): any[] {
    return [...this.data.services];
  }

  public getService(id: string): any {
    const s = this.data.services.find((item) => item.id === id);
    if (!s) {
      throw new Error(`Service ${id} not found.`);
    }
    return { ...s };
  }

  public createService(data: {
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
  }): any {
    const newService = {
      id: `demo-srv-${Date.now()}`,
      clinicId: this.data.clinic.id,
      code: data.code || `D${Math.floor(1000 + Math.random() * 9000)}`,
      name: data.name,
      description: data.description || '',
      durationMinutes: data.durationMinutes,
      bufferMinutes: data.bufferMinutes ?? 10,
      price: data.price ?? 150,
      currency: data.currency || 'USD',
      pricingModel: data.pricingModel || 'fixed',
      category: data.category || 'General Dentistry',
      active: data.active ?? true,
      isActive: data.active ?? true,
    };

    this.data.services.push(newService);

    this.recordAudit({
      action: 'SERVICE_CREATED',
      entityType: 'service',
      entityId: newService.id,
      details: `Added new clinic service: ${newService.name} ($${newService.price}).`,
    });

    return newService;
  }

  public updateService(
    id: string,
    data: {
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
    }
  ): any {
    const s = this.data.services.find((item) => item.id === id);
    if (!s) {
      throw new Error(`Service ${id} not found to update.`);
    }

    Object.assign(s, {
      ...data,
      active: data.active !== undefined ? data.active : s.active,
      isActive: data.active !== undefined ? data.active : s.isActive,
    });

    return { ...s };
  }

  public deleteService(id: string): any {
    const idx = this.data.services.findIndex((s) => s.id === id);
    if (idx !== -1) {
      const removed = this.data.services.splice(idx, 1)[0];
      this.recordAudit({
        action: 'SERVICE_DELETED',
        entityType: 'service',
        entityId: id,
        details: `Deleted service ${removed.name}.`,
      });
    }
    return { id };
  }

  // --- Handoffs ---

  public getHandoffs(status?: string): {
    items: any[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  } {
    let list = [...this.data.handoffs];
    if (status && status !== 'all') {
      const targetStatus = status.toLowerCase();
      list = list.filter((h) => (h.status || '').toLowerCase() === targetStatus);
    }

    return {
      items: list,
      total: list.length,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    };
  }

  public resolveHandoff(id: string, notes: string): any {
    const handoff = this.data.handoffs.find((h) => h.id === id);
    if (!handoff) {
      throw new Error(`Handoff ${id} not found.`);
    }

    handoff.status = 'RESOLVED';
    handoff.notes = notes;
    handoff.resolvedAt = new Date().toISOString();
    handoff.resolvedBy = this.data.user.fullName;

    // Also update associated conversation status if present
    if (handoff.conversationId) {
      const conv = this.data.conversations.find((c) => c.id === handoff.conversationId);
      if (conv) {
        conv.handoffStatus = 'none';
      }
    }

    this.recordAudit({
      action: 'HANDOFF_RESOLVED',
      entityType: 'handoff',
      entityId: id,
      details: `Resolved staff handoff: ${notes}`,
    });

    return { ...handoff };
  }

  // --- Conversations & Messages ---

  public getConversations(params?: {
    page?: number;
    pageSize?: number;
    search?: string;
  }): {
    items: any[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  } {
    let list = [...this.data.conversations];

    if (params?.search && params.search.trim()) {
      const q = params.search.trim().toLowerCase();
      list = list.filter((c) => {
        const name = (c.patientName || c.patient?.fullName || '').toLowerCase();
        const lastMsg = (c.lastMessageBody || '').toLowerCase();
        const phone = (c.patientPhone || '').toLowerCase();
        return name.includes(q) || lastMsg.includes(q) || phone.includes(q);
      });
    }

    const total = list.length;
    const page = Math.max(1, params?.page || 1);
    const pageSize = Math.max(1, params?.pageSize || 20);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const startIdx = (page - 1) * pageSize;
    const items = list.slice(startIdx, startIdx + pageSize);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages,
    };
  }

  public getConversation(id: string): { conversation: any; messages: any[] } {
    const conv = this.data.conversations.find((c) => c.id === id);
    if (!conv) {
      throw new Error(`Conversation ${id} not found.`);
    }

    const msgs = this.data.messages[id] || [];
    return {
      conversation: { ...conv },
      messages: [...msgs],
    };
  }

  public sendMessage(conversationId: string, body: string, resolveHandoff = false): any {
    const conv = this.data.conversations.find((c) => c.id === conversationId);
    if (!conv) {
      throw new Error(`Conversation ${conversationId} not found.`);
    }

    const newMsg = {
      id: `demo-msg-${Date.now()}`,
      conversationId,
      direction: 'outbound',
      kind: 'text',
      body,
      content: body,
      senderType: 'staff',
      senderName: this.data.user.fullName,
      deliveryStatus: 'delivered',
      providerStatus: 'delivered',
      providerMessageId: `wamid.HBgL${Date.now()}`,
      createdAt: new Date().toISOString(),
    };

    if (!this.data.messages[conversationId]) {
      this.data.messages[conversationId] = [];
    }
    this.data.messages[conversationId].push(newMsg);

    conv.lastMessageBody = body;
    conv.lastMessageAt = newMsg.createdAt;
    conv.messageCount = (conv.messageCount || 0) + 1;

    let handoffResolved = false;
    if (resolveHandoff) {
      conv.handoffStatus = 'none';
      const pendingHandoff = this.data.handoffs.find(
        (h) => h.conversationId === conversationId && h.status === 'PENDING'
      );
      if (pendingHandoff) {
        pendingHandoff.status = 'RESOLVED';
        pendingHandoff.resolvedAt = new Date().toISOString();
        pendingHandoff.resolvedBy = this.data.user.fullName;
        handoffResolved = true;
      }
    }

    return {
      ...newMsg,
      handoffResolved,
    };
  }

  public closeConversation(id: string, reason = 'staff_action'): any {
    const conv = this.data.conversations.find((c) => c.id === id);
    if (conv) {
      conv.status = 'closed';
      conv.handoffStatus = 'none';
    }
    return { ...conv, closeReason: reason };
  }

  public deleteConversation(id: string): { id: string; deleted: boolean } {
    const idx = this.data.conversations.findIndex((c) => c.id === id);
    if (idx !== -1) {
      this.data.conversations.splice(idx, 1);
      delete this.data.messages[id];
    }
    return { id, deleted: true };
  }

  public deleteConversationsBulk(conversationIds: string[]): {
    deletedCount: number;
    deletedIds: string[];
  } {
    const idsSet = new Set(conversationIds);
    this.data.conversations = this.data.conversations.filter((c) => !idsSet.has(c.id));
    for (const id of conversationIds) {
      delete this.data.messages[id];
    }
    return {
      deletedCount: conversationIds.length,
      deletedIds: conversationIds,
    };
  }

  public deleteAllConversations(): { deletedCount: number; deletedIds: string[] } {
    const ids = this.data.conversations.map((c) => c.id);
    this.data.conversations = [];
    this.data.messages = {};
    return {
      deletedCount: ids.length,
      deletedIds: ids,
    };
  }

  public syncConversations(since?: string, conversationId?: string): {
    messages: any[];
    serverTime: string;
  } {
    return {
      messages: [],
      serverTime: new Date().toISOString(),
    };
  }

  public getStreamTicket(): string {
    return 'demo-sse-ticket-brightsmile';
  }

  public getConversationStreamUrl(ticket?: string): string {
    return '#demo-simulated-stream';
  }

  // --- Schedules, Blocks & Holidays ---

  public getClinicHours(): any[] {
    return JSON.parse(JSON.stringify(this.data.clinicHours));
  }

  public updateClinicHours(
    hours: Array<{
      dayOfWeek: number;
      isOpen: boolean;
      opensAt: string;
      closesAt: string;
    }>
  ): any[] {
    this.data.clinicHours = JSON.parse(JSON.stringify(hours));
    this.recordAudit({
      action: 'CLINIC_HOURS_UPDATED',
      entityType: 'schedule',
      entityId: this.data.clinic.id,
      details: 'Updated clinic weekly operating hours roster.',
    });
    return this.getClinicHours();
  }

  public getDoctorSchedules(doctorId: string): any[] {
    const sched = this.data.doctorSchedules[doctorId];
    if (sched) return JSON.parse(JSON.stringify(sched));

    return [1, 2, 3, 4, 5].map((dayOfWeek) => ({
      doctorId,
      dayOfWeek,
      isWorking: true,
      startsAt: '09:00',
      endsAt: '17:00',
    }));
  }

  public updateDoctorSchedule(
    doctorId: string,
    schedules: Array<{
      dayOfWeek: number;
      isWorking: boolean;
      startsAt: string;
      endsAt: string;
    }>
  ): any[] {
    this.data.doctorSchedules[doctorId] = JSON.parse(JSON.stringify(schedules));
    return this.getDoctorSchedules(doctorId);
  }

  public getScheduleBlocks(dentistId?: string): any[] {
    let list = [...this.data.scheduleBlocks];
    if (dentistId && dentistId !== 'all') {
      list = list.filter((b) => b.dentistId === dentistId || !b.dentistId);
    }
    return list;
  }

  public checkBlockConflicts(data: {
    startsAt: string;
    endsAt: string;
    dentistId?: string | null;
  }): {
    hasConflicts: boolean;
    conflictCount: number;
    conflicts: any[];
  } {
    const blockStart = new Date(data.startsAt).getTime();
    const blockEnd = new Date(data.endsAt).getTime();

    const conflicts = this.data.appointments.filter((a) => {
      if (a.status === 'CANCELLED') return false;
      if (data.dentistId && a.doctorId !== data.dentistId) return false;
      const apptStart = new Date(a.startsAt).getTime();
      const apptEnd = new Date(a.endsAt).getTime();
      return blockStart < apptEnd && blockEnd > apptStart;
    });

    return {
      hasConflicts: conflicts.length > 0,
      conflictCount: conflicts.length,
      conflicts,
    };
  }

  public createScheduleBlock(data: {
    kind: string;
    startsAt: string;
    endsAt: string;
    reason: string;
    dentistId?: string | null;
    ignoreConflicts?: boolean;
  }): any {
    const newBlock = {
      id: `demo-block-${Date.now()}`,
      clinicId: this.data.clinic.id,
      dentistId: data.dentistId || null,
      kind: data.kind || 'holiday',
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      reason: data.reason,
      createdAt: new Date().toISOString(),
    };

    this.data.scheduleBlocks.push(newBlock);

    this.recordAudit({
      action: 'SCHEDULE_BLOCK_CREATED',
      entityType: 'schedule_block',
      entityId: newBlock.id,
      details: `Created closure block: ${newBlock.reason} (${newBlock.startsAt} to ${newBlock.endsAt}).`,
    });

    return newBlock;
  }

  public updateScheduleBlock(
    id: string,
    data: {
      kind: string;
      startsAt: string;
      endsAt: string;
      reason: string;
      dentistId?: string | null;
    }
  ): any {
    const block = this.data.scheduleBlocks.find((b) => b.id === id);
    if (!block) {
      throw new Error(`Schedule block ${id} not found.`);
    }

    Object.assign(block, data);
    return { ...block };
  }

  public deleteScheduleBlock(id: string): { id: string } {
    const idx = this.data.scheduleBlocks.findIndex((b) => b.id === id);
    if (idx !== -1) {
      this.data.scheduleBlocks.splice(idx, 1);
    }
    return { id };
  }

  public getHolidays(year?: number): {
    countryCode: string;
    year: number;
    holidays: any[];
  } {
    return {
      countryCode: 'US',
      year: year || new Date().getFullYear(),
      holidays: [...this.data.holidays],
    };
  }

  public setHolidayOverride(data: {
    holidayDate: string;
    holidayName: string;
    action: 'closed' | 'working_day' | 'modified_hours';
    customOpensAt?: string;
    customClosesAt?: string;
    notes?: string;
  }): any {
    const override = {
      id: `demo-override-${Date.now()}`,
      clinicId: this.data.clinic.id,
      ...data,
      createdAt: new Date().toISOString(),
    };
    this.data.holidayOverrides.push(override);
    return override;
  }

  public deleteHolidayOverride(overrideId: string): any {
    const idx = this.data.holidayOverrides.findIndex((o) => o.id === overrideId);
    if (idx !== -1) {
      this.data.holidayOverrides.splice(idx, 1);
    }
    return { id: overrideId };
  }

  // --- Dynamic Slot Availability ---

  public getAvailability(params: {
    date: string;
    doctorId?: string;
    serviceId?: string;
  }): {
    date: string;
    doctorId?: string;
    serviceId?: string;
    slots: Array<{ time: string; startsAt: string; available: boolean }>;
  } {
    const { date, doctorId, serviceId } = params;
    const requestedDate = new Date(`${date}T00:00:00`);
    const dayOfWeek = requestedDate.getDay();

    // Check clinic hours for this day of week
    const clinicDay = this.data.clinicHours.find((h) => h.dayOfWeek === dayOfWeek);
    if (clinicDay && !clinicDay.isOpen) {
      return { date, doctorId, serviceId, slots: [] };
    }

    // Check doctor schedule if doctor selected
    if (doctorId) {
      const docSched = (this.data.doctorSchedules[doctorId] || []).find(
        (s: any) => s.dayOfWeek === dayOfWeek
      );
      if (docSched && !docSched.isWorking) {
        return { date, doctorId, serviceId, slots: [] };
      }
    }

    // Standard business slot times between 09:00 and 17:00
    const candidateTimes = [
      '09:00',
      '09:45',
      '10:30',
      '11:15',
      '13:00',
      '13:45',
      '14:30',
      '15:15',
      '16:00',
      '16:45',
    ];

    const slots: Array<{ time: string; startsAt: string; available: boolean }> = [];

    for (const timeStr of candidateTimes) {
      const slotIso = `${date}T${timeStr}:00.000Z`;
      const slotTime = new Date(slotIso).getTime();
      const slotEnd = slotTime + 45 * 60000;

      // Check collision with appointments
      const hasApptCollision = this.data.appointments.some((a) => {
        if (a.status === 'CANCELLED') return false;
        if (doctorId && a.doctorId !== doctorId) return false;
        const apptStart = new Date(a.startsAt).getTime();
        const apptEnd = new Date(a.endsAt).getTime();
        return slotTime < apptEnd && slotEnd > apptStart;
      });

      // Check collision with schedule blocks
      const hasBlockCollision = this.data.scheduleBlocks.some((b) => {
        if (doctorId && b.dentistId && b.dentistId !== doctorId) return false;
        const bStart = new Date(b.startsAt).getTime();
        const bEnd = new Date(b.endsAt).getTime();
        return slotTime < bEnd && slotEnd > bStart;
      });

      if (!hasApptCollision && !hasBlockCollision) {
        slots.push({
          time: timeStr,
          startsAt: slotIso,
          available: true,
        });
      }
    }

    return {
      date,
      doctorId,
      serviceId,
      slots,
    };
  }

  // --- Receptionist Settings ---

  public getReceptionistSettings(): any {
    return JSON.parse(JSON.stringify(this.data.receptionistSettings));
  }

  public updateReceptionistSettings(settings: any): any {
    this.data.receptionistSettings = {
      ...this.data.receptionistSettings,
      ...settings,
    };
    return this.getReceptionistSettings();
  }

  // --- WhatsApp Cloud API Integration ---

  public getWhatsAppIntegration(): DemoWhatsAppIntegrationData {
    return JSON.parse(JSON.stringify(this.data.whatsappIntegration));
  }

  public updateWhatsAppIntegration(
    payload: DemoUpdateWhatsAppIntegrationPayload
  ): {
    clinicId: string;
    phoneNumberId: string | null;
    wabaId: string | null;
    enabled: boolean;
    status: string;
    hasToken: boolean;
    maskedToken: string;
    validation?: DemoValidateIntegrationResult | null;
  } {
    const current = this.data.whatsappIntegration;
    if (payload.phoneNumberId !== undefined) current.phoneNumberId = payload.phoneNumberId;
    if (payload.wabaId !== undefined) current.wabaId = payload.wabaId;
    if (payload.enabled !== undefined) current.enabled = payload.enabled;

    if (payload.accessToken) {
      current.hasToken = true;
      current.maskedToken = `EAAG...${payload.accessToken.slice(-4) || '92A1'}`;
      current.status = 'valid';
      current.lastValidatedAt = new Date().toISOString();
      current.lastError = null;
    }

    let validation: DemoValidateIntegrationResult | undefined;
    if (payload.validateNow) {
      validation = this.validateWhatsAppIntegration();
    }

    return {
      clinicId: current.clinicId,
      phoneNumberId: current.phoneNumberId,
      wabaId: current.wabaId,
      enabled: current.enabled,
      status: current.status,
      hasToken: current.hasToken,
      maskedToken: current.maskedToken,
      validation,
    };
  }

  public validateWhatsAppIntegration(): DemoValidateIntegrationResult {
    return {
      valid: true,
      status: 'valid',
      message: 'WhatsApp Cloud API connection verified successfully for BrightSmile Dental Studio sandbox.',
      verifiedName: 'BrightSmile Dental Studio',
      displayPhoneNumber: '+1 512-555-0100',
      qualityRating: 'GREEN',
      codeVerificationStatus: 'VERIFIED',
    };
  }

  // --- Reports & Analytics ---

  public getReportsSummary(from?: string, to?: string): any {
    const appts = this.data.appointments;
    const nowTime = Date.now();

    const totalAppointments = appts.length;
    const completedAppointments = appts.filter((a) => a.status === 'COMPLETED').length;
    const cancelledAppointments = appts.filter((a) => a.status === 'CANCELLED').length;
    const confirmedAppointments = appts.filter(
      (a) => a.status === 'CONFIRMED' || a.status === 'SCHEDULED'
    ).length;
    const upcomingAppointments = appts.filter(
      (a) => (a.status === 'CONFIRMED' || a.status === 'SCHEDULED') && new Date(a.startsAt).getTime() >= nowTime
    ).length;

    const totalConversations = this.data.conversations.length;
    const resolvedHandoffs = this.data.handoffs.filter((h) => h.status === 'RESOLVED').length;
    const pendingHandoffs = this.data.handoffs.filter((h) => h.status === 'PENDING').length;

    // AI Containment: conversations without human handoffs
    const aiContainedCount = Math.max(0, totalConversations - pendingHandoffs);
    const containmentRate = totalConversations > 0 ? Math.round((aiContainedCount / totalConversations) * 100) : 88;

    return {
      totalAppointments,
      completedAppointments,
      cancelledAppointments,
      confirmedAppointments,
      upcomingAppointments,
      todayAppointments: appts.filter((a) => {
        const d = new Date(a.startsAt);
        const today = new Date();
        return (
          d.getFullYear() === today.getFullYear() &&
          d.getMonth() === today.getMonth() &&
          d.getDate() === today.getDate()
        );
      }).length,
      totalConversations,
      aiContainedCount,
      containmentRate,
      averageResolutionMinutes: 3.2,
      patientSatisfaction: 4.9,
      period: {
        from: from || new Date(nowTime - 30 * 86400000).toISOString(),
        to: to || new Date().toISOString(),
      },
      resolvedHandoffs,
      pendingHandoffs,
    };
  }

  public getStatusBreakdown(): any[] {
    const counts: Record<string, number> = {
      CONFIRMED: 0,
      COMPLETED: 0,
      CANCELLED: 0,
      SCHEDULED: 0,
    };

    for (const a of this.data.appointments) {
      const s = (a.status || 'CONFIRMED').toUpperCase();
      counts[s] = (counts[s] || 0) + 1;
    }

    return Object.entries(counts).map(([status, count]) => ({
      status,
      count,
    }));
  }

  public getHourlyDistribution(): any[] {
    const hours = [9, 10, 11, 12, 13, 14, 15, 16, 17];
    return hours.map((hour) => {
      const count = this.data.appointments.filter((a) => {
        const h = new Date(a.startsAt).getUTCHours();
        return h === hour;
      }).length;
      return {
        hour,
        count: count || (hour % 2 === 0 ? 3 : 2),
      };
    });
  }

  // --- Audit Trail ---

  public getAuditLog(params?: { page?: number; pageSize?: number }): {
    items: any[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  } {
    const page = Math.max(1, params?.page || 1);
    const pageSize = Math.max(1, params?.pageSize || 20);
    const total = this.data.auditLog.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const startIdx = (page - 1) * pageSize;
    const items = this.data.auditLog.slice(startIdx, startIdx + pageSize);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages,
    };
  }

  private recordAudit(event: {
    action: string;
    entityType: string;
    entityId: string;
    details: string;
  }): void {
    const auditEntry = {
      id: `audit-${Date.now()}`,
      clinicId: this.data.clinic.id,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      actor: this.data.user.fullName,
      actorName: this.data.user.fullName,
      actorType: 'staff',
      timestamp: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      details: event.details,
    };
    this.data.auditLog.unshift(auditEntry);
  }
}

// Export singleton instance for client-side demo state management
export const demoStore = new DemoStore();
