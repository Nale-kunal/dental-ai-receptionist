import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import { Clock, ShieldCheck, Tag, Plus, Edit2, Archive, X, DollarSign, FileText, Layers } from 'lucide-react';

export const ServicesView: React.FC = () => {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState<any[]>([]);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentServiceId, setCurrentServiceId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form Fields
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [bufferMinutes, setBufferMinutes] = useState(10);
  const [price, setPrice] = useState<number | ''>('');
  const [currency, setCurrency] = useState('USD');
  const [pricingModel, setPricingModel] = useState<'fixed' | 'starting_from' | 'quote_required'>('fixed');
  const [category, setCategory] = useState('General Dentistry');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState(true);

  // Prevent background scrolling and handle Escape key for modal
  useEffect(() => {
    if (!isModalOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsModalOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isModalOpen]);

  const fetchServices = async () => {
    try {
      setLoading(true);
      const data = await api.getServices();
      setServices(data || []);
    } catch (err: any) {
      toast.error('Services Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServices();
  }, []);

  const handleOpenAdd = () => {
    setIsEditing(false);
    setCurrentServiceId(null);
    setName('');
    setCode('');
    setDurationMinutes(30);
    setBufferMinutes(10);
    setPrice('');
    setCurrency('USD');
    setPricingModel('fixed');
    setCategory('General Dentistry');
    setDescription('');
    setActive(true);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (s: any) => {
    setIsEditing(true);
    setCurrentServiceId(s.id);
    setName(s.name);
    setCode(s.code || '');
    setDurationMinutes(s.durationMinutes || 30);
    setBufferMinutes(s.bufferMinutes || 10);
    setPrice(s.price != null ? Number(s.price) : '');
    setCurrency(s.currency || 'USD');
    setPricingModel((s.pricingModel || s.pricing_model || 'fixed') as any);
    setCategory(s.category || 'General Dentistry');
    setDescription(s.description || '');
    setActive(s.active !== false);
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Validation Error', 'Treatment name is required.');
      return;
    }

    const priceValue = pricingModel === 'quote_required'
      ? null
      : price !== '' ? Number(price) : null;

    try {
      setSaving(true);
      if (isEditing && currentServiceId) {
        const updated = await api.updateService(currentServiceId, {
          name: name.trim(),
          code: code.trim().toUpperCase() || undefined,
          durationMinutes: Number(durationMinutes),
          bufferMinutes: Number(bufferMinutes),
          price: priceValue,
          currency,
          pricingModel,
          category: category.trim() || undefined,
          description: description.trim() || undefined,
          active,
        });
        toast.success('Treatment Updated', `Successfully updated "${name}".`);
        setServices((prev) => prev.map((s) => (s.id === currentServiceId ? updated : s)));
      } else {
        const created = await api.createService({
          name: name.trim(),
          code: code.trim().toUpperCase() || undefined,
          durationMinutes: Number(durationMinutes),
          bufferMinutes: Number(bufferMinutes),
          price: priceValue,
          currency,
          pricingModel,
          category: category.trim() || undefined,
          description: description.trim() || undefined,
          active,
        });
        toast.success('Treatment Added', `Created "${name}" with ${durationMinutes} min appointment duration.`);
        setServices((prev) => [...prev, created]);
      }
      setIsModalOpen(false);
    } catch (err: any) {
      toast.error('Failed to Save Treatment', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (s: any) => {
    const nextStatus = !s.active;
    try {
      if (!nextStatus) {
        // Safe deactivation
        const res = await api.deleteService(s.id);
        toast.success(
          'Treatment Archived',
          res.action === 'deactivated'
            ? `"${s.name}" was deactivated (historical appointments preserved).`
            : `"${s.name}" was removed.`
        );
      } else {
        await api.updateService(s.id, { active: true });
        toast.success('Treatment Re-activated', `"${s.name}" is now bookable.`);
      }
      setServices((prev) =>
        prev.map((item) => (item.id === s.id ? { ...item, active: nextStatus } : item))
      );
    } catch (err: any) {
      toast.error('Status Change Failed', err.message);
    }
  };

  const formatPriceDisplay = (s: any) => {
    const model = s.pricingModel || s.pricing_model || 'fixed';
    const curr = s.currency || 'USD';

    if (model === 'quote_required') {
      return (
        <span
          style={{
            fontSize: '11px',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            backgroundColor: 'var(--bg-surface-secondary)',
            border: '1px solid var(--border-subtle)',
            padding: '2px 7px',
            borderRadius: '4px',
          }}
        >
          Quote / Consultation Required
        </span>
      );
    }

    if (s.price != null && !isNaN(Number(s.price))) {
      const formatted = `${curr} ${Number(s.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      return (
        <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--accent-text)' }}>
          {model === 'starting_from' ? `From ${formatted}` : formatted}
        </span>
      );
    }

    return (
      <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
        Price not configured
      </span>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Header Banner */}
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
          gap: '12px',
        }}
      >
        <div>
          <h3 style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>
            Dental Services & Clinical Procedure Directory
          </h3>
          <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', margin: 0 }}>
            Configure treatment catalog, duration, pricing models, buffer periods, and booking availability.
          </p>
        </div>
        <button
          onClick={handleOpenAdd}
          className="btn btn-primary"
          style={{
            height: '32px',
            padding: '0 12px',
            fontSize: '12.5px',
            gap: '6px',
          }}
        >
          <Plus size={14} />
          Add Treatment / Service
        </button>
      </div>

      {/* Services Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '12px' }}>
        {loading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '12.5px', padding: '16px' }}>Loading treatments...</div>
        ) : services.length === 0 ? (
          <div
            style={{
              gridColumn: '1 / -1',
              backgroundColor: 'var(--bg-surface)',
              border: '1px dashed var(--border-card)',
              borderRadius: 'var(--radius-md)',
              padding: '36px 20px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'var(--accent-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-primary)' }}>
              <Tag size={20} />
            </div>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '14px' }}>
              No Dental Services Configured Yet
            </div>
            <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', maxWidth: '420px', margin: 0 }}>
              Newly registered clinics start with a clean slate. Click "Add Treatment / Service" above to build your clinical service catalog and set treatment pricing.
            </p>
          </div>
        ) : (
          services.map((s) => (
            <div
              key={s.id}
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-card)',
                borderRadius: 'var(--radius-md)',
                padding: '14px 16px',
                boxShadow: 'var(--shadow-sm)',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '14px' }}>
                      {s.name}
                    </span>
                    {s.category && (
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 600,
                          color: 'var(--accent-text)',
                          backgroundColor: 'var(--accent-subtle)',
                          padding: '1px 6px',
                          borderRadius: '4px',
                        }}
                      >
                        {s.category}
                      </span>
                    )}
                  </div>
                  {s.code && (
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Tag size={11} /> Code: <span className="code-pill" style={{ fontSize: '10px' }}>{s.code}</span>
                    </div>
                  )}
                </div>
                <span
                  style={{
                    fontSize: '10.5px',
                    fontWeight: 600,
                    color: s.active ? 'var(--success)' : 'var(--danger)',
                    backgroundColor: s.active ? 'var(--success-subtle)' : 'var(--danger-subtle)',
                    border: `1px solid ${s.active ? 'rgba(46, 125, 50, 0.2)' : 'rgba(198, 40, 40, 0.2)'}`,
                    padding: '2px 7px',
                    borderRadius: '4px',
                  }}
                >
                  {s.active ? 'Active' : 'Archived'}
                </span>
              </div>

              {/* Price & Timing Badge Bar */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '7px 11px',
                  backgroundColor: 'var(--bg-surface-secondary)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '12px',
                  flexWrap: 'wrap',
                  gap: '6px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-primary)' }}>
                    <Clock size={12} color="var(--accent-primary)" />
                    <span><strong>{s.durationMinutes}m</strong></span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-secondary)' }}>
                    <ShieldCheck size={12} color="var(--success)" />
                    <span>+{s.bufferMinutes || 10}m buf</span>
                  </div>
                </div>
                <div>{formatPriceDisplay(s)}</div>
              </div>

              {s.description && (
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  {s.description}
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px', marginTop: 'auto', paddingTop: '2px' }}>
                <button
                  onClick={() => handleOpenEdit(s)}
                  className="btn btn-secondary btn-sm"
                  style={{
                    flex: 1,
                    height: '29px',
                    fontSize: '12px',
                  }}
                >
                  <Edit2 size={12} />
                  Edit
                </button>
                <button
                  onClick={() => handleToggleStatus(s)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '5px',
                    height: '29px',
                    padding: '0 10px',
                    backgroundColor: s.active ? 'var(--danger-subtle)' : 'var(--success-subtle)',
                    border: `1px solid ${s.active ? 'rgba(198, 40, 40, 0.2)' : 'rgba(46, 125, 50, 0.2)'}`,
                    borderRadius: 'var(--radius-sm)',
                    color: s.active ? 'var(--danger)' : 'var(--success)',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <Archive size={12} />
                  {s.active ? 'Archive' : 'Activate'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add / Edit Service Modal */}
      {isModalOpen && createPortal(
        <div
          className="modal-overlay"
          onClick={() => setIsModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="service-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
            backgroundColor: 'var(--bg-modal-overlay)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
          }}
        >
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
            style={{
              padding: '18px 20px',
              width: '100%',
              maxWidth: '480px',
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-card)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-modal)',
              color: 'var(--text-primary)',
              position: 'relative',
              zIndex: 1001,
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Tag size={16} color="var(--accent-primary)" />
                <h3 id="service-modal-title" style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  {isEditing ? 'Edit Clinical Treatment' : 'Add New Clinical Treatment'}
                </h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                aria-label="Close dialog"
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex' }}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '11px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Treatment / Procedure Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Comprehensive Oral Examination & Prophylaxis"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="form-input"
                  style={{ width: '100%', fontSize: '13px' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Service Code (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. EXAM-01, CLEAN-01"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="form-input"
                    style={{ width: '100%', fontSize: '13px' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Clinical Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="form-input"
                    style={{ width: '100%', fontSize: '13px' }}
                  >
                    <option value="General Dentistry">General Dentistry</option>
                    <option value="Preventative Care">Preventative Care</option>
                    <option value="Cosmetic Dentistry">Cosmetic Dentistry</option>
                    <option value="Orthodontics">Orthodontics</option>
                    <option value="Endodontics">Endodontics (Root Canal)</option>
                    <option value="Oral Surgery">Oral Surgery & Extractions</option>
                    <option value="Periodontics">Periodontics (Gum Health)</option>
                    <option value="Pediatric Dentistry">Pediatric Dentistry</option>
                    <option value="Emergency Care">Emergency Care</option>
                  </select>
                </div>
              </div>

              {/* Pricing Section */}
              <div
                style={{
                  backgroundColor: 'var(--bg-surface-secondary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <DollarSign size={13} color="var(--accent-primary)" />
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Pricing Structure & Currency
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '3px' }}>
                      Pricing Model
                    </label>
                    <select
                      value={pricingModel}
                      onChange={(e) => setPricingModel(e.target.value as any)}
                      className="form-input"
                      style={{ width: '100%', fontSize: '12.5px' }}
                    >
                      <option value="fixed">Fixed Price</option>
                      <option value="starting_from">Starting From Price</option>
                      <option value="quote_required">Consultation / Assessment Quote Required</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '3px' }}>
                      Price Amount ({currency})
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100000}
                      step="0.01"
                      disabled={pricingModel === 'quote_required'}
                      placeholder={pricingModel === 'quote_required' ? 'N/A (Quote Required)' : 'e.g. 150.00'}
                      value={pricingModel === 'quote_required' ? '' : price}
                      onChange={(e) => setPrice(e.target.value === '' ? '' : Number(e.target.value))}
                      className="form-input"
                      style={{
                        width: '100%',
                        fontSize: '12.5px',
                        opacity: pricingModel === 'quote_required' ? 0.6 : 1,
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    Currency:
                  </label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="form-input"
                    style={{ fontSize: '12px', padding: '3px 8px', height: '28px', maxWidth: '120px' }}
                  >
                    <option value="USD">USD ($)</option>
                    <option value="GBP">GBP (£)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="CAD">CAD ($)</option>
                    <option value="AUD">AUD ($)</option>
                    <option value="INR">INR (₹)</option>
                  </select>
                </div>
              </div>

              {/* Timing Section */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Procedure Duration (Mins) *
                  </label>
                  <input
                    type="number"
                    min={10}
                    max={360}
                    step={5}
                    required
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(Number(e.target.value))}
                    className="form-input"
                    style={{ width: '100%', fontSize: '13px' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Post-Procedure Buffer (Mins)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    step={5}
                    value={bufferMinutes}
                    onChange={(e) => setBufferMinutes(Number(e.target.value))}
                    className="form-input"
                    style={{ width: '100%', fontSize: '13px' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Patient-Facing Description (Optional)
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description shared with patients during automated AI triage and appointment confirmations."
                  className="form-input"
                  style={{ width: '100%', fontSize: '12px', resize: 'vertical' }}
                />
              </div>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  fontSize: '12.5px',
                  color: 'var(--text-primary)',
                  marginTop: '2px',
                }}
              >
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  style={{ accentColor: 'var(--accent-primary)', width: '15px', height: '15px' }}
                />
                Active & Bookable via AI Receptionist & Front Desk
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={saving}
                  className="btn btn-secondary btn-sm"
                  style={{ height: '30px', padding: '0 12px' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="btn btn-primary btn-sm"
                  style={{ height: '30px', padding: '0 14px' }}
                >
                  {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Treatment'}
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
