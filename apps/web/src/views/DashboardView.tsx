import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import { useClinic } from '../context/ClinicContext';
import {
  Calendar,
  CheckCircle,
  Users,
  Bot,
  AlertTriangle,
  Clock,
  ArrowRight,
  PhoneCall,
  UserCheck,
  CalendarCheck,
  CalendarDays,
  MessageSquare,
  RefreshCw,
  Plus,
} from 'lucide-react';

interface DashboardViewProps {
  onNavigate: (tab: any) => void;
  onOpenBookingModal: () => void;
  onOpenHandoffModal: (handoff: any) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  onNavigate,
  onOpenBookingModal,
  onOpenHandoffModal,
}) => {
  const toast = useToast();
  const { formatDate, formatTime } = useClinic();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<any>(null);
  const [recentAppointments, setRecentAppointments] = useState<any[]>([]);
  const [pendingHandoffs, setPendingHandoffs] = useState<any[]>([]);

  const loadData = async (silent?: boolean) => {
    try {
      if (!silent) setLoading(true);
      const [sumRes, apptRes, handRes] = await Promise.all([
        api.getReportsSummary(),
        api.getAppointments({ pageSize: 6 }),
        api.getHandoffs('pending'),
      ]);
      setSummary(sumRes);
      setRecentAppointments(apptRes.items || []);
      setPendingHandoffs(handRes.items || []);
    } catch (err: any) {
      if (!silent) toast.error('Unable to load dashboard', err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    const handleRefresh = () => {
      loadData(true);
    };

    const handleConversationDeleted = (e: any) => {
      const convId = e?.detail?.conversationId;
      if (convId) {
        setPendingHandoffs((prev) =>
          prev.filter((h) => h.conversationId !== convId && h.conversation_id !== convId)
        );
      }
      loadData(true);
    };

    window.addEventListener('clinic:refresh_dashboard', handleRefresh);
    window.addEventListener('clinic:conversation_deleted', handleConversationDeleted);

    return () => {
      window.removeEventListener('clinic:refresh_dashboard', handleRefresh);
      window.removeEventListener('clinic:conversation_deleted', handleConversationDeleted);
    };
  }, []);

  if (loading) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: '13px', fontWeight: 500 }}>Loading clinic operations...</div>
      </div>
    );
  }

  // Pure genuine data directly from Neon backend (zero hardcoded mock fallbacks)
  const todayAppointments = summary?.todayAppointments ?? 0;
  const upcomingAppointments = summary?.upcomingAppointments ?? 0;
  const totalAppointments = summary?.totalAppointments ?? 0;
  const confirmedCount = summary?.confirmedCount ?? 0;
  const pendingCount = summary?.pendingCount ?? 0;
  const rescheduledCount = summary?.rescheduledCount ?? 0;
  const cancelledCount = summary?.cancelledCount ?? 0;
  const totalConversations = summary?.totalConversations ?? 0;
  const pendingStaffCount = pendingHandoffs.length || (summary?.pendingStaffAttention ?? 0);
  const totalPatients = summary?.totalPatients ?? 0;
  const containmentRate = summary?.containmentRate ?? '0%';
  const isReceptionistWorking = summary?.receptionistStatus !== 'paused';

  const getStatusBadge = (status: string) => {
    switch (status) {
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
        return <span className="badge badge-neutral"><span className="badge-dot" />{status}</span>;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }} className="animate-fade-in">
      {/* 1. Calm AI Receptionist Status Banner */}
      <div
        className="card"
        style={{
          backgroundColor: pendingStaffCount > 0
            ? 'var(--status-pending-bg)'
            : 'var(--bg-surface)',
          borderColor: pendingStaffCount > 0
            ? 'var(--status-pending-border)'
            : 'var(--border-card)',
          borderRadius: 'var(--radius-lg)',
          padding: '11px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
          <div
            style={{
              width: '34px',
              height: '34px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: pendingStaffCount > 0
                ? 'var(--status-pending-border)'
                : 'var(--accent-subtle)',
              color: pendingStaffCount > 0
                ? 'var(--status-pending-text)'
                : 'var(--accent-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Bot size={18} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                {pendingStaffCount > 0
                  ? `AI Receptionist — ${pendingStaffCount} conversation${pendingStaffCount > 1 ? 's' : ''} require staff review`
                  : isReceptionistWorking
                  ? 'AI Receptionist Active & Answering'
                  : 'AI Receptionist Paused'}
              </h2>
              <span
                className="badge"
                style={{
                  backgroundColor: pendingStaffCount > 0
                    ? 'var(--status-pending-bg)'
                    : isReceptionistWorking
                    ? 'var(--status-confirmed-bg)'
                    : 'var(--bg-surface-secondary)',
                  color: pendingStaffCount > 0
                    ? 'var(--status-pending-text)'
                    : isReceptionistWorking
                    ? 'var(--status-confirmed-text)'
                    : 'var(--text-muted)',
                  border: `1px solid ${
                    pendingStaffCount > 0
                      ? 'var(--status-pending-border)'
                      : isReceptionistWorking
                      ? 'var(--status-confirmed-border)'
                      : 'var(--border-subtle)'
                  }`,
                  padding: '2px 7px',
                  fontSize: '11px',
                }}
              >
                {pendingStaffCount > 0 ? 'Review Needed' : isReceptionistWorking ? 'Online' : 'Paused'}
              </span>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px', lineHeight: 1.3 }}>
              {isReceptionistWorking
                ? 'Answering patient enquiries on WhatsApp, checking openings, and processing booking requests.'
                : 'Automated answering is currently turned off. Inbound patient messages are queued for staff review.'}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={() => onNavigate('receptionist')}
            className={pendingStaffCount > 0 ? 'btn btn-primary' : 'btn btn-secondary'}
            style={{
              padding: '6px 12px',
              fontSize: '12px',
              gap: '6px',
            }}
          >
            <span>{pendingStaffCount > 0 ? `Review Enquiries (${pendingStaffCount})` : 'Open Conversation Inbox'}</span>
            <ArrowRight size={13} />
          </button>
        </div>
      </div>

      {/* 2. Key Clinic Operations Metrics Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '12px',
        }}
      >
        {/* Today's Appointments */}
        <div
          onClick={() => onNavigate('appointments')}
          className="card"
          style={{
            padding: '12px 16px',
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 500 }}>
              Appointments Today
            </span>
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--bg-surface-secondary)',
                color: 'var(--accent-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CalendarCheck size={15} />
            </div>
          </div>
          <div style={{ fontSize: '24px', fontWeight: 600, color: 'var(--text-primary)', marginTop: '4px', letterSpacing: '-0.02em' }}>
            {todayAppointments}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '1px' }}>
            Scheduled for today
          </div>
        </div>

        {/* Upcoming Appointments */}
        <div
          onClick={() => onNavigate('appointments')}
          className="card"
          style={{
            padding: '12px 16px',
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 500 }}>
              Upcoming Appointments
            </span>
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--bg-surface-secondary)',
                color: 'var(--status-confirmed-text)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CalendarDays size={15} />
            </div>
          </div>
          <div style={{ fontSize: '24px', fontWeight: 600, color: 'var(--text-primary)', marginTop: '4px', letterSpacing: '-0.02em' }}>
            {upcomingAppointments}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--status-confirmed-text)', marginTop: '1px', fontWeight: 500 }}>
            Booked for future dates
          </div>
        </div>

        {/* Staff Attention Needed */}
        <div
          onClick={() => onNavigate('receptionist')}
          className="card"
          style={{
            padding: '12px 16px',
            cursor: 'pointer',
            borderColor: pendingStaffCount > 0 ? 'var(--status-pending-border)' : 'var(--border-card)',
            backgroundColor: pendingStaffCount > 0 ? 'var(--status-pending-bg)' : 'var(--bg-surface)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '12px', color: pendingStaffCount > 0 ? 'var(--status-pending-text)' : 'var(--text-secondary)', fontWeight: 500 }}>
              Needs Staff Attention
            </span>
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: pendingStaffCount > 0 ? 'var(--status-pending-border)' : 'var(--bg-surface-secondary)',
                color: pendingStaffCount > 0 ? 'var(--status-pending-text)' : 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <AlertTriangle size={15} />
            </div>
          </div>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 600,
              color: pendingStaffCount > 0 ? 'var(--status-pending-text)' : 'var(--text-primary)',
              marginTop: '4px',
              letterSpacing: '-0.02em',
            }}
          >
            {pendingStaffCount}
          </div>
          <div
            style={{
              fontSize: '11px',
              color: pendingStaffCount > 0 ? 'var(--status-pending-text)' : 'var(--text-muted)',
              marginTop: '1px',
            }}
          >
            {pendingStaffCount > 0 ? 'Patient enquiries waiting for staff' : 'All enquiries handled'}
          </div>
        </div>

        {/* Patient Enquiries Handled */}
        <div
          onClick={() => onNavigate('receptionist')}
          className="card"
          style={{
            padding: '12px 16px',
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 500 }}>
              Enquiries Handled
            </span>
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--bg-surface-secondary)',
                color: 'var(--status-completed-text)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MessageSquare size={15} />
            </div>
          </div>
          <div style={{ fontSize: '24px', fontWeight: 600, color: 'var(--text-primary)', marginTop: '4px', letterSpacing: '-0.02em' }}>
            {totalConversations}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--status-confirmed-text)', marginTop: '1px', fontWeight: 500 }}>
            {containmentRate} resolved by AI
          </div>
        </div>
      </div>

      {/* 3. Operational Breakdown Strip */}
      <div
        className="card"
        style={{
          padding: '10px 16px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '12px',
        }}
      >
        <div>
          <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 500 }}>
            Confirmed Bookings
          </div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--status-confirmed-text)', marginTop: '1px' }}>
            {confirmedCount}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 500 }}>
            Pending Confirmations
          </div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--status-pending-text)', marginTop: '1px' }}>
            {pendingCount}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 500 }}>
            Rescheduled
          </div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--status-rescheduled-text)', marginTop: '1px' }}>
            {rescheduledCount}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 500 }}>
            Cancelled
          </div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--status-cancelled-text)', marginTop: '1px' }}>
            {cancelledCount}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 500 }}>
            Registered Patients
          </div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginTop: '1px' }}>
            {totalPatients}
          </div>
        </div>
      </div>

      {/* 4. Attention Center & Recent Activity */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1.9fr)', gap: '12px' }}>
        {/* Left: Enquiries Needing Staff Attention */}
        <div
          className="card"
          style={{
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <AlertTriangle size={15} color={pendingStaffCount > 0 ? 'var(--status-pending-text)' : 'var(--status-confirmed-text)'} />
              <h3 style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Enquiries Needing Attention ({pendingHandoffs.length})
              </h3>
            </div>
            <button
              onClick={() => onNavigate('receptionist')}
              className="btn-ghost"
              style={{
                fontSize: '11.5px',
                fontWeight: 500,
                color: 'var(--accent-primary)',
                padding: '3px 6px',
                borderRadius: 'var(--radius-xs)',
              }}
            >
              View Inbox →
            </button>
          </div>

          {pendingHandoffs.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '30px 16px',
                color: 'var(--text-muted)',
                textAlign: 'center',
              }}
            >
              <UserCheck size={28} color="var(--status-confirmed-text)" style={{ marginBottom: '6px', opacity: 0.8 }} />
              <div style={{ color: 'var(--text-primary)', fontWeight: 500, fontSize: '13px' }}>All Enquiries Attended</div>
              <div style={{ fontSize: '11.5px', marginTop: '2px' }}>
                No patients are currently waiting for staff follow-up.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {pendingHandoffs.slice(0, 4).map((h) => (
                <div
                  key={h.id}
                  style={{
                    padding: '9px 12px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--bg-surface-secondary)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '12.5px' }}>
                      {h.patientName || 'Patient'}
                    </span>
                    <span
                      style={{
                        fontSize: '10.5px',
                        color: 'var(--status-pending-text)',
                        backgroundColor: 'var(--status-pending-bg)',
                        border: '1px solid var(--status-pending-border)',
                        padding: '1px 6px',
                        borderRadius: 'var(--radius-full)',
                        fontWeight: 500,
                      }}
                    >
                      {h.reason || 'Staff Request'}
                    </span>
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <PhoneCall size={11} color="var(--text-muted)" /> {h.patientPhone || 'WhatsApp Chat'}
                  </div>
                  <button
                    onClick={() => onOpenHandoffModal(h)}
                    className="btn btn-primary btn-sm"
                    style={{
                      alignSelf: 'flex-end',
                      marginTop: '2px',
                      padding: '3px 8px',
                      fontSize: '11px',
                    }}
                  >
                    Respond to Patient
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Recent Appointment Activity */}
        <div
          className="card"
          style={{
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <Clock size={15} color="var(--accent-primary)" />
              <h3 style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Recent Appointment Bookings
              </h3>
            </div>
            <button
              onClick={() => onNavigate('appointments')}
              className="btn-ghost"
              style={{
                fontSize: '11.5px',
                fontWeight: 500,
                color: 'var(--accent-primary)',
                padding: '3px 6px',
                borderRadius: 'var(--radius-xs)',
              }}
            >
              All Appointments →
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {recentAppointments.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                No recent appointments found.
              </div>
            ) : (
              recentAppointments.map((appt) => (
                <div
                  key={appt.id}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--bg-surface-secondary)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                    <div
                      className="code-pill"
                      style={{
                        flexShrink: 0,
                        maxWidth: '110px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: '11.5px',
                        padding: '2px 6px',
                      }}
                      title={appt.confirmationCode || appt.id}
                    >
                      {appt.confirmationCode || appt.id.slice(0, 8)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {appt.patient?.name || appt.patient?.fullName || 'Patient'}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {appt.service?.name || 'General Dental'} · {appt.doctor?.name || appt.doctor?.displayName || 'Doctor'}
                      </div>
                    </div>
                  </div>

                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '11.5px', fontWeight: 500, color: 'var(--text-primary)' }}>
                      {formatDate(appt.startsAt)} at {formatTime(appt.startsAt)}
                    </div>
                    <div style={{ marginTop: '2px' }}>
                      {getStatusBadge(appt.status)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
