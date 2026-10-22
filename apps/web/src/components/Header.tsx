import React from 'react';
import { Bell, RefreshCw, Plus, Clock, LogOut, Sun, Moon, Shield } from 'lucide-react';
import { useClinic } from '../context/ClinicContext';
import { useTheme } from '../context/ThemeContext';
import { api } from '../api/client';

interface HeaderProps {
  title: string;
  subtitle?: string;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  onOpenBookingModal?: () => void;
  pendingHandoffsCount?: number;
  onSelectTab?: (tab: any) => void;
  onLogout?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  subtitle,
  onRefresh,
  isRefreshing,
  onOpenBookingModal,
  pendingHandoffsCount = 0,
  onSelectTab,
  onLogout,
}) => {
  const { timezone } = useClinic();
  const { theme, toggleTheme } = useTheme();
  const user = api.getUser();
  const initials = user
    ? `${user.firstName?.[0] || 'C'}${user.lastName?.[0] || 'A'}`.toUpperCase()
    : 'CA';
  const displayName = user
    ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Clinic Administrator'
    : 'Clinic Administrator';
  const displayEmail = user?.email || '';

  const handleLogout = async () => {
    await api.logout();
    if (onLogout) {
      onLogout();
    } else {
      window.location.reload();
    }
  };

  return (
    <header
      style={{
        height: '58px',
        borderBottom: '1px solid var(--border-subtle)',
        backgroundColor: 'var(--bg-glass)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        position: 'sticky',
        top: 0,
        zIndex: 40,
        transition: 'background-color var(--transition-normal), border-color var(--transition-normal)',
      }}
    >
      {/* Title & Section details */}
      <div
        style={{
          minWidth: 0,
          flex: 1,
          paddingRight: '16px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        <h1
          style={{
            margin: 0,
            padding: 0,
            fontSize: '16.5px',
            fontWeight: 600,
            fontFamily: 'var(--font-display)',
            color: 'var(--text-primary)',
            letterSpacing: '-0.015em',
            lineHeight: 1.25,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            style={{
              margin: '2px 0 0 0',
              padding: 0,
              fontSize: '12px',
              color: 'var(--text-muted)',
              lineHeight: 1.25,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {subtitle}
          </p>
        )}
      </div>

      {/* Actions & Profile */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
        {/* Clinic Timezone Indicator */}
        <div
          title={`Clinic Operating Timezone: ${timezone}. All schedule and appointment times are aligned to this timezone.`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '5px 10px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--bg-surface-secondary)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-secondary)',
            fontSize: '11.5px',
            fontWeight: 500,
          }}
        >
          <Clock size={13} color="var(--text-muted)" />
          <span>{timezone}</span>
        </div>

        {/* Refresh / Sync button */}
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            title="Refresh and synchronize clinic database records"
            aria-label="Synchronize clinic data"
            className="btn btn-secondary btn-sm"
            style={{
              height: '32px',
              padding: '0 11px',
              gap: '6px',
              fontSize: '12px',
              fontWeight: 500,
              cursor: isRefreshing ? 'wait' : 'pointer',
            }}
          >
            <RefreshCw
              size={13}
              style={{
                animation: isRefreshing ? 'spin 1s linear infinite' : 'none',
              }}
            />
            <span>Sync</span>
          </button>
        )}

        {/* Theme Toggle Button */}
        <button
          type="button"
          onClick={toggleTheme}
          title={theme === 'light' ? 'Switch to Dark theme' : 'Switch to Light Cream theme'}
          aria-label={theme === 'light' ? 'Switch to Dark theme' : 'Switch to Light Cream theme'}
          className="btn-icon"
          style={{
            width: '32px',
            height: '32px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-subtle)',
            backgroundColor: 'var(--bg-surface)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}
        >
          {theme === 'light' ? (
            <Moon size={15} color="var(--text-secondary)" />
          ) : (
            <Sun size={15} color="var(--text-secondary)" />
          )}
        </button>

        {/* Handoff Bell Notifications */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => onSelectTab && onSelectTab('receptionist')}
            title="AI Receptionist patient enquiries needing review"
            aria-label="View notifications"
            className="btn-icon"
            style={{
              width: '32px',
              height: '32px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              position: 'relative',
            }}
          >
            <Bell size={15} />
            {pendingHandoffsCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: '-4px',
                  right: '-4px',
                  backgroundColor: 'var(--status-cancelled-text)',
                  color: '#ffffff',
                  fontSize: '10px',
                  fontWeight: 600,
                  minWidth: '16px',
                  height: '16px',
                  borderRadius: '999px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 4px',
                }}
              >
                {pendingHandoffsCount}
              </span>
            )}
          </button>
        </div>

        {/* Primary Action Button: New Appointment */}
        {onOpenBookingModal && (
          <button
            type="button"
            onClick={onOpenBookingModal}
            className="btn btn-primary"
            style={{
              height: '32px',
              padding: '0 13px',
              fontSize: '12px',
              fontWeight: 500,
              gap: '6px',
            }}
          >
            <Plus size={14} />
            <span>New Appointment</span>
          </button>
        )}

        {/* User Identity & Sign Out */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            paddingLeft: '10px',
            borderLeft: '1px solid var(--border-subtle)',
            marginLeft: '2px',
          }}
        >
          <div
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '50%',
              backgroundColor: 'var(--bg-surface-secondary)',
              border: '1px solid var(--border-card)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-primary)',
              fontWeight: 600,
              fontSize: '11px',
              flexShrink: 0,
            }}
          >
            {initials}
          </div>
          <div style={{ lineHeight: 1.25 }}>
            <div
              style={{
                fontSize: '12.5px',
                fontWeight: 600,
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <span>{displayName}</span>
              <span title="Clinic Administrator" style={{ display: 'inline-flex' }}>
                <Shield size={11} color="var(--accent-primary)" />
              </span>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              {displayEmail}
            </div>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            title="Sign out of clinic session"
            aria-label="Sign out"
            style={{
              marginLeft: '4px',
              padding: '5px 8px',
              borderRadius: 'var(--radius-xs)',
              backgroundColor: 'transparent',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              fontSize: '11px',
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              transition: 'all var(--transition-fast)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--status-cancelled-bg)';
              e.currentTarget.style.color = 'var(--status-cancelled-text)';
              e.currentTarget.style.borderColor = 'var(--status-cancelled-border)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = 'var(--text-secondary)';
              e.currentTarget.style.borderColor = 'var(--border-subtle)';
            }}
          >
            <LogOut size={12} />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </header>
  );
};
