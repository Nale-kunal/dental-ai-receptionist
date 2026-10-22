import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import { useClinic } from '../context/ClinicContext';
import {
  Clock,
  User,
  Calendar,
  ShieldAlert,
  Search,
  CheckCircle,
  Briefcase,
  AlertCircle,
  Plus,
  Trash2,
  Edit2,
  X,
  AlertTriangle,
  Check,
  CalendarOff,
  Globe,
} from 'lucide-react';

interface ScheduleViewProps {
  onOpenBookingModal: (doctorId?: string) => void;
}

interface WeekDaySchedule {
  dayOfWeek: number; // 1 = Mon, 2 = Tue, 3 = Wed, 4 = Thu, 5 = Fri, 6 = Sat, 0 = Sun
  name: string;
  isOpen: boolean;
  opensAt: string;
  closesAt: string;
}

const WEEK_DAYS: { dayOfWeek: number; name: string }[] = [
  { dayOfWeek: 1, name: 'Monday' },
  { dayOfWeek: 2, name: 'Tuesday' },
  { dayOfWeek: 3, name: 'Wednesday' },
  { dayOfWeek: 4, name: 'Thursday' },
  { dayOfWeek: 5, name: 'Friday' },
  { dayOfWeek: 6, name: 'Saturday' },
  { dayOfWeek: 0, name: 'Sunday' },
];

