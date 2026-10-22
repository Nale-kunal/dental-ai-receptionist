import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { X, CheckCircle, ShieldAlert } from 'lucide-react';

interface HandoffModalProps {
  isOpen: boolean;
  handoff: any | null;
  onClose: () => void;
  onSuccess: () => void;
}

export const HandoffModal: React.FC<HandoffModalProps> = ({
  isOpen,
  handoff,
  onClose,
  onSuccess,
}) => {
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [resolutionNotes, setResolutionNotes] = useState('Contacted patient via phone and resolved inquiry.');

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

  if (!isOpen || !handoff) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolutionNotes.trim()) {
      toast.warning('Notes Required', 'Please enter how this handoff was resolved.');
      return;
    }

    try {
      setSubmitting(true);
      await api.resolveHandoff(handoff.id, resolutionNotes.trim());
      toast.success('Handoff Resolved', 'The patient has been marked as attended and AI receptionist released.');
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error('Resolve Failed', err.message);
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
      aria-labelledby="handoff-modal-title"
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
              <CheckCircle size={15} />
            </div>
            <div>
              <h2 id="handoff-modal-title" style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Resolve Patient Handoff
              </h2>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                Reason: {handoff.reason}
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
              padding: '9px 12px',
              backgroundColor: 'var(--warning-subtle)',
              borderRadius: '8px',
              border: '1px solid rgba(194, 91, 16, 0.2)',
              fontSize: '12.5px',
              color: 'var(--warning)',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <ShieldAlert size={15} />
            <div>
              Patient: <strong style={{ color: 'var(--text-primary)' }}>{handoff.patientName || 'Unknown Patient'}</strong> ({handoff.patientPhone || 'No phone'})
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
              Resolution Notes / Follow-up Actions
            </label>
            <textarea
              value={resolutionNotes}
              onChange={(e) => setResolutionNotes(e.target.value)}
              rows={3}
              placeholder="Explain how the staff addressed this patient's request..."
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

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary"
              style={{
                height: '32px',
                padding: '0 14px',
                fontSize: '13px',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn btn-primary"
              style={{
                height: '32px',
                padding: '0 16px',
                fontSize: '13px',
              }}
            >
              {submitting ? 'Resolving...' : 'Complete & Close Handoff'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
