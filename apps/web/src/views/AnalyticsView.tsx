import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import { BarChart3, TrendingUp } from 'lucide-react';

export const AnalyticsView: React.FC = () => {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<any>(null);
  const [statusBreakdown, setStatusBreakdown] = useState<any[]>([]);
  const [hourlyDist, setHourlyDist] = useState<any[]>([]);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        setLoading(true);
        const [sum, breakdown, hourly] = await Promise.all([
          api.getReportsSummary(),
          api.getStatusBreakdown(),
          api.getHourlyDistribution(),
        ]);
        setSummary(sum);
        setStatusBreakdown(Array.isArray(breakdown) ? breakdown : Object.entries(breakdown || {}).map(([status, count]) => ({ status, count: Number(count) || 0 })));
        setHourlyDist(hourly || []);
      } catch (err: any) {
        toast.error('Analytics Error', err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchAnalytics();
  }, []);

  if (loading) {
    return <div style={{ color: 'var(--text-muted)', padding: '32px', textAlign: 'center' }}>Loading clinic analytics...</div>;
  }

  const maxStatusCount = Math.max(...statusBreakdown.map((s) => s.count || 0), 1);
  const maxHourlyCount = Math.max(...hourlyDist.map((h) => h.count || 0), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Top Highlight Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '12px' }}>
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>Total Handled Inquiries</div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '4px' }}>
            {summary?.totalConversations ?? 0}
          </div>
          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '2px' }}>Inbound Patient Enquiries</div>
        </div>

        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>Autonomous AI Containment</div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--accent-text)', marginTop: '4px' }}>
            {summary?.containmentRate ?? summary?.kpis?.aiContainmentRate ?? '100%'}
          </div>
          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '2px' }}>Resolved Without Staff Escalation</div>
        </div>

        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>Staff Escalations</div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--danger)', marginTop: '4px' }}>
            {summary?.pendingStaffAttention ?? summary?.kpis?.totalHandoffs ?? 0}
          </div>
          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '2px' }}>Requiring Human Attention</div>
        </div>

        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>Confirmed Bookings</div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--success)', marginTop: '4px' }}>
            {summary?.confirmedCount ?? summary?.kpis?.confirmedCount ?? 0}
          </div>
          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '2px' }}>Active Appointments</div>
        </div>
      </div>

      {/* Visual Distribution Graphs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '12px' }}>
        {/* Appointment Status Breakdown */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 16px',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <BarChart3 size={16} color="var(--accent-primary)" />
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              Appointment Status Breakdown
            </h3>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {statusBreakdown.map((item, idx) => {
              const pct = Math.round(((item.count || 0) / maxStatusCount) * 100);
              const color =
                item.status === 'confirmed'
                  ? 'var(--success)'
                  : item.status === 'rescheduled'
                  ? 'var(--accent-primary)'
                  : item.status === 'cancelled'
                  ? 'var(--danger)'
                  : 'var(--text-secondary)';

              return (
                <div key={idx}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '4px' }}>
                    <span style={{ textTransform: 'capitalize', color: 'var(--text-primary)', fontWeight: 500 }}>
                      {item.status.replace('_', ' ')}
                    </span>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{item.count}</span>
                  </div>
                  <div style={{ height: '6px', backgroundColor: 'var(--bg-surface-secondary)', borderRadius: '999px', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${pct}%`,
                        backgroundColor: color,
                        borderRadius: '999px',
                        transition: 'width 0.4s ease',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Hourly Peak Booking Activity */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 16px',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <TrendingUp size={16} color="var(--accent-primary)" />
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              Hourly Appointment Density (09:00 - 17:00)
            </h3>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
            {hourlyDist.slice(0, 8).map((h, idx) => {
              const pct = Math.round(((h.count || 0) / maxHourlyCount) * 100);
              const hourLabel = `${String(h.hour).padStart(2, '0')}:00`;

              return (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ width: '44px', fontSize: '11.5px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                    {hourLabel}
                  </span>
                  <div style={{ flex: 1, height: '6px', backgroundColor: 'var(--bg-surface-secondary)', borderRadius: '999px', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${pct}%`,
                        backgroundColor: 'var(--accent-primary)',
                        borderRadius: '999px',
                      }}
                    />
                  </div>
                  <span style={{ width: '24px', fontSize: '11.5px', color: 'var(--text-primary)', fontWeight: 600, textAlign: 'right' }}>
                    {h.count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
