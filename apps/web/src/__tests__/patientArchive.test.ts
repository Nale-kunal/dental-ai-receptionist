/**
 * Frontend Test Suite: Clinical Treatment Categories & Patient Archive Lifecycle
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CLINICAL_CATEGORIES } from '@dental/shared';
import { DemoStore } from '../demo/demoStore';

describe('Frontend: Clinical Categories & Patient Archive Lifecycle', () => {
  let store: DemoStore;

  beforeEach(() => {
    store = new DemoStore();
  });

  describe('Clinical Categories', () => {
    it('provides all 13 standard clinical categories', () => {
      expect(CLINICAL_CATEGORIES).toHaveLength(13);
      expect(CLINICAL_CATEGORIES).toContain('Restorative Dentistry');
      expect(CLINICAL_CATEGORIES).toContain('Prosthodontics');
      expect(CLINICAL_CATEGORIES).toContain('Implant Dentistry');
      expect(CLINICAL_CATEGORIES).toContain('Diagnostic & Imaging');
    });

    it('allows services to be categorized under new categories', () => {
      const services = store.getClinicContext().services;
      const categories = services.map((s: any) => s.category);
      expect(categories).toContain('Restorative Dentistry');
      expect(categories).toContain('Prosthodontics');
      expect(categories).toContain('Implant Dentistry');
      expect(categories).toContain('Diagnostic & Imaging');
    });
  });

  describe('Patient Archive Lifecycle', () => {
    it('filters out archived patients from the active patient list', () => {
      const activePatients = store.getPatients();
      expect(activePatients.items.every((p: any) => !p.isArchived)).toBe(true);
      expect(activePatients.items.find((p: any) => p.fullName === 'Eleanor Vance')).toBeUndefined();
    });

    it('returns archived patients in getArchivedPatients', () => {
      const archived = store.getArchivedPatients();
      expect(archived.items.length).toBeGreaterThan(0);
      const eleanor = archived.items.find((p: any) => p.fullName === 'Eleanor Vance');
      expect(eleanor).toBeDefined();
      expect(eleanor.isArchived).toBe(true);
    });

    it('archives patient and prevents booking', () => {
      const newPat = store.createPatient({
        fullName: 'Claire Redfield',
        phone: '+15125554321',
      });

      const archived = store.archivePatient(newPat.id, 'No longer in area');
      expect(archived.isArchived).toBe(true);
      expect(archived.archiveReason).toBe('No longer in area');

      const doctor = store.getDoctors()[0];
      const service = store.getServices()[0];

      expect(() => {
        store.bookAppointment({
          doctorId: doctor.id,
          patientId: newPat.id,
          serviceId: service.id,
          startsAt: new Date(Date.now() + 86400000).toISOString(),
        });
      }).toThrow(/Cannot book appointment for archived patient/i);
    });

    it('restores patient and allows booking again', () => {
      const eleanor = store.getArchivedPatients().items.find((p: any) => p.fullName === 'Eleanor Vance');
      expect(eleanor).toBeDefined();

      const restored = store.restorePatient(eleanor.id);
      expect(restored.isArchived).toBe(false);
      expect(restored.restoredAt).toBeDefined();

      const doctor = store.getDoctors()[0];
      const service = store.getServices()[0];

      const appt = store.bookAppointment({
        doctorId: doctor.id,
        patientId: restored.id,
        serviceId: service.id,
        startsAt: new Date(Date.now() + 86400000).toISOString(),
      });

      expect(appt.id).toBeDefined();
      expect(appt.patientId).toBe(restored.id);
    });
  });
});
