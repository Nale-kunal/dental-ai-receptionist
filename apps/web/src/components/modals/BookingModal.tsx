import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { useClinic } from '../../context/ClinicContext';
import { X, Calendar } from 'lucide-react';

interface BookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  preselectedDoctorId?: string;
}

export const BookingModal: React.FC<BookingModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  preselectedDoctorId,
}) => {
  const toast = useToast();
  const { toUtcIso } = useClinic();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form states
  const [doctors, setDoctors] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);

  const [selectedDoctorId, setSelectedDoctorId] = useState(preselectedDoctorId || '');
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [date, setDate] = useState(() => {
    // Tomorrow by default
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  });
  const [time, setTime] = useState('10:00');
  const [notes, setNotes] = useState('');

  // Patient Quick Search / Create
  const [patientSearch, setPatientSearch] = useState('');
  const [showNewPatient, setShowNewPatient] = useState(false);
  const [newPatientName, setNewPatientName] = useState('');
  const [newPatientPhone, setNewPatientPhone] = useState('');
  const [newPatientEmail, setNewPatientEmail] = useState('');

  // Live Slots
  const [availableSlots, setAvailableSlots] = useState<any[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  // Manage body scroll locking and Escape key dismiss
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const loadPrereqs = async () => {
      setLoading(true);
      try {
        const [docs, servs, pats] = await Promise.all([
          api.getDoctors(),
          api.getServices(),
          api.getPatients({ pageSize: 50 }),
        ]);
        setDoctors(docs);
        setServices(servs);
        setPatients(pats.items);

        if (!selectedDoctorId && docs.length > 0) setSelectedDoctorId(docs[0].id);
        if (!selectedServiceId && servs.length > 0) setSelectedServiceId(servs[0].id);
        if (pats.items.length > 0) setSelectedPatientId(pats.items[0].id);
      } catch (err: any) {
        toast.error('Failed to load clinic options', err.message);
      } finally {
        setLoading(false);
      }
    };
    loadPrereqs();
  }, [isOpen]);

  // Query live slots whenever doctor, service, or date changes
  useEffect(() => {
    if (!isOpen || !selectedDoctorId || !selectedServiceId || !date) return;
    const fetchSlots = async () => {
      setLoadingSlots(true);
      try {
        const res = await api.getAvailability({
          date,
          doctorId: selectedDoctorId,
          serviceId: selectedServiceId,
        });
        setAvailableSlots(res.slots || []);
        if (res.slots && res.slots.length > 0) {
          setTime(res.slots[0].time);
        }
      } catch (err) {
        console.error('Slot check failed:', err);
      } finally {
        setLoadingSlots(false);
      }
    };
    fetchSlots();
  }, [isOpen, selectedDoctorId, selectedServiceId, date]);

  if (!isOpen) return null;

  const handleCreatePatient = async () => {
    if (!newPatientName.trim() || !newPatientPhone.trim()) {
      toast.warning('Validation', 'Patient name and phone number are required.');
      return;
    }
    try {
      setSubmitting(true);
      const created = await api.createPatient({
        fullName: newPatientName.trim(),
        phone: newPatientPhone.trim(),
        email: newPatientEmail.trim() || undefined,
      });
      toast.success('Patient Registered', `${created.fullName} is ready for booking.`);
      setSelectedPatientId(created.id);
      setShowNewPatient(false);
      // Reload patients
      const patRes = await api.getPatients({ pageSize: 50 });
      setPatients(patRes.items);
    } catch (err: any) {
      toast.error('Failed to add patient', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDoctorId || !selectedServiceId || !selectedPatientId || !date || !time) {
      toast.warning('Incomplete Form', 'Please choose doctor, service, patient, date, and time.');
      return;
    }

    try {
      setSubmitting(true);
      const matchingSlot = availableSlots.find((s) => s.time === time);
      const startsAt = matchingSlot?.startsAt || toUtcIso(date, time);

      const result = await api.bookAppointment({
        doctorId: selectedDoctorId,
        serviceId: selectedServiceId,
        patientId: selectedPatientId,
        startsAt,
        notes: notes.trim() || undefined,
      });

      toast.success(
        'Appointment Confirmed!',
        `Confirmation code: ${result.confirmation_code || 'Generated'}`
      );
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error('Booking Rejected', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const filteredPatients = patients.filter((p) =>
    patientSearch
      ? p.fullName.toLowerCase().includes(patientSearch.toLowerCase()) ||
        p.phone.includes(patientSearch)
      : true
  );

  return createPortal(
    <div
      className="modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="booking-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        backgroundColor: 'var(--bg-modal-overlay)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-modal)',
          color: 'var(--text-primary)',
          width: '100%',
          maxWidth: '560px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          padding: 0,
          position: 'relative',
          zIndex: 1001,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '13px 18px',
            borderBottom: '1px solid var(--border-subtle)',
            backgroundColor: 'var(--bg-surface)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '8px',
                backgroundColor: 'var(--accent-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent-primary)',
              }}
            >
              <Calendar size={15} />
            </div>
            <div>
              <h2 id="booking-modal-title" style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Book Dental Appointment
              </h2>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0, marginTop: '2px' }}>
                Select an available appointment opening for the patient
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
            }}
          >
            <X size={17} />
          </button>
        </div>

        {/* Body */}
        <form
          onSubmit={handleSubmit}
          style={{
            padding: '14px 18px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            backgroundColor: 'var(--bg-surface)',
            flex: 1,
          }}
        >
          {/* Dentist Selection */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                marginBottom: '4px',
              }}
            >
              Select Dentist / Practitioner
            </label>
            <select
              value={selectedDoctorId}
              onChange={(e) => setSelectedDoctorId(e.target.value)}
              className="form-input"
              style={{ width: '100%', fontSize: '13px', height: '32px' }}
            >
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.displayName} ({d.specialty})
                </option>
              ))}
            </select>
          </div>

          {/* Service Selection */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                marginBottom: '4px',
              }}
            >
              Select Service / Treatment
            </label>
            <select
              value={selectedServiceId}
              onChange={(e) => setSelectedServiceId(e.target.value)}
              className="form-input"
              style={{ width: '100%', fontSize: '13px', height: '32px' }}
            >
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.durationMinutes} mins + {s.bufferMinutes || 10} min buffer)
                </option>
              ))}
            </select>
          </div>

          {/* Patient Selection & Quick Add */}
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '4px',
              }}
            >
              <label
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                }}
              >
                Patient
              </label>
              <button
                type="button"
                onClick={() => setShowNewPatient(!showNewPatient)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--accent-text)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                {showNewPatient ? 'Cancel New Patient' : '+ Quick Register New Patient'}
              </button>
            </div>

            {showNewPatient ? (
              <div
                style={{
                  padding: '10px 12px',
                  backgroundColor: 'var(--bg-surface-secondary)',
                  borderRadius: '8px',
                  border: '1px solid var(--border-card)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <input
                  type="text"
                  placeholder="Full Name (e.g. Sarah Jenkins)"
                  value={newPatientName}
                  onChange={(e) => setNewPatientName(e.target.value)}
                  className="form-input"
                  style={{ fontSize: '13px', height: '32px' }}
                />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    placeholder="Phone Number (+1...)"
                    value={newPatientPhone}
                    onChange={(e) => setNewPatientPhone(e.target.value)}
                    className="form-input"
                    style={{ flex: 1, fontSize: '13px', height: '32px' }}
                  />
                  <input
                    type="email"
                    placeholder="Email (Optional)"
                    value={newPatientEmail}
                    onChange={(e) => setNewPatientEmail(e.target.value)}
                    className="form-input"
                    style={{ flex: 1, fontSize: '13px', height: '32px' }}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleCreatePatient}
                  disabled={submitting}
                  className="btn btn-primary"
                  style={{
                    height: '30px',
                    padding: '0 12px',
                    fontSize: '12px',
                  }}
                >
                  Save Patient & Select
                </button>
              </div>
            ) : (
              <div>
                <input
                  type="text"
                  placeholder="Type to filter patients..."
                  value={patientSearch}
                  onChange={(e) => setPatientSearch(e.target.value)}
                  className="form-input"
                  style={{
                    width: '100%',
                    borderRadius: '8px 8px 0 0',
                    fontSize: '12px',
                    height: '30px',
                    borderBottom: 'none',
                  }}
                />
                <select
                  value={selectedPatientId}
                  onChange={(e) => setSelectedPatientId(e.target.value)}
                  className="form-input"
                  style={{
                    width: '100%',
                    borderRadius: '0 0 8px 8px',
                    fontSize: '13px',
                    height: '32px',
                  }}
                >
                  {filteredPatients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName} — {p.phone}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Date and Time */}
          <div style={{ display: 'flex', gap: '12px' }}>
            <div style={{ flex: 1 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  marginBottom: '4px',
                }}
              >
                Date
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                className="form-input"
                style={{ width: '100%', fontSize: '13px', height: '32px' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  marginBottom: '4px',
                }}
              >
                Time {loadingSlots && '(calculating...)'}
              </label>
              {availableSlots.length > 0 ? (
                <select
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="form-input"
                  style={{ width: '100%', fontSize: '13px', height: '32px' }}
                >
                  {availableSlots.map((s, idx) => (
                    <option key={idx} value={s.time}>
                      {s.time} (Available)
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="form-input"
                  style={{ width: '100%', fontSize: '13px', height: '32px' }}
                />
              )}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                marginBottom: '4px',
              }}
            >
              Internal Notes / Clinical Concerns
            </label>
            <textarea
              placeholder="e.g. Patient mentioned mild sensitivity on lower left molar..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="form-input"
              style={{
                width: '100%',
                fontSize: '13px',
                lineHeight: '1.45',
                padding: '6px 10px',
                resize: 'none',
              }}
            />
          </div>

          {/* Footer Actions */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: '8px',
              marginTop: '8px',
              paddingTop: '10px',
              borderTop: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-surface)',
              position: 'sticky',
              bottom: 0,
              zIndex: 5,
            }}
          >
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary"
              style={{ height: '32px', padding: '0 14px', fontSize: '13px' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn btn-primary"
              style={{ height: '32px', padding: '0 18px', fontSize: '13px' }}
            >
              {submitting ? 'Confirming...' : 'Book & Lock Appointment'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
