import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import {
  Building2,
  Clock,
  Briefcase,
  Bell,
  FileText,
  Save,
  ExternalLink,
  DollarSign,
  Globe,
  AlertCircle,
  CheckCircle2,
  Radio,
} from 'lucide-react';
import { WhatsAppIntegrationData } from '../api/client';

interface SettingsViewProps {
  onNavigate?: (tab: any) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ onNavigate }) => {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Clinic Profile State
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [timezone, setTimezone] = useState('America/New_York');
  const [locale, setLocale] = useState('en-US');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [country, setCountry] = useState('US');
  const [postalCode, setPostalCode] = useState('');
  const [currency, setCurrency] = useState('USD');

  // Practice Policies & Patient Info State
  const [acceptedInsurance, setAcceptedInsurance] = useState('');
  const [cancellationPolicy, setCancellationPolicy] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');

  // Operational counts from database
  const [doctorCount, setDoctorCount] = useState(0);
  const [serviceCount, setServiceCount] = useState(0);
  const [whatsappData, setWhatsappData] = useState<WhatsAppIntegrationData | null>(null);

  useEffect(() => {
    let isMounted = true;
    const fetchClinicSettings = async () => {
      try {
        setLoading(true);
        const [clinicData, receptionistSettings, doctors, services, whatsapp] = await Promise.all([
          api.getClinic(),
          api.getReceptionistSettings().catch(() => ({})),
          api.getDoctors().catch(() => []),
          api.getServices().catch(() => []),
          api.getWhatsAppIntegration().catch(() => null),
        ]);

        if (!isMounted) return;

        if (clinicData) {
          setName(clinicData.name || '');
          setPhone(clinicData.phone || '');
          setEmail(clinicData.email || '');
          setTimezone(clinicData.timezone || 'America/New_York');
          setLocale(clinicData.locale || 'en-US');
          setAddress(clinicData.address || clinicData.settings?.address || '');
          setCity(clinicData.city || clinicData.settings?.city || '');
          setState(clinicData.state || clinicData.settings?.state || '');
          setCountry(clinicData.country || clinicData.settings?.country || 'US');
          setPostalCode(clinicData.postalCode || clinicData.settings?.postalCode || '');
          setCurrency(clinicData.currency || clinicData.settings?.currency || 'USD');
        }

        if (receptionistSettings) {
          setAcceptedInsurance(
            receptionistSettings.acceptedInsurance ||
              receptionistSettings.insurance ||
              ''
          );
          setCancellationPolicy(
            receptionistSettings.cancellationPolicy ||
              ''
          );
          setEmergencyPhone(receptionistSettings.emergencyPhone || '');
        }

        setDoctorCount(doctors?.length || 0);
        setServiceCount(services?.length || 0);
        if (whatsapp) {
          setWhatsappData(whatsapp);
        }
      } catch (err: any) {
        if (isMounted) {
          toast.error('Unable to load clinic settings', err.message);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchClinicSettings();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);

      await Promise.all([
        api.updateClinic({
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim() || undefined,
          timezone,
          locale,
          address: address.trim(),
          city: city.trim(),
          state: state.trim(),
          country: country.trim(),
          postalCode: postalCode.trim(),
          currency: currency.trim(),
        }),
        api.updateReceptionistSettings({
          acceptedInsurance: acceptedInsurance.trim(),
          cancellationPolicy: cancellationPolicy.trim(),
          emergencyPhone: emergencyPhone.trim(),
        }),
      ]);

      toast.success('Settings Saved', 'Clinic profile, regional configuration, and patient policies updated.');
    } catch (err: any) {
      toast.error('Save Failed', err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }}>
      {/* Settings Form */}
      <form
        onSubmit={handleSaveSettings}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          width: '100%',
        }}
      >
        {/* Section 1: Clinic Profile & Contact Details (Full Width) */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-md)',
            padding: '16px 18px',
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Building2 size={16} color="var(--accent-primary)" />
              <h3 style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Clinic Profile & Contact Information
              </h3>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px', marginBottom: 0 }}>
              Official practice details displayed to patients in automated messages and appointment confirmations.
            </p>
          </div>

          {loading ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '12.5px', padding: '12px 0' }}>
              Loading clinic profile...
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Practice / Clinic Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="e.g. Grand Central Dental Associates"
                  className="form-input"
                  style={{ width: '100%', fontSize: '13px', height: '32px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Front Desk Phone Number *
                </label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  placeholder="e.g. +1 (212) 555-0199"
                  className="form-input"
                  style={{ width: '100%', fontSize: '13px', height: '32px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Administrative Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. reception@grandcentraldental.com"
                  className="form-input"
                  style={{ width: '100%', fontSize: '13px', height: '32px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Clinic Street Address
                </label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="e.g. 100 Medical Center Blvd, Suite 400"
                  className="form-input"
                  style={{ width: '100%', fontSize: '13px', height: '32px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  City
                </label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. New York"
                  className="form-input"
                  style={{ width: '100%', fontSize: '13px', height: '32px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  State / Region / Province
                </label>
                <input
                  type="text"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  placeholder="e.g. NY"
                  className="form-input"
                  style={{ width: '100%', fontSize: '13px', height: '32px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Postal Code
                </label>
                <input
                  type="text"
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  placeholder="e.g. 10017"
                  className="form-input"
                  style={{ width: '100%', fontSize: '13px', height: '32px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Country / Holiday Jurisdiction
                </label>
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="form-input"
                  style={{ width: '100%', fontSize: '13px', height: '32px' }}
                >
                  <option value="US">United States (US)</option>
                  <option value="GB">United Kingdom (GB / UK)</option>
                  <option value="CA">Canada (CA)</option>
                  <option value="AU">Australia (AU)</option>
                  <option value="IN">India (IN)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Default Pricing Currency
                </label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="form-input"
                  style={{ width: '100%', fontSize: '13px', height: '32px' }}
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
          )}
        </div>

        {/* Section 2 & 3: Side-by-Side Responsive 2-Column Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '14px' }}>
          {/* Card: Operating Timezone & Regional Localization */}
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-card)',
              borderRadius: 'var(--radius-md)',
              padding: '16px 18px',
              boxShadow: 'var(--shadow-sm)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Clock size={16} color="var(--accent-primary)" />
                <h3 style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  Timezone & Regional Localization
                </h3>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px', marginBottom: 0 }}>
                Operating timezone and language used by the AI receptionist and schedule logic.
              </p>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                Operating Timezone
              </label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="form-input"
                style={{ width: '100%', fontSize: '13px', height: '32px' }}
              >
                <option value="America/New_York">America/New_York (Eastern Time)</option>
                <option value="America/Chicago">America/Chicago (Central Time)</option>
                <option value="America/Denver">America/Denver (Mountain Time)</option>
                <option value="America/Los_Angeles">America/Los_Angeles (Pacific Time)</option>
                <option value="Europe/London">Europe/London (GMT / BST)</option>
                <option value="Asia/Kolkata">Asia/Kolkata (India Standard Time)</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                Language & Regional Format
              </label>
              <select
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
                className="form-input"
                style={{ width: '100%', fontSize: '13px', height: '32px' }}
              >
                <option value="en-US">English (United States)</option>
                <option value="en-GB">English (United Kingdom)</option>
                <option value="es-ES">Spanish (Español)</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                After-Hours Emergency Contact Phone
              </label>
              <input
                type="text"
                value={emergencyPhone}
                onChange={(e) => setEmergencyPhone(e.target.value)}
                placeholder="e.g. +1 (212) 555-0999"
                className="form-input"
                style={{ width: '100%', fontSize: '13px', height: '32px' }}
              />
            </div>
          </div>

          {/* Card: Practice Policies & Patient Information */}
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-card)',
              borderRadius: 'var(--radius-md)',
              padding: '16px 18px',
              boxShadow: 'var(--shadow-sm)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FileText size={16} color="var(--accent-primary)" />
                <h3 style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  Practice Policies & Patient Information
                </h3>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px', marginBottom: 0 }}>
                Terms and policies provided to patients during automated booking and inquiries.
              </p>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                Accepted Insurance Networks
              </label>
              <input
                type="text"
                value={acceptedInsurance}
                onChange={(e) => setAcceptedInsurance(e.target.value)}
                placeholder="e.g. Delta Dental, Cigna, MetLife PPO, Guardian (or Self-Pay only)"
                className="form-input"
                style={{ width: '100%', fontSize: '13px', height: '32px' }}
              />
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                Cancellation & Rescheduling Notice Policy
              </label>
              <textarea
                rows={4}
                value={cancellationPolicy}
                onChange={(e) => setCancellationPolicy(e.target.value)}
                placeholder="e.g. Please provide at least 24 hours notice to cancel or reschedule without fee."
                className="form-input"
                style={{
                  width: '100%',
                  fontSize: '12.5px',
                  lineHeight: '1.45',
                  padding: '8px 11px',
                  resize: 'none',
                  flex: 1,
                  minHeight: '82px',
                }}
              />
            </div>
          </div>
        </div>

        {/* Section 3: Full-Width Save Settings Action Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 18px',
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-sm)',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            Updates apply immediately across automated WhatsApp conversations and clinic appointment schedules.
          </div>
          <button
            type="submit"
            disabled={saving}
            className="btn btn-primary"
            style={{
              height: '32px',
              padding: '0 18px',
              fontSize: '12.5px',
              fontWeight: 500,
              gap: '6px',
            }}
          >
            <Save size={14} />
            {saving ? 'Saving Changes...' : 'Save Clinic Settings'}
          </button>
        </div>
      </form>

      {/* Section 4: Practice Schedule & Clinical Services Overview (Full Width) */}
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-sm)',
          padding: '16px 18px',
        }}
      >
        <div style={{ marginBottom: '12px' }}>
          <h3 style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Operations & Service Directory
          </h3>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px', marginBottom: 0 }}>
            Manage working schedules, dentist rosters, treatment procedures, and holiday blocks.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
          {/* Card: Dentists & Hours */}
          <div
            onClick={() => onNavigate && onNavigate('schedules')}
            style={{
              padding: '12px 14px',
              backgroundColor: 'var(--bg-surface-secondary)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              cursor: 'pointer',
              transition: 'background-color 0.15s ease, border-color 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--bg-surface-hover)';
              e.currentTarget.style.borderColor = 'var(--accent-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--bg-surface-secondary)';
              e.currentTarget.style.borderColor = 'var(--border-subtle)';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <Clock size={15} color="var(--accent-primary)" />
                <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '13px' }}>
                  Dentists & Working Hours
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span
                  style={{
                    fontSize: '10.5px',
                    fontWeight: 600,
                    color: doctorCount > 0 ? 'var(--success)' : 'var(--warning)',
                    backgroundColor: doctorCount > 0 ? 'var(--success-subtle)' : 'var(--warning-subtle)',
                    border: `1px solid ${doctorCount > 0 ? 'rgba(46, 125, 50, 0.2)' : 'rgba(234, 179, 8, 0.2)'}`,
                    padding: '2px 7px',
                    borderRadius: '4px',
                  }}
                >
                  {doctorCount > 0 ? `${doctorCount} Active` : 'Needs Setup'}
                </span>
                <ExternalLink size={13} color="var(--text-secondary)" />
              </div>
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              {doctorCount > 0
                ? `${doctorCount} active practitioners, standard practice hours, and holiday leave blocks.`
                : 'No dentists configured yet. Click to add your clinical team and configure operating hours.'}
            </div>
          </div>

          {/* Card: Dental Services */}
          <div
            onClick={() => onNavigate && onNavigate('services')}
            style={{
              padding: '12px 14px',
              backgroundColor: 'var(--bg-surface-secondary)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              cursor: 'pointer',
              transition: 'background-color 0.15s ease, border-color 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--bg-surface-hover)';
              e.currentTarget.style.borderColor = 'var(--accent-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--bg-surface-secondary)';
              e.currentTarget.style.borderColor = 'var(--border-subtle)';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <Briefcase size={15} color="var(--accent-primary)" />
                <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '13px' }}>
                  Dental Treatment Catalog
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span
                  style={{
                    fontSize: '10.5px',
                    fontWeight: 600,
                    color: serviceCount > 0 ? 'var(--success)' : 'var(--warning)',
                    backgroundColor: serviceCount > 0 ? 'var(--success-subtle)' : 'var(--warning-subtle)',
                    border: `1px solid ${serviceCount > 0 ? 'rgba(46, 125, 50, 0.2)' : 'rgba(234, 179, 8, 0.2)'}`,
                    padding: '2px 7px',
                    borderRadius: '4px',
                  }}
                >
                  {serviceCount > 0 ? `${serviceCount} Treatments` : 'Needs Setup'}
                </span>
                <ExternalLink size={13} color="var(--text-secondary)" />
              </div>
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              {serviceCount > 0
                ? `${serviceCount} treatment types, pricing models, and practitioner recovery buffers.`
                : 'No treatments configured yet. Click to build your clinical service catalog and pricing.'}
            </div>
          </div>

          {/* Card: WhatsApp Cloud API Integration */}
          <div
            onClick={() => {
              window.location.hash = '#whatsapp-integration';
              if (onNavigate) onNavigate('receptionist');
            }}
            style={{
              padding: '12px 14px',
              backgroundColor: 'var(--bg-surface-secondary)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              cursor: 'pointer',
              transition: 'background-color 0.15s ease, border-color 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--bg-surface-hover)';
              e.currentTarget.style.borderColor = 'var(--accent-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--bg-surface-secondary)';
              e.currentTarget.style.borderColor = 'var(--border-subtle)';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <Radio size={15} color="var(--accent-primary)" />
                <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '13px' }}>
                  WhatsApp Cloud API
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span
                  style={{
                    fontSize: '10.5px',
                    fontWeight: 600,
                    color:
                      whatsappData?.status === 'valid'
                        ? 'var(--status-confirmed-text)'
                        : whatsappData?.status === 'unvalidated'
                        ? 'var(--status-pending-text)'
                        : 'var(--text-muted)',
                    backgroundColor:
                      whatsappData?.status === 'valid'
                        ? 'var(--status-confirmed-bg)'
                        : whatsappData?.status === 'unvalidated'
                        ? 'var(--status-pending-bg)'
                        : 'var(--bg-surface)',
                    border: `1px solid ${
                      whatsappData?.status === 'valid'
                        ? 'var(--status-confirmed-border)'
                        : whatsappData?.status === 'unvalidated'
                        ? 'var(--status-pending-border)'
                        : 'var(--border-subtle)'
                    }`,
                    padding: '2px 7px',
                    borderRadius: '4px',
                  }}
                >
                  {whatsappData?.status === 'valid'
                    ? 'Connected & Verified'
                    : whatsappData?.status === 'unvalidated'
                    ? 'Saved (Unvalidated)'
                    : 'Configure'}
                </span>
                <ExternalLink size={13} color="var(--text-secondary)" />
              </div>
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              {whatsappData?.phoneNumberId
                ? `Phone ID: ${whatsappData.phoneNumberId} • Encrypted at rest (AES-256-GCM). Click to configure credentials.`
                : 'Configure Phone Number ID, WABA ID, and access token for live WhatsApp messaging.'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
