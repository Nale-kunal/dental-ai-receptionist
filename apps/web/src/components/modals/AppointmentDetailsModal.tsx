import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useClinic } from '../../context/ClinicContext';
import {
  X,
  Calendar,
  Clock,
  User,
  Phone,
  Mail,
  Stethoscope,
  CalendarClock,
  Ban,
  History,
  FileText,
  Tag,
  Copy,
  Check,
} from 'lucide-react';

interface AppointmentDetailsModalProps {
  isOpen: boolean;
  appointment: any | null;
  onClose: () => void;
  onReschedule: (appointment: any) => void;
  onCancel: (appointment: any) => void;
  onViewHistory: (appointment: any) => void;
}

export const AppointmentDetailsModal: React.FC<AppointmentDetailsModalProps> = ({
  isOpen,
  appointment,
  onClose,
  onReschedule,
  onCancel,
  onViewHistory,
}) => {
  const { formatDate, formatTime, timezone } = useClinic();
  const [copiedCode, setCopiedCode] = React.useState(false);

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

  const code = appointment.confirmationCode || appointment.id?.slice(0, 8);
  const patientName = appointment.patient?.name || appointment.patient?.fullName || 'Patient';
  const patientPhone = appointment.patient?.phone || 'No phone provided';
  const patientEmail = appointment.patient?.email;
  const doctorName = appointment.doctor?.name || appointment.doctor?.displayName || 'Doctor';
  const serviceName = appointment.service?.name || 'General Dental Treatment';
  const duration = appointment.durationMinutes || 30;
  const buffer = appointment.bufferMinutes || 10;
  const status = appointment.status || 'confirmed';

  const handleCopyCode = () => {
    if (code) {
      navigator.clipboard.writeText(code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const getStatusBadge = (st: string) => {
    switch (st) {
      case 'confirmed':
        return <span className="badge badge-confirmed"><span className="badge-dot" />Confirmed</span>;
      case 'rescheduled':
        return <span className="badge badge-rescheduled"><span className="badge-dot" />Rescheduled</span>;
      case 'cancelled':
        return <span className="badge badge-cancelled"><span className="badge-dot" />Cancelled</span>;
      case 'pending':
        return <span className="badge badge-pending"><span className="badge-dot" />Pending</span>;
      case 'completed':
        return <span className="badge badge-completed"><span className="badge-dot" />Completed</span>;
      default:
        return <span className="badge badge-neutral"><span className="badge-dot" />{st.replace('_', ' ')}</span>;
    }
  };

  return createPortal(
    <div
      className="modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="appointment-details-title"
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
          maxWidth: '520px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-modal)',
          color: 'var(--text-primary)',
          position: 'relative',
          zIndex: 1001,
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'var(--bg-surface-secondary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '34px',
                height: '34px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'rgba(13, 148, 136, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent-primary)',
              }}
            >
              <Calendar size={18} />
            </div>
            <div>
              <h3
                id="appointment-details-title"
                style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}
              >
                Appointment Details
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>Code:</span>
                <span className="code-pill" style={{ fontSize: '11px', padding: '1px 6px' }}>
                  {code}
                </span>
                <button
                  type="button"
                  onClick={handleCopyCode}
                  title="Copy confirmation code"
                  className="btn-icon"
                  style={{ width: '18px', height: '18px', padding: 0 }}
                >
                  {copiedCode ? <Check size={11} color="var(--accent-primary)" /> : <Copy size={11} />}
                </button>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {getStatusBadge(status)}
            <button
              type="button"
              onClick={onClose}
              className="btn-icon"
              aria-label="Close appointment details"
              style={{ marginLeft: '4px' }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body content */}
        <div
          style={{
            padding: '20px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            fontSize: '13px',
          }}
        >
          {/* Timing card */}
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-primary)', fontWeight: 600 }}>
              <Clock size={15} />
              <span>{formatDate(appointment.startsAt)}</span>
            </div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
              {formatTime(appointment.startsAt)}
              <span style={{ fontWeight: 400, color: 'var(--text-secondary)', marginLeft: '6px', fontSize: '12px' }}>
                ({duration} mins + {buffer}m buffer)
              </span>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Clinic Timezone: {timezone || 'UTC'}
            </div>
          </div>

          {/* Patient and Doctor info */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {/* Patient card */}
            <div
              style={{
                padding: '12px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--bg-surface-secondary)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '11.5px', marginBottom: '6px' }}>
                <User size={13} />
                <span>Patient</span>
              </div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                {patientName}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                <Phone size={11} />
                <span>{patientPhone}</span>
              </div>
              {patientEmail && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  <Mail size={11} />
                  <span>{patientEmail}</span>
                </div>
              )}
            </div>

            {/* Practitioner card */}
            <div
              style={{
                padding: '12px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--bg-surface-secondary)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '11.5px', marginBottom: '6px' }}>
                <Stethoscope size={13} />
                <span>Practitioner</span>
              </div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                {doctorName}
              </div>
              <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                {appointment.doctor?.specialty || 'General Dentistry'}
              </div>
            </div>
          </div>

          {/* Procedure details */}
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--bg-surface-secondary)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '11.5px', marginBottom: '4px' }}>
              <Tag size={13} />
              <span>Service & Procedure</span>
            </div>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
              {serviceName}
            </div>
            {appointment.service?.description && (
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                {appointment.service.description}
              </div>
            )}
          </div>

          {/* Notes or Booking Source */}
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--bg-surface-secondary)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '11.5px', marginBottom: '4px' }}>
              <FileText size={13} />
              <span>Booking Notes & Channel</span>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
              {appointment.notes || (
                <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  No special notes recorded. Booked via {appointment.source || 'Receptionist Dashboard'}.
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div
          style={{
            padding: '14px 20px',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'var(--bg-surface-secondary)',
            gap: '10px',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={() => {
              onClose();
              onViewHistory(appointment);
            }}
            className="btn btn-secondary btn-sm"
            style={{ gap: '6px', height: '32px' }}
          >
            <History size={13} /> Status History
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {status !== 'cancelled' && status !== 'completed' && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onReschedule(appointment);
                  }}
                  className="btn btn-secondary btn-sm"
                  style={{ gap: '6px', height: '32px', color: 'var(--status-rescheduled-text)' }}
                >
                  <CalendarClock size={13} /> Reschedule
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onCancel(appointment);
                  }}
                  className="btn btn-secondary btn-sm"
                  style={{ gap: '6px', height: '32px', color: 'var(--status-cancelled-text)' }}
                >
                  <Ban size={13} /> Cancel
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="btn btn-primary btn-sm"
              style={{ height: '32px', padding: '0 14px' }}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
