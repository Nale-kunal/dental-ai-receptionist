import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useClinic } from '../../context/ClinicContext';
import {
  getClinicToday,
  getLocalDateString,
  getClinicLocalTimeMinutes,
  getWeekRange,
  getMonthGrid,
  addDays,
  addMonths,
  formatCalendarTitle,
  layoutDayAppointments,
  PositionedAppointment,
  CalendarDayCell,
} from '../../utils/calendarDates';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  RefreshCw,
  AlertTriangle,
  CalendarX2,
} from 'lucide-react';

export type CalendarViewMode = 'day' | 'week' | 'month';

interface AppointmentCalendarProps {
  appointments: any[];
  selectedDate: string; // 'YYYY-MM-DD'
  onSelectDate: (dateStr: string) => void;
  viewMode: CalendarViewMode;
  onViewModeChange: (mode: CalendarViewMode) => void;
  onSelectAppointment: (appointment: any) => void;
  onBookSlot?: (dateStr?: string) => void;
  loading?: boolean;
  initialLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

const START_HOUR = 7; // 7:00 AM
const END_HOUR = 21; // 9:00 PM
const TOTAL_HOURS = END_HOUR - START_HOUR; // 14 hours
const HOUR_HEIGHT = 60; // 60px per hour
const GRID_TOP_PADDING = 14; // breathing room so 7 AM line and label are never clipped
const TOTAL_GRID_HEIGHT = TOTAL_HOURS * HOUR_HEIGHT + GRID_TOP_PADDING * 2;

export const AppointmentCalendar: React.FC<AppointmentCalendarProps> = ({
  appointments,
  selectedDate,
  onSelectDate,
  viewMode,
  onViewModeChange,
  onSelectAppointment,
  onBookSlot,
  loading = false,
  initialLoading = false,
  error = null,
  onRetry,
}) => {
  const { timezone, formatTime, formatDate } = useClinic();
  const timeGridRef = useRef<HTMLDivElement>(null);

  // Clinic today string ('YYYY-MM-DD')
  const clinicToday = useMemo(() => getClinicToday(timezone), [timezone]);

  // Current clinic time in minutes from midnight
  const [currentMinutes, setCurrentMinutes] = useState(() =>
    getClinicLocalTimeMinutes(new Date().toISOString(), timezone)
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentMinutes(getClinicLocalTimeMinutes(new Date().toISOString(), timezone));
    }, 60000);
    return () => clearInterval(timer);
  }, [timezone]);

  // Reset scroll to top on mount or view mode change so the top of schedule is always visible
  useEffect(() => {
    if (timeGridRef.current) {
      timeGridRef.current.scrollTop = 0;
    }
  }, [viewMode, selectedDate]);

  // Group appointments by clinic local date 'YYYY-MM-DD'
  const appointmentsByDate = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const appt of appointments) {
      const localDate = getLocalDateString(appt.startsAt, timezone);
      if (!localDate) continue;
      const list = map.get(localDate) || [];
      list.push(appt);
      map.set(localDate, list);
    }
    return map;
  }, [appointments, timezone]);

  // Navigation handlers
  const handlePrev = () => {
    if (viewMode === 'day') {
      onSelectDate(addDays(selectedDate, -1));
    } else if (viewMode === 'week') {
      onSelectDate(addDays(selectedDate, -7));
    } else {
      onSelectDate(addMonths(selectedDate, -1));
    }
  };

  const handleNext = () => {
    if (viewMode === 'day') {
      onSelectDate(addDays(selectedDate, 1));
    } else if (viewMode === 'week') {
      onSelectDate(addDays(selectedDate, 7));
    } else {
      onSelectDate(addMonths(selectedDate, 1));
    }
  };

  const handleToday = () => {
    onSelectDate(clinicToday);
  };

  const headerTitle = useMemo(
    () => formatCalendarTitle(selectedDate, viewMode, timezone),
    [selectedDate, viewMode, timezone]
  );

  // Status style helper
  const getStatusClasses = (status: string) => {
    switch (status) {
      case 'confirmed':
        return {
          bg: 'var(--status-confirmed-bg)',
          text: 'var(--status-confirmed-text)',
          border: 'var(--status-confirmed-border)',
          accent: 'var(--status-confirmed-text)',
          isCancelled: false,
        };
      case 'rescheduled':
        return {
          bg: 'var(--status-rescheduled-bg)',
          text: 'var(--status-rescheduled-text)',
          border: 'var(--status-rescheduled-border)',
          accent: 'var(--status-rescheduled-text)',
          isCancelled: false,
        };
      case 'cancelled':
        return {
          bg: 'var(--status-cancelled-bg)',
          text: 'var(--text-muted)',
          border: '1px dashed var(--status-cancelled-border)',
          accent: 'var(--status-cancelled-text)',
          isCancelled: true,
        };
      case 'pending':
        return {
          bg: 'var(--status-pending-bg)',
          text: 'var(--status-pending-text)',
          border: 'var(--status-pending-border)',
          accent: 'var(--status-pending-text)',
          isCancelled: false,
        };
      case 'completed':
        return {
          bg: 'var(--status-completed-bg)',
          text: 'var(--status-completed-text)',
          border: 'var(--status-completed-border)',
          accent: 'var(--status-completed-text)',
          isCancelled: false,
        };
      default:
        return {
          bg: 'var(--bg-surface-secondary)',
          text: 'var(--text-primary)',
          border: 'var(--border-subtle)',
          accent: 'var(--accent-primary)',
          isCancelled: false,
        };
    }
  };

  // Render hour markers (7 AM .. 9 PM)
  const hours = useMemo(() => {
    const list: { hour: number; label: string }[] = [];
    for (let h = START_HOUR; h <= END_HOUR; h++) {
      const d = new Date(Date.UTC(2026, 0, 1, h, 0));
      const label = d.toLocaleTimeString('en-US', {
        timeZone: 'UTC',
        hour: 'numeric',
        hour12: true,
      });
      list.push({ hour: h, label });
    }
    return list;
  }, []);

  // --- SKELETON PLACEHOLDER ---
  const renderSkeleton = () => (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 20px',
        color: 'var(--text-muted)',
        gap: '12px',
      }}
    >
      <RefreshCw size={24} className="animate-spin" color="var(--accent-primary)" />
      <span style={{ fontSize: '13px', fontWeight: 500 }}>Loading clinic schedule...</span>
    </div>
  );

  // --- ERROR STATE ---
  const renderError = () => (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 20px',
        gap: '12px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: '44px',
          height: '44px',
          borderRadius: '50%',
          backgroundColor: 'rgba(210, 90, 90, 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--status-cancelled-text)',
        }}
      >
        <AlertTriangle size={22} />
      </div>
      <div>
        <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
          Unable to Load Schedule
        </h3>
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', maxWidth: '360px' }}>
          {error || 'An unexpected error occurred while fetching appointment slots.'}
        </p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="btn btn-secondary btn-sm"
          style={{ gap: '6px', height: '30px' }}
        >
          <RefreshCw size={13} /> Try Again
        </button>
      )}
    </div>
  );

  // --- DAY VIEW COMPONENT ---
  const renderDayView = () => {
    const dayAppts = appointmentsByDate.get(selectedDate) || [];
    const positioned = layoutDayAppointments(dayAppts, timezone);
    const isToday = selectedDate === clinicToday;

    return (
      <div
        ref={timeGridRef}
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          overflowY: 'auto',
          overflowX: 'hidden',
          position: 'relative',
        }}
      >
        {/* Time labels column */}
        <div
          style={{
            width: '64px',
            minWidth: '64px',
            borderRight: '1px solid var(--border-subtle)',
            backgroundColor: 'var(--bg-surface-secondary)',
            position: 'relative',
            height: `${TOTAL_GRID_HEIGHT}px`,
            userSelect: 'none',
          }}
        >
          {hours.map(({ hour, label }) => {
            const lineTop = GRID_TOP_PADDING + (hour - START_HOUR) * HOUR_HEIGHT;
            return (
              <div
                key={hour}
                style={{
                  position: 'absolute',
                  top: `${lineTop}px`,
                  right: '8px',
                  transform: 'translateY(-50%)',
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </div>
            );
          })}
        </div>

        {/* Day timeline column */}
        <div
          style={{
            flex: 1,
            position: 'relative',
            height: `${TOTAL_GRID_HEIGHT}px`,
            minWidth: '280px',
          }}
        >
          {/* Hour grid lines */}
          {hours.map(({ hour }) => {
            const lineTop = GRID_TOP_PADDING + (hour - START_HOUR) * HOUR_HEIGHT;
            return (
              <div
                key={hour}
                style={{
                  position: 'absolute',
                  top: `${lineTop}px`,
                  left: 0,
                  right: 0,
                  borderTop: '1px solid var(--border-subtle)',
                  pointerEvents: 'none',
                }}
              />
            );
          })}

          {/* Half-hour dashed lines */}
          {hours.slice(0, -1).map(({ hour }) => {
            const halfTop = GRID_TOP_PADDING + (hour - START_HOUR + 0.5) * HOUR_HEIGHT;
            return (
              <div
                key={`half-${hour}`}
                style={{
                  position: 'absolute',
                  top: `${halfTop}px`,
                  left: 0,
                  right: 0,
                  borderTop: '1px dashed rgba(150, 150, 150, 0.15)',
                  pointerEvents: 'none',
                }}
              />
            );
          })}

          {/* Current time indicator line on clinic today */}
          {isToday &&
            currentMinutes >= START_HOUR * 60 &&
            currentMinutes <= END_HOUR * 60 && (
              <div
                style={{
                  position: 'absolute',
                  top: `${GRID_TOP_PADDING + ((currentMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT}px`,
                  left: 0,
                  right: 0,
                  height: '2px',
                  backgroundColor: 'var(--status-cancelled-text)',
                  zIndex: 10,
                  pointerEvents: 'none',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: '-4px',
                    top: '-4px',
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    backgroundColor: 'var(--status-cancelled-text)',
                  }}
                />
              </div>
            )}

          {/* Positioned Appointments */}
          {positioned.length === 0 ? (
            <div
              style={{
                position: 'absolute',
                top: '40px',
                left: 0,
                right: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
                color: 'var(--text-muted)',
                fontSize: '12.5px',
                padding: '24px',
                textAlign: 'center',
              }}
            >
              <CalendarX2 size={24} style={{ opacity: 0.6 }} />
              <div>No appointments scheduled for this date.</div>
              {onBookSlot && (
                <button
                  type="button"
                  onClick={() => onBookSlot(selectedDate)}
                  className="btn btn-secondary btn-sm"
                  style={{ height: '28px', fontSize: '11.5px', gap: '5px', marginTop: '4px' }}
                >
                  <Plus size={12} /> Book Appointment
                </button>
              )}
            </div>
          ) : (
            positioned.map((pos, idx) => {
              const { appointment: appt, startMinutes, durationMinutes, column, totalColumns } = pos;
              const topPx =
                GRID_TOP_PADDING +
                Math.max(0, ((startMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT);
              const heightPx = Math.max(26, (durationMinutes / 60) * HOUR_HEIGHT);

              const colWidthPercent = 100 / totalColumns;
              const leftPercent = column * colWidthPercent;

              const style = getStatusClasses(appt.status);
              const patientName = appt.patient?.name || appt.patient?.fullName || 'Patient';
              const doctorName = appt.doctor?.name || appt.doctor?.displayName || 'Doctor';
              const serviceName = appt.service?.name || 'General Dental';

              return (
                <div
                  key={appt.id || idx}
                  onClick={() => onSelectAppointment(appt)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      onSelectAppointment(appt);
                    }
                  }}
                  title={`${patientName} (${appt.status}) • ${formatTime(appt.startsAt)} • ${doctorName} • ${serviceName}`}
                  style={{
                    position: 'absolute',
                    top: `${topPx}px`,
                    height: `${heightPx}px`,
                    left: `calc(${leftPercent}% + 2px)`,
                    width: `calc(${colWidthPercent}% - 4px)`,
                    backgroundColor: style.bg,
                    color: style.text,
                    border: style.isCancelled
                      ? '1px dashed var(--status-cancelled-border)'
                      : `1px solid ${style.border}`,
                    borderLeft: `3.5px solid ${style.accent}`,
                    borderRadius: 'var(--radius-sm)',
                    padding: '3px 7px',
                    overflow: 'hidden',
                    cursor: 'pointer',
                    boxShadow: 'var(--shadow-sm)',
                    opacity: style.isCancelled ? 0.65 : 1,
                    transition: 'transform var(--transition-fast), box-shadow var(--transition-fast)',
                    zIndex: 5,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'flex-start',
                  }}
                  className="calendar-appointment-block"
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '4px',
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: '11.5px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        textDecoration: style.isCancelled ? 'line-through' : 'none',
                      }}
                    >
                      {patientName}
                    </span>
                    <span style={{ fontSize: '10px', fontWeight: 500, opacity: 0.85, flexShrink: 0 }}>
                      {formatTime(appt.startsAt)}
                    </span>
                  </div>

                  {heightPx > 40 && (
                    <div
                      style={{
                        fontSize: '10.5px',
                        opacity: 0.85,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        marginTop: '1px',
                      }}
                    >
                      {doctorName} • {serviceName}
                    </div>
                  )}

                  {heightPx > 64 && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        marginTop: 'auto',
                        fontSize: '10px',
                        textTransform: 'capitalize',
                      }}
                    >
                      <span
                        style={{
                          width: '5px',
                          height: '5px',
                          borderRadius: '50%',
                          backgroundColor: style.accent,
                          display: 'inline-block',
                        }}
                      />
                      {appt.status}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  };

  // --- WEEK VIEW COMPONENT ---
  const renderWeekView = () => {
    const { days } = getWeekRange(selectedDate);
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Sticky Week Header */}
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            borderBottom: '1px solid var(--border-subtle)',
            backgroundColor: 'var(--bg-surface-secondary)',
          }}
        >
          {/* Time gutter placeholder */}
          <div style={{ width: '64px', minWidth: '64px', borderRight: '1px solid var(--border-subtle)' }} />

          {/* 7 Day Headers */}
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(7, minmax(100px, 1fr))' }}>
            {days.map((dayStr, idx) => {
              const isToday = dayStr === clinicToday;
              const isSelected = dayStr === selectedDate;
              const dayAppts = appointmentsByDate.get(dayStr) || [];
              const dayNum = parseInt(dayStr.split('-')[2], 10);

              return (
                <div
                  key={dayStr}
                  onClick={() => {
                    onSelectDate(dayStr);
                    onViewModeChange('day');
                  }}
                  role="button"
                  tabIndex={0}
                  title={`View Day: ${dayStr}`}
                  style={{
                    padding: '6px 4px',
                    textAlign: 'center',
                    borderRight: idx < 6 ? '1px solid var(--border-subtle)' : 'none',
                    cursor: 'pointer',
                    backgroundColor: isSelected ? 'var(--accent-subtle)' : 'transparent',
                    transition: 'background-color var(--transition-fast)',
                  }}
                  className="calendar-header-day-cell"
                >
                  <div style={{ fontSize: '10.5px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                    {dayNames[idx]}
                  </div>
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      marginTop: '2px',
                      fontSize: '12px',
                      fontWeight: isToday ? 700 : 500,
                      backgroundColor: isToday ? 'var(--accent-primary)' : 'transparent',
                      color: isToday ? '#ffffff' : 'var(--text-primary)',
                    }}
                  >
                    {dayNum}
                  </div>
                  {dayAppts.length > 0 && (
                    <div style={{ fontSize: '9.5px', color: 'var(--text-muted)', marginTop: '1px' }}>
                      {dayAppts.length} {dayAppts.length === 1 ? 'slot' : 'slots'}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Scrollable 7-day grid */}
        <div
          ref={timeGridRef}
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            overflowY: 'auto',
            overflowX: 'auto',
            position: 'relative',
          }}
        >
          {/* Time labels column */}
          <div
            style={{
              width: '64px',
              minWidth: '64px',
              borderRight: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-surface-secondary)',
              position: 'relative',
              height: `${TOTAL_GRID_HEIGHT}px`,
              userSelect: 'none',
            }}
          >
            {hours.map(({ hour, label }) => {
              const lineTop = GRID_TOP_PADDING + (hour - START_HOUR) * HOUR_HEIGHT;
              return (
                <div
                  key={hour}
                  style={{
                    position: 'absolute',
                    top: `${lineTop}px`,
                    right: '8px',
                    transform: 'translateY(-50%)',
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                </div>
              );
            })}
          </div>

          {/* 7 Columns */}
          <div
            style={{
              flex: 1,
              display: 'grid',
              gridTemplateColumns: 'repeat(7, minmax(100px, 1fr))',
              position: 'relative',
              height: `${TOTAL_GRID_HEIGHT}px`,
            }}
          >
            {/* Background hour grid lines */}
            {hours.map(({ hour }) => {
              const lineTop = GRID_TOP_PADDING + (hour - START_HOUR) * HOUR_HEIGHT;
              return (
                <div
                  key={hour}
                  style={{
                    position: 'absolute',
                    top: `${lineTop}px`,
                    left: 0,
                    right: 0,
                    borderTop: '1px solid var(--border-subtle)',
                    pointerEvents: 'none',
                  }}
                />
              );
            })}

            {/* Individual Day Columns */}
            {days.map((dayStr, idx) => {
              const dayAppts = appointmentsByDate.get(dayStr) || [];
              const positioned = layoutDayAppointments(dayAppts, timezone);
              const isToday = dayStr === clinicToday;

              return (
                <div
                  key={dayStr}
                  style={{
                    position: 'relative',
                    height: `${TOTAL_GRID_HEIGHT}px`,
                    borderRight: idx < 6 ? '1px solid var(--border-subtle)' : 'none',
                    backgroundColor: isToday ? 'rgba(13, 148, 136, 0.02)' : 'transparent',
                  }}
                >
                  {/* Current time indicator line on today */}
                  {isToday &&
                    currentMinutes >= START_HOUR * 60 &&
                    currentMinutes <= END_HOUR * 60 && (
                      <div
                        style={{
                          position: 'absolute',
                          top: `${GRID_TOP_PADDING + ((currentMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT}px`,
                          left: 0,
                          right: 0,
                          height: '2px',
                          backgroundColor: 'var(--status-cancelled-text)',
                          zIndex: 10,
                          pointerEvents: 'none',
                        }}
                      />
                    )}

                  {/* Appointments in this column */}
                  {positioned.map((pos, pIdx) => {
                    const { appointment: appt, startMinutes, durationMinutes, column, totalColumns } = pos;
                    const topPx =
                      GRID_TOP_PADDING +
                      Math.max(0, ((startMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT);
                    const heightPx = Math.max(26, (durationMinutes / 60) * HOUR_HEIGHT);

                    const colWidthPercent = 100 / totalColumns;
                    const leftPercent = column * colWidthPercent;

                    const style = getStatusClasses(appt.status);
                    const patientName = appt.patient?.name || appt.patient?.fullName || 'Patient';
                    const doctorName = appt.doctor?.name || appt.doctor?.displayName || 'Doctor';
                    const serviceName = appt.service?.name || 'General Dental';

                    return (
                      <div
                        key={appt.id || pIdx}
                        onClick={() => onSelectAppointment(appt)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            onSelectAppointment(appt);
                          }
                        }}
                        title={`${patientName} (${appt.status}) • ${formatTime(appt.startsAt)} • ${doctorName} • ${serviceName}`}
                        style={{
                          position: 'absolute',
                          top: `${topPx}px`,
                          height: `${heightPx}px`,
                          left: `calc(${leftPercent}% + 1px)`,
                          width: `calc(${colWidthPercent}% - 2px)`,
                          backgroundColor: style.bg,
                          color: style.text,
                          border: style.isCancelled
                            ? '1px dashed var(--status-cancelled-border)'
                            : `1px solid ${style.border}`,
                          borderLeft: `3px solid ${style.accent}`,
                          borderRadius: 'var(--radius-sm)',
                          padding: heightPx <= 32 ? '1px 5px' : '2px 6px',
                          overflow: 'hidden',
                          cursor: 'pointer',
                          boxShadow: 'var(--shadow-sm)',
                          opacity: style.isCancelled ? 0.65 : 1,
                          transition: 'transform var(--transition-fast), box-shadow var(--transition-fast)',
                          zIndex: 5,
                          fontSize: '10.5px',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: heightPx <= 36 ? 'center' : 'flex-start',
                        }}
                        className="calendar-appointment-block"
                      >
                        {heightPx < 28 ? (
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '3px',
                              width: '100%',
                              lineHeight: 1.2,
                            }}
                          >
                            <span
                              style={{
                                fontWeight: 600,
                                fontSize: '10.5px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                textDecoration: style.isCancelled ? 'line-through' : 'none',
                              }}
                            >
                              {patientName}
                            </span>
                            <span style={{ fontSize: '9px', opacity: 0.85, flexShrink: 0 }}>
                              {formatTime(appt.startsAt)}
                            </span>
                          </div>
                        ) : (
                          <>
                            <div
                              style={{
                                fontWeight: 600,
                                fontSize: '11px',
                                lineHeight: 1.25,
                                flexShrink: 0,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                textDecoration: style.isCancelled ? 'line-through' : 'none',
                              }}
                            >
                              {patientName}
                            </div>
                            <div
                              style={{
                                fontSize: '9.5px',
                                lineHeight: 1.2,
                                opacity: 0.85,
                                whiteSpace: 'nowrap',
                                flexShrink: 0,
                              }}
                            >
                              {formatTime(appt.startsAt)}
                            </div>
                            {heightPx > 48 && (
                              <div
                                style={{
                                  fontSize: '9px',
                                  lineHeight: 1.2,
                                  opacity: 0.75,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  marginTop: '2px',
                                  flexShrink: 0,
                                }}
                              >
                                {doctorName} • {serviceName}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  // --- MONTH VIEW COMPONENT ---
  const renderMonthView = () => {
    const { days } = getMonthGrid(selectedDate, timezone);
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const numWeeks = Math.ceil(days.length / 7);

    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Day of week headers */}
        <div
          style={{
            flexShrink: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            borderBottom: '1px solid var(--border-subtle)',
            backgroundColor: 'var(--bg-surface-secondary)',
          }}
        >
          {dayNames.map((name) => (
            <div
              key={name}
              style={{
                padding: '8px 4px',
                textAlign: 'center',
                fontSize: '11.5px',
                fontWeight: 600,
                color: 'var(--text-secondary)',
              }}
            >
              {name}
            </div>
          ))}
        </div>

        {/* Month grid cells */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gridTemplateRows: `repeat(${numWeeks}, minmax(72px, 1fr))`,
            backgroundColor: 'var(--border-subtle)',
            gap: '1px',
            overflowY: 'auto',
          }}
        >
          {days.map((cell: CalendarDayCell) => {
            const dayAppts = appointmentsByDate.get(cell.dateStr) || [];
            const isToday = cell.dateStr === clinicToday;
            const isSelected = cell.dateStr === selectedDate;
            const maxVisible = 2;
            const extraCount = dayAppts.length - maxVisible;

            return (
              <div
                key={cell.dateStr}
                onClick={() => {
                  onSelectDate(cell.dateStr);
                  onViewModeChange('day');
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    onSelectDate(cell.dateStr);
                    onViewModeChange('day');
                  }
                }}
                style={{
                  backgroundColor: isSelected
                    ? 'var(--accent-subtle)'
                    : cell.isCurrentMonth
                    ? 'var(--bg-card)'
                    : 'var(--bg-surface-secondary)',
                  opacity: cell.isCurrentMonth ? 1 : 0.5,
                  padding: '5px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '3px',
                  cursor: 'pointer',
                  transition: 'background-color var(--transition-fast)',
                  minHeight: '72px',
                }}
                className="calendar-month-cell"
              >
                {/* Cell Header: Day Number + Count */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span
                    style={{
                      width: '22px',
                      height: '22px',
                      borderRadius: '50%',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '11px',
                      fontWeight: isToday ? 700 : 500,
                      backgroundColor: isToday ? 'var(--accent-primary)' : 'transparent',
                      color: isToday ? '#ffffff' : 'var(--text-primary)',
                    }}
                  >
                    {cell.dayNumber}
                  </span>

                  {dayAppts.length > 0 && (
                    <span
                      style={{
                        fontSize: '9.5px',
                        color: 'var(--text-muted)',
                        padding: '1px 4px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--bg-surface-secondary)',
                      }}
                    >
                      {dayAppts.length}
                    </span>
                  )}
                </div>

                {/* Appointment Pills */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    overflow: 'hidden',
                  }}
                >
                  {dayAppts.slice(0, maxVisible).map((appt) => {
                    const style = getStatusClasses(appt.status);
                    const patientName = appt.patient?.name || appt.patient?.fullName || 'Patient';

                    return (
                      <div
                        key={appt.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectAppointment(appt);
                        }}
                        role="button"
                        tabIndex={0}
                        title={`${patientName} • ${formatTime(appt.startsAt)} (${appt.status})`}
                        style={{
                          fontSize: '10px',
                          padding: '2px 4px',
                          borderRadius: 'var(--radius-sm)',
                          backgroundColor: style.bg,
                          color: style.text,
                          border: style.isCancelled
                            ? '1px dashed var(--status-cancelled-border)'
                            : `1px solid ${style.border}`,
                          borderLeft: `2.5px solid ${style.accent}`,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '3px',
                          opacity: style.isCancelled ? 0.65 : 1,
                        }}
                        className="calendar-month-pill"
                      >
                        <span style={{ fontWeight: 600, fontSize: '9.5px', flexShrink: 0 }}>
                          {formatTime(appt.startsAt)}
                        </span>
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            textDecoration: style.isCancelled ? 'line-through' : 'none',
                          }}
                        >
                          {patientName}
                        </span>
                      </div>
                    );
                  })}

                  {extraCount > 0 && (
                    <div
                      style={{
                        fontSize: '9.5px',
                        fontWeight: 600,
                        color: 'var(--accent-primary)',
                        padding: '0 2px',
                        textAlign: 'left',
                      }}
                    >
                      +{extraCount} more...
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
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
      {/* Calendar Navigation & Mode Selector Bar */}
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
        {/* Left: Navigation (Prev, Today, Next) + Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <button
              type="button"
              onClick={handlePrev}
              title="Previous period"
              aria-label="Previous period"
              className="btn btn-secondary btn-sm"
              style={{ width: '30px', height: '30px', padding: 0 }}
            >
              <ChevronLeft size={15} />
            </button>
            <button
              type="button"
              onClick={handleToday}
              className="btn btn-secondary btn-sm"
              style={{ height: '30px', padding: '0 10px', fontSize: '12px', fontWeight: 600 }}
            >
              Today
            </button>
            <button
              type="button"
              onClick={handleNext}
              title="Next period"
              aria-label="Next period"
              className="btn btn-secondary btn-sm"
              style={{ width: '30px', height: '30px', padding: 0 }}
            >
              <ChevronRight size={15} />
            </button>
          </div>

          {/* Current Date Title */}
          <h2
            style={{
              fontSize: '14.5px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              margin: '0 0 0 4px',
            }}
          >
            {headerTitle}
          </h2>

          {loading && !initialLoading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-muted)', fontSize: '11px' }}>
              <RefreshCw size={11} className="animate-spin" />
              <span>Updating...</span>
            </div>
          )}
        </div>

        {/* Right: View Mode Segmented Controls (Day | Week | Month) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              display: 'inline-flex',
              padding: '2px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--bg-surface-secondary)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            {(['day', 'week', 'month'] as CalendarViewMode[]).map((mode) => {
              const active = viewMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onViewModeChange(mode)}
                  style={{
                    padding: '3px 10px',
                    fontSize: '11.5px',
                    fontWeight: active ? 600 : 500,
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                    backgroundColor: active ? 'var(--bg-card)' : 'transparent',
                    color: active ? 'var(--accent-primary)' : 'var(--text-secondary)',
                    boxShadow: active ? 'var(--shadow-sm)' : 'none',
                    transition: 'all var(--transition-fast)',
                  }}
                >
                  {mode}
                </button>
              );
            })}
          </div>

          {onBookSlot && (
            <button
              type="button"
              onClick={() => onBookSlot(selectedDate)}
              className="btn btn-primary"
              style={{ height: '30px', padding: '0 11px', fontSize: '12px', gap: '5px' }}
            >
              <Plus size={13} /> Book Slot
            </button>
          )}
        </div>
      </div>

      {/* Main Calendar View Card */}
      <div
        className="card"
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Top subtle loading indicator line during background refetch */}
        {loading && !initialLoading && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '2px',
              backgroundColor: 'var(--accent-primary)',
              zIndex: 30,
              animation: 'pulse 1.5s infinite',
            }}
          />
        )}

        {initialLoading ? (
          renderSkeleton()
        ) : error ? (
          renderError()
        ) : (
          <>
            {viewMode === 'day' && renderDayView()}
            {viewMode === 'week' && renderWeekView()}
            {viewMode === 'month' && renderMonthView()}
          </>
        )}
      </div>
    </div>
  );
};
