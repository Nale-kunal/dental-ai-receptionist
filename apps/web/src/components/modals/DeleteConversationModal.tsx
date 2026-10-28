import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Trash2, AlertTriangle } from 'lucide-react';

interface DeleteConversationModalProps {
  isOpen: boolean;
  conversation: any | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  isDeleting: boolean;
}

export const DeleteConversationModal: React.FC<DeleteConversationModalProps> = ({
  isOpen,
  conversation,
  onClose,
  onConfirm,
  isDeleting,
}) => {
  // Prevent background scrolling and handle Escape key
  useEffect(() => {
    if (!isOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isDeleting) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, isDeleting]);

  if (!isOpen || !conversation) return null;

  const patientDisplay =
    conversation.patientName ||
    conversation.contactName ||
    conversation.patient?.name ||
    conversation.patientPhone ||
    conversation.contactPhone ||
    conversation.phone ||
    conversation.channel_conversation_id ||
    'this contact';

  const handleConfirmClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (isDeleting) return;
    await onConfirm();
  };

  return createPortal(
    <div
      className="modal-overlay"
      onClick={() => {
        if (!isDeleting) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-conversation-modal-title"
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
        {/* Header */}
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
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                backgroundColor: 'var(--danger-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--danger)',
              }}
            >
              <Trash2 size={16} />
            </div>
            <div>
              <h2
                id="delete-conversation-modal-title"
                style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}
              >
                Delete Conversation
              </h2>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                Thread ID: {conversation.id ? String(conversation.id).slice(0, 8) : ''}
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              if (!isDeleting) onClose();
            }}
            disabled={isDeleting}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: isDeleting ? 'not-allowed' : 'pointer',
              padding: '4px',
              display: 'flex',
            }}
          >
            <X size={17} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5', margin: 0 }}>
            Are you sure you want to permanently delete the conversation with{' '}
            <strong style={{ color: 'var(--text-primary)' }}>{patientDisplay}</strong>?
          </p>

          <div
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--danger-subtle)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              fontSize: '12px',
              color: 'var(--text-secondary)',
              lineHeight: '1.4',
            }}
          >
            <AlertTriangle size={15} color="var(--danger)" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              This action <strong style={{ color: 'var(--danger)' }}>cannot be undone</strong>. The entire message
              transcript will be permanently deleted from the database. Patient demographic records and booked
              appointments will be preserved.
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={isDeleting}
              className="btn btn-secondary"
              style={{ height: '32px', padding: '0 14px', fontSize: '13px' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmClick}
              disabled={isDeleting}
              className="btn btn-danger"
              style={{
                height: '32px',
                padding: '0 16px',
                fontSize: '13px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Trash2 size={13} />
              {isDeleting ? 'Deleting...' : 'Delete Permanently'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
