import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import { useClinic } from '../context/ClinicContext';
import { Shield } from 'lucide-react';

export const AuditView: React.FC = () => {
  const toast = useToast();
  const { formatDateTime } = useClinic();
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    const fetchAudit = async () => {
      try {
        setLoading(true);
        const res = await api.getAuditLog({ page, pageSize: 20 });
        setLogs(res.items || []);
        setTotal(res.total || 0);
        setTotalPages(res.totalPages || 1);
      } catch (err: any) {
        toast.error('Audit Trail Error', err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchAudit();
  }, [page]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-md)',
          padding: '12px 16px',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Shield size={16} color="var(--accent-primary)" />
          <h3 style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Appointment Activity History & Compliance Log
          </h3>
        </div>
        <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginTop: '2px', marginBottom: 0 }}>
          Verified activity history tracking every appointment booking, confirmation, reschedule, and cancellation.
        </p>
      </div>

      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-sm)',
          overflow: 'hidden',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
          <thead>
            <tr
              style={{
                borderBottom: '1px solid var(--border-subtle)',
                backgroundColor: 'var(--bg-surface-secondary)',
                color: 'var(--text-secondary)',
                fontSize: '11px',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                fontWeight: 600,
              }}
            >
              <th style={{ padding: '9px 14px' }}>Timestamp</th>
              <th style={{ padding: '9px 14px' }}>Appointment Code</th>
              <th style={{ padding: '9px 14px' }}>State Transition</th>
              <th style={{ padding: '9px 14px' }}>Changed By</th>
              <th style={{ padding: '9px 14px' }}>Reason / Notes</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  Loading audit events...
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No audit trail events found.
                </td>
              </tr>
            ) : (
              logs.map((log) => {
                const rawDate = log.changedAt || log.timestamp || log.createdAt;
                const formattedDate = rawDate && !isNaN(new Date(rawDate).getTime())
                  ? formatDateTime(rawDate)
                  : 'Recent Event';
                const code = log.confirmationCode || (log.appointmentId ? log.appointmentId.slice(0, 8) : (log.entityId ? log.entityId.slice(0, 8) : 'APT'));
                const fromStat = log.previousStatus || log.fromStatus || 'Created';
                const toStat = log.newStatus || log.toStatus || 'Updated';
                const who = log.changedBy || log.user?.name || 'system';
                const note = log.reason || log.details || '—';

                return (
                  <tr
                    key={log.id}
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      transition: 'background-color 0.15s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-surface-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td style={{ padding: '9px 14px', color: 'var(--text-secondary)' }}>
                      {formattedDate}
                    </td>
                    <td style={{ padding: '9px 14px' }}>
                      <span className="code-pill">
                        {code}
                      </span>
                    </td>
                    <td style={{ padding: '9px 14px' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{fromStat}</span>
                      <span style={{ margin: '0 6px', color: 'var(--text-muted)' }}>→</span>
                      <span style={{ fontWeight: 600, color: 'var(--accent-text)' }}>{toStat}</span>
                    </td>
                    <td style={{ padding: '9px 14px', color: 'var(--text-primary)' }}>
                      {who}
                    </td>
                    <td style={{ padding: '9px 14px', color: 'var(--text-secondary)' }}>
                      {note}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {/* Pagination */}
        <div
          style={{
            padding: '10px 14px',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '12px',
            color: 'var(--text-secondary)',
          }}
        >
          <div>
            Showing {logs.length} of <strong style={{ color: 'var(--text-primary)' }}>{total}</strong> audit entries
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="btn btn-secondary btn-sm"
              style={{
                height: '28px',
                padding: '0 10px',
                fontSize: '11.5px',
              }}
            >
              Prev
            </button>
            <span style={{ color: 'var(--text-muted)', fontSize: '11.5px' }}>
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="btn btn-secondary btn-sm"
              style={{
                height: '28px',
                padding: '0 10px',
                fontSize: '11.5px',
              }}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
