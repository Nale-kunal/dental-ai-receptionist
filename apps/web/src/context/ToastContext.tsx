import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
}

interface ToastContextValue {
  showToast: (type: ToastType, title: string, message?: string) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const recentToastsRef = React.useRef<Map<string, number>>(new Map());

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((type: ToastType, title: string, message?: string) => {
    const key = `${type}:${title}:${message || ''}`;
    const now = Date.now();
    const lastTime = recentToastsRef.current.get(key) || 0;

    // Deduplicate identical notifications within 3.5 seconds
    if (now - lastTime < 3500) {
      return;
    }
    recentToastsRef.current.set(key, now);

    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => {
      const filtered = prev.slice(-2);
      return [...filtered, { id, type, title, message }];
    });

    setTimeout(() => {
      removeToast(id);
    }, 4500);
  }, [removeToast]);

  const success = useCallback((title: string, message?: string) => showToast('success', title, message), [showToast]);
  const error = useCallback((title: string, message?: string) => showToast('error', title, message), [showToast]);
  const info = useCallback((title: string, message?: string) => showToast('info', title, message), [showToast]);
  const warning = useCallback((title: string, message?: string) => showToast('warning', title, message), [showToast]);

  return (
    <ToastContext.Provider value={{ showToast, success, error, info, warning }}>
      {children}
      <div
        className="toast-container"
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          maxWidth: '380px',
          pointerEvents: 'none',
        }}
      >
        {toasts.map((t) => {
          const typeConfig = {
            success: {
              bg: 'var(--status-confirmed-bg)',
              border: 'var(--status-confirmed-border)',
              color: 'var(--status-confirmed-text)',
              icon: CheckCircle2,
            },
            error: {
              bg: 'var(--status-cancelled-bg)',
              border: 'var(--status-cancelled-border)',
              color: 'var(--status-cancelled-text)',
              icon: AlertCircle,
            },
            warning: {
              bg: 'var(--status-pending-bg)',
              border: 'var(--status-pending-border)',
              color: 'var(--status-pending-text)',
              icon: AlertTriangle,
            },
            info: {
              bg: 'var(--status-completed-bg)',
              border: 'var(--status-completed-border)',
              color: 'var(--status-completed-text)',
              icon: Info,
            },
          }[t.type];

          const IconComponent = typeConfig.icon;

          return (
            <div
              key={t.id}
              onClick={() => removeToast(t.id)}
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: `1px solid var(--border-card)`,
                borderLeft: `4px solid ${typeConfig.color}`,
                color: 'var(--text-primary)',
                padding: '12px 14px',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-lg)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                pointerEvents: 'auto',
                cursor: 'pointer',
                animation: 'fadeIn 0.2s cubic-bezier(0.2, 0, 0, 1)',
                backdropFilter: 'blur(12px)',
                transition: 'all 0.15s ease',
              }}
            >
              <IconComponent size={18} color={typeConfig.color} style={{ marginTop: '2px', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--text-primary)' }}>
                  {t.title}
                </div>
                {t.message && (
                  <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginTop: '2px', lineHeight: 1.4 }}>
                    {t.message}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeToast(t.id);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '2px',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}
