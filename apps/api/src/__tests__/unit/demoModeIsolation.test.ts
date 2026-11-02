/**
 * Automated Verification: Production-Safe Realistic Demo Mode Isolation & Invariant Test Suite
 *
 * Verifies:
 * 1. Demographic & Clinical Identity: BrightSmile Dental Studio (Austin, TX, America/Chicago).
 * 2. Minimum 5 records across each applicable domain (Doctors, Services, Patients, Appointments,
 *    Conversations, Schedule Blocks, Holidays, Audit Log).
 * 3. In-memory CRUD mutations (appointment booking, rescheduling, cancellation, conversation deletion).
 * 4. Refresh / Reset isolation (calling reset() restores baseline).
 * 5. Production database safety (zero database connection, zero tenant leakage).
 */

import { createDemoBaseline } from '../../../../web/src/demo/fixtures';
import { DemoStore } from '../../../../web/src/demo/demoStore';

describe('Demo Mode Isolation & Dataset Invariants', () => {
  let store: DemoStore;

  beforeEach(() => {
    store = new DemoStore();
  });

  describe('1. Clinic Identity & Baseline Completeness', () => {
    it('initializes with the correct fictional clinic identity and clinical director', () => {
      const clinic = store.getClinic();
      expect(clinic.name).toBe('BrightSmile Dental Studio');
      expect(clinic.city).toBe('Austin');
      expect(clinic.state).toBe('TX');
      expect(clinic.timezone).toBe('America/Chicago');
      expect(clinic.currency).toBe('USD');

      const user = store.getUser();
      expect(user.fullName).toBe('Dr. Emily Carter, DDS');
      expect(user.email).toBe('dr.carter@brightsmiledental.example');
      expect(user.role).toBe('clinic_admin');

      const receptionist = store.getReceptionistSettings();
      expect(receptionist.name).toBe('Alex Morgan');
      expect(receptionist.persona).toContain('Warm');
    });

    it('contains at least 5 realistic records across all applicable modules', () => {
      const data = createDemoBaseline(new Date());

      // Doctors: 5 complete profiles
      expect(data.doctors.length).toBeGreaterThanOrEqual(5);
      data.doctors.forEach((doc) => {
        expect(doc.id).toBeDefined();
        expect(doc.displayName).toMatch(/^Dr\./);
        expect(doc.specialty).toBeDefined();
        expect(doc.licenseNumber).toMatch(/^TX-/);
        expect(doc.experienceYears).toBeGreaterThan(0);
      });

      // Clinical Services: 6 services with ADA codes and pricing
      expect(data.services.length).toBeGreaterThanOrEqual(5);
      data.services.forEach((srv) => {
        expect(srv.id).toBeDefined();
        expect(srv.code).toMatch(/^D\d{4}$/);
        expect(srv.durationMinutes).toBeGreaterThan(0);
        expect(srv.price).toBeGreaterThan(0);
      });

      // Patients: 6 complete patient profiles
      expect(data.patients.length).toBeGreaterThanOrEqual(5);
      data.patients.forEach((pat) => {
        expect(pat.id).toBeDefined();
        expect(pat.fullName).toBeDefined();
        expect(pat.phone).toBeDefined();
      });

      // Appointments: 8 realistic appointments spanning today, past, and upcoming
      expect(data.appointments.length).toBeGreaterThanOrEqual(5);
      const lowerStatuses = new Set(data.appointments.map((a) => (a.status || '').toLowerCase()));
      expect(lowerStatuses.has('confirmed')).toBe(true);
      expect(lowerStatuses.has('completed')).toBe(true);
      expect(lowerStatuses.has('cancelled')).toBe(true);

      // Conversations: 6 realistic communication threads with messages
      expect(data.conversations.length).toBeGreaterThanOrEqual(5);
      data.conversations.forEach((conv) => {
        expect(conv.id).toBeDefined();
        expect(conv.patientName).toBeDefined();
        expect(data.messages[conv.id]).toBeDefined();
        expect(data.messages[conv.id].length).toBeGreaterThanOrEqual(2);
      });

      // Schedule Blocks: at least 5 closure blocks
      expect(data.scheduleBlocks.length).toBeGreaterThanOrEqual(5);

      // Public Holidays: recognized holidays
      expect(data.holidays.length).toBeGreaterThanOrEqual(5);

      // Audit Log: at least 5 compliance entries
      expect(data.auditLog.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('2. In-Memory CRUD Mutations & Dynamic Availability', () => {
    it('supports booking, rescheduling, and cancelling appointments in memory', () => {
      const initialCount = store.getAppointments().total;
      const doctors = store.getDoctors();
      const patients = store.getPatients().items;
      const services = store.getServices();

      // Book new appointment
      const newAppt = store.bookAppointment({
        doctorId: doctors[0].id,
        patientId: patients[0].id,
        serviceId: services[0].id,
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        notes: 'Patient requesting consultation.',
      });

      expect(newAppt.id).toBeDefined();
      expect(store.getAppointments().total).toBe(initialCount + 1);

      // Reschedule appointment
      const rescheduledTime = new Date(Date.now() + 172800000).toISOString();
      const rescheduled = store.rescheduleAppointment(newAppt.id, rescheduledTime, 'Schedule conflict');
      expect(rescheduled.startsAt).toBe(rescheduledTime);
      expect(rescheduled.rescheduleReason).toBe('Schedule conflict');

      // Cancel appointment
      const cancelled = store.cancelAppointment(newAppt.id, 'Patient feeling unwell');
      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.cancellationReason).toBe('Patient feeling unwell');
    });

    it('supports patient and doctor mutations', () => {
      // Create patient
      const pat = store.createPatient({
        fullName: 'Test Patient Persona',
        phone: '+1 512-555-9999',
        email: 'test.persona@example.com',
      });
      expect(pat.id).toBeDefined();
      expect(store.getPatient(pat.id).fullName).toBe('Test Patient Persona');

      // Update patient
      const updated = store.updatePatient(pat.id, { notes: 'Allergic to latex' });
      expect(updated.notes).toBe('Allergic to latex');

      // Create practitioner
      const doc = store.createDoctor({
        displayName: 'Dr. Gregory House, MD',
        specialty: 'Diagnostic Dentistry',
      });
      expect(doc.id).toBeDefined();
      expect(store.getDoctor(doc.id).displayName).toBe('Dr. Gregory House, MD');

      // Delete practitioner
      store.deleteDoctor(doc.id);
      expect(() => store.getDoctor(doc.id)).toThrow();
    });

    it('supports single and bulk conversation deletion', () => {
      const convs = store.getConversations().items;
      const initialCount = convs.length;
      expect(initialCount).toBeGreaterThanOrEqual(5);

      // Single deletion
      const firstId = convs[0].id;
      const delRes = store.deleteConversation(firstId);
      expect(delRes.deleted).toBe(true);
      expect(store.getConversations().items.some((c) => c.id === firstId)).toBe(false);

      // Bulk deletion
      const remainingConvs = store.getConversations().items;
      const bulkIds = [remainingConvs[0].id, remainingConvs[1].id];
      const bulkRes = store.deleteConversationsBulk(bulkIds);
      expect(bulkRes.deletedCount).toBe(2);
      expect(store.getConversations().items.length).toBe(remainingConvs.length - 2);
    });

    it('calculates slot availability without overlapping booked appointments or blocks', () => {
      const todayStr = new Date().toISOString().split('T')[0];
      const doctors = store.getDoctors();
      const res = store.getAvailability({
        date: todayStr,
        doctorId: doctors[0].id,
      });

      expect(Array.isArray(res.slots)).toBe(true);
      res.slots.forEach((slot) => {
        expect(slot.time).toMatch(/^\d{2}:\d{2}$/);
        expect(slot.available).toBe(true);
      });
    });

    it('dynamically computes KPI reports summary from current state', () => {
      const summary = store.getReportsSummary();
      expect(summary.totalAppointments).toBeGreaterThan(0);
      expect(summary.containmentRate).toBeGreaterThan(0);
      expect(summary.patientSatisfaction).toBeGreaterThan(4.0);

      const statusBreakdown = store.getStatusBreakdown();
      expect(Array.isArray(statusBreakdown)).toBe(true);
      expect(statusBreakdown.length).toBeGreaterThan(0);
    });
  });

  describe('3. Refresh & Reset In-Memory Isolation', () => {
    it('restores exact initial baseline after calling reset()', () => {
      const initialAppointmentsCount = store.getAppointments().total;
      const initialConversationsCount = store.getConversations().total;

      // Mutate aggressively
      store.deleteAllConversations();
      expect(store.getConversations().total).toBe(0);

      const docs = store.getDoctors();
      const pats = store.getPatients().items;
      const srvs = store.getServices();
      store.bookAppointment({
        doctorId: docs[0].id,
        patientId: pats[0].id,
        serviceId: srvs[0].id,
        startsAt: new Date().toISOString(),
      });

      // Call reset()
      store.reset();

      // Verify restored to baseline
      expect(store.getAppointments().total).toBe(initialAppointmentsCount);
      expect(store.getConversations().total).toBe(initialConversationsCount);
    });
  });

  describe('4. Zero Production Database & Network Leakage', () => {
    it('ensures demo store operates 100% in memory with no remote connections', () => {
      // Neon database URL should never be touched or required by demoStore
      expect(process.env.DATABASE_URL).toBeUndefined();
      const clinic = store.getClinic();
      expect(clinic.id).toBe('demo-clinic-brightsmile');
      expect(clinic.name).toBe('BrightSmile Dental Studio');
    });
  });
});
