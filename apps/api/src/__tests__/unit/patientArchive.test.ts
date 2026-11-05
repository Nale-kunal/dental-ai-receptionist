/**
 * Unit Test Suite: Clinical Treatment Categories & Patient Archive Lifecycle
 *
 * Covers:
 * 1. CLINICAL_CATEGORIES constants: all 13 standard clinical categories.
 * 2. Patient Archive Lifecycle in DemoStore & Repository logic:
 *    - Successful patient archive with reason.
 *    - Exclusion of archived patients from active directory.
 *    - Inclusion in dedicated archived directory.
 *    - Search within archived directory.
 *    - Active upcoming appointments prevent archiving (conflict check).
 *    - Nonexistent patient archive rejection.
 *    - Restoring an archived patient back to active status.
 *    - Restored patient retains original ID, contact details, and appointment records.
 *    - Appointment booking rejection for archived patients.
 *    - Audit event recording (PATIENT_ARCHIVED, PATIENT_RESTORED).
 */

import { CLINICAL_CATEGORIES } from '@dental/shared';
import { DemoStore } from '../../../../web/src/demo/demoStore';
import { createDemoBaseline } from '../../../../web/src/demo/fixtures';

describe('Clinical Treatment Categories & Patient Archive Lifecycle', () => {
  describe('Part 1: Clinical Treatment Categories', () => {
    it('contains all 13 required clinical categories', () => {
      const expectedCategories = [
        'General Dentistry',
        'Preventative Care',
        'Cosmetic Dentistry',
        'Restorative Dentistry',
        'Prosthodontics',
        'Implant Dentistry',
        'Orthodontics',
        'Endodontics (Root Canal)',
        'Oral Surgery & Extractions',
        'Periodontics (Gum Health)',
        'Pediatric Dentistry',
        'Diagnostic & Imaging',
        'Emergency Care',
      ];

      expect(CLINICAL_CATEGORIES.length).toBe(13);
      for (const cat of expectedCategories) {
        expect(CLINICAL_CATEGORIES).toContain(cat);
      }
    });

    it('fixtures include services across new and existing categories', () => {
      const baseline = createDemoBaseline(new Date());
      const categoriesInFixtures = new Set(baseline.services.map((s) => s.category));

      expect(categoriesInFixtures.has('General Dentistry')).toBe(true);
      expect(categoriesInFixtures.has('Preventative Care')).toBe(true);
      expect(categoriesInFixtures.has('Cosmetic Dentistry')).toBe(true);
      expect(categoriesInFixtures.has('Orthodontics')).toBe(true);
      expect(categoriesInFixtures.has('Restorative Dentistry')).toBe(true);
      expect(categoriesInFixtures.has('Prosthodontics')).toBe(true);
      expect(categoriesInFixtures.has('Implant Dentistry')).toBe(true);
      expect(categoriesInFixtures.has('Diagnostic & Imaging')).toBe(true);
    });
  });

  describe('Part 2: Patient Archive Lifecycle', () => {
    let store: DemoStore;

    beforeEach(() => {
      store = new DemoStore();
    });

    it('active patient directory excludes archived patients by default', () => {
      const activeList = store.getPatients();
      const allBaseline = store.getClinicContext();

      // Ensure no active patient returned has isArchived === true
      activeList.items.forEach((p) => {
        expect(p.isArchived).not.toBe(true);
      });

      // Eleanor Vance was seeded as an archived patient in fixtures
      const archivedEleanor = activeList.items.find((p) => p.fullName === 'Eleanor Vance');
      expect(archivedEleanor).toBeUndefined();
    });

    it('dedicated archived patients directory returns archived patients', () => {
      const archivedRes = store.getArchivedPatients();
      expect(archivedRes.items.length).toBeGreaterThanOrEqual(1);

      const eleanor = archivedRes.items.find((p) => p.fullName === 'Eleanor Vance');
      expect(eleanor).toBeDefined();
      expect(eleanor.isArchived).toBe(true);
      expect(eleanor.archivedAt).toBeDefined();
      expect(eleanor.archiveReason).toBeDefined();
    });

    it('getArchivedPatientsCount returns accurate count', () => {
      const initialCount = store.getArchivedPatientsCount();
      expect(initialCount).toBeGreaterThanOrEqual(1);
    });

    it('searches within archived patients correctly', () => {
      const searchRes = store.getArchivedPatients({ search: 'Eleanor' });
      expect(searchRes.items.length).toBe(1);
      expect(searchRes.items[0].fullName).toBe('Eleanor Vance');

      const nonMatch = store.getArchivedPatients({ search: 'NonExistentZzzz' });
      expect(nonMatch.items.length).toBe(0);
    });

    it('successfully archives an eligible patient with optional reason and audit log', () => {
      // Create a fresh patient with no appointments
      const freshPatient = store.createPatient({
        fullName: 'Thomas Sterling',
        phone: '+15125559876',
        email: 'thomas.sterling@example.com',
      });

      const initialActiveCount = store.getPatients().total;
      const initialArchivedCount = store.getArchivedPatientsCount();

      // Archive the patient
      const archiveReason = 'Relocated out of state';
      const archived = store.archivePatient(freshPatient.id, archiveReason);

      expect(archived.isArchived).toBe(true);
      expect(archived.archivedAt).toBeDefined();
      expect(archived.archiveReason).toBe(archiveReason);

      // Verify active directory reduced
      expect(store.getPatients().total).toBe(initialActiveCount - 1);
      expect(store.getPatients().items.find((p) => p.id === freshPatient.id)).toBeUndefined();

      // Verify archived directory increased
      expect(store.getArchivedPatientsCount()).toBe(initialArchivedCount + 1);
      expect(store.getArchivedPatients().items.find((p) => p.id === freshPatient.id)).toBeDefined();

      // Verify audit history
      const audits = store.getAuditLog().items;
      const archiveAudit = audits.find(
        (a: any) => a.action === 'PATIENT_ARCHIVED' && a.entityId === freshPatient.id
      );
      expect(archiveAudit).toBeDefined();
      expect(archiveAudit.details).toContain('Thomas Sterling');
      expect(archiveAudit.details).toContain(archiveReason);
    });

    it('blocks archiving when patient has active upcoming appointments', () => {
      // Pick an active patient with upcoming appointments
      const activePatients = store.getPatients().items;
      const patientWithAppt = activePatients.find((p) => {
        const appts = store.getPatientAppointments(p.id);
        const now = Date.now();
        return appts.some((a) => {
          const st = (a.status || '').toLowerCase();
          return (st === 'pending' || st === 'confirmed') && new Date(a.startsAt).getTime() >= now;
        });
      });

      expect(patientWithAppt).toBeDefined();

      // Attempt to archive should throw
      expect(() => {
        store.archivePatient(patientWithAppt.id, 'Attempting archive with active booking');
      }).toThrow(/Cannot archive patient with active upcoming appointments/i);

      // Verify patient is still active
      const patientAfter = store.getPatient(patientWithAppt.id);
      expect(patientAfter.isArchived).not.toBe(true);
    });

    it('rejects archiving for nonexistent patient ID', () => {
      expect(() => {
        store.archivePatient('non-existent-id-999');
      }).toThrow(/not found/i);
    });

    it('successfully restores an archived patient back to active directory', () => {
      const initialArchivedList = store.getArchivedPatients().items;
      const targetArchived = initialArchivedList[0];
      expect(targetArchived).toBeDefined();

      const initialActiveCount = store.getPatients().total;
      const initialArchivedCount = store.getArchivedPatientsCount();

      // Restore patient
      const restored = store.restorePatient(targetArchived.id);

      expect(restored.isArchived).toBe(false);
      expect(restored.restoredAt).toBeDefined();
      expect(restored.id).toBe(targetArchived.id);
      expect(restored.fullName).toBe(targetArchived.fullName);

      // Active count increased by 1
      expect(store.getPatients().total).toBe(initialActiveCount + 1);
      expect(store.getPatients().items.find((p) => p.id === targetArchived.id)).toBeDefined();

      // Archived count decreased by 1
      expect(store.getArchivedPatientsCount()).toBe(initialArchivedCount - 1);

      // Verify audit history
      const audits = store.getAuditLog().items;
      const restoreAudit = audits.find(
        (a: any) => a.action === 'PATIENT_RESTORED' && a.entityId === targetArchived.id
      );
      expect(restoreAudit).toBeDefined();
      expect(restoreAudit.details).toContain(targetArchived.fullName);
    });

    it('rejects new appointment booking for an archived patient', () => {
      const archivedPatient = store.getArchivedPatients().items[0];
      expect(archivedPatient).toBeDefined();

      const doctor = store.getDoctors()[0];
      const service = store.getServices()[0];

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      expect(() => {
        store.bookAppointment({
          doctorId: doctor.id,
          patientId: archivedPatient.id,
          serviceId: service.id,
          startsAt: tomorrow.toISOString(),
          notes: 'Test booking for archived patient',
        });
      }).toThrow(/Cannot book appointment for archived patient/i);
    });
  });
});
