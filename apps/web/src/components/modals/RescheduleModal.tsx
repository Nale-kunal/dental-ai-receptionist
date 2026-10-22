import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { useClinic } from '../../context/ClinicContext';
import { X, CalendarClock } from 'lucide-react';

interface RescheduleModalProps {
  isOpen: boolean;
  appointment: any | null;
  onClose: () => void;
  onSuccess: () => void;
}

export const RescheduleModal: React.FC<RescheduleModalProps> = ({
  isOpen,
  appointment,
  onClose,
  onSuccess,
}) => {
  const toast = useToast();
  const { formatDateTime, toUtcIso } = useClinic();
  const [submitting, setSubmitting] = useState(false);
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return d.toISOString().split('T')[0];
  });
  const [time, setTime] = useState('11:00');
  const [reason, setReason] = useState('Patient schedule adjustment');

  // Prevent background scrolling and handle Escape key
  useEffect(() => {
    if (!isOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !appointment) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      const newStartsAt = toUtcIso(date, time);
      await api.rescheduleAppointment(appointment.id, newStartsAt, reason);
      toast.success('Rescheduled Successfully', `New appointment moved to ${date} at ${time}`);
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error('Reschedule Failed', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="reschedule-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        backgroundColor: 'var(--bg-modal-overlay)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      }}
    >
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '480px',
          overflow: 'hidden',
          padding: 0,
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-modal)',
          color: 'var(--text-primary)',
          position: 'relative',
          zIndex: 1001,
        }}
      >
        <div
          style={{
            padding: '13px 18px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'var(--bg-surface)',
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
              <CalendarClock size={15} />
            </div>
            <div>
              <h2 id="reschedule-modal-title" style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Reschedule Appointment
              </h2>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                Code: {appointment.confirmationCode || appointment.id.slice(0, 8)}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px', display: 'flex' }}
          >
            <X size={17} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div
            style={{
              padding: '10px 12px',
              backgroundColor: 'var(--bg-surface-secondary)',
              borderRadius: '8px',
              border: '1px solid var(--border-subtle)',
              fontSize: '12.5px',
              color: 'var(--text-secondary)',
              display: 'flex',
              flexDirection: 'column',
              gap: '3px',
            }}
          >
            <div><strong style={{ color: 'var(--text-primary)' }}>Patient:</strong> {appointment.patient?.name || appointment.patient?.fullName || 'Patient'}</div>
            <div><strong style={{ color: 'var(--text-primary)' }}>Doctor:</strong> {appointment.doctor?.name || appointment.doctor?.displayName || 'Dentist'}</div>
            <div><strong style={{ color: 'var(--text-primary)' }}>Current Time:</strong> {formatDateTime(appointment.startsAt)}</div>
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                New Date
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                required
                className="form-input"
                style={{ width: '100%', fontSize: '13px', height: '32px' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                New Time
              </label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                required
                className="form-input"
                style={{ width: '100%', fontSize: '13px', height: '32px' }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
              Reason for Rescheduling
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Patient travel conflict"
              className="form-input"
              style={{ width: '100%', fontSize: '13px', height: '32px' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
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
              {submitting ? 'Updating...' : 'Reschedule Slot'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
