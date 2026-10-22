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
} from 'lucide-react';

interface PatientsViewProps {
  onOpenBookingModal: (patientId?: string) => void;
}

export const PatientsView: React.FC<PatientsViewProps> = ({ onOpenBookingModal }) => {
  const toast = useToast();
  const { formatDate, formatTime } = useClinic();
  const [loading, setLoading] = useState(true);
  const [patients, setPatients] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');

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

  // Prevent background scrolling and handle Escape key for patient overlays
  const isAnyPatientOverlayOpen = Boolean(selectedPatient || showCreateModal || showEditModal);
  useEffect(() => {
    if (!isAnyPatientOverlayOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showEditModal) {
          setShowEditModal(false);
        } else if (showCreateModal) {
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
  }, [isAnyPatientOverlayOpen, showEditModal, showCreateModal, selectedPatient]);

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
      setShowEditModal(false);
    } catch (err: any) {
      toast.error('Update Failed', err.message);
    } finally {
      setUpdating(false);
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

  useEffect(() => {
    fetchPatients();
  }, [page]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchPatients();
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
    } catch (err: any) {
      toast.error('Registration Failed', err.message);
    } finally {
      setCreating(false);
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
        <form
          onSubmit={handleSearchSubmit}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '260px' }}
        >
          <div style={{ position: 'relative', width: '100%', maxWidth: '340px' }}>
            <Search
              size={14}
              color="var(--text-muted)"
              style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }}
            />
            <input
              type="text"
              placeholder="Search patients by name, phone, email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
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

        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="btn btn-primary"
          style={{ height: '32px', padding: '0 12px', fontSize: '12.5px', gap: '6px' }}
        >
          <Plus size={14} /> Add Patient
        </button>
      </div>

      {/* Patients Table Card */}
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
                  onClick={() => setSelectedPatient(null)}
                  className="btn-icon"
                  aria-label="Close patient drawer"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

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
    </div>
  );
};
