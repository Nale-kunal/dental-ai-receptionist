import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import { useClinic } from '../context/ClinicContext';
import {
  Users,
  Search,
  Plus,
  Phone,
  Mail,
  Calendar,
  ChevronLeft,
  ChevronRight,
  User,
  MessageSquare,
  FileText,
  Edit2,
  X,
  Archive,
  RotateCcw,
  AlertTriangle,
  ArrowLeft,
} from 'lucide-react';

interface PatientsViewProps {
  onOpenBookingModal: (patientId?: string) => void;
}

export const PatientsView: React.FC<PatientsViewProps> = ({ onOpenBookingModal }) => {
  const toast = useToast();
  const { formatDate, formatTime } = useClinic();

  // Active Directory State
  const [loading, setLoading] = useState(true);
  const [patients, setPatients] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');

  // Archived Directory State
  const [isArchivedView, setIsArchivedView] = useState(false);
  const [archivedCount, setArchivedCount] = useState(0);
  const [loadingArchived, setLoadingArchived] = useState(false);
  const [archivedPatients, setArchivedPatients] = useState<any[]>([]);
  const [archivedTotal, setArchivedTotal] = useState(0);
  const [archivedPage, setArchivedPage] = useState(1);
  const [archivedTotalPages, setArchivedTotalPages] = useState(1);
  const [archivedSearch, setArchivedSearch] = useState('');

  // Selected Patient Details Drawer
  const [selectedPatient, setSelectedPatient] = useState<any | null>(null);
  const [patientAppointments, setPatientAppointments] = useState<any[]>([]);
  const [loadingAppts, setLoadingAppts] = useState(false);

  // New Patient Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newDob, setNewDob] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [creating, setCreating] = useState(false);

  // Edit Patient Modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editDob, setEditDob] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [updating, setUpdating] = useState(false);

  // Archive Confirmation Modal
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [patientToArchive, setPatientToArchive] = useState<any | null>(null);
  const [archiveReason, setArchiveReason] = useState('');
  const [archiving, setArchiving] = useState(false);
  const [checkingAppointments, setCheckingAppointments] = useState(false);
  const [upcomingAppointmentsForArchive, setUpcomingAppointmentsForArchive] = useState<any[]>([]);

  // Restore Confirmation Modal
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [patientToRestore, setPatientToRestore] = useState<any | null>(null);
  const [restoring, setRestoring] = useState(false);

  // Prevent background scrolling and handle Escape key for patient overlays
  const isAnyPatientOverlayOpen = Boolean(
    selectedPatient || showCreateModal || showEditModal || showArchiveModal || showRestoreModal
  );

  useEffect(() => {
    if (!isAnyPatientOverlayOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showArchiveModal && !archiving) {
          setShowArchiveModal(false);
        } else if (showRestoreModal && !restoring) {
          setShowRestoreModal(false);
        } else if (showEditModal && !updating) {
          setShowEditModal(false);
        } else if (showCreateModal && !creating) {
          setShowCreateModal(false);
        } else if (selectedPatient) {
          setSelectedPatient(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    isAnyPatientOverlayOpen,
    showArchiveModal,
    showRestoreModal,
    showEditModal,
    showCreateModal,
    selectedPatient,
    archiving,
    restoring,
    updating,
    creating,
  ]);

  const fetchArchivedCount = async () => {
    try {
      const res = await api.getArchivedPatientsCount();
      setArchivedCount(res.count || 0);
    } catch (err) {
      console.error('Failed to fetch archived patient count', err);
    }
  };

  const fetchPatients = async () => {
    try {
      setLoading(true);
      const res = await api.getPatients({
        page,
        pageSize: 15,
        search: search.trim() || undefined,
      });
      setPatients(res.items || []);
      setTotal(res.total || 0);
      setTotalPages(res.totalPages || 1);
    } catch (err: any) {
      toast.error('Fetch Failed', err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchArchivedPatients = async () => {
    try {
      setLoadingArchived(true);
      const res = await api.getArchivedPatients({
        page: archivedPage,
        pageSize: 15,
        search: archivedSearch.trim() || undefined,
      });
      setArchivedPatients(res.items || []);
      setArchivedTotal(res.total || 0);
      setArchivedTotalPages(res.totalPages || 1);
    } catch (err: any) {
      toast.error('Fetch Failed', err.message);
    } finally {
      setLoadingArchived(false);
    }
  };

  useEffect(() => {
    fetchPatients();
    fetchArchivedCount();
  }, [page]);

  useEffect(() => {
    if (isArchivedView) {
      fetchArchivedPatients();
    }
  }, [isArchivedView, archivedPage]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchPatients();
  };

  const handleArchivedSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setArchivedPage(1);
    fetchArchivedPatients();
  };

  const handleSelectPatient = async (patient: any) => {
    setSelectedPatient(patient);
    setLoadingAppts(true);
    try {
      const appts = await api.getPatientAppointments(patient.id);
      setPatientAppointments(appts || []);
    } catch (err: any) {
      toast.error('Error loading history', err.message);
    } finally {
      setLoadingAppts(false);
    }
  };

  const handleOpenEditPatient = () => {
    if (!selectedPatient) return;
    setEditName(selectedPatient.fullName || `${selectedPatient.firstName || ''} ${selectedPatient.lastName || ''}`.trim());
    setEditPhone(selectedPatient.phone || '');
    setEditEmail(selectedPatient.email || '');
    setEditDob(selectedPatient.dateOfBirth || '');
    setEditNotes(selectedPatient.notes || '');
    setShowEditModal(true);
  };

  const handleUpdatePatient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) return;
    if (!editName.trim() || !editPhone.trim()) {
      toast.error('Validation Error', 'Full Name and Phone Number are required.');
      return;
    }
    try {
      setUpdating(true);
      const updated = await api.updatePatient(selectedPatient.id, {
        fullName: editName.trim(),
        phone: editPhone.trim(),
        email: editEmail.trim() || undefined,
        dateOfBirth: editDob || undefined,
        notes: editNotes.trim() || undefined,
      });
      toast.success('Patient Updated', `${updated.fullName || editName} updated successfully.`);
      setSelectedPatient(updated);
      setPatients((prev) => prev.map((p) => (p.id === selectedPatient.id ? { ...p, ...updated } : p)));
      setArchivedPatients((prev) => prev.map((p) => (p.id === selectedPatient.id ? { ...p, ...updated } : p)));
      setShowEditModal(false);
    } catch (err: any) {
      toast.error('Update Failed', err.message);
    } finally {
      setUpdating(false);
    }
  };

  const handleCreatePatient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newPhone.trim()) {
      toast.error('Validation Error', 'Name and Phone Number are required.');
      return;
    }
    try {
      setCreating(true);
      const res = await api.createPatient({
        fullName: newName.trim(),
        phone: newPhone.trim(),
        email: newEmail.trim() || undefined,
        dateOfBirth: newDob || undefined,
        notes: newNotes.trim() || undefined,
      });
      toast.success('Patient Registered', `${res.fullName} added successfully.`);
      setShowCreateModal(false);
      setNewName('');
      setNewPhone('');
      setNewEmail('');
      setNewDob('');
      setNewNotes('');
      fetchPatients();
      fetchArchivedCount();
    } catch (err: any) {
      toast.error('Registration Failed', err.message);
    } finally {
      setCreating(false);
    }
  };

  // Archive flow
  const handleOpenArchiveModal = async (patient: any) => {
    setPatientToArchive(patient);
    setArchiveReason('');
    setUpcomingAppointmentsForArchive([]);
    setCheckingAppointments(true);
    setShowArchiveModal(true);

    try {
      const appts = await api.getPatientAppointments(patient.id);
      const now = Date.now();
      const upcoming = (appts || []).filter((a: any) => {
        const st = (a.status || '').toLowerCase();
        const isPendingOrConfirmed = st === 'pending' || st === 'confirmed';
        const isUpcoming = new Date(a.startsAt).getTime() >= now;
        return isPendingOrConfirmed && isUpcoming;
      });
      setUpcomingAppointmentsForArchive(upcoming);
    } catch (err) {
      console.error('Failed to check patient appointments for archive', err);
    } finally {
      setCheckingAppointments(false);
    }
  };

  const handleConfirmArchive = async () => {
    if (!patientToArchive) return;
    try {
      setArchiving(true);
      const updated = await api.archivePatient(patientToArchive.id, archiveReason.trim() || undefined);
      toast.success('Patient Archived', `${patientToArchive.fullName} has been moved to the archived directory.`);
      setShowArchiveModal(false);

      if (selectedPatient?.id === patientToArchive.id) {
        setSelectedPatient({
          ...selectedPatient,
          ...updated,
          isArchived: true,
          archivedAt: updated.archivedAt || new Date().toISOString(),
          archiveReason: archiveReason.trim() || null,
        });
      }

      fetchPatients();
      fetchArchivedCount();
      if (isArchivedView) {
        fetchArchivedPatients();
      }
    } catch (err: any) {
      toast.error('Archive Failed', err.message);
    } finally {
      setArchiving(false);
    }
  };

  // Restore flow
  const handleOpenRestoreModal = (patient: any) => {
    setPatientToRestore(patient);
    setShowRestoreModal(true);
  };

  const handleConfirmRestore = async () => {
    if (!patientToRestore) return;
    try {
      setRestoring(true);
      const updated = await api.restorePatient(patientToRestore.id);
      toast.success('Patient Restored', `${patientToRestore.fullName} has been restored to the active directory.`);
      setShowRestoreModal(false);

      if (selectedPatient?.id === patientToRestore.id) {
        setSelectedPatient({
          ...selectedPatient,
          ...updated,
          isArchived: false,
          restoredAt: updated.restoredAt || new Date().toISOString(),
        });
      }

      fetchPatients();
      fetchArchivedCount();
      if (isArchivedView) {
        fetchArchivedPatients();
      }
    } catch (err: any) {
      toast.error('Restore Failed', err.message);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }} className="animate-fade-in">
      {/* Top Search & Actions Bar */}
      <div
        className="card"
        style={{
          padding: '10px 14px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '10px',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '280px', flexWrap: 'wrap' }}>
          <form
            onSubmit={isArchivedView ? handleArchivedSearchSubmit : handleSearchSubmit}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '240px', maxWidth: '420px' }}
          >
            <div style={{ position: 'relative', width: '100%' }}>
              <Search
                size={14}
                color="var(--text-muted)"
                style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }}
              />
              <input
                type="text"
                placeholder={isArchivedView ? 'Search archived patients...' : 'Search patients by name, phone, email...'}
                value={isArchivedView ? archivedSearch : search}
                onChange={(e) => (isArchivedView ? setArchivedSearch(e.target.value) : setSearch(e.target.value))}
                className="form-input"
                style={{ paddingLeft: '32px', height: '32px', fontSize: '12.5px' }}
              />
            </div>
            <button
              type="submit"
              className="btn btn-secondary btn-sm"
              style={{ height: '32px' }}
            >
              Search
            </button>
          </form>

          {/* Archived Patients Toggle Button beside Search */}
          {!isArchivedView ? (
            <button
              type="button"
              onClick={() => {
                setIsArchivedView(true);
                setArchivedPage(1);
              }}
              className="btn btn-secondary btn-sm"
              style={{
                height: '32px',
                gap: '6px',
                fontSize: '12px',
                color: 'var(--text-secondary)',
              }}
            >
              <Archive size={13} />
              <span>Archived Patients</span>
              <span
                style={{
                  fontSize: '10.5px',
                  fontWeight: 600,
                  backgroundColor: 'var(--bg-surface-secondary)',
                  border: '1px solid var(--border-subtle)',
                  padding: '1px 6px',
                  borderRadius: '10px',
                  color: 'var(--text-primary)',
                }}
              >
                {archivedCount}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setIsArchivedView(false);
                setPage(1);
              }}
              className="btn btn-secondary btn-sm"
              style={{
                height: '32px',
                gap: '6px',
                fontSize: '12px',
                color: 'var(--accent-text)',
                backgroundColor: 'var(--accent-subtle)',
              }}
            >
              <ArrowLeft size={13} />
              <span>← Return to Patient Directory</span>
            </button>
          )}
        </div>

        {!isArchivedView && (
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="btn btn-primary"
            style={{ height: '32px', padding: '0 12px', fontSize: '12.5px', gap: '6px' }}
          >
            <Plus size={14} /> Add Patient
          </button>
        )}
      </div>

      {/* Dedicated Archived Banner when in Archive View */}
      {isArchivedView && (
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                backgroundColor: 'var(--bg-surface-secondary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-secondary)',
              }}
            >
              <Archive size={16} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  Archived Patients
                </h3>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: '10px',
                    backgroundColor: 'var(--bg-surface-secondary)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {archivedTotal} Record{archivedTotal === 1 ? '' : 's'}
                </span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                Inactive patient records are excluded from active directory searches and appointment booking pathways.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsArchivedView(false)}
            className="btn btn-secondary btn-sm"
            style={{ height: '30px', fontSize: '12px', gap: '5px' }}
          >
            <ArrowLeft size={13} />
            <span>Return to Patient Directory</span>
          </button>
        </div>
      )}

      {/* Active Patients Directory Table */}
      {!isArchivedView && (
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
                  <th style={{ padding: '9px 14px' }}>Patient Name</th>
                  <th style={{ padding: '9px 14px' }}>Phone / WhatsApp</th>
                  <th style={{ padding: '9px 14px' }}>Email Address</th>
                  <th style={{ padding: '9px 14px' }}>Date of Birth</th>
                  <th style={{ padding: '9px 14px' }}>WhatsApp Consent</th>
                  <th style={{ padding: '9px 14px', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      Loading patient directory from database...
                    </td>
                  </tr>
                ) : patients.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      No patients match your search.
                    </td>
                  </tr>
                ) : (
                  patients.map((p) => (
                    <tr
                      key={p.id}
                      onClick={() => handleSelectPatient(p)}
                      style={{
                        borderBottom: '1px solid var(--border-subtle)',
                        cursor: 'pointer',
                        transition: 'background-color var(--transition-fast)',
                      }}
                    >
                      <td style={{ padding: '9px 14px' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.fullName}</div>
                        {p.notes && (
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.notes}
                          </div>
                        )}
                      </td>

                      <td style={{ padding: '9px 14px', color: 'var(--text-primary)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Phone size={12} color="var(--text-muted)" />
                          <span>{p.phone}</span>
                        </div>
                      </td>

                      <td style={{ padding: '9px 14px', color: 'var(--text-secondary)' }}>
                        {p.email ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Mail size={12} color="var(--text-muted)" />
                            <span>{p.email}</span>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>—</span>
                        )}
                      </td>

                      <td style={{ padding: '9px 14px', color: 'var(--text-secondary)' }}>
                        {p.dateOfBirth ? formatDate(p.dateOfBirth) : '—'}
                      </td>

                      <td style={{ padding: '9px 14px' }}>
                        {p.consentWhatsapp ? (
                          <span className="badge badge-confirmed">
                            <span className="badge-dot" />Opted In
                          </span>
                        ) : (
                          <span className="badge badge-neutral">
                            <span className="badge-dot" />Standard
                          </span>
                        )}
                      </td>

                      <td style={{ padding: '9px 14px', textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectPatient(p);
                          }}
                          className="btn btn-secondary btn-sm"
                          style={{ height: '28px', fontSize: '11.5px', padding: '0 9px' }}
                        >
                          Profile & Bookings →
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Active Pagination */}
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
              Showing {patients.length} of <strong style={{ color: 'var(--text-primary)' }}>{total}</strong> patients
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
      )}

      {/* Dedicated Archived Patients Table */}
      {isArchivedView && (
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
                  <th style={{ padding: '9px 14px' }}>Patient Name</th>
                  <th style={{ padding: '9px 14px' }}>Phone / WhatsApp</th>
                  <th style={{ padding: '9px 14px' }}>Email Address</th>
                  <th style={{ padding: '9px 14px' }}>Date of Birth</th>
                  <th style={{ padding: '9px 14px' }}>Archived Date</th>
                  <th style={{ padding: '9px 14px' }}>Archive Reason</th>
                  <th style={{ padding: '9px 14px', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {loadingArchived ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      Loading archived records...
                    </td>
                  </tr>
                ) : archivedPatients.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '36px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                        <Archive size={22} color="var(--text-muted)" />
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '13.5px' }}>
                          No archived patients found.
                        </span>
                        <span style={{ fontSize: '12px' }}>
                          {archivedSearch ? 'No archived records match your search criteria.' : 'The archive is currently empty.'}
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  archivedPatients.map((p) => (
                    <tr
                      key={p.id}
                      onClick={() => handleSelectPatient(p)}
                      style={{
                        borderBottom: '1px solid var(--border-subtle)',
                        cursor: 'pointer',
                        transition: 'background-color var(--transition-fast)',
                      }}
                    >
                      <td style={{ padding: '9px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.fullName}</span>
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 600,
                              color: 'var(--danger)',
                              backgroundColor: 'var(--danger-subtle)',
                              padding: '1px 5px',
                              borderRadius: '4px',
                            }}
                          >
                            Archived
                          </span>
                        </div>
                        {p.notes && (
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.notes}
                          </div>
                        )}
                      </td>

                      <td style={{ padding: '9px 14px', color: 'var(--text-primary)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Phone size={12} color="var(--text-muted)" />
                          <span>{p.phone}</span>
                        </div>
                      </td>

                      <td style={{ padding: '9px 14px', color: 'var(--text-secondary)' }}>
                        {p.email ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Mail size={12} color="var(--text-muted)" />
                            <span>{p.email}</span>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>—</span>
                        )}
                      </td>

                      <td style={{ padding: '9px 14px', color: 'var(--text-secondary)' }}>
                        {p.dateOfBirth ? formatDate(p.dateOfBirth) : '—'}
                      </td>

                      <td style={{ padding: '9px 14px', color: 'var(--text-secondary)', fontSize: '12px' }}>
                        {p.archivedAt ? formatDate(p.archivedAt) : '—'}
                      </td>

                      <td style={{ padding: '9px 14px', color: p.archiveReason ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: '12px', fontStyle: p.archiveReason ? 'normal' : 'italic' }}>
                        {p.archiveReason || 'None specified'}
                      </td>

                      <td style={{ padding: '9px 14px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectPatient(p);
                            }}
                            className="btn btn-secondary btn-sm"
                            style={{ height: '28px', fontSize: '11.5px', padding: '0 8px' }}
                          >
                            View Profile
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenRestoreModal(p);
                            }}
                            className="btn btn-secondary btn-sm"
                            style={{
                              height: '28px',
                              fontSize: '11.5px',
                              padding: '0 8px',
                              gap: '4px',
                              color: 'var(--success)',
                              borderColor: 'rgba(46, 125, 50, 0.3)',
                            }}
                          >
                            <RotateCcw size={12} />
                            <span>Restore Patient</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Archived Pagination */}
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
              Showing {archivedPatients.length} of <strong style={{ color: 'var(--text-primary)' }}>{archivedTotal}</strong> archived records
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setArchivedPage((p) => Math.max(1, p - 1))}
                disabled={archivedPage <= 1}
                className="btn btn-secondary btn-sm"
                style={{
                  height: '28px',
                  padding: '0 8px',
                  fontSize: '11.5px',
                  opacity: archivedPage <= 1 ? 0.4 : 1,
                  cursor: archivedPage <= 1 ? 'not-allowed' : 'pointer',
                }}
              >
                <ChevronLeft size={13} /> Prev
              </button>
              <span style={{ fontSize: '11.5px', fontWeight: 500, color: 'var(--text-primary)' }}>
                Page {archivedPage} of {archivedTotalPages}
              </span>
              <button
                type="button"
                onClick={() => setArchivedPage((p) => Math.min(archivedTotalPages, p + 1))}
                disabled={archivedPage >= archivedTotalPages}
                className="btn btn-secondary btn-sm"
                style={{
                  height: '28px',
                  padding: '0 8px',
                  fontSize: '11.5px',
                  opacity: archivedPage >= archivedTotalPages ? 0.4 : 1,
                  cursor: archivedPage >= archivedTotalPages ? 'not-allowed' : 'pointer',
                }}
              >
                Next <ChevronRight size={13} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Patient Profile Drawer */}
      {selectedPatient && createPortal(
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="patient-drawer-title"
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
          onClick={() => setSelectedPatient(null)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '480px',
              backgroundColor: 'var(--bg-surface)',
              height: '100%',
              borderLeft: '1px solid var(--border-card)',
              padding: '18px 20px',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: 'var(--shadow-modal)',
              color: 'var(--text-primary)',
              position: 'relative',
              zIndex: 1001,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div>
                <h3 id="patient-drawer-title" style={{ fontSize: '15.5px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  {selectedPatient.fullName}
                </h3>
                <p style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  ID: {selectedPatient.id ? selectedPatient.id.slice(0, 8) + '...' : ''}
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {!selectedPatient.isArchived ? (
                  <>
                    <button
                      type="button"
                      onClick={handleOpenEditPatient}
                      className="btn btn-secondary btn-sm"
                      style={{ gap: '5px' }}
                    >
                      <Edit2 size={13} />
                      <span>Edit Profile</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenArchiveModal(selectedPatient)}
                      className="btn btn-secondary btn-sm"
                      style={{
                        gap: '5px',
                        color: 'var(--danger)',
                        borderColor: 'rgba(198, 40, 40, 0.3)',
                      }}
                    >
                      <Archive size={13} />
                      <span>Archive Patient</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleOpenRestoreModal(selectedPatient)}
                    className="btn btn-secondary btn-sm"
                    style={{
                      gap: '5px',
                      color: 'var(--success)',
                      borderColor: 'rgba(46, 125, 50, 0.3)',
                    }}
                  >
                    <RotateCcw size={13} />
                    <span>Restore Patient</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedPatient(null)}
                  className="btn-icon"
                  aria-label="Close patient drawer"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Archived Status Warning Banner */}
            {selectedPatient.isArchived && (
              <div
                style={{
                  padding: '10px 12px',
                  backgroundColor: 'var(--danger-subtle)',
                  border: '1px solid rgba(198, 40, 40, 0.25)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--danger)',
                  fontSize: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  marginBottom: '12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                  <Archive size={14} />
                  <span>Archived Patient Profile (Read-Only)</span>
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                  Archived on {formatDate(selectedPatient.archivedAt || new Date().toISOString())}
                  {selectedPatient.archiveReason && ` — Reason: ${selectedPatient.archiveReason}`}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  New appointment bookings are disabled while archived. Restore this patient to re-enable booking.
                </div>
              </div>
            )}

            {/* Quick Contact & Details */}
            <div
              style={{
                padding: '10px 12px',
                backgroundColor: 'var(--bg-surface-secondary)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: '5px',
                marginBottom: '14px',
                fontSize: '12px',
              }}
            >
              <div style={{ color: 'var(--text-primary)' }}>
                <strong style={{ color: 'var(--text-secondary)' }}>Phone:</strong> {selectedPatient.phone}
              </div>
              <div style={{ color: 'var(--text-primary)' }}>
                <strong style={{ color: 'var(--text-secondary)' }}>Email:</strong> {selectedPatient.email || 'None on record'}
              </div>
              <div style={{ color: 'var(--text-primary)' }}>
                <strong style={{ color: 'var(--text-secondary)' }}>WhatsApp Opt-in:</strong> {selectedPatient.consentWhatsapp ? 'Yes' : 'Standard'}
              </div>
              {selectedPatient.notes && (
                <div style={{ color: 'var(--text-primary)' }}>
                  <strong style={{ color: 'var(--text-secondary)' }}>Notes:</strong> {selectedPatient.notes}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Appointment History ({patientAppointments.length})
              </h4>
              {!selectedPatient.isArchived ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPatient(null);
                    onOpenBookingModal(selectedPatient.id);
                  }}
                  className="btn btn-primary btn-sm"
                >
                  + Book For Patient
                </button>
              ) : (
                <span
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    fontStyle: 'italic',
                    backgroundColor: 'var(--bg-surface-secondary)',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  Booking Disabled (Archived)
                </span>
              )}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '7px' }}>
              {loadingAppts ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '12.5px', textAlign: 'center', marginTop: '20px' }}>
                  Loading booking history...
                </div>
              ) : patientAppointments.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '12.5px', textAlign: 'center', marginTop: '30px' }}>
                  No appointments recorded for this patient.
                </div>
              ) : (
                patientAppointments.map((appt) => (
                  <div
                    key={appt.id}
                    style={{
                      padding: '10px 12px',
                      backgroundColor: 'var(--bg-surface-secondary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '12.5px' }}>
                        {appt.service?.name || 'Dental Visit'}
                      </span>
                      <span
                        className={`badge ${
                          appt.status === 'confirmed'
                            ? 'badge-confirmed'
                            : appt.status === 'cancelled'
                            ? 'badge-cancelled'
                            : 'badge-rescheduled'
                        }`}
                      >
                        <span className="badge-dot" />
                        {appt.status}
                      </span>
                    </div>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginTop: '3px' }}>
                      With {appt.doctor?.name || appt.doctor?.displayName || 'Dentist'} on{' '}
                      {formatDate(appt.startsAt)} at {formatTime(appt.startsAt)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* New Patient Registration Modal */}
      {showCreateModal && createPortal(
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-patient-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'var(--bg-modal-overlay)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
          onClick={() => setShowCreateModal(false)}
        >
          <div
            className="modal-content"
            style={{
              width: '100%',
              maxWidth: '460px',
              boxShadow: 'var(--shadow-modal)',
              border: '1px solid var(--border-card)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              position: 'relative',
              zIndex: 1001,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: '13px 18px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: 'var(--bg-surface)',
              }}
            >
              <h3 id="create-patient-modal-title" style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Register New Patient
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="btn-icon"
                aria-label="Close dialog"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreatePatient} style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label className="form-label">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Michael Thorne"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="form-input"
                />
              </div>

              <div>
                <label className="form-label">
                  Phone Number *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. +14155552671"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="form-input"
                />
              </div>

              <div>
                <label className="form-label">
                  Email Address (Optional)
                </label>
                <input
                  type="email"
                  placeholder="m.thorne@example.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="form-input"
                />
              </div>

              <div>
                <label className="form-label">
                  Date of Birth (Optional)
                </label>
                <input
                  type="date"
                  value={newDob}
                  onChange={(e) => setNewDob(e.target.value)}
                  className="form-input"
                />
              </div>

              <div>
                <label className="form-label">
                  Medical / Administrative Notes
                </label>
                <textarea
                  rows={2}
                  placeholder="Allergies, preferences, insurance details..."
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  className="form-input"
                  style={{ resize: 'none' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="btn btn-primary"
                >
                  {creating ? 'Saving...' : 'Register Patient'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Edit Patient Modal */}
      {showEditModal && createPortal(
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-patient-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'var(--bg-modal-overlay)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
          onClick={() => setShowEditModal(false)}
        >
          <div
            className="modal-content"
            style={{
              width: '100%',
              maxWidth: '460px',
              boxShadow: 'var(--shadow-modal)',
              border: '1px solid var(--border-card)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              position: 'relative',
              zIndex: 1001,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: '13px 18px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: 'var(--bg-surface)',
              }}
            >
              <h3 id="edit-patient-modal-title" style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Edit Patient Profile
              </h3>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="btn-icon"
                aria-label="Close dialog"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleUpdatePatient} style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label className="form-label">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Michael Thorne"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="form-input"
                />
              </div>

              <div>
                <label className="form-label">
                  Phone Number *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. +14155552671"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="form-input"
                />
              </div>

              <div>
                <label className="form-label">
                  Email Address
                </label>
                <input
                  type="email"
                  placeholder="m.thorne@example.com"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="form-input"
                />
              </div>

              <div>
                <label className="form-label">
                  Date of Birth
                </label>
                <input
                  type="date"
                  value={editDob}
                  onChange={(e) => setEditDob(e.target.value)}
                  className="form-input"
                />
              </div>

              <div>
                <label className="form-label">
                  Medical / Administrative Notes
                </label>
                <textarea
                  rows={2}
                  placeholder="Allergies, preferences, insurance details..."
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="form-input"
                  style={{ resize: 'none' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updating}
                  className="btn btn-primary"
                >
                  {updating ? 'Saving Changes...' : 'Save Profile Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Archive Confirmation Modal */}
      {showArchiveModal && patientToArchive && createPortal(
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="archive-patient-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'var(--bg-modal-overlay)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            zIndex: 1100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
          onClick={() => !archiving && setShowArchiveModal(false)}
        >
          <div
            className="modal-content"
            style={{
              width: '100%',
              maxWidth: '480px',
              boxShadow: 'var(--shadow-modal)',
              border: '1px solid var(--border-card)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              position: 'relative',
              zIndex: 1101,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              style={{
                padding: '13px 18px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: 'var(--bg-surface)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '6px',
                    backgroundColor: 'var(--danger-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--danger)',
                  }}
                >
                  <Archive size={15} />
                </div>
                <h3 id="archive-patient-modal-title" style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  Archive Patient Profile
                </h3>
              </div>
              <button
                type="button"
                onClick={() => !archiving && setShowArchiveModal(false)}
                className="btn-icon"
                aria-label="Close dialog"
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <p style={{ fontSize: '13px', color: 'var(--text-primary)', margin: '0 0 6px 0', lineHeight: 1.5 }}>
                  Are you sure you want to archive <strong>{patientToArchive.fullName}</strong>?
                </p>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                  The patient will be removed from the active Patient Directory and will no longer be eligible for new appointment bookings. Their medical history and existing appointment records will be preserved.
                </p>
              </div>

              {/* Upcoming active appointments validation check */}
              {checkingAppointments ? (
                <div style={{ padding: '10px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
                  Checking appointment schedule...
                </div>
              ) : upcomingAppointmentsForArchive.length > 0 ? (
                <div
                  style={{
                    padding: '11px 13px',
                    backgroundColor: 'var(--danger-subtle)',
                    border: '1px solid rgba(198, 40, 40, 0.3)',
                    borderRadius: 'var(--radius-sm)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--danger)', fontWeight: 600, fontSize: '12.5px' }}>
                    <AlertTriangle size={15} />
                    <span>Cannot Archive: Active Upcoming Appointments</span>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                    This patient has <strong>{upcomingAppointmentsForArchive.length}</strong> active upcoming appointment(s). You must reschedule, cancel, or complete all upcoming appointments before archiving this patient.
                  </p>
                  <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '110px', overflowY: 'auto' }}>
                    {upcomingAppointmentsForArchive.map((a: any) => (
                      <div
                        key={a.id}
                        style={{
                          fontSize: '11.5px',
                          padding: '5px 8px',
                          backgroundColor: 'var(--bg-surface)',
                          borderRadius: '4px',
                          border: '1px solid var(--border-subtle)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span>{a.service?.name || 'Visit'} — {formatDate(a.startsAt)} at {formatTime(a.startsAt)}</span>
                        <span className="badge badge-confirmed" style={{ fontSize: '10px' }}>{a.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <label className="form-label" style={{ marginBottom: '4px' }}>
                    Reason for Archiving (Optional)
                  </label>
                  <textarea
                    rows={2}
                    placeholder="e.g., Relocated out of area, requested record inactivity, duplicate profile..."
                    value={archiveReason}
                    onChange={(e) => setArchiveReason(e.target.value)}
                    className="form-input"
                    style={{ resize: 'none', fontSize: '12.5px' }}
                  />
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => setShowArchiveModal(false)}
                  disabled={archiving}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmArchive}
                  disabled={archiving || checkingAppointments || upcomingAppointmentsForArchive.length > 0}
                  className="btn btn-primary"
                  style={{
                    backgroundColor: 'var(--danger)',
                    borderColor: 'var(--danger)',
                    color: '#fff',
                    opacity: (upcomingAppointmentsForArchive.length > 0 || checkingAppointments) ? 0.4 : 1,
                    cursor: (upcomingAppointmentsForArchive.length > 0 || checkingAppointments) ? 'not-allowed' : 'pointer',
                  }}
                >
                  {archiving ? 'Archiving...' : 'Confirm Archive'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Restore Confirmation Modal */}
      {showRestoreModal && patientToRestore && createPortal(
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="restore-patient-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'var(--bg-modal-overlay)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            zIndex: 1100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
          onClick={() => !restoring && setShowRestoreModal(false)}
        >
          <div
            className="modal-content"
            style={{
              width: '100%',
              maxWidth: '460px',
              boxShadow: 'var(--shadow-modal)',
              border: '1px solid var(--border-card)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              position: 'relative',
              zIndex: 1101,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              style={{
                padding: '13px 18px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: 'var(--bg-surface)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '6px',
                    backgroundColor: 'var(--success-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--success)',
                  }}
                >
                  <RotateCcw size={15} />
                </div>
                <h3 id="restore-patient-modal-title" style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  Restore Patient to Active Directory
                </h3>
              </div>
              <button
                type="button"
                onClick={() => !restoring && setShowRestoreModal(false)}
                className="btn-icon"
                aria-label="Close dialog"
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <p style={{ fontSize: '13px', color: 'var(--text-primary)', margin: '0 0 6px 0', lineHeight: 1.5 }}>
                  Restore <strong>{patientToRestore.fullName}</strong> to the active Patient Directory?
                </p>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                  The patient's existing medical history and appointment records will remain available, and they will immediately become eligible for new appointment bookings.
                </p>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => setShowRestoreModal(false)}
                  disabled={restoring}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  onClick={handleConfirmRestore}
                  disabled={restoring}
                  className="btn btn-primary"
                  style={{
                    backgroundColor: 'var(--success)',
                    borderColor: 'var(--success)',
                    color: '#fff',
                  }}
                >
                  {restoring ? 'Restoring...' : 'Restore Patient'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
