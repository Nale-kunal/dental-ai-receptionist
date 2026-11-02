import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Trash2, AlertTriangle } from 'lucide-react';

export type DeleteConversationMode = 'single' | 'selected' | 'all';

interface DeleteConversationModalProps {
  isOpen: boolean;
  mode?: DeleteConversationMode;
  conversation?: any | null;
  selectedCount?: number;
  totalCount?: number;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  isDeleting: boolean;
}

export const DeleteConversationModal: React.FC<DeleteConversationModalProps> = ({
  isOpen,
  mode = 'single',
  conversation,
  selectedCount = 0,
  totalCount = 0,
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

  if (!isOpen) return null;
  if (mode === 'single' && !conversation) return null;

  const patientDisplay = conversation
    ? conversation.patientName ||
      conversation.contactName ||
      conversation.patient?.name ||
      conversation.patientPhone ||
      conversation.contactPhone ||
      conversation.phone ||
      conversation.channel_conversation_id ||
      'this contact'
    : '';

  const handleConfirmClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (isDeleting) return;
    await onConfirm();
  };

  const getTitle = () => {
    if (mode === 'all') return 'Delete All Clinic Conversations';
    if (mode === 'selected') return 'Delete Selected Conversations';
    return 'Delete Conversation';
  };

  const getSubtitle = () => {
    if (mode === 'all') return `Scope: Entire clinic inbox (${totalCount} conversation${totalCount === 1 ? '' : 's'})`;
    if (mode === 'selected') return `${selectedCount} conversation${selectedCount === 1 ? '' : 's'} selected`;
    return `Thread ID: ${conversation?.id ? String(conversation.id).slice(0, 8) : ''}`;
  };

  const getPrompt = () => {
    if (mode === 'all') {
      return (
        <>
          Are you sure you want to permanently delete{' '}
          <strong style={{ color: 'var(--danger)' }}>
            ALL {totalCount} conversation{totalCount === 1 ? '' : 's'}
          </strong>{' '}
          belonging to this clinic? This action will completely clear your patient conversations inbox.
        </>
      );
    }
    if (mode === 'selected') {
      return (
        <>
          Are you sure you want to permanently delete the{' '}
          <strong style={{ color: 'var(--text-primary)' }}>
            {selectedCount} selected conversation{selectedCount === 1 ? '' : 's'}
          </strong>
          ?
        </>
      );
    }
    return (
      <>
        Are you sure you want to permanently delete the conversation with{' '}
        <strong style={{ color: 'var(--text-primary)' }}>{patientDisplay}</strong>?
      </>
    );
  };

  const getWarning = () => {
    if (mode === 'all') {
      return (
        <>
          This action <strong style={{ color: 'var(--danger)' }}>cannot be undone</strong>. All conversation threads
          and message transcripts for this clinic will be permanently deleted from the database. Patient demographic
          records, contact details, and booked appointments will remain completely intact.
        </>
      );
    }
    if (mode === 'selected') {
      return (
        <>
          This action <strong style={{ color: 'var(--danger)' }}>cannot be undone</strong>. The message transcripts for
          the selected conversations will be permanently deleted from the database. Patient demographic records and
          booked appointments will be preserved.
        </>
      );
    }
    return (
      <>
        This action <strong style={{ color: 'var(--danger)' }}>cannot be undone</strong>. The entire message
        transcript will be permanently deleted from the database. Patient demographic records and booked
        appointments will be preserved.
      </>
    );
  };

  const getConfirmButtonText = () => {
    if (isDeleting) {
      if (mode === 'all') return 'Deleting All...';
      if (mode === 'selected') return 'Deleting Selected...';
      return 'Deleting...';
    }
    if (mode === 'all') return 'Delete All Conversations';
    if (mode === 'selected') return `Delete ${selectedCount} Selected`;
    return 'Delete Permanently';
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
                {getTitle()}
              </h2>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                {getSubtitle()}
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
            {getPrompt()}
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
            <div>{getWarning()}</div>
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
              {getConfirmButtonText()}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
