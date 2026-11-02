import React from 'react';
import { Sparkles, RotateCcw, LogOut, Info } from 'lucide-react';

interface DemoBannerProps {
  onReset: () => void;
  onExit: () => void;
}

export const DemoBanner: React.FC<DemoBannerProps> = ({ onReset, onExit }) => {
  return (
    <aside
      aria-label="Demo mode active notification"
      style={{
        backgroundColor: 'var(--bg-surface, #ffffff)',
        borderBottom: '1px solid var(--border-color, #e2e8f0)',
        borderLeft: '4px solid var(--accent-primary, #0d9488)',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
        fontSize: '13px',
        color: 'var(--text-primary, #0f172a)',
        zIndex: 40,
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      }}
    >
      {/* Left: Badge & Description */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: '1 1 320px' }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '3px 8px',
            borderRadius: '4px',
            backgroundColor: 'rgba(13, 148, 136, 0.12)',
            color: 'var(--accent-primary, #0d9488)',
            fontWeight: 700,
            fontSize: '11px',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
          }}
        >
          <Sparkles size={13} />
          <span>Demo Mode</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <strong style={{ fontWeight: 600 }}>BrightSmile Dental Studio (Austin, TX)</strong>
          <span style={{ color: 'var(--text-muted, #64748b)', fontSize: '12px' }}>
            — Sample clinic data. Changes reset on refresh. No real patient messages or phone calls are dispatched.
          </span>
        </div>
      </div>

      {/* Right: Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          type="button"
          onClick={onReset}
          className="btn btn-secondary btn-sm"
          title="Restore baseline sample dataset"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '5px 10px',
            fontSize: '12px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          <RotateCcw size={13} />
          <span>Reset Sample Data</span>
        </button>

        <button
          type="button"
          onClick={onExit}
          className="btn btn-secondary btn-sm"
          title="Exit live demo and return to clinic sign in"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '5px 10px',
            fontSize: '12px',
            fontWeight: 500,
            cursor: 'pointer',
            color: 'var(--error, #ef4444)',
          }}
        >
          <LogOut size={13} />
          <span>Exit Demo</span>
        </button>
      </div>
    </aside>
  );
};