export const ScheduleView: React.FC<ScheduleViewProps> = ({ onOpenBookingModal }) => {
  const toast = useToast();
  const { formatDate, formatTime, toUtcIso } = useClinic();
  const [loading, setLoading] = useState(true);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [clinicHours, setClinicHours] = useState<any[]>([]);
  const [blocks, setBlocks] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);

  // Business Hours Editing State
  const [isEditingHours, setIsEditingHours] = useState(false);
  const [editableHours, setEditableHours] = useState<WeekDaySchedule[]>([]);
  const [savingHours, setSavingHours] = useState(false);

  // Holiday / Closure Filter & Modal State
  const [closureFilter, setClosureFilter] = useState<'upcoming' | 'past' | 'all'>('upcoming');
  const [holidays, setHolidays] = useState<any[]>([]);
  const [holidayCountry, setHolidayCountry] = useState('US');
  const [holidayYear, setHolidayYear] = useState(new Date().getFullYear());
  const [holidaySubTab, setHolidaySubTab] = useState<'public' | 'custom'>('public');
  const [savingHoliday, setSavingHoliday] = useState(false);
  const [isBlockModalOpen, setIsBlockModalOpen] = useState(false);
  const [isEditingBlock, setIsEditingBlock] = useState(false);
  const [currentBlockId, setCurrentBlockId] = useState<string | null>(null);
  const [savingBlock, setSavingBlock] = useState(false);

  // Block Modal Form Fields
  const [blockKind, setBlockKind] = useState<'holiday' | 'closure' | 'maintenance' | 'leave'>('holiday');
  const [blockReason, setBlockReason] = useState('');
  const [blockDentistId, setBlockDentistId] = useState('');
  const [blockIsAllDay, setBlockIsAllDay] = useState(true);
  const [blockStartDate, setBlockStartDate] = useState('');
  const [blockEndDate, setBlockEndDate] = useState('');
  const [blockStartTime, setBlockStartTime] = useState('09:00');
  const [blockEndTime, setBlockEndTime] = useState('17:00');

  // Conflict Detection State
  const [blockConflicts, setBlockConflicts] = useState<any[]>([]);
  const [conflictAcknowledged, setConflictAcknowledged] = useState(false);

  // Slot Availability Playground State
  const [testDoctorId, setTestDoctorId] = useState('');
  const [testServiceId, setTestServiceId] = useState('');
  const [testDate, setTestDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  });
  const [testingSlots, setTestingSlots] = useState(false);
  const [testedSlots, setTestedSlots] = useState<any[] | null>(null);

  // --- Dentist CRUD State ---
  const [isDoctorModalOpen, setIsDoctorModalOpen] = useState(false);
  const [isEditingDoctor, setIsEditingDoctor] = useState(false);
  const [currentDoctorId, setCurrentDoctorId] = useState<string | null>(null);
  const [doctorDisplayName, setDoctorDisplayName] = useState('');
  const [doctorTitle, setDoctorTitle] = useState('Dr.');
  const [doctorQualifications, setDoctorQualifications] = useState('');
  const [doctorSpecialty, setDoctorSpecialty] = useState('');
  const [doctorExperienceYears, setDoctorExperienceYears] = useState<number | ''>(5);
  const [doctorLicenseNumber, setDoctorLicenseNumber] = useState('');
  const [doctorBio, setDoctorBio] = useState('');
  const [doctorBufferMinutes, setDoctorBufferMinutes] = useState(10);
  const [doctorActive, setDoctorActive] = useState(true);
  const [savingDoctor, setSavingDoctor] = useState(false);

  // --- Dentist Individual Schedule & Breaks Modal State ---
  const [isDoctorScheduleModalOpen, setIsDoctorScheduleModalOpen] = useState(false);
  const [selectedDoctor, setSelectedDoctor] = useState<any | null>(null);
  const [doctorTab, setDoctorTab] = useState<'hours' | 'breaks'>('hours');
  const [doctorWeeklyHours, setDoctorWeeklyHours] = useState<
    Array<{ dayOfWeek: number; name: string; isWorking: boolean; startsAt: string; endsAt: string }>
  >([]);
  const [doctorBlocks, setDoctorBlocks] = useState<any[]>([]);
  const [loadingDoctorSchedule, setLoadingDoctorSchedule] = useState(false);
  const [savingDoctorHours, setSavingDoctorHours] = useState(false);

  // Prevent background scrolling and handle Escape key for modals
  const isAnyModalOpen = isBlockModalOpen || isDoctorModalOpen || isDoctorScheduleModalOpen;
  useEffect(() => {
    if (!isAnyModalOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isBlockModalOpen) handleCloseBlockModal();
        if (isDoctorModalOpen) setIsDoctorModalOpen(false);
        if (isDoctorScheduleModalOpen) setIsDoctorScheduleModalOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAnyModalOpen, isBlockModalOpen, isDoctorModalOpen, isDoctorScheduleModalOpen]);

  // Break / Off-time form fields for doctor
  const [docBreakKind, setDocBreakKind] = useState<'break' | 'leave'>('break');
  const [docBreakReason, setDocBreakReason] = useState('Lunch Break');
  const [docBreakDate, setDocBreakDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [docBreakStartTime, setDocBreakStartTime] = useState('13:00');
  const [docBreakEndTime, setDocBreakEndTime] = useState('14:00');
  const [savingDocBreak, setSavingDocBreak] = useState(false);

  const buildWeekSchedule = (hours: any[]): WeekDaySchedule[] => {
    return WEEK_DAYS.map((wd) => {
      const existing = hours.find((h) => Number(h.dayOfWeek) === wd.dayOfWeek);
      if (existing) {
        return {
          dayOfWeek: wd.dayOfWeek,
          name: wd.name,
          isOpen: true,
          opensAt: (existing.opensAt || '09:00').slice(0, 5),
          closesAt: (existing.closesAt || '17:00').slice(0, 5),
        };
      }
      return {
        dayOfWeek: wd.dayOfWeek,
        name: wd.name,
        isOpen: false,
        opensAt: '09:00',
        closesAt: '17:00',
      };
    });
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const [docs, hours, blks, srvs, holidayRes] = await Promise.all([
        api.getDoctors(),
        api.getClinicHours(),
        api.getScheduleBlocks(),
        api.getServices(),
        api.getHolidays().catch(() => ({ countryCode: 'US', year: new Date().getFullYear(), holidays: [] })),
      ]);
      setDoctors(docs || []);
      setClinicHours(hours || []);
      setBlocks(blks || []);
      setServices(srvs || []);
      if (holidayRes) {
        setHolidays(holidayRes.holidays || []);
        setHolidayCountry(holidayRes.countryCode || 'US');
        setHolidayYear(holidayRes.year || new Date().getFullYear());
      }

      if (docs.length > 0) setTestDoctorId(docs[0].id);
      if (srvs.length > 0) setTestServiceId(srvs[0].id);
    } catch (err: any) {
      toast.error('Schedule Load Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleHolidayWorkingDay = async (h: any) => {
    try {
      setSavingHoliday(true);
      const isWorking = h.status === 'working_day';
      const nextAction = isWorking ? 'closed' : 'working_day';

      await api.setHolidayOverride({
        holidayDate: h.date,
        holidayName: h.name,
        action: nextAction,
      });

      toast.success(
        nextAction === 'working_day' ? 'Working Day Enabled' : 'Holiday Closed',
        `${h.name} (${h.date}) is now set to ${nextAction === 'working_day' ? 'Open (Normal Working Day)' : 'Closed'}.`
      );

      const [hRes, blks] = await Promise.all([
        api.getHolidays(holidayYear),
        api.getScheduleBlocks(),
      ]);
      if (hRes) setHolidays(hRes.holidays || []);
      setBlocks(blks || []);
    } catch (err: any) {
      toast.error('Failed to update holiday rule', err.message);
    } finally {
      setSavingHoliday(false);
    }
  };

  const handleYearChange = async (newYear: number) => {
    setHolidayYear(newYear);
    try {
      const res = await api.getHolidays(newYear);
      if (res) setHolidays(res.holidays || []);
    } catch (err: any) {
      toast.error('Failed to load holidays', err.message);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // --- Business Hours Handlers ---
  const handleStartEditHours = () => {
    setEditableHours(buildWeekSchedule(clinicHours));
    setIsEditingHours(true);
  };

  const handleCancelEditHours = () => {
    setIsEditingHours(false);
  };

  const handleToggleDayOpen = (index: number) => {
    setEditableHours((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], isOpen: !next[index].isOpen };
      return next;
    });
  };

  const handleTimeChange = (index: number, field: 'opensAt' | 'closesAt', value: string) => {
    setEditableHours((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleSaveHours = async () => {
    // Validate each open day
    for (const day of editableHours) {
      if (day.isOpen) {
        if (!day.opensAt || !day.closesAt) {
          toast.error('Invalid Hours', `${day.name} must have both opening and closing times set.`);
          return;
        }
        if (day.opensAt >= day.closesAt) {
          toast.error(
            'Invalid Schedule',
            `${day.name}: Opening time (${day.opensAt}) must be earlier than closing time (${day.closesAt}).`
          );
          return;
        }
      }
    }

    try {
      setSavingHours(true);
      const payload = editableHours.map((d) => ({
        dayOfWeek: d.dayOfWeek,
        isOpen: d.isOpen,
        opensAt: d.opensAt,
        closesAt: d.closesAt,
      }));
      const updated = await api.updateClinicHours(payload);
      setClinicHours(updated || []);
      setIsEditingHours(false);
      toast.success(
        'Business Hours Updated',
        'Clinic operating schedule has been saved. New appointment availability reflects these hours.'
      );
    } catch (err: any) {
      toast.error('Failed to Save Business Hours', err.message);
    } finally {
      setSavingHours(false);
    }
  };

  // --- Dentist CRUD Handlers ---
  const handleOpenAddDoctor = () => {
    setIsEditingDoctor(false);
    setCurrentDoctorId(null);
    setDoctorDisplayName('');
    setDoctorTitle('');
    setDoctorQualifications('');
    setDoctorSpecialty('General Dentistry');
    setDoctorExperienceYears('');
    setDoctorLicenseNumber('');
    setDoctorBio('');
    setDoctorBufferMinutes(10);
    setDoctorActive(true);
    setIsDoctorModalOpen(true);
  };

  const handleOpenEditDoctor = (doc: any) => {
    setIsEditingDoctor(true);
    setCurrentDoctorId(doc.id);
    setDoctorDisplayName(doc.displayName || doc.name || '');
    setDoctorTitle(doc.title || '');
    setDoctorQualifications(doc.qualifications || '');
    setDoctorSpecialty(doc.specialty || 'General Dentistry');
    const exp = doc.experienceYears ?? doc.experience_years;
    setDoctorExperienceYears(exp != null && exp !== '' ? Number(exp) : '');
    setDoctorLicenseNumber(doc.licenseNumber || doc.license_number || '');
    setDoctorBio(doc.bio || '');
    setDoctorBufferMinutes(doc.defaultBufferMinutes || 10);
    setDoctorActive(doc.active !== false);
    setIsDoctorModalOpen(true);
  };

  const handleSaveDoctor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!doctorDisplayName.trim()) {
      toast.error('Validation Error', 'Dentist name is required.');
      return;
    }
    try {
      setSavingDoctor(true);
      const payload: any = {
        displayName: doctorDisplayName.trim(),
        specialty: doctorSpecialty.trim() || undefined,
        defaultBufferMinutes: Number(doctorBufferMinutes),
        active: doctorActive,
      };

      if (doctorTitle.trim()) payload.title = doctorTitle.trim();
      if (doctorQualifications.trim()) payload.qualifications = doctorQualifications.trim();
      if (doctorExperienceYears !== '' && doctorExperienceYears !== null) {
        payload.experienceYears = Number(doctorExperienceYears);
      }
      if (doctorLicenseNumber.trim()) payload.licenseNumber = doctorLicenseNumber.trim();
      if (doctorBio.trim()) payload.bio = doctorBio.trim();

      if (isEditingDoctor && currentDoctorId) {
        const updated = await api.updateDoctor(currentDoctorId, payload);
        toast.success('Dentist Updated', `Successfully updated "${doctorDisplayName}".`);
        setDoctors((prev) => prev.map((d) => (d.id === currentDoctorId ? { ...d, ...updated } : d)));
      } else {
        const created = await api.createDoctor(payload);
        toast.success('Dentist Added', `Created practitioner "${doctorDisplayName}".`);
        setDoctors((prev) => [...prev, created]);
      }
      setIsDoctorModalOpen(false);
    } catch (err: any) {
      toast.error('Failed to Save Dentist', err.message);
    } finally {
      setSavingDoctor(false);
    }
  };

  const handleToggleDoctorStatus = async (doc: any) => {
    const nextStatus = !doc.active;
    try {
      if (!nextStatus) {
        const res = await api.deleteDoctor(doc.id);
        toast.success(
          'Dentist Deactivated',
          res.action === 'deactivated'
            ? `"${doc.displayName}" was deactivated (historical appointments preserved).`
            : `"${doc.displayName}" was removed.`
        );
      } else {
        await api.setDoctorStatus(doc.id, true);
        toast.success('Dentist Activated', `"${doc.displayName}" is now active and accepting appointments.`);
      }
      setDoctors((prev) => prev.map((d) => (d.id === doc.id ? { ...d, active: nextStatus } : d)));
    } catch (err: any) {
      toast.error('Dentist Status Error', err.message);
    }
  };

  const handleOpenDoctorScheduleModal = async (doc: any) => {
    setSelectedDoctor(doc);
    setDoctorTab('hours');
    setIsDoctorScheduleModalOpen(true);
    setLoadingDoctorSchedule(true);
    try {
      const [schedules, docBlocks] = await Promise.all([
        api.getDoctorSchedules(doc.id),
        api.getScheduleBlocks(doc.id),
      ]);

      const weekly = WEEK_DAYS.map((wd) => {
        const match = (schedules || []).find((s: any) => Number(s.dayOfWeek) === wd.dayOfWeek);
        if (match) {
          return {
            dayOfWeek: wd.dayOfWeek,
            name: wd.name,
            isWorking: true,
            startsAt: (match.startsAt || '09:00').slice(0, 5),
            endsAt: (match.endsAt || '17:00').slice(0, 5),
          };
        }
        const clinicMatch = clinicHours.find((h: any) => Number(h.dayOfWeek) === wd.dayOfWeek);
        const isOpenByDefault = clinicMatch ? true : wd.dayOfWeek >= 1 && wd.dayOfWeek <= 5;
        return {
          dayOfWeek: wd.dayOfWeek,
          name: wd.name,
          isWorking: isOpenByDefault,
          startsAt: (clinicMatch?.opensAt || '09:00').slice(0, 5),
          endsAt: (clinicMatch?.closesAt || '17:00').slice(0, 5),
        };
      });

      setDoctorWeeklyHours(weekly);
      setDoctorBlocks(docBlocks || []);
    } catch (err: any) {
      toast.error('Schedule Load Error', err.message);
    } finally {
      setLoadingDoctorSchedule(false);
    }
  };

  const handleDoctorDayToggle = (index: number) => {
    setDoctorWeeklyHours((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], isWorking: !next[index].isWorking };
      return next;
    });
  };

  const handleDoctorTimeChange = (index: number, field: 'startsAt' | 'endsAt', val: string) => {
    setDoctorWeeklyHours((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: val };
      return next;
    });
  };

  const handleSaveDoctorWeeklyHours = async () => {
    if (!selectedDoctor) return;
    try {
      setSavingDoctorHours(true);
      await api.updateDoctorSchedule(selectedDoctor.id, doctorWeeklyHours);
      toast.success(
        'Working Schedule Saved',
        `Individual hours for ${selectedDoctor.displayName} updated successfully in PostgreSQL.`
      );
    } catch (err: any) {
      toast.error('Failed to Save Working Schedule', err.message);
    } finally {
      setSavingDoctorHours(false);
    }
  };

  const handleCreateDoctorBreak = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDoctor || !docBreakDate) return;
    try {
      setSavingDocBreak(true);
      const startsAt = toUtcIso(docBreakDate, docBreakStartTime);
      const endsAt = toUtcIso(docBreakDate, docBreakEndTime);

      if (new Date(startsAt) >= new Date(endsAt)) {
        toast.error('Invalid Interval', 'End time must be after start time.');
        return;
      }

      const created = await api.createScheduleBlock({
        kind: docBreakKind,
        reason: docBreakReason.trim() || (docBreakKind === 'break' ? 'Lunch Break' : 'Leave'),
        startsAt,
        endsAt,
        dentistId: selectedDoctor.id,
        ignoreConflicts: true,
      });

      toast.success('Break / Leave Added', `Recorded ${docBreakReason} for ${selectedDoctor.displayName}.`);
      setDoctorBlocks((prev) => [...prev, created]);
      setBlocks((prev) => [...prev, created]);
      // Reset form defaults
      setDocBreakReason('Lunch Break');
    } catch (err: any) {
      toast.error('Failed to Add Break', err.message);
    } finally {
      setSavingDocBreak(false);
    }
  };

  const handleDeleteDoctorBreak = async (blockId: string) => {
    if (!confirm('Are you sure you want to remove this break/leave?')) return;
    try {
      await api.deleteScheduleBlock(blockId);
      toast.success('Break Removed', 'The break interval was removed.');
      setDoctorBlocks((prev) => prev.filter((b) => b.id !== blockId));
      setBlocks((prev) => prev.filter((b) => b.id !== blockId));
    } catch (err: any) {
      toast.error('Failed to Remove Break', err.message);
    }
  };

  // --- Holiday & Closure Handlers ---
  const handleOpenAddBlockModal = () => {
    const today = new Date().toISOString().split('T')[0];
    setIsEditingBlock(false);
    setCurrentBlockId(null);
    setBlockKind('holiday');
    setBlockReason('');
    setBlockDentistId('');
    setBlockIsAllDay(true);
    setBlockStartDate(today);
    setBlockEndDate(today);
    setBlockStartTime('09:00');
    setBlockEndTime('17:00');
    setBlockConflicts([]);
    setConflictAcknowledged(false);
    setIsBlockModalOpen(true);
  };

  const handleOpenEditBlockModal = (block: any) => {
    setIsEditingBlock(true);
    setCurrentBlockId(block.id);
    setBlockKind(block.kind || 'holiday');
    setBlockReason(block.reason || '');
    setBlockDentistId(block.dentistId || '');

    const startObj = new Date(block.startsAt);
    const endObj = new Date(block.endsAt);

    const sDate = startObj.toISOString().split('T')[0];
    const eDate = endObj.toISOString().split('T')[0];
    const sTime = startObj.toISOString().slice(11, 16);
    const eTime = endObj.toISOString().slice(11, 16);

    const isAll = (sTime === '00:00' && (eTime === '23:59' || eTime === '00:00'));

    setBlockStartDate(sDate);
    setBlockEndDate(eDate);
    setBlockIsAllDay(isAll);
    setBlockStartTime(isAll ? '09:00' : sTime);
    setBlockEndTime(isAll ? '17:00' : eTime);
    setBlockConflicts([]);
    setConflictAcknowledged(false);
    setIsBlockModalOpen(true);
  };

  const handleCloseBlockModal = () => {
    setIsBlockModalOpen(false);
    setBlockConflicts([]);
    setConflictAcknowledged(false);
  };

  const handleSaveBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!blockReason.trim()) {
      toast.error('Validation Error', 'Please provide a name or reason for this closure/holiday.');
      return;
    }
    if (!blockStartDate || !blockEndDate) {
      toast.error('Validation Error', 'Please specify start and end dates.');
      return;
    }

    let startsAtIso: string;
    let endsAtIso: string;

    if (blockIsAllDay) {
      startsAtIso = toUtcIso(blockStartDate, '00:00');
      endsAtIso = toUtcIso(blockEndDate, '23:59:59');
    } else {
      if (blockStartDate === blockEndDate && blockStartTime >= blockEndTime) {
        toast.error('Validation Error', 'Opening/start time must be earlier than closing/end time.');
        return;
      }
      startsAtIso = toUtcIso(blockStartDate, blockStartTime);
      endsAtIso = toUtcIso(blockEndDate, blockEndTime);
    }

    if (new Date(startsAtIso) > new Date(endsAtIso)) {
      toast.error('Validation Error', 'Start date and time must be earlier than end date and time.');
      return;
    }

    // If new block and conflicts not yet checked/acknowledged
    if (!isEditingBlock && !conflictAcknowledged && blockConflicts.length === 0) {
      try {
        const conflictRes = await api.checkBlockConflicts({
          startsAt: startsAtIso,
          endsAt: endsAtIso,
          dentistId: blockDentistId || null,
        });

        if (conflictRes.hasConflicts) {
          setBlockConflicts(conflictRes.conflicts);
          toast.warning(
            'Appointment Conflict Detected',
            `Found ${conflictRes.conflictCount} existing appointment(s) during this period. Please review before proceeding.`
          );
          return;
        }
      } catch (err: any) {
        console.warn('Conflict check error:', err);
      }
    }

    // Persist to Neon PostgreSQL
    try {
      setSavingBlock(true);
      if (isEditingBlock && currentBlockId) {
        await api.updateScheduleBlock(currentBlockId, {
          kind: blockKind,
          startsAt: startsAtIso,
          endsAt: endsAtIso,
          reason: blockReason.trim(),
          dentistId: blockDentistId || null,
        });
        toast.success('Closure Updated', 'The schedule block has been updated successfully.');
      } else {
        await api.createScheduleBlock({
          kind: blockKind,
          startsAt: startsAtIso,
          endsAt: endsAtIso,
          reason: blockReason.trim(),
          dentistId: blockDentistId || null,
          ignoreConflicts: true, // User has explicitly confirmed/reviewed
        });
        toast.success(
          'Holiday / Closure Scheduled',
          'The closure has been recorded and is actively blocking new appointment bookings.'
        );
      }

      // Reload blocks from backend
      const updatedBlocks = await api.getScheduleBlocks();
      setBlocks(updatedBlocks || []);
      handleCloseBlockModal();
    } catch (err: any) {
      toast.error('Failed to Save Closure', err.message);
    } finally {
      setSavingBlock(false);
    }
  };

  const handleDeleteBlock = async (id: string, reason: string) => {
    if (
      !window.confirm(
        `Are you sure you want to remove the closure "${reason}"?\n\nAppointment slots during this timeframe will become available for booking again.`
      )
    ) {
      return;
    }

    try {
      await api.deleteScheduleBlock(id);
      toast.success('Closure Removed', 'The closure block was deleted and calendar slots restored.');
      setBlocks((prev) => prev.filter((b) => b.id !== id));
    } catch (err: any) {
      toast.error('Failed to Delete Closure', err.message);
    }
  };

  // --- Slot Availability Playground Handler ---
  const handleTestAvailability = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testDoctorId || !testServiceId || !testDate) return;
    setTestingSlots(true);
    try {
      const res = await api.getAvailability({
        date: testDate,
        doctorId: testDoctorId,
        serviceId: testServiceId,
      });
      setTestedSlots(res.slots || []);
      toast.success(
        'Slots Calculated',
        `Found ${res.slots.length} available appointment opening(s) on ${testDate}.`
      );
    } catch (err: any) {
      toast.error('Availability Check Error', err.message);
    } finally {
      setTestingSlots(false);
    }
  };

  // Filter blocks for display
  const now = new Date();
  const upcomingBlocks = blocks.filter((b) => new Date(b.endsAt) >= now);
  const pastBlocks = blocks.filter((b) => new Date(b.endsAt) < now);
  const displayedBlocks =
    closureFilter === 'upcoming'
      ? upcomingBlocks
      : closureFilter === 'past'
      ? pastBlocks
      : blocks;

  const currentSchedule = buildWeekSchedule(clinicHours);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Dentists Roster Section */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              Clinic Dentists & Specialists
            </h3>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
              Manage practitioners, individual weekly schedules, lunch breaks, and personal leave.
            </p>
          </div>
          <button
            onClick={handleOpenAddDoctor}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              height: '32px',
              padding: '0 12px',
              backgroundColor: 'var(--accent-primary)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              color: '#ffffff',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background-color 0.2s',
            }}
          >
            <Plus size={14} />
            Add Dentist
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '12px' }}>
          {doctors.map((doc) => (
            <div
              key={doc.id}
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-card)',
                borderRadius: 'var(--radius-md)',
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '50%',
                      backgroundColor: 'var(--accent-subtle)',
                      border: '1px solid var(--accent-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--accent-text)',
                      fontWeight: 700,
                      fontSize: '13px',
                    }}
                  >
                    {doc.displayName.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '14px' }}>
                      {doc.displayName}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '2px', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: 'var(--accent-text)', fontWeight: 600 }}>{doc.specialty || 'General Dentistry'}</span>
                      {doc.qualifications && (
                        <span style={{ fontSize: '10px', color: '#a78bfa', backgroundColor: 'rgba(167, 139, 250, 0.12)', padding: '1px 5px', borderRadius: '4px', fontWeight: 600 }}>
                          {doc.qualifications}
                        </span>
                      )}
                      {(doc.experienceYears != null || doc.experience_years != null) && (
                        <span style={{ fontSize: '10px', color: '#34d399', backgroundColor: 'rgba(52, 211, 153, 0.12)', padding: '1px 5px', borderRadius: '4px' }}>
                          {doc.experienceYears ?? doc.experience_years} yrs exp
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <span
                  style={{
                    fontSize: '10.5px',
                    fontWeight: 600,
                    color: doc.active ? '#10b981' : '#f87171',
                    backgroundColor: doc.active ? 'var(--success-subtle)' : 'var(--danger-subtle)',
                    padding: '2px 7px',
                    borderRadius: '4px',
                  }}
                >
                  {doc.active ? 'Accepting Patients' : 'Inactive'}
                </span>
              </div>

              {doc.bio && (
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                  {doc.bio}
                </div>
              )}

              <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Default Buffer: <strong style={{ color: 'var(--text-primary)' }}>{doc.defaultBufferMinutes || 10}m</strong></span>
                {(doc.licenseNumber || doc.license_number) && (
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Lic: {doc.licenseNumber || doc.license_number}
                  </span>
                )}
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px' }}>
                <button
                  onClick={() => handleOpenEditDoctor(doc)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '5px',
                    padding: '7px 10px',
                    backgroundColor: 'var(--bg-surface-secondary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '6px',
                    color: 'var(--text-primary)',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <Edit2 size={12} />
                  Edit Details
                </button>
                <button
                  onClick={() => handleOpenDoctorScheduleModal(doc)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '5px',
                    padding: '7px 10px',
                    backgroundColor: 'var(--accent-subtle)',
                    border: '1px solid var(--border-card)',
                    borderRadius: '6px',
                    color: 'var(--accent-text)',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <Clock size={12} />
                  Schedule & Breaks
                </button>
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
                <button
                  onClick={() => handleToggleDoctorStatus(doc)}
                  style={{
                    padding: '7px 10px',
                    backgroundColor: doc.active ? 'var(--danger-subtle)' : 'var(--success-subtle)',
                    border: `1px solid ${doc.active ? 'rgba(198, 40, 40, 0.2)' : 'rgba(16, 185, 129, 0.2)'}`,
                    borderRadius: '6px',
                    color: doc.active ? '#f87171' : '#10b981',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {doc.active ? 'Deactivate' : 'Activate'}
                </button>

                <button
                  onClick={() => onOpenBookingModal(doc.id)}
                  style={{
                    flex: 1,
                    padding: '7px 12px',
                    backgroundColor: 'var(--bg-surface-secondary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '6px',
                    color: 'var(--accent-text)',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textAlign: 'center',
                  }}
                >
                  Book Slot →
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Grid: Operating Hours & Schedule Blocks */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        {/* Clinic Standard Operating Hours */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-md)',
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
              marginBottom: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={16} color="var(--accent-primary)" />
              <h3 style={{ fontSize: '14.5px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                Clinic Standard Business Hours
              </h3>
            </div>
            {!isEditingHours ? (
              <button
                onClick={handleStartEditHours}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  height: '28px',
                  padding: '0 10px',
                  backgroundColor: 'var(--accent-subtle)',
                  border: '1px solid var(--accent-primary)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--accent-primary)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <Edit2 size={12} />
                Edit Hours
              </button>
            ) : (
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  onClick={handleCancelEditHours}
                  disabled={savingHours}
                  style={{
                    padding: '6px 10px',
                    backgroundColor: 'var(--bg-surface-secondary)',
                    border: '1px solid var(--border-card)',
                    borderRadius: '6px',
                    color: 'var(--text-secondary)',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: savingHours ? 'wait' : 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveHours}
                  disabled={savingHours}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 14px',
                    backgroundColor: 'var(--accent-primary)',
                    border: 'none',
                    borderRadius: '6px',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: savingHours ? 'wait' : 'pointer',
                  }}
                >
                  {savingHours ? (
                    'Saving...'
                  ) : (
                    <>
                      <Check size={13} />
                      Save Schedule
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {!isEditingHours ? (
            /* Read-only Hours View */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {clinicHours.length === 0 && (
                <div
                  style={{
                    backgroundColor: 'var(--warning-subtle)',
                    border: '1px solid rgba(234, 179, 8, 0.3)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '8px 12px',
                    marginBottom: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '12px',
                    color: 'var(--text-primary)',
                  }}
                >
                  <AlertTriangle size={15} color="var(--warning)" style={{ flexShrink: 0 }} />
                  <div>
                    <strong>Weekly Hours Not Configured:</strong> Newly registered clinics start with all days closed. Click <strong>"Edit Hours"</strong> above to configure your regular open schedule.
                  </div>
                </div>
              )}
              {currentSchedule.map((h) => (
                <div
                  key={h.dayOfWeek}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '7px 11px',
                    backgroundColor: 'var(--bg-surface-secondary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '12.5px',
                  }}
                >
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{h.name}</span>
                  {h.isOpen ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: '12px' }}>
                        {h.opensAt} – {h.closesAt}
                      </span>
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 600,
                          color: 'var(--success)',
                          backgroundColor: 'var(--success-subtle)',
                          padding: '1px 6px',
                          borderRadius: '4px',
                        }}
                      >
                        Open
                      </span>
                    </div>
                  ) : (
                    <span
                      style={{
                        fontSize: '10.5px',
                        fontWeight: 600,
                        color: 'var(--text-secondary)',
                        backgroundColor: 'var(--bg-surface-secondary)',
                        padding: '1px 6px',
                        borderRadius: '4px',
                      }}
                    >
                      {clinicHours.length === 0 ? 'Unconfigured (Closed)' : 'Closed'}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            /* Interactive Hours Editor View */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              <div
                style={{
                  fontSize: '11.5px',
                  color: 'var(--text-secondary)',
                  marginBottom: '2px',
                  backgroundColor: 'var(--accent-subtle)',
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--accent-subtle)',
                }}
              >
                Configure opening and closing times for each weekday. Uncheck "Open" to mark the clinic closed for that day.
              </div>

              {editableHours.map((day, idx) => (
                <div
                  key={day.dayOfWeek}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 10px',
                    backgroundColor: day.isOpen ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.2)',
                    border: `1px solid ${day.isOpen ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.03)'}`,
                    borderRadius: 'var(--radius-sm)',
                    gap: '10px',
                  }}
                >
                  {/* Day Checkbox */}
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '7px',
                      cursor: 'pointer',
                      width: '110px',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={day.isOpen}
                      onChange={() => handleToggleDayOpen(idx)}
                      style={{ cursor: 'pointer', accentColor: 'var(--accent-primary)', width: '14px', height: '14px' }}
                    />
                    <span
                      style={{
                        fontSize: '12.5px',
                        fontWeight: 600,
                        color: day.isOpen ? 'var(--text-primary)' : 'var(--text-muted)',
                      }}
                    >
                      {day.name}
                    </span>
                  </label>

                  {/* Time Inputs */}
                  {day.isOpen ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <input
                        type="time"
                        value={day.opensAt}
                        onChange={(e) => handleTimeChange(idx, 'opensAt', e.target.value)}
                        style={{
                          backgroundColor: 'var(--bg-surface-secondary)',
                          border: '1px solid var(--border-card)',
                          borderRadius: '4px',
                          padding: '4px 6px',
                          color: 'var(--text-primary)',
                          fontSize: '12px',
                          fontFamily: 'monospace',
                        }}
                      />
                      <span style={{ color: 'var(--text-muted)', fontSize: '11.5px' }}>to</span>
                      <input
                        type="time"
                        value={day.closesAt}
                        onChange={(e) => handleTimeChange(idx, 'closesAt', e.target.value)}
                        style={{
                          backgroundColor: 'var(--bg-surface-secondary)',
                          border:
                            day.opensAt >= day.closesAt
                              ? '1px solid #ef4444'
                              : '1px solid var(--border-subtle)',
                          borderRadius: '4px',
                          padding: '4px 6px',
                          color: 'var(--text-primary)',
                          fontSize: '12px',
                          fontFamily: 'monospace',
                        }}
                      />
                    </div>
                  ) : (
                    <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', fontStyle: 'italic', paddingRight: '8px' }}>
                      Closed all day
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Schedule Blocks & Holidays */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '10px',
              flexWrap: 'wrap',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldAlert size={16} color="var(--warning)" />
              <h3 style={{ fontSize: '14.5px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                Holidays & Clinic Closures
              </h3>
            </div>
            {holidaySubTab === 'custom' && (
              <button
                onClick={handleOpenAddBlockModal}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  height: '28px',
                  padding: '0 10px',
                  backgroundColor: 'var(--warning-subtle)',
                  border: '1px solid rgba(194, 91, 16, 0.3)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--warning)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <Plus size={13} />
                Add Closure
              </button>
            )}
          </div>

          {/* SubTab Switcher: Public Holidays vs Custom Closures */}
          <div
            style={{
              display: 'flex',
              gap: '6px',
              borderBottom: '1px solid var(--border-subtle)',
              paddingBottom: '8px',
              marginBottom: '10px',
            }}
          >
            <button
              type="button"
              onClick={() => setHolidaySubTab('public')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 10px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                backgroundColor: holidaySubTab === 'public' ? 'var(--accent-subtle)' : 'transparent',
                color: holidaySubTab === 'public' ? 'var(--accent-primary)' : 'var(--text-muted)',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Globe size={13} />
              Public Holidays ({holidayCountry} - {holidayYear})
            </button>
            <button
              type="button"
              onClick={() => setHolidaySubTab('custom')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 10px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                backgroundColor: holidaySubTab === 'custom' ? 'var(--accent-subtle)' : 'transparent',
                color: holidaySubTab === 'custom' ? 'var(--accent-primary)' : 'var(--text-muted)',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <CalendarOff size={13} />
              Custom Closures ({blocks.length})
            </button>
          </div>

          {holidaySubTab === 'public' ? (
            /* PUBLIC HOLIDAYS TAB */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  backgroundColor: 'var(--bg-surface-secondary)',
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '12px',
                }}
              >
                <span style={{ color: 'var(--text-secondary)' }}>
                  Jurisdiction: <strong style={{ color: 'var(--text-primary)' }}>{holidayCountry}</strong> (Auto-selected from Clinic Settings)
                </span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1].map((yr) => (
                    <button
                      key={yr}
                      type="button"
                      onClick={() => handleYearChange(yr)}
                      style={{
                        padding: '2px 7px',
                        fontSize: '11px',
                        borderRadius: '4px',
                        border: '1px solid var(--border-subtle)',
                        backgroundColor: holidayYear === yr ? 'var(--accent-primary)' : 'transparent',
                        color: holidayYear === yr ? '#ffffff' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      {yr}
                    </button>
                  ))}
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  overflowY: 'auto',
                  maxHeight: '340px',
                  paddingRight: '4px',
                }}
              >
                {holidays.length === 0 ? (
                  <div
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: '12.5px',
                      textAlign: 'center',
                      padding: '28px 12px',
                    }}
                  >
                    No public holidays registered for this jurisdiction.
                  </div>
                ) : (
                  holidays.map((h) => {
                    const isWorking = h.status === 'working_day';
                    return (
                      <div
                        key={h.date + h.name}
                        style={{
                          padding: '10px 12px',
                          borderRadius: '8px',
                          backgroundColor: isWorking ? 'rgba(16, 185, 129, 0.05)' : 'var(--bg-surface-secondary)',
                          border: `1px solid ${isWorking ? 'rgba(16, 185, 129, 0.3)' : 'var(--border-subtle)'}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '10px',
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '13px' }}>
                            {h.name}
                          </span>
                          <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                            {formatDate(h.date + 'T00:00:00', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: 600,
                              padding: '2px 8px',
                              borderRadius: '4px',
                              backgroundColor: isWorking ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.12)',
                              color: isWorking ? '#10b981' : '#ef4444',
                              border: `1px solid ${isWorking ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.25)'}`,
                            }}
                          >
                            {isWorking ? 'Open (Working Day)' : 'Closed'}
                          </span>

                          <button
                            type="button"
                            disabled={savingHoliday}
                            onClick={() => handleToggleHolidayWorkingDay(h)}
                            style={{
                              padding: '4px 8px',
                              borderRadius: '5px',
                              border: '1px solid var(--border-subtle)',
                              backgroundColor: 'var(--bg-surface)',
                              color: isWorking ? 'var(--text-secondary)' : 'var(--accent-primary)',
                              fontSize: '11.5px',
                              fontWeight: 600,
                              cursor: savingHoliday ? 'wait' : 'pointer',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            {isWorking ? 'Mark Closed' : 'Work This Day'}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            /* CUSTOM CLOSURES TAB */
            <>
              {/* Filter Tabs */}
              <div
                style={{
                  display: 'flex',
                  gap: '4px',
                  backgroundColor: 'var(--bg-surface-secondary)',
                  padding: '3px',
                  borderRadius: 'var(--radius-sm)',
                  marginBottom: '10px',
                }}
              >
                <button
                  type="button"
                  onClick={() => setClosureFilter('upcoming')}
                  style={{
                    flex: 1,
                    padding: '5px 8px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: closureFilter === 'upcoming' ? '#1e293b' : 'transparent',
                    color: closureFilter === 'upcoming' ? '#f8fafc' : '#94a3b8',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Upcoming ({upcomingBlocks.length})
                </button>
                <button
                  type="button"
                  onClick={() => setClosureFilter('past')}
                  style={{
                    flex: 1,
                    padding: '5px 8px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: closureFilter === 'past' ? '#1e293b' : 'transparent',
                    color: closureFilter === 'past' ? '#f8fafc' : '#94a3b8',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Past ({pastBlocks.length})
                </button>
                <button
                  type="button"
                  onClick={() => setClosureFilter('all')}
                  style={{
                    flex: 1,
                    padding: '5px 8px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: closureFilter === 'all' ? '#1e293b' : 'transparent',
                    color: closureFilter === 'all' ? '#f8fafc' : '#94a3b8',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  All ({blocks.length})
                </button>
              </div>

              {/* Closures List */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  overflowY: 'auto',
                  maxHeight: '340px',
                  paddingRight: '4px',
                }}
              >
                {displayedBlocks.length === 0 ? (
                  <div
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: '13px',
                      textAlign: 'center',
                      padding: '36px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <CalendarOff size={28} color="#475569" />
                    <span>
                      {closureFilter === 'upcoming'
                        ? 'No upcoming clinic closures or custom overrides scheduled.'
                        : closureFilter === 'past'
                        ? 'No past closure history.'
                        : 'No schedule overrides found.'}
                    </span>
                  </div>
                ) : (
                  displayedBlocks.map((b) => {
                    const sDate = new Date(b.startsAt);
                    const eDate = new Date(b.endsAt);
                    const isSingleDay = sDate.toDateString() === eDate.toDateString();
                    const isPast = eDate < now;

                    return (
                      <div
                        key={b.id}
                        style={{
                          padding: '12px 14px',
                          borderRadius: '8px',
                          backgroundColor: isPast ? 'rgba(255, 255, 255, 0.02)' : 'rgba(245, 158, 11, 0.06)',
                          border: `1px solid ${isPast ? 'rgba(255, 255, 255, 0.06)' : 'rgba(245, 158, 11, 0.25)'}`,
                          opacity: isPast ? 0.75 : 1,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '13.5px' }}>
                                {b.reason || 'Scheduled Closure'}
                              </span>
                              <span
                                style={{
                                  fontSize: '10.5px',
                                  fontWeight: 600,
                                  textTransform: 'uppercase',
                                  color:
                                    b.kind === 'holiday'
                                      ? '#38bdf8'
                                      : b.kind === 'leave'
                                      ? '#ec4899'
                                      : b.kind === 'maintenance'
                                      ? '#a855f7'
                                      : '#f59e0b',
                                  backgroundColor: 'rgba(255, 255, 255, 0.06)',
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                }}
                              >
                                {b.kind}
                              </span>
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                              {b.dentistName ? `Practitioner: ${b.dentistName}` : 'Clinic-wide (All Practitioners)'}
                            </div>
                          </div>

                          {/* Actions */}
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              type="button"
                              onClick={() => handleOpenEditBlockModal(b)}
                              title="Edit closure details"
                              style={{
                                padding: '4px 6px',
                                backgroundColor: 'var(--bg-surface-secondary)',
                                border: '1px solid var(--border-subtle)',
                                borderRadius: '5px',
                                color: 'var(--text-primary)',
                                cursor: 'pointer',
                              }}
                            >
                              <Edit2 size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteBlock(b.id, b.reason || 'closure')}
                              title="Remove closure"
                              style={{
                                padding: '4px 6px',
                                backgroundColor: 'var(--danger-subtle)',
                                border: '1px solid rgba(239, 68, 68, 0.25)',
                                borderRadius: '5px',
                                color: 'var(--danger)',
                                cursor: 'pointer',
                              }}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>

                        <div style={{ fontSize: '12px', color: 'var(--accent-text)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Calendar size={12} />
                          {isSingleDay
                            ? formatDate(b.startsAt, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
                            : `${formatDate(b.startsAt, { month: 'short', day: 'numeric' })} – ${formatDate(b.endsAt, { month: 'short', day: 'numeric', year: 'numeric' })}`}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Real-time Slot Availability Checker */}
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-md)',
          padding: '16px 18px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <Search size={16} color="var(--accent-primary)" />
          <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Appointment Slot Availability Checker
          </h3>
        </div>
        <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', margin: '0 0 12px 0' }}>
          Instantly check available appointment openings. Calculated by intersecting clinic business hours, doctor shifts, schedule closures/holidays, and existing bookings.
        </p>

        <form onSubmit={handleTestAvailability} style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: '170px' }}>
            <label style={{ display: 'block', fontSize: '11.5px', color: 'var(--text-primary)', marginBottom: '4px' }}>
              Practitioner
            </label>
            <select
              value={testDoctorId}
              onChange={(e) => setTestDoctorId(e.target.value)}
              className="form-input"
              style={{
                width: '100%',
                height: '32px',
                fontSize: '12.5px',
              }}
            >
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.displayName}
                </option>
              ))}
            </select>
          </div>

          <div style={{ flex: 1, minWidth: '170px' }}>
            <label style={{ display: 'block', fontSize: '11.5px', color: 'var(--text-primary)', marginBottom: '4px' }}>
              Treatment
            </label>
            <select
              value={testServiceId}
              onChange={(e) => setTestServiceId(e.target.value)}
              className="form-input"
              style={{
                width: '100%',
                height: '32px',
                fontSize: '12.5px',
              }}
            >
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.durationMinutes}m)
                </option>
              ))}
            </select>
          </div>

          <div style={{ flex: 1, minWidth: '150px' }}>
            <label style={{ display: 'block', fontSize: '11.5px', color: 'var(--text-primary)', marginBottom: '4px' }}>
              Date
            </label>
            <input
              type="date"
              value={testDate}
              onChange={(e) => setTestDate(e.target.value)}
              className="form-input"
              style={{
                width: '100%',
                height: '32px',
                fontSize: '12.5px',
              }}
            />
          </div>

          <button
            type="submit"
            disabled={testingSlots}
            className="btn btn-primary"
            style={{
              height: '32px',
              padding: '0 14px',
              fontSize: '12.5px',
            }}
          >
            {testingSlots ? 'Checking Openings...' : 'Check Available Openings'}
          </button>
        </form>

        {testedSlots && (
          <div style={{ marginTop: '12px' }}>
            <div style={{ fontSize: '12.5px', color: 'var(--text-primary)', marginBottom: '8px', fontWeight: 600 }}>
              Available Openings on {testDate} ({testedSlots.length} slots):
            </div>
            {testedSlots.length === 0 ? (
              <div
                style={{
                  color: 'var(--danger)',
                  fontSize: '13px',
                  backgroundColor: 'var(--danger-subtle)',
                  border: '1px solid rgba(198, 40, 40, 0.2)',
                  borderRadius: '8px',
                  padding: '12px 14px',
                }}
              >
                No available appointment slots on this date. The clinic or practitioner is either closed according to business hours, blocked by a scheduled holiday/closure, or fully booked.
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {testedSlots.map((s, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      backgroundColor: 'var(--success-subtle)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      color: 'var(--success)',
                      fontSize: '12.5px',
                      fontWeight: 600,
                    }}
                  >
                    {s.time}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add / Edit Holiday & Closure Modal */}
      {isBlockModalOpen && createPortal(
        <div
          className="modal-overlay"
          onClick={handleCloseBlockModal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="block-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'var(--bg-modal-overlay)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px',
          }}
        >
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-card)',
              borderRadius: 'var(--radius-lg)',
              padding: '24px',
              width: '100%',
              maxWidth: '540px',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: 'var(--shadow-modal)',
              color: 'var(--text-primary)',
              position: 'relative',
              zIndex: 1001,
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '18px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShieldAlert size={20} color="var(--warning)" />
                <h3 id="block-modal-title" style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                  {isEditingBlock ? 'Edit Schedule Closure' : 'Add Holiday or Clinic Closure'}
                </h3>
              </div>
              <button
                onClick={handleCloseBlockModal}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: '4px',
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveBlock} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Reason / Title */}
              <div>
                <label style={{ display: 'block', fontSize: '12.5px', color: 'var(--text-primary)', marginBottom: '6px' }}>
                  Name / Reason <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Christmas Day, Clinic Renovations, Staff Training"
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    backgroundColor: 'var(--bg-surface-secondary)',
                    border: '1px solid var(--border-card)',
                    borderRadius: '8px',
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                  }}
                />
              </div>

              {/* Kind & Scope */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12.5px', color: 'var(--text-primary)', marginBottom: '6px' }}>
                    Closure Type
                  </label>
                  <select
                    value={blockKind}
                    onChange={(e: any) => setBlockKind(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      backgroundColor: 'var(--bg-surface-secondary)',
                      border: '1px solid var(--border-card)',
                      borderRadius: '8px',
                      color: 'var(--text-primary)',
                      fontSize: '13px',
                    }}
                  >
                    <option value="holiday">Holiday (Public / Clinic)</option>
                    <option value="closure">Clinic Closure</option>
                    <option value="maintenance">Facility Maintenance</option>
                    <option value="leave">Practitioner Leave</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12.5px', color: 'var(--text-primary)', marginBottom: '6px' }}>
                    Affected Scope
                  </label>
                  <select
                    value={blockDentistId}
                    onChange={(e) => setBlockDentistId(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      backgroundColor: 'var(--bg-surface-secondary)',
                      border: '1px solid var(--border-card)',
                      borderRadius: '8px',
                      color: 'var(--text-primary)',
                      fontSize: '13px',
                    }}
                  >
                    <option value="">Clinic-wide (All Staff)</option>
                    {doctors.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.displayName} only
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* All-Day Checkbox */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  color: 'var(--text-primary)',
                  userSelect: 'none',
                }}
              >
                <input
                  type="checkbox"
                  checked={blockIsAllDay}
                  onChange={(e) => setBlockIsAllDay(e.target.checked)}
                  style={{ accentColor: 'var(--accent-primary)', width: '16px', height: '16px' }}
                />
                All-day closure (blocks the entire business day)
              </label>

              {/* Date Pickers */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12.5px', color: 'var(--text-primary)', marginBottom: '6px' }}>
                    Start Date <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={blockStartDate}
                    onChange={(e) => {
                      setBlockStartDate(e.target.value);
                      if (!blockEndDate || blockEndDate < e.target.value) {
                        setBlockEndDate(e.target.value);
                      }
                      setBlockConflicts([]);
                    }}
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      backgroundColor: 'var(--bg-surface-secondary)',
                      border: '1px solid var(--border-card)',
                      borderRadius: '8px',
                      color: 'var(--text-primary)',
                      fontSize: '13px',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12.5px', color: 'var(--text-primary)', marginBottom: '6px' }}>
                    End Date <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input
                    type="date"
                    required
                    min={blockStartDate}
                    value={blockEndDate}
                    onChange={(e) => {
                      setBlockEndDate(e.target.value);
                      setBlockConflicts([]);
                    }}
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      backgroundColor: 'var(--bg-surface-secondary)',
                      border: '1px solid var(--border-card)',
                      borderRadius: '8px',
                      color: 'var(--text-primary)',
                      fontSize: '13px',
                    }}
                  />
                </div>
              </div>

              {/* Time Pickers if not All Day */}
              {!blockIsAllDay && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12.5px', color: 'var(--text-primary)', marginBottom: '6px' }}>
                      Start Time
                    </label>
                    <input
                      type="time"
                      value={blockStartTime}
                      onChange={(e) => {
                        setBlockStartTime(e.target.value);
                        setBlockConflicts([]);
                      }}
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        backgroundColor: 'var(--bg-surface-secondary)',
                        border: '1px solid var(--border-card)',
                        borderRadius: '8px',
                        color: 'var(--text-primary)',
                        fontSize: '13px',
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '12.5px', color: 'var(--text-primary)', marginBottom: '6px' }}>
                      End Time
                    </label>
                    <input
                      type="time"
                      value={blockEndTime}
                      onChange={(e) => {
                        setBlockEndTime(e.target.value);
                        setBlockConflicts([]);
                      }}
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        backgroundColor: 'var(--bg-surface-secondary)',
                        border: '1px solid var(--border-card)',
                        borderRadius: '8px',
                        color: 'var(--text-primary)',
                        fontSize: '13px',
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Conflict Warning Box */}
              {blockConflicts.length > 0 && (
                <div
                  style={{
                    backgroundColor: 'rgba(245, 158, 11, 0.08)',
                    border: '1px solid rgba(245, 158, 11, 0.35)',
                    borderRadius: '10px',
                    padding: '14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--warning)', fontWeight: 700, fontSize: '13px' }}>
                    <AlertTriangle size={18} />
                    <span>Warning: {blockConflicts.length} Existing Appointment(s) Conflict with this Closure</span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                    The following confirmed or pending bookings overlap with this time window. Existing appointments will <strong>NOT</strong> be automatically cancelled or deleted:
                  </div>

                  <div
                    style={{
                      maxHeight: '130px',
                      overflowY: 'auto',
                      backgroundColor: 'rgba(0, 0, 0, 0.3)',
                      borderRadius: '6px',
                      padding: '8px',
                      fontSize: '12px',
                    }}
                  >
                    {blockConflicts.map((c) => (
                      <div
                        key={c.id}
                        style={{
                          padding: '4px 0',
                          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                          color: 'var(--text-primary)',
                        }}
                      >
                        <strong>{c.patientName}</strong> with {c.dentistName} •{' '}
                        {formatTime(c.startsAt)} ({c.status})
                      </div>
                    ))}
                  </div>

                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      color: 'var(--warning)',
                      marginTop: '4px',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={conflictAcknowledged}
                      onChange={(e) => setConflictAcknowledged(e.target.checked)}
                      style={{ accentColor: '#f59e0b', width: '15px', height: '15px' }}
                    />
                    I acknowledge these bookings and confirm applying this closure (new bookings will be blocked).
                  </label>
                </div>
              )}

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={handleCloseBlockModal}
                  disabled={savingBlock}
                  style={{
                    padding: '9px 16px',
                    backgroundColor: 'var(--bg-surface-secondary)',
                    border: '1px solid var(--border-card)',
                    borderRadius: '8px',
                    color: 'var(--text-secondary)',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: savingBlock ? 'wait' : 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingBlock || (blockConflicts.length > 0 && !conflictAcknowledged)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '9px 20px',
                    backgroundColor:
                      blockConflicts.length > 0 && !conflictAcknowledged
                        ? '#475569'
                        : '#06b6d4',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#ffffff',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor:
                      savingBlock || (blockConflicts.length > 0 && !conflictAcknowledged)
                        ? 'not-allowed'
                        : 'pointer',
                  }}
                >
                  {savingBlock
                    ? 'Saving...'
                    : blockConflicts.length > 0
                    ? 'Confirm & Save Closure'
                    : isEditingBlock
                    ? 'Update Closure'
                    : 'Save Closure'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Dentist Add / Edit Modal */}
      {isDoctorModalOpen && createPortal(
        <div
          className="modal-overlay"
          onClick={() => setIsDoctorModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="doctor-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'var(--bg-modal-overlay)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px',
          }}
        >
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-card)',
              borderRadius: 'var(--radius-lg)',
              padding: '24px',
              width: '100%',
              maxWidth: '480px',
              boxShadow: 'var(--shadow-modal)',
              color: 'var(--text-primary)',
              position: 'relative',
              zIndex: 1001,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div>
                <h3 id="doctor-modal-title" style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                  {isEditingDoctor ? 'Edit Dentist Profile' : 'Add New Clinic Dentist'}
                </h3>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Manage practitioner qualifications, clinical specialty, and booking parameters.
                </p>
              </div>
              <button
                onClick={() => setIsDoctorModalOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveDoctor} style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxHeight: '75vh', overflowY: 'auto', paddingRight: '4px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '5px' }}>
                    Title
                  </label>
                  <select
                    value={doctorTitle}
                    onChange={(e) => setDoctorTitle(e.target.value)}
                    style={{
                      width: '100%',
                      backgroundColor: 'var(--bg-surface-secondary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      padding: '8px 10px',
                      color: 'var(--text-primary)',
                      fontSize: '13px',
                    }}
                  >
                    <option value="Dr.">Dr.</option>
                    <option value="Prof.">Prof.</option>
                    <option value="Assoc. Prof.">Assoc. Prof.</option>
                    <option value="DDS">DDS</option>
                    <option value="BDS">BDS</option>
                    <option value="">None</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '5px' }}>
                    Full / Display Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Sarah Jenkins"
                    value={doctorDisplayName}
                    onChange={(e) => setDoctorDisplayName(e.target.value)}
                    style={{
                      width: '100%',
                      backgroundColor: 'var(--bg-surface-secondary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      color: 'var(--text-primary)',
                      fontSize: '13px',
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '5px' }}>
                    Clinical Specialty
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Orthodontics, General"
                    value={doctorSpecialty}
                    onChange={(e) => setDoctorSpecialty(e.target.value)}
                    style={{
                      width: '100%',
                      backgroundColor: 'var(--bg-surface-secondary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      color: 'var(--text-primary)',
                      fontSize: '13px',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '5px' }}>
                    Degrees / Qualifications
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. BDS, MDS, FICOI"
                    value={doctorQualifications}
                    onChange={(e) => setDoctorQualifications(e.target.value)}
                    style={{
                      width: '100%',
                      backgroundColor: 'var(--bg-surface-secondary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      color: 'var(--text-primary)',
                      fontSize: '13px',
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '5px' }}>
                    Experience (Years)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={70}
                    placeholder="e.g. 8"
                    value={doctorExperienceYears}
                    onChange={(e) => setDoctorExperienceYears(e.target.value === '' ? '' : Number(e.target.value))}
                    style={{
                      width: '100%',
                      backgroundColor: 'var(--bg-surface-secondary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      color: 'var(--text-primary)',
                      fontSize: '13px',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '5px' }}>
                    License / Registration No.
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. DC-98421-B"
                    value={doctorLicenseNumber}
                    onChange={(e) => setDoctorLicenseNumber(e.target.value)}
                    style={{
                      width: '100%',
                      backgroundColor: 'var(--bg-surface-secondary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      color: 'var(--text-primary)',
                      fontSize: '13px',
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '5px' }}>
                  Professional Biography & Background
                </label>
                <textarea
                  rows={3}
                  placeholder="Clinical background, specialist areas, and patient approach..."
                  value={doctorBio}
                  onChange={(e) => setDoctorBio(e.target.value)}
                  style={{
                    width: '100%',
                    backgroundColor: 'var(--bg-surface-secondary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                    resize: 'vertical',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '5px' }}>
                  Default Buffer Time Between Appointments (Minutes)
                </label>
                <input
                  type="number"
                  min={0}
                  max={60}
                  step={5}
                  value={doctorBufferMinutes}
                  onChange={(e) => setDoctorBufferMinutes(Number(e.target.value))}
                  style={{
                    width: '100%',
                    backgroundColor: 'var(--bg-surface-secondary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                  }}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px', display: 'block' }}>
                  Sanitization buffer automatically reserved between patient procedures.
                </span>
              </div>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  color: 'var(--text-primary)',
                }}
              >
                <input
                  type="checkbox"
                  checked={doctorActive}
                  onChange={(e) => setDoctorActive(e.target.checked)}
                  style={{ accentColor: 'var(--accent-primary)', width: '16px', height: '16px' }}
                />
                Active & Accepting Patient Bookings
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setIsDoctorModalOpen(false)}
                  disabled={savingDoctor}
                  style={{
                    padding: '9px 16px',
                    backgroundColor: 'var(--bg-surface-secondary)',
                    border: '1px solid var(--border-card)',
                    borderRadius: '8px',
                    color: 'var(--text-secondary)',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: savingDoctor ? 'wait' : 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingDoctor}
                  style={{
                    padding: '9px 20px',
                    backgroundColor: 'var(--accent-primary)',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#ffffff',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: savingDoctor ? 'wait' : 'pointer',
                  }}
                >
                  {savingDoctor ? 'Saving...' : isEditingDoctor ? 'Save Changes' : 'Create Dentist'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Dentist Individual Schedule & Breaks Modal */}
      {isDoctorScheduleModalOpen && selectedDoctor && createPortal(
        <div
          className="modal-overlay"
          onClick={() => setIsDoctorScheduleModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="doctor-schedule-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'var(--bg-modal-overlay)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px',
          }}
        >
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-card)',
              borderRadius: 'var(--radius-lg)',
              padding: '24px',
              width: '100%',
              maxWidth: '680px',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: 'var(--shadow-modal)',
              color: 'var(--text-primary)',
              position: 'relative',
              zIndex: 1001,
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexShrink: 0 }}>
              <div>
                <h3 id="doctor-schedule-modal-title" style={{ fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                  Practitioner Schedule & Availability
                </h3>
                <div style={{ fontSize: '13px', color: 'var(--accent-text)', marginTop: '3px' }}>
                  {selectedDoctor.displayName} • {selectedDoctor.specialty}
                </div>
              </div>
              <button
                onClick={() => setIsDoctorScheduleModalOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '12px', marginBottom: '16px', flexShrink: 0 }}>
              <button
                onClick={() => setDoctorTab('hours')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 14px',
                  backgroundColor: doctorTab === 'hours' ? 'var(--accent-subtle)' : 'transparent',
                  border: doctorTab === 'hours' ? '1px solid rgba(6, 182, 212, 0.4)' : '1px solid transparent',
                  borderRadius: '6px',
                  color: doctorTab === 'hours' ? '#38bdf8' : '#94a3b8',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <Clock size={14} />
                Weekly Working Hours
              </button>
              <button
                onClick={() => setDoctorTab('breaks')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 14px',
                  backgroundColor: doctorTab === 'breaks' ? 'var(--accent-subtle)' : 'transparent',
                  border: doctorTab === 'breaks' ? '1px solid rgba(6, 182, 212, 0.4)' : '1px solid transparent',
                  borderRadius: '6px',
                  color: doctorTab === 'breaks' ? '#38bdf8' : '#94a3b8',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <CalendarOff size={14} />
                Breaks & Off-Time ({doctorBlocks.length})
              </button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingRight: '4px' }}>
              {loadingDoctorSchedule ? (
                <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  Loading practitioner availability from PostgreSQL...
                </div>
              ) : doctorTab === 'hours' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', margin: '0 0 4px 0' }}>
                    Configure individual working days and shift hours. When unconfigured, clinic standard business hours apply.
                  </p>

                  {doctorWeeklyHours.map((d, index) => (
                    <div
                      key={d.dayOfWeek}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        backgroundColor: d.isWorking ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.25)',
                        border: `1px solid ${d.isWorking ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.03)'}`,
                        borderRadius: '8px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: '130px' }}>
                        <input
                          type="checkbox"
                          checked={d.isWorking}
                          onChange={() => handleDoctorDayToggle(index)}
                          style={{ accentColor: 'var(--accent-primary)', width: '16px', height: '16px', cursor: 'pointer' }}
                        />
                        <span style={{ fontWeight: 600, color: d.isWorking ? '#f8fafc' : '#64748b', fontSize: '13.5px' }}>
                          {d.name}
                        </span>
                      </div>

                      {d.isWorking ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input
                            type="time"
                            value={d.startsAt}
                            onChange={(e) => handleDoctorTimeChange(index, 'startsAt', e.target.value)}
                            style={{
                              backgroundColor: 'var(--bg-surface-secondary)',
                              border: '1px solid var(--border-subtle)',
                              borderRadius: '6px',
                              padding: '5px 8px',
                              color: 'var(--text-primary)',
                              fontSize: '13px',
                            }}
                          />
                          <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>to</span>
                          <input
                            type="time"
                            value={d.endsAt}
                            onChange={(e) => handleDoctorTimeChange(index, 'endsAt', e.target.value)}
                            style={{
                              backgroundColor: 'var(--bg-surface-secondary)',
                              border: '1px solid var(--border-subtle)',
                              borderRadius: '6px',
                              padding: '5px 8px',
                              color: 'var(--text-primary)',
                              fontSize: '13px',
                            }}
                          />
                        </div>
                      ) : (
                        <span style={{ fontSize: '12px', color: 'var(--danger)', fontWeight: 600, backgroundColor: 'var(--danger-subtle)', padding: '2px 8px', borderRadius: '4px' }}>
                          Off Duty
                        </span>
                      )}
                    </div>
                  ))}

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
                    <button
                      onClick={handleSaveDoctorWeeklyHours}
                      disabled={savingDoctorHours}
                      style={{
                        padding: '9px 20px',
                        backgroundColor: 'var(--accent-primary)',
                        border: 'none',
                        borderRadius: '8px',
                        color: '#ffffff',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: savingDoctorHours ? 'wait' : 'pointer',
                      }}
                    >
                      {savingDoctorHours ? 'Saving...' : 'Save Working Schedule'}
                    </button>
                  </div>
                </div>
              ) : (
                /* Tab 2: Breaks & Off-Time */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Add Break / Leave Form */}
                  <form
                    onSubmit={handleCreateDoctorBreak}
                    style={{
                      backgroundColor: 'var(--bg-surface-secondary)',
                      border: '1px solid var(--border-card)',
                      borderRadius: '10px',
                      padding: '16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px',
                    }}
                  >
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '13.5px' }}>
                      Add Lunch Break, Tea Break, or Leave for {selectedDoctor.displayName}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '10px' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Type</label>
                        <select
                          value={docBreakKind}
                          onChange={(e: any) => setDocBreakKind(e.target.value)}
                          style={{
                            width: '100%',
                            backgroundColor: 'var(--bg-surface-secondary)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '6px',
                            padding: '7px 8px',
                            color: 'var(--text-primary)',
                            fontSize: '12.5px',
                          }}
                        >
                          <option value="break">Break</option>
                          <option value="leave">Leave / Off</option>
                        </select>
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Reason / Title</label>
                        <input
                          type="text"
                          required
                          value={docBreakReason}
                          onChange={(e) => setDocBreakReason(e.target.value)}
                          placeholder="e.g. Lunch Break, Afternoon Tea, Personal Leave"
                          style={{
                            width: '100%',
                            backgroundColor: 'var(--bg-surface-secondary)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '6px',
                            padding: '7px 10px',
                            color: 'var(--text-primary)',
                            fontSize: '12.5px',
                          }}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Date</label>
                        <input
                          type="date"
                          required
                          value={docBreakDate}
                          onChange={(e) => setDocBreakDate(e.target.value)}
                          style={{
                            width: '100%',
                            backgroundColor: 'var(--bg-surface-secondary)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '6px',
                            padding: '6px 8px',
                            color: 'var(--text-primary)',
                            fontSize: '12.5px',
                          }}
                        />
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Start Time</label>
                        <input
                          type="time"
                          required
                          value={docBreakStartTime}
                          onChange={(e) => setDocBreakStartTime(e.target.value)}
                          style={{
                            width: '100%',
                            backgroundColor: 'var(--bg-surface-secondary)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '6px',
                            padding: '6px 8px',
                            color: 'var(--text-primary)',
                            fontSize: '12.5px',
                          }}
                        />
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '4px' }}>End Time</label>
                        <input
                          type="time"
                          required
                          value={docBreakEndTime}
                          onChange={(e) => setDocBreakEndTime(e.target.value)}
                          style={{
                            width: '100%',
                            backgroundColor: 'var(--bg-surface-secondary)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '6px',
                            padding: '6px 8px',
                            color: 'var(--text-primary)',
                            fontSize: '12.5px',
                          }}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
                      <button
                        type="submit"
                        disabled={savingDocBreak}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '8px 16px',
                          backgroundColor: 'var(--accent-primary)',
                          border: 'none',
                          borderRadius: '6px',
                          color: '#ffffff',
                          fontSize: '12.5px',
                          fontWeight: 600,
                          cursor: savingDocBreak ? 'wait' : 'pointer',
                        }}
                      >
                        <Plus size={14} />
                        {savingDocBreak ? 'Saving Break...' : 'Add Practitioner Break / Leave'}
                      </button>
                    </div>
                  </form>

                  {/* List of Doctor Blocks */}
                  <div>
                    <h4 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
                      Current Breaks & Leave ({doctorBlocks.length})
                    </h4>
                    {doctorBlocks.length === 0 ? (
                      <div style={{ color: 'var(--text-secondary)', fontSize: '12.5px', fontStyle: 'italic', padding: '12px 0' }}>
                        No breaks or leave currently scheduled for {selectedDoctor.displayName}.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {doctorBlocks.map((blk) => (
                          <div
                            key={blk.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '10px 14px',
                              backgroundColor: 'var(--bg-surface-secondary)',
                              border: '1px solid rgba(255, 255, 255, 0.07)',
                              borderRadius: '8px',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <span
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  color: blk.kind === 'break' ? '#f59e0b' : '#a855f7',
                                  backgroundColor: blk.kind === 'break' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(168, 85, 247, 0.1)',
                                  padding: '2px 7px',
                                  borderRadius: '4px',
                                  textTransform: 'uppercase',
                                }}
                              >
                                {blk.kind}
                              </span>
                              <div>
                                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                                  {blk.reason}
                                </div>
                                <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                                  {formatDate(blk.startsAt, { month: 'short', day: 'numeric', year: 'numeric' })} •{' '}
                                  {formatTime(blk.startsAt)} - {formatTime(blk.endsAt)}
                                </div>
                              </div>
                            </div>

                            <button
                              onClick={() => handleDeleteDoctorBreak(blk.id)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--danger)',
                                cursor: 'pointer',
                                padding: '6px',
                                borderRadius: '4px',
                              }}
                              title="Delete Break"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
