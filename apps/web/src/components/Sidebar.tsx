import React from 'react';
import {
  LayoutDashboard,
  Calendar,
  Users,
  Bot,
  Clock,
  Briefcase,
  BarChart3,
  History,
  Settings,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';
import { useClinic } from '../context/ClinicContext';
import { api } from '../api/client';

export type NavTab =
  | 'dashboard'
  | 'appointments'
  | 'patients'
  | 'receptionist'
  | 'schedules'
  | 'services'
  | 'analytics'
  | 'audit'
  | 'settings';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  pendingHandoffsCount?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  pendingHandoffsCount = 0,
}) => {
  const { clinic } = useClinic();
  const user = api.getUser();
  const clinicDisplayName = clinic?.name || user?.clinicName || 'Clinic Workspace';
  const menuItems = [
    { id: 'dashboard' as NavTab, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'appointments' as NavTab, label: 'Appointments', icon: Calendar },
    { id: 'patients' as NavTab, label: 'Patients', icon: Users },
    {
      id: 'receptionist' as NavTab,
      label: 'AI Receptionist',
      icon: Bot,
      badge: pendingHandoffsCount > 0 ? pendingHandoffsCount : undefined,
    },
    { id: 'schedules' as NavTab, label: 'Dentists & Hours', icon: Clock },
    { id: 'services' as NavTab, label: 'Dental Services', icon: Briefcase },
    { id: 'analytics' as NavTab, label: 'Analytics & KPIs', icon: BarChart3 },
    { id: 'audit' as NavTab, label: 'Audit Trail', icon: History },
    { id: 'settings' as NavTab, label: 'Clinic Settings', icon: Settings },
  ];

  return (
    <aside
      style={{
        width: '240px',
        backgroundColor: 'var(--bg-surface-secondary)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        height: '100vh',
        position: 'sticky',
        top: 0,
        transition: 'background-color var(--transition-normal), border-color var(--transition-normal)',
      }}
    >
      {/* Brand & Clinic Name */}
      <div
        style={{
          padding: '16px 16px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}
      >
        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--accent-primary)',
            color: 'var(--accent-text)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'var(--shadow-sm)',
            flexShrink: 0,
          }}
        >
          <Bot size={18} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              fontSize: '14px',
              letterSpacing: '-0.015em',
              color: 'var(--text-primary)',
              lineHeight: 1.2,
            }}
          >
            DentalAI Suite
          </div>
          <div
            style={{
              fontSize: '11px',
              color: 'var(--text-secondary)',
              marginTop: '1px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {clinicDisplayName}
          </div>
        </div>
      </div>

      {/* Navigation Links */}
      <nav
        style={{
          flex: 1,
          padding: '10px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
          overflowY: 'auto',
        }}
      >
        {menuItems.map((item) => {
          const isActive = activeTab === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '9px',
                width: '100%',
                padding: '7px 10px',
                borderRadius: 'var(--radius-sm)',
                border: isActive ? '1px solid var(--border-subtle)' : '1px solid transparent',
                backgroundColor: isActive ? 'var(--bg-surface)' : 'transparent',
                color: isActive ? 'var(--accent-primary)' : 'var(--text-secondary)',
                fontWeight: isActive ? 600 : 400,
                fontSize: '13px',
                cursor: 'pointer',
                transition: 'all var(--transition-fast)',
                textAlign: 'left',
                boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.backgroundColor = 'var(--bg-surface-hover)';
                  e.currentTarget.style.color = 'var(--text-primary)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = 'var(--text-secondary)';
                }
              }}
            >
              <Icon
                size={15}
                color={isActive ? 'var(--accent-primary)' : 'var(--text-secondary)'}
                strokeWidth={isActive ? 2.2 : 1.8}
                style={{ flexShrink: 0 }}
              />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.label}
              </span>
              {item.badge !== undefined && (
                <span
                  style={{
                    backgroundColor: 'var(--status-cancelled-bg)',
                    color: 'var(--status-cancelled-text)',
                    border: '1px solid var(--status-cancelled-border)',
                    fontSize: '10px',
                    fontWeight: 600,
                    padding: '1px 5px',
                    borderRadius: 'var(--radius-full)',
                    lineHeight: '1.2',
                  }}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Clinic System Status Panel (Restrained, No Glowing Green Halos) */}
      <div
        style={{
          padding: '10px 14px',
          borderTop: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-surface)',
          transition: 'background-color var(--transition-normal)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '4px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              fontSize: '11.5px',
              color: 'var(--status-confirmed-text)',
              fontWeight: 500,
            }}
          >
            <CheckCircle2 size={13} color="var(--status-confirmed-text)" />
            <span>Clinic Operational</span>
          </div>
          <span
            style={{
              fontSize: '10px',
              color: 'var(--text-muted)',
              padding: '1px 5px',
              backgroundColor: 'var(--bg-surface-secondary)',
              borderRadius: 'var(--radius-xs)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            Front Desk
          </span>
        </div>
        <div
          style={{
            fontSize: '11px',
            color: 'var(--text-muted)',
            lineHeight: 1.35,
          }}
        >
          AI Receptionist Online & Answering
        </div>
      </div>
    </aside>
  );
};
