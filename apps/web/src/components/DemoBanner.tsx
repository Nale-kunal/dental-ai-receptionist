import React from 'react';
import { Sparkles, RotateCcw, LogOut } from 'lucide-react';

interface DemoBannerProps {
  onReset: () => void;
  onExit: () => void;
}

export const DemoBanner: React.FC<DemoBannerProps> = ({ onReset, onExit }) => {
  return (
    <aside
      aria-label="Demo mode active indicator"
      className="demo-banner-strip"
    >
      {/* Left: Badge, Clinic Name & Short Explanatory Message */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '2px 6px',
            borderRadius: 'var(--radius-xs)',
            backgroundColor: 'var(--accent-subtle)',
            color: 'var(--accent-primary)',
            fontWeight: 700,
            fontSize: '10px',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            flexShrink: 0,
            border: '1px solid var(--accent-border)',
          }}
        >
          <Sparkles size={11} />
          <span>DEMO MODE</span>
        </span>

        <span
          style={{
            fontWeight: 600,
            color: 'var(--text-primary)',
            fontSize: '11.5px',
            flexShrink: 0,
          }}
        >
          BrightSmile Dental Studio
        </span>

        <span
          className="demo-banner-hint"
          style={{
            color: 'var(--text-muted)',
            fontSize: '11px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          · Sample data only · Changes reset on refresh
        </span>
      </div>

      {/* Right: Restrained Secondary Actions */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={onReset}
          className="btn btn-secondary btn-sm"
          title="Restore baseline sample clinic dataset"
          style={{
            height: '24px',
            minHeight: '24px',
            padding: '0 8px',
            fontSize: '11px',
            gap: '5px',
            fontWeight: 500,
            borderRadius: 'var(--radius-xs)',
          }}
        >
          <RotateCcw size={11} />
          <span className="demo-banner-btn-text">Reset Demo</span>
        </button>

        <button
          type="button"
          onClick={onExit}
          className="btn btn-ghost btn-sm"
          title="Exit live demo and return to clinic sign in"
          style={{
            height: '24px',
            minHeight: '24px',
            padding: '0 8px',
            fontSize: '11px',
            gap: '5px',
            fontWeight: 500,
            borderRadius: 'var(--radius-xs)',
            color: 'var(--status-cancelled-text)',
          }}
        >
          <LogOut size={11} />
          <span className="demo-banner-btn-text">Exit Demo</span>
        </button>
      </div>
    </aside>
  );
};
