import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { useClinic } from '../../context/ClinicContext';
import { X, AlertTriangle } from 'lucide-react';

interface CancelModalProps {
  isOpen: boolean;
  appointment: any | null;
  onClose: () => void;
  onSuccess: () => void;
}

export const CancelModal: React.FC<CancelModalProps> = ({
  isOpen,
  appointment,
  onClose,
  onSuccess,
}) => {
  const toast = useToast();
  const { formatDate, formatTime } = useClinic();
  const [submitting, setSubmitting] = useState(false);
  const [reason, setReason] = useState('Patient requested cancellation');

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
      await api.cancelAppointment(appointment.id, reason);
      toast.success('Appointment Cancelled', 'The slot has been released back to clinic availability.');
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error('Cancellation Failed', err.message);
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
      aria-labelledby="cancel-modal-title"
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
          maxWidth: '460px',
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
                backgroundColor: 'var(--danger-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--danger)',
              }}
            >
              <AlertTriangle size={15} />
            </div>
            <div>
              <h2 id="cancel-modal-title" style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Cancel Appointment
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
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.45', margin: 0 }}>
            Are you sure you want to cancel the appointment for{' '}
            <strong style={{ color: 'var(--text-primary)' }}>{appointment.patient?.name || appointment.patient?.fullName || 'Patient'}</strong> with{' '}
            <strong style={{ color: 'var(--text-primary)' }}>{appointment.doctor?.name || appointment.doctor?.displayName || 'Dentist'}</strong> on{' '}
            <strong style={{ color: 'var(--text-primary)' }}>{formatDate(appointment.startsAt)} at {formatTime(appointment.startsAt)}</strong>?
          </p>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
              Reason for Cancellation
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="form-input"
              style={{ width: '100%', fontSize: '13px', height: '32px' }}
            >
              <option value="Patient requested cancellation">Patient requested cancellation</option>
              <option value="Patient feeling unwell / sickness">Patient feeling unwell / sickness</option>
              <option value="Doctor emergency / unavailable">Doctor emergency / unavailable</option>
              <option value="Scheduling error / duplicate booking">Scheduling error / duplicate booking</option>
              <option value="Financial / insurance dispute">Financial / insurance dispute</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary"
              style={{ height: '32px', padding: '0 14px', fontSize: '13px' }}
            >
              Keep Appointment
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn btn-danger"
              style={{ height: '32px', padding: '0 16px', fontSize: '13px' }}
            >
              {submitting ? 'Cancelling...' : 'Confirm Cancellation'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
