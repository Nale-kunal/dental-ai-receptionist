import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import { useClinic } from '../context/ClinicContext';
import {
  Calendar as CalendarIcon,
  List,
  Search,
  Plus,
  CalendarClock,
  Ban,
  History,
  ChevronLeft,
  ChevronRight,
  X,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { AppointmentCalendar, CalendarViewMode } from '../components/calendar/AppointmentCalendar';
import { AppointmentDetailsModal } from '../components/modals/AppointmentDetailsModal';
import {
  getClinicToday,
  getDateRangeForView,
  getWeekRange,
  parseDateParts,
  toDateStr,
  addDays,
} from '../utils/calendarDates';
import { toUtcIsoInTimezone } from '../utils/dateTime';

export type MainViewType = 'list' | 'calendar';
export type ListDateFilter = 'all' | 'today' | 'week' | 'month';

interface AppointmentsViewProps {
  onOpenBookingModal: (doctorId?: string) => void;
  onOpenRescheduleModal: (appointment: any) => void;
  onOpenCancelModal: (appointment: any) => void;
}

export const AppointmentsView: React.FC<AppointmentsViewProps> = ({
  onOpenBookingModal,
  onOpenRescheduleModal,
  onOpenCancelModal,
}) => {
  const toast = useToast();
  const { formatDate, formatTime, formatDateTime, timezone } = useClinic();

  // Active view: default to 'list' as specified in requirements
  const [viewType, setViewType] = useState<MainViewType>('list');

  // Calendar view mode: 'day' | 'week' | 'month'
  const [calendarMode, setCalendarMode] = useState<CalendarViewMode>('week');

  // Authoritative clinic-local selected date ('YYYY-MM-DD')
  const clinicToday = useMemo(() => getClinicToday(timezone), [timezone]);
  const [selectedDate, setSelectedDate] = useState<string>(clinicToday);

  // Sync selectedDate only when clinic timezone changes
  const prevTimezoneRef = useRef(timezone);
  useEffect(() => {
    if (prevTimezoneRef.current !== timezone) {
      prevTimezoneRef.current = timezone;
      setSelectedDate(getClinicToday(timezone));
    }
  }, [timezone]);

  // List view date filter ('all' | 'today' | 'week' | 'month')
  const [listDateFilter, setListDateFilter] = useState<ListDateFilter>('all');

  // Data states
  const [listLoading, setListLoading] = useState(true);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarInitialLoading, setCalendarInitialLoading] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [appointments, setAppointments] = useState<any[]>([]);
  const [calendarAppointments, setCalendarAppointments] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Common filters (apply to both List and Calendar views)
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [doctorFilter, setDoctorFilter] = useState('all');

  // Appointment details modal state (for calendar clicks)
  const [selectedApptForDetails, setSelectedApptForDetails] = useState<any | null>(null);

  // Audit history drawer state
  const [selectedAppointmentHistory, setSelectedAppointmentHistory] = useState<any[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyAppointment, setHistoryAppointment] = useState<any | null>(null);

  // In-flight request ID guards to prevent race conditions and duplicate executions
  const listReqIdRef = useRef(0);
  const calendarReqIdRef = useRef(0);

  // Client-side cache for recent calendar views to enable instantaneous rendering
  const calendarCacheRef = useRef<Map<string, any[]>>(new Map());

  // Fetch doctors list once on mount (eliminates duplicate appointment loading caused by doctor state changes)
  useEffect(() => {
    let active = true;
    api
      .getDoctors()
      .then((docs) => {
        if (active && Array.isArray(docs)) {
          setDoctors(docs);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Calculate UTC date boundaries for List view date filter
  const listDateRange = useMemo(() => {
    if (listDateFilter === 'all') return { dateFrom: undefined, dateTo: undefined };

    if (listDateFilter === 'today') {
      const dateFrom = toUtcIsoInTimezone(clinicToday, '00:00:00', timezone);
      const dateTo = toUtcIsoInTimezone(addDays(clinicToday, 1), '00:00:00', timezone);
      return { dateFrom, dateTo };
    }

    if (listDateFilter === 'week') {
      const { weekStart, weekEnd } = getWeekRange(clinicToday);
      const dateFrom = toUtcIsoInTimezone(weekStart, '00:00:00', timezone);
      const dateTo = toUtcIsoInTimezone(addDays(weekEnd, 1), '00:00:00', timezone);
      return { dateFrom, dateTo };
    }

    // listDateFilter === 'month'
    const { year, month } = parseDateParts(clinicToday);
    const firstOfMonth = toDateStr(year, month, 1);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const lastOfMonth = toDateStr(year, month, daysInMonth);
    const dateFrom = toUtcIsoInTimezone(firstOfMonth, '00:00:00', timezone);
    const dateTo = toUtcIsoInTimezone(addDays(lastOfMonth, 1), '00:00:00', timezone);
    return { dateFrom, dateTo };
  }, [listDateFilter, clinicToday, timezone]);

  // Prevent background scrolling and handle Escape key for history drawer
  useEffect(() => {
    if (!selectedAppointmentHistory) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedAppointmentHistory(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedAppointmentHistory]);

  // --- LIST VIEW FETCH EFFECT (Runs only when in List view and its parameters change) ---
  const fetchListAppointments = useCallback(async () => {
    const currentReqId = ++listReqIdRef.current;
    setListLoading(true);
    setListError(null);

    try {
      const apptRes = await api.getAppointments({
        page,
        pageSize: 15,
        search: search.trim() || undefined,
        status: statusFilter,
        doctorId: doctorFilter,
        dateFrom: listDateRange.dateFrom,
        dateTo: listDateRange.dateTo,
      });

      if (currentReqId !== listReqIdRef.current) return; // Stale request discarded

      setAppointments(apptRes.items || []);
      setTotal(apptRes.total || 0);
      setTotalPages(apptRes.totalPages || 1);
    } catch (err: any) {
      if (currentReqId !== listReqIdRef.current) return;
      setListError(err.message || 'Failed to fetch appointments.');
      toast.error('Fetch Error', err.message);
    } finally {
      if (currentReqId === listReqIdRef.current) {
        setListLoading(false);
      }
    }
  }, [page, search, statusFilter, doctorFilter, listDateRange, toast]);

  useEffect(() => {
    if (viewType === 'list') {
      fetchListAppointments();
    }
  }, [viewType, fetchListAppointments]);

  // --- CALENDAR VIEW FETCH EFFECT (Runs only when in Calendar view and its parameters change) ---
  const fetchCalendarAppointments = useCallback(
    async (forceFresh: boolean = false) => {
      const currentReqId = ++calendarReqIdRef.current;
      setCalendarError(null);

      const cacheKey = `${selectedDate}_${calendarMode}_${timezone}_${statusFilter}_${doctorFilter}_${search.trim()}`;

      // Check client-side cache for instantaneous view switching without flash of loading
      if (!forceFresh && calendarCacheRef.current.has(cacheKey)) {
        const cached = calendarCacheRef.current.get(cacheKey)!;
        setCalendarAppointments(cached);
        setCalendarInitialLoading(false);
        setCalendarLoading(false);
        // Continue to revalidate in background quietly
      } else {
        if (calendarAppointments.length === 0) {
          setCalendarInitialLoading(true);
        }
        setCalendarLoading(true);
      }

      try {
        const { dateFrom, dateTo } = getDateRangeForView(selectedDate, calendarMode, timezone);
        const apptRes = await api.getAppointments({
          page: 1,
          pageSize: 500, // Retrieve all appointments within visible calendar boundaries
          search: search.trim() || undefined,
          status: statusFilter,
          doctorId: doctorFilter,
          dateFrom,
          dateTo,
        });

        if (currentReqId !== calendarReqIdRef.current) return; // Stale request discarded

        const items = apptRes.items || [];
        setCalendarAppointments(items);
        calendarCacheRef.current.set(cacheKey, items);
      } catch (err: any) {
        if (currentReqId !== calendarReqIdRef.current) return;
        setCalendarError(err.message || 'Failed to load calendar events.');
        toast.error('Calendar Fetch Error', err.message);
      } finally {
        if (currentReqId === calendarReqIdRef.current) {
          setCalendarLoading(false);
          setCalendarInitialLoading(false);
        }
      }
    },
    [selectedDate, calendarMode, timezone, search, statusFilter, doctorFilter, toast, calendarAppointments.length]
  );

  useEffect(() => {
    if (viewType === 'calendar') {
      fetchCalendarAppointments();
    }
  }, [viewType, fetchCalendarAppointments]);

  // Search submission
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (viewType === 'list') {
      setPage(1);
      fetchListAppointments();
    } else {
      calendarCacheRef.current.clear();
      fetchCalendarAppointments(true);
    }
  };

  // View status history drawer
  const handleViewHistory = async (appt: any) => {
    setHistoryAppointment(appt);
    setHistoryLoading(true);
    try {
      const history = await api.getAppointmentHistory(appt.id);
      setSelectedAppointmentHistory(history);
    } catch (err: any) {
      toast.error('History Error', err.message);
    } finally {
      setHistoryLoading(false);
    }
  };

  // Switch between List and Calendar
  const handleSwitchView = (newView: MainViewType) => {
    setViewType(newView);
    if (newView === 'list') {
      setPage(1);
    }
  };

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
        return <span className="badge badge-neutral"><span className="badge-dot" />{status.replace('_', ' ')}</span>;
    }
  };

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
      className="animate-fade-in"
    >
      {/* Top Toolbar: Search, Filters, View Switcher & Booking Action */}
      <div
        className="card"
        style={{
          flexShrink: 0,
          padding: '8px 14px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {/* Search bar */}
        <form
          onSubmit={handleSearchSubmit}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '220px', maxWidth: '380px' }}
        >
          <div style={{ position: 'relative', width: '100%' }}>
            <Search
              size={14}
              color="var(--text-muted)"
              style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }}
            />
            <input
              type="text"
              placeholder="Search patient, phone, code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="form-input"
              style={{ paddingLeft: '32px', height: '30px', fontSize: '12px' }}
            />
          </div>
          <button
            type="submit"
            className="btn btn-secondary btn-sm"
            style={{ height: '30px', padding: '0 10px', fontSize: '12px' }}
          >
            Search
          </button>
        </form>

        {/* Controls Cluster */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="form-input"
            style={{ width: 'auto', minWidth: '120px', height: '30px', fontSize: '12px', padding: '0 8px' }}
            aria-label="Filter by appointment status"
          >
            <option value="all">All Statuses</option>
            <option value="confirmed">Confirmed</option>
            <option value="pending">Pending</option>
            <option value="completed">Completed</option>
            <option value="rescheduled">Rescheduled</option>
            <option value="cancelled">Cancelled</option>
          </select>

          {/* Practitioner filter */}
          <select
            value={doctorFilter}
            onChange={(e) => {
              setDoctorFilter(e.target.value);
              setPage(1);
            }}
            className="form-input"
            style={{ width: 'auto', minWidth: '140px', height: '30px', fontSize: '12px', padding: '0 8px' }}
            aria-label="Filter by practitioner"
          >
            <option value="all">All Practitioners</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.displayName}
              </option>
            ))}
          </select>

          {/* View Switcher: List vs Calendar */}
          <div
            style={{
              display: 'inline-flex',
              padding: '2px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--bg-surface-secondary)',
              border: '1px solid var(--border-subtle)',
            }}
            role="tablist"
            aria-label="Appointment view switcher"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewType === 'list'}
              onClick={() => handleSwitchView('list')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '3px 10px',
                fontSize: '11.5px',
                fontWeight: viewType === 'list' ? 600 : 500,
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: viewType === 'list' ? 'var(--bg-card)' : 'transparent',
                color: viewType === 'list' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                boxShadow: viewType === 'list' ? 'var(--shadow-sm)' : 'none',
                transition: 'all var(--transition-fast)',
              }}
            >
              <List size={13} /> List
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewType === 'calendar'}
              onClick={() => handleSwitchView('calendar')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '3px 10px',
                fontSize: '11.5px',
                fontWeight: viewType === 'calendar' ? 600 : 500,
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: viewType === 'calendar' ? 'var(--bg-card)' : 'transparent',
                color: viewType === 'calendar' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                boxShadow: viewType === 'calendar' ? 'var(--shadow-sm)' : 'none',
                transition: 'all var(--transition-fast)',
              }}
            >
              <CalendarIcon size={13} /> Calendar
            </button>
          </div>

          {/* New appointment button */}
          <button
            type="button"
            onClick={() => onOpenBookingModal()}
            className="btn btn-primary"
            style={{ height: '30px', padding: '0 12px', fontSize: '12px', gap: '5px' }}
          >
            <Plus size={13} /> Book Slot
          </button>
        </div>
      </div>

      {/* VIEW CONTENT: List View OR Calendar View */}
      {viewType === 'list' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* List Date Range Selector Bar */}
          <div
            className="card"
            style={{
              padding: '8px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', fontWeight: 500 }}>
                Date Filter:
              </span>
              <div
                style={{
                  display: 'inline-flex',
                  padding: '2px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg-surface-secondary)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                {(['all', 'today', 'week', 'month'] as ListDateFilter[]).map((f) => {
                  const active = listDateFilter === f;
                  const label =
                    f === 'all'
                      ? 'All Time'
                      : f === 'today'
                      ? 'Today'
                      : f === 'week'
                      ? 'This Week'
                      : 'This Month';
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => {
                        setListDateFilter(f);
                        setPage(1);
                      }}
                      style={{
                        padding: '3px 9px',
                        fontSize: '11px',
                        fontWeight: active ? 600 : 500,
                        borderRadius: 'var(--radius-sm)',
                        border: 'none',
                        cursor: 'pointer',
                        backgroundColor: active ? 'var(--bg-card)' : 'transparent',
                        color: active ? 'var(--accent-primary)' : 'var(--text-secondary)',
                        boxShadow: active ? 'var(--shadow-sm)' : 'none',
                        transition: 'all var(--transition-fast)',
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Clinic Timezone: <strong style={{ color: 'var(--text-primary)' }}>{timezone}</strong>
            </div>
          </div>

          {/* Error Banner in List View */}
          {listError && (
            <div
              className="card"
              style={{
                padding: '12px 14px',
                borderLeft: '4px solid var(--status-cancelled-text)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--status-cancelled-text)', fontSize: '12.5px' }}>
                <AlertTriangle size={15} />
                <span>{listError}</span>
              </div>
              <button
                type="button"
                onClick={() => fetchListAppointments()}
                className="btn btn-secondary btn-sm"
                style={{ height: '26px', fontSize: '11.5px', gap: '4px' }}
              >
                <RefreshCw size={12} /> Retry
              </button>
            </div>
          )}

          {/* Appointments Table Card */}
          <div
            className="card"
            style={{
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
            }}
          >
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead>
                  <tr>
                    <th style={{ padding: '9px 14px', width: '130px' }}>Code</th>
                    <th style={{ padding: '9px 14px' }}>Patient</th>
                    <th style={{ padding: '9px 14px' }}>Practitioner</th>
                    <th style={{ padding: '9px 14px' }}>Service</th>
                    <th style={{ padding: '9px 14px' }}>Scheduled Time</th>
                    <th style={{ padding: '9px 14px' }}>Status</th>
                    <th style={{ padding: '9px 14px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {listLoading ? (
                    <tr>
                      <td colSpan={7} style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                          <RefreshCw size={14} className="animate-spin" />
                          <span>Loading appointments...</span>
                        </div>
                      </td>
                    </tr>
                  ) : appointments.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        No appointments found matching your filter criteria.
                      </td>
                    </tr>
                  ) : (
                    appointments.map((appt) => (
                      <tr
                        key={appt.id}
                        style={{
                          borderBottom: '1px solid var(--border-subtle)',
                          transition: 'background-color var(--transition-fast)',
                        }}
                      >
                        {/* Confirmation code */}
                        <td style={{ padding: '9px 14px' }}>
                          <span
                            className="code-pill"
                            title={appt.confirmationCode || appt.id}
                            style={{ display: 'inline-block', maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          >
                            {appt.confirmationCode || appt.id.slice(0, 8)}
                          </span>
                        </td>

                        {/* Patient */}
                        <td style={{ padding: '9px 14px' }}>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                            {appt.patient?.name || appt.patient?.fullName || 'Patient'}
                          </div>
                          <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                            {appt.patient?.phone || 'No phone'}
                          </div>
                        </td>

                        {/* Practitioner */}
                        <td style={{ padding: '9px 14px', color: 'var(--text-primary)' }}>
                          {appt.doctor?.name || appt.doctor?.displayName || 'Doctor'}
                        </td>

                        {/* Service */}
                        <td style={{ padding: '9px 14px', color: 'var(--text-secondary)' }}>
                          <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{appt.service?.name || 'General Dental'}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            {appt.durationMinutes}m (+{appt.bufferMinutes || 10}m buffer)
                          </div>
                        </td>

                        {/* Scheduled Time */}
                        <td style={{ padding: '9px 14px', color: 'var(--text-primary)' }}>
                          <div style={{ fontWeight: 500 }}>{formatDate(appt.startsAt)}</div>
                          <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                            {formatTime(appt.startsAt)}
                          </div>
                        </td>

                        {/* Status */}
                        <td style={{ padding: '9px 14px' }}>{getStatusBadge(appt.status)}</td>

                        {/* Actions */}
                        <td style={{ padding: '9px 14px', textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '6px' }}>
                            <button
                              type="button"
                              onClick={() => handleViewHistory(appt)}
                              title="View Status Audit Trail"
                              aria-label="View Status History"
                              className="btn-icon"
                            >
                              <History size={14} />
                            </button>

                            {appt.status !== 'cancelled' && appt.status !== 'completed' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => onOpenRescheduleModal(appt)}
                                  title="Reschedule Appointment"
                                  aria-label="Reschedule Appointment"
                                  className="btn-icon"
                                  style={{ color: 'var(--status-rescheduled-text)' }}
                                >
                                  <CalendarClock size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onOpenCancelModal(appt)}
                                  title="Cancel Appointment"
                                  aria-label="Cancel Appointment"
                                  className="btn-icon"
                                  style={{ color: 'var(--status-cancelled-text)' }}
                                >
                                  <Ban size={14} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            <div
              style={{
                padding: '10px 14px',
                borderTop: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '12px',
                color: 'var(--text-secondary)',
                backgroundColor: 'var(--bg-surface-secondary)',
              }}
            >
              <div>
                Showing {appointments.length} of <strong style={{ color: 'var(--text-primary)' }}>{total}</strong> records
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="btn btn-secondary btn-sm"
                  style={{
                    height: '28px',
                    padding: '0 8px',
                    fontSize: '11.5px',
                    opacity: page <= 1 ? 0.4 : 1,
                    cursor: page <= 1 ? 'not-allowed' : 'pointer',
                  }}
                >
                  <ChevronLeft size={13} /> Prev
                </button>
                <span style={{ fontSize: '11.5px', fontWeight: 500, color: 'var(--text-primary)' }}>
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="btn btn-secondary btn-sm"
                  style={{
                    height: '28px',
                    padding: '0 8px',
                    fontSize: '11.5px',
                    opacity: page >= totalPages ? 0.4 : 1,
                    cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                  }}
                >
                  Next <ChevronRight size={13} />
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* CALENDAR VIEW */
        <AppointmentCalendar
          appointments={calendarAppointments}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          viewMode={calendarMode}
          onViewModeChange={setCalendarMode}
          onSelectAppointment={(appt) => setSelectedApptForDetails(appt)}
          onBookSlot={(dateStr) => onOpenBookingModal()}
          loading={calendarLoading}
          initialLoading={calendarInitialLoading}
          error={calendarError}
          onRetry={() => {
            calendarCacheRef.current.clear();
            fetchCalendarAppointments(true);
          }}
        />
      )}

      {/* Appointment Details Modal (opens when appointment is clicked in Calendar) */}
      <AppointmentDetailsModal
        isOpen={Boolean(selectedApptForDetails)}
        appointment={selectedApptForDetails}
        onClose={() => setSelectedApptForDetails(null)}
        onReschedule={(appt) => {
          setSelectedApptForDetails(null);
          onOpenRescheduleModal(appt);
        }}
        onCancel={(appt) => {
          setSelectedApptForDetails(null);
          onOpenCancelModal(appt);
        }}
        onViewHistory={(appt) => {
          setSelectedApptForDetails(null);
          handleViewHistory(appt);
        }}
      />

      {/* Appointment Audit History Drawer / Modal */}
      {selectedAppointmentHistory && historyAppointment && createPortal(
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="audit-history-title"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'var(--bg-modal-overlay)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            zIndex: 1000,
            display: 'flex',
            justifyContent: 'flex-end',
            padding: 0,
          }}
          onClick={() => setSelectedAppointmentHistory(null)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '440px',
              backgroundColor: 'var(--bg-surface)',
              height: '100%',
              borderLeft: '1px solid var(--border-card)',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: 'var(--shadow-modal)',
              position: 'relative',
              zIndex: 1001,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <div>
                <h3 id="audit-history-title" style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  Status History Trail
                </h3>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  Code: {historyAppointment.confirmationCode || historyAppointment.id.slice(0, 8)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAppointmentHistory(null)}
                className="btn-icon"
                aria-label="Close status history"
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {selectedAppointmentHistory.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', marginTop: '40px' }}>
                  No transition records logged yet for this booking.
                </div>
              ) : (
                selectedAppointmentHistory.map((h, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--bg-surface-secondary)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', color: 'var(--accent-primary)', fontWeight: 600 }}>
                        {h.previousStatus || 'initial'} → {h.newStatus}
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {formatDateTime(h.changedAt)}
                      </span>
                    </div>
                    {h.reason && (
                      <div style={{ fontSize: '12px', color: 'var(--text-primary)', marginTop: '4px' }}>
                        Reason: {h.reason}
                      </div>
                    )}
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '3px' }}>
                      Changed by: {h.changedBy || 'system'}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
