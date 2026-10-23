import React, { useState, useEffect } from 'react';
import {
  api,
  WhatsAppIntegrationData,
  ValidateIntegrationResult,
} from '../api/client';
import { useToast } from '../context/ToastContext';
import { useClinic } from '../context/ClinicContext';
import {
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Radio,
  Eye,
  EyeOff,
  Save,
  RefreshCw,
  Trash2,
  ExternalLink,
  Lock,
  Smartphone,
  Building,
  Info,
  Server,
  KeyRound,
  Sparkles,
} from 'lucide-react';

export const WhatsAppIntegrationSettings: React.FC = () => {
  const toast = useToast();
  const { clinic, formatDateTime } = useClinic();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);

  // Integration state from server
  const [integration, setIntegration] = useState<WhatsAppIntegrationData | null>(null);

  // Form field states
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [enabled, setEnabled] = useState(true);

  // Local verified details from live validation
  const [validationResult, setValidationResult] = useState<ValidateIntegrationResult | null>(null);
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);

  // Fetch integration data
  const fetchIntegration = async () => {
    try {
      setLoading(true);
      const data = await api.getWhatsAppIntegration();
      setIntegration(data);
      setPhoneNumberId(data.phoneNumberId || '');
      setWabaId(data.wabaId || '');
      setEnabled(data.enabled);
      setAccessToken(''); // Always clear token input on fetch
    } catch (err: any) {
      toast.error('Unable to load WhatsApp integration', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIntegration();
  }, []);

  // Form validation
  const cleanPhoneId = phoneNumberId.trim();
  const isPhoneIdValid = !cleanPhoneId || /^\d{8,25}$/.test(cleanPhoneId);

  // Save integration settings (does not validate unless validateNow=true)
  const handleSave = async (validateNow = false) => {
    if (cleanPhoneId && !isPhoneIdValid) {
      toast.error('Invalid Phone Number ID', 'Phone Number ID must contain only digits (8 to 25 characters).');
      return;
    }

    if (wabaId.trim() && !/^\d{8,25}$/.test(wabaId.trim())) {
      toast.error('Invalid WABA ID', 'WhatsApp Business Account ID must contain only digits.');
      return;
    }

    try {
      if (validateNow) {
        setValidating(true);
      } else {
        setSaving(true);
      }

      const payload: any = {
        phoneNumberId: cleanPhoneId || undefined,
        wabaId: wabaId.trim() || undefined,
        enabled,
        validateNow,
      };

      // Only include accessToken if the user typed something new
      if (accessToken.trim()) {
        payload.accessToken = accessToken.trim();
      }

      const res = await api.updateWhatsAppIntegration(payload);

      // Immediately clear the token input from UI state for security
      setAccessToken('');

      if (validateNow && res.validation) {
        setValidationResult(res.validation);
        if (res.validation.valid) {
          toast.success(
            'Saved & Verified with Meta',
            res.validation.verifiedName
              ? `Connected to "${res.validation.verifiedName}" (${res.validation.displayPhoneNumber || cleanPhoneId}).`
              : 'WhatsApp credentials verified successfully with Meta.'
          );
        } else {
          toast.error('Validation Notice', res.validation.message);
        }
      } else {
        toast.success(
          'Credentials Saved Securely',
          accessToken.trim()
            ? 'Access token encrypted at rest (AES-256-GCM). Click "Validate Connection" to verify with Meta.'
            : 'WhatsApp integration preferences updated.'
        );
      }

      await fetchIntegration();
    } catch (err: any) {
      toast.error('Save Failed', err.message || 'Unable to update WhatsApp credentials.');
    } finally {
      setSaving(false);
      setValidating(false);
    }
  };

  // Run on-demand validation against Meta without sending messages
  const handleValidateConnection = async () => {
    if (!integration?.phoneNumberId && !cleanPhoneId) {
      toast.error('Missing Phone Number ID', 'Please enter and save a Phone Number ID before validating.');
      return;
    }

    if (!integration?.hasToken && !accessToken.trim()) {
      toast.error('Missing Access Token', 'Please provide a Meta access token to validate.');
      return;
    }

    // If the user has typed changes into the form that are not yet saved, save & validate together
    if (accessToken.trim() || cleanPhoneId !== (integration?.phoneNumberId || '') || wabaId.trim() !== (integration?.wabaId || '')) {
      await handleSave(true);
      return;
    }

    try {
      setValidating(true);
      const res = await api.validateWhatsAppIntegration();
      setValidationResult(res);

      if (res.valid) {
        toast.success(
          'Meta Verification Succeeded',
          res.verifiedName
            ? `Verified "${res.verifiedName}" (${res.displayPhoneNumber || integration?.phoneNumberId}). Zero WhatsApp messages sent.`
            : 'Connection is active and permissions are verified. Zero WhatsApp messages sent.'
        );
      } else {
        toast.error('Meta Verification Failed', res.message);
      }

      await fetchIntegration();
    } catch (err: any) {
      toast.error('Validation Error', err.message || 'Unable to complete validation with Meta Cloud API.');
    } finally {
      setValidating(false);
    }
  };

  // Disconnect / Clear credentials
  const handleDisconnect = async () => {
    try {
      setSaving(true);
      await api.updateWhatsAppIntegration({
        phoneNumberId: '',
        wabaId: '',
        accessToken: '',
        enabled: false,
      });
      setAccessToken('');
      setPhoneNumberId('');
      setWabaId('');
      setEnabled(false);
      setValidationResult(null);
      setConfirmDisconnectOpen(false);
      toast.info('WhatsApp Disconnected', 'Credentials cleared. Safe test mode active.');
      await fetchIntegration();
    } catch (err: any) {
      toast.error('Disconnect Failed', err.message);
    } finally {
      setSaving(false);
    }
  };

  // Determine current effective status
  const currentStatus = integration?.status || 'unconfigured';
  const isConfigured = Boolean(integration?.phoneNumberId && integration?.hasToken);

  const getStatusBadge = () => {
    switch (currentStatus) {
      case 'valid':
        return {
          label: 'Connected & Verified',
          bg: 'var(--status-confirmed-bg)',
          color: 'var(--status-confirmed-text)',
          border: 'var(--status-confirmed-border)',
          icon: CheckCircle2,
          description: 'Credentials verified with Meta Cloud API. Live WhatsApp dispatch is operational for verified patient conversations.',
        };
      case 'unvalidated':
        return {
          label: 'Saved (Unvalidated)',
          bg: 'var(--status-pending-bg)',
          color: 'var(--status-pending-text)',
          border: 'var(--status-pending-border)',
          icon: AlertTriangle,
          description: 'Credentials are encrypted and saved securely. Run "Validate Connection" to test permissions against Meta before enabling live dispatch.',
        };
      case 'invalid':
        return {
          label: 'Verification Failed',
          bg: 'var(--status-cancelled-bg)',
          color: 'var(--status-cancelled-text)',
          border: 'var(--status-cancelled-border)',
          icon: AlertCircle,
          description: integration?.lastError || 'Meta Cloud API rejected the configured credentials or Phone Number ID. Check your token and permissions.',
        };
      case 'expired':
        return {
          label: 'Token Expired',
          bg: 'var(--status-cancelled-bg)',
          color: 'var(--status-cancelled-text)',
          border: 'var(--status-cancelled-border)',
          icon: AlertCircle,
          description: 'The Meta access token has expired. Generate a permanent System User token in Meta Business Manager and update below.',
        };
      case 'unconfigured':
      default:
        return {
          label: 'Not Configured',
          bg: 'var(--bg-surface-secondary)',
          color: 'var(--text-secondary)',
          border: 'var(--border-subtle)',
          icon: Info,
          description: 'No WhatsApp Cloud API credentials configured for this clinic. Currently operating in Safe Test Mode (inbox replies recorded in chart).',
        };
    }
  };

  const statusBadge = getStatusBadge();
  const StatusIcon = statusBadge.icon;

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '280px',
          color: 'var(--text-muted)',
          fontSize: '13px',
          gap: '8px',
        }}
      >
        <RefreshCw size={16} className="animate-spin" />
        <span>Loading WhatsApp Cloud API integration settings...</span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        width: '100%',
        paddingBottom: '24px',
        boxSizing: 'border-box',
      }}
    >
      {/* ─── Top Header Card ───────────────────────────────────────────────── */}
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-lg)',
          padding: '18px 20px',
          boxShadow: 'var(--shadow-sm)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--accent-subtle)',
                color: 'var(--accent-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Radio size={20} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                  WhatsApp Cloud API Integration
                </h2>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '11px',
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: 'var(--radius-full)',
                    backgroundColor: statusBadge.bg,
                    color: statusBadge.color,
                    border: `1px solid ${statusBadge.border}`,
                  }}
                >
                  <StatusIcon size={12} />
                  {statusBadge.label}
                </span>
              </div>
              <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', margin: '3px 0 0 0' }}>
                Official Meta Cloud API gateway for automated AI answering and verified staff-to-patient WhatsApp messaging.
              </p>
            </div>
          </div>

          {/* Tenant Scope pill */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--bg-surface-secondary)',
              border: '1px solid var(--border-subtle)',
              fontSize: '11px',
              color: 'var(--text-secondary)',
            }}
          >
            <Building size={12} color="var(--accent-primary)" />
            <span>Clinic Scope: <strong>{clinic?.name || 'Demo Dental Clinic'}</strong></span>
          </div>
        </div>

        {/* Status Explanation Banner */}
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: statusBadge.bg,
            border: `1px solid ${statusBadge.border}`,
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
          }}
        >
          <StatusIcon size={16} color={statusBadge.color} style={{ marginTop: '2px', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '12.5px', fontWeight: 600, color: statusBadge.color }}>
              {statusBadge.description}
            </div>
            {currentStatus === 'valid' && (
              <div style={{ fontSize: '11.5px', color: statusBadge.color, marginTop: '4px', opacity: 0.9 }}>
                Last verified with Meta: {integration?.lastValidatedAt ? formatDateTime(integration.lastValidatedAt) : 'Recently verified'}
              </div>
            )}
            {integration?.lastError && currentStatus !== 'valid' && (
              <div style={{ fontSize: '11.5px', color: 'var(--danger)', marginTop: '4px', fontWeight: 500 }}>
                Detail: {integration.lastError}
              </div>
            )}
          </div>
        </div>

        {/* Verified Metadata Card (if available from Meta response) */}
        {(validationResult?.valid || currentStatus === 'valid') && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '10px',
              padding: '12px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--bg-surface-secondary)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block' }}>Verified Business Name</span>
              <strong style={{ fontSize: '12.5px', color: 'var(--text-primary)' }}>
                {validationResult?.verifiedName || clinic?.name || 'Verified Clinic Account'}
              </strong>
            </div>

            <div>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block' }}>Display WhatsApp Number</span>
              <strong style={{ fontSize: '12.5px', color: 'var(--text-primary)' }}>
                {validationResult?.displayPhoneNumber || integration?.phoneNumberId || 'Configured'}
              </strong>
            </div>

            <div>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block' }}>Phone Quality Rating</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '2px' }}>
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor:
                      (validationResult?.qualityRating || 'GREEN') === 'GREEN'
                        ? 'var(--success)'
                        : (validationResult?.qualityRating || '') === 'YELLOW'
                        ? 'var(--warning)'
                        : 'var(--danger)',
                  }}
                />
                <strong style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                  {validationResult?.qualityRating || 'High Quality (GREEN)'}
                </strong>
              </div>
            </div>

            <div>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block' }}>Meta Verification Status</span>
              <strong style={{ fontSize: '12px', color: 'var(--success)' }}>
                {validationResult?.codeVerificationStatus || 'VERIFIED'}
              </strong>
            </div>
          </div>
        )}
      </div>

      {/* ─── Mode Switch: Live Dispatch vs Safe Test Mode ─────────────────── */}
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-md)',
          padding: '14px 18px',
          boxShadow: 'var(--shadow-sm)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Smartphone size={16} color="var(--accent-primary)" />
            <span style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
              Enable Live WhatsApp Dispatch
            </span>
            <span
              style={{
                fontSize: '10.5px',
                fontWeight: 600,
                padding: '1px 6px',
                borderRadius: 'var(--radius-xs)',
                backgroundColor: enabled && currentStatus === 'valid' ? 'var(--status-confirmed-bg)' : 'var(--status-pending-bg)',
                color: enabled && currentStatus === 'valid' ? 'var(--status-confirmed-text)' : 'var(--status-pending-text)',
                border: `1px solid ${enabled && currentStatus === 'valid' ? 'var(--status-confirmed-border)' : 'var(--status-pending-border)'}`,
              }}
            >
              {enabled && currentStatus === 'valid' ? 'LIVE MESSAGING ACTIVE' : 'SAFE TEST MODE ACTIVE'}
            </span>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '3px 0 0 0' }}>
            {enabled && currentStatus === 'valid'
              ? 'Staff replies in the patient inbox and automated AI answering will send real WhatsApp messages to patients.'
              : 'Safe test mode: Replies are safely recorded in the patient medical chart without sending external WhatsApp messages.'}
          </p>
        </div>

        <label style={{ position: 'relative', display: 'inline-block', width: '44px', height: '24px', flexShrink: 0, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            style={{ opacity: 0, width: 0, height: 0 }}
          />
          <span
            style={{
              position: 'absolute',
              cursor: 'pointer',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: enabled ? 'var(--accent-primary)' : 'var(--bg-surface-active)',
              borderRadius: '24px',
              transition: 'var(--transition-fast)',
              border: '1px solid var(--border-card)',
            }}
          >
            <span
              style={{
                position: 'absolute',
                height: '18px',
                width: '18px',
                left: enabled ? '22px' : '3px',
                bottom: '2px',
                backgroundColor: '#ffffff',
                borderRadius: '50%',
                transition: 'var(--transition-fast)',
                boxShadow: 'var(--shadow-sm)',
              }}
            />
          </span>
        </label>
      </div>

      {/* ─── Credentials Form ─────────────────────────────────────────────── */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSave(false);
        }}
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-lg)',
          padding: '18px 20px',
          boxShadow: 'var(--shadow-sm)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <KeyRound size={16} color="var(--accent-primary)" />
            <h3 style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              Meta Cloud API Credentials
            </h3>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px', marginBottom: 0 }}>
            Enter your clinic's WhatsApp Phone Number ID, WhatsApp Business Account ID, and System User Access Token.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
          {/* Phone Number ID */}
          <div>
            <label
              htmlFor="whatsapp-phone-number-id"
              style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}
            >
              WhatsApp Phone Number ID *
            </label>
            <input
              id="whatsapp-phone-number-id"
              type="text"
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value.replace(/\D/g, ''))}
              placeholder="e.g. 1330570960147204"
              className="form-input"
              style={{
                width: '100%',
                fontSize: '13px',
                height: '34px',
                fontFamily: 'var(--font-mono)',
                borderColor: cleanPhoneId && !isPhoneIdValid ? 'var(--danger)' : undefined,
              }}
              required
            />
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
              From Meta Developer Portal → WhatsApp → API Setup → Phone number ID.
            </span>
          </div>

          {/* WABA ID */}
          <div>
            <label
              htmlFor="whatsapp-waba-id"
              style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}
            >
              WhatsApp Business Account ID (WABA ID)
            </label>
            <input
              id="whatsapp-waba-id"
              type="text"
              value={wabaId}
              onChange={(e) => setWabaId(e.target.value.replace(/\D/g, ''))}
              placeholder="e.g. 109283746591823"
              className="form-input"
              style={{
                width: '100%',
                fontSize: '13px',
                height: '34px',
                fontFamily: 'var(--font-mono)',
              }}
            />
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
              Found in Meta Business Manager → Accounts → WhatsApp Accounts.
            </span>
          </div>

          {/* Access Token Input */}
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
              <label
                htmlFor="whatsapp-access-token"
                style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}
              >
                Meta System User Access Token
              </label>

              {integration?.hasToken && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '11px',
                    color: 'var(--success)',
                    backgroundColor: 'var(--status-confirmed-bg)',
                    padding: '2px 8px',
                    borderRadius: 'var(--radius-xs)',
                    border: '1px solid var(--status-confirmed-border)',
                  }}
                >
                  <Lock size={10} />
                  Token configured: <strong>{integration.maskedToken}</strong> (AES-256-GCM)
                </span>
              )}
            </div>

            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                id="whatsapp-access-token"
                type={showToken ? 'text' : 'password'}
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder={
                  integration?.hasToken
                    ? 'Leave empty to preserve existing token, or paste a new token to update...'
                    : 'Paste permanent System User token (starts with EAAG...)'
                }
                autoComplete="new-password"
                className="form-input"
                style={{
                  width: '100%',
                  fontSize: '13px',
                  height: '34px',
                  paddingRight: '38px',
                  fontFamily: showToken ? 'var(--font-mono)' : 'inherit',
                }}
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                style={{
                  position: 'absolute',
                  right: '8px',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title={showToken ? 'Hide token' : 'Show token'}
              >
                {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: '6px',
                flexWrap: 'wrap',
                gap: '8px',
              }}
            >
              <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                🔒 <strong>Zero Plaintext Storage:</strong> Tokens are encrypted using AES-256-GCM server-side before database storage and never returned in plaintext.
              </span>

              {integration?.hasToken && (
                <button
                  type="button"
                  onClick={() => setConfirmDisconnectOpen(true)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--danger)',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '2px 6px',
                  }}
                >
                  <Trash2 size={12} /> Clear / Disconnect Credentials
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons Toolbar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '10px',
            paddingTop: '12px',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Validate Connection button */}
            <button
              type="button"
              onClick={handleValidateConnection}
              disabled={validating || saving || (!isConfigured && !accessToken.trim() && !cleanPhoneId)}
              className="btn btn-secondary"
              style={{
                height: '34px',
                padding: '0 14px',
                fontSize: '12.5px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {validating ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  <span>Checking with Meta...</span>
                </>
              ) : (
                <>
                  <ShieldCheck size={14} color="var(--accent-primary)" />
                  <span>Validate Connection</span>
                </>
              )}
            </button>

            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              (Checks Meta permissions without sending messages)
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Save Only */}
            <button
              type="submit"
              disabled={saving || validating}
              className="btn btn-secondary"
              style={{
                height: '34px',
                padding: '0 14px',
                fontSize: '12.5px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Save size={14} />
              <span>{saving ? 'Saving...' : 'Save Configuration'}</span>
            </button>

            {/* Save & Validate Immediately */}
            <button
              type="button"
              onClick={() => handleSave(true)}
              disabled={saving || validating}
              className="btn btn-primary"
              style={{
                height: '34px',
                padding: '0 16px',
                fontSize: '12.5px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {saving || validating ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <Sparkles size={14} />
                  <span>Save & Validate</span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* ─── Confirmation Modal for Disconnecting ─────────────────────────── */}
      {confirmDisconnectOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'var(--bg-modal-overlay)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-card)',
              borderRadius: 'var(--radius-lg)',
              padding: '20px',
              maxWidth: '440px',
              width: '100%',
              boxShadow: 'var(--shadow-modal)',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--status-cancelled-bg)',
                  color: 'var(--danger)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <AlertCircle size={18} />
              </div>
              <h4 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Disconnect WhatsApp Integration?
              </h4>
            </div>

            <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.45' }}>
              This will safely clear the stored Phone Number ID and encrypted access token for <strong>{clinic?.name}</strong>.
              The clinic will immediately fall back to safe test mode (replies recorded in patient charts only).
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
              <button
                type="button"
                onClick={() => setConfirmDisconnectOpen(false)}
                className="btn btn-secondary"
                style={{ height: '32px', padding: '0 12px', fontSize: '12px' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={saving}
                className="btn btn-danger"
                style={{ height: '32px', padding: '0 12px', fontSize: '12px' }}
              >
                {saving ? 'Disconnecting...' : 'Yes, Clear Credentials'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Security & Architecture Technical Specifications ────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '12px',
        }}
      >
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 16px',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <ShieldCheck size={16} color="var(--accent-primary)" />
            <strong style={{ fontSize: '12.5px', color: 'var(--text-primary)' }}>Zero Message Validation</strong>
          </div>
          <p style={{ fontSize: '11.5px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.45' }}>
            Credential validation executes a read-only query to Meta Graph API (<code>GET /v20.0/&#123;phone_number_id&#125;</code>) to check token ownership and WABA permissions without sending any WhatsApp message.
          </p>
        </div>

        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 16px',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <Lock size={16} color="var(--accent-primary)" />
            <strong style={{ fontSize: '12.5px', color: 'var(--text-primary)' }}>AES-256-GCM Encryption</strong>
          </div>
          <p style={{ fontSize: '11.5px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.45' }}>
            Credentials are encrypted at rest using authenticated AES-256-GCM with a dedicated environment encryption key. Tokens are never exposed in logs, AI context, or database backups.
          </p>
        </div>

        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 16px',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <Building size={16} color="var(--accent-primary)" />
            <strong style={{ fontSize: '12.5px', color: 'var(--text-primary)' }}>Strict Tenant Isolation</strong>
          </div>
          <p style={{ fontSize: '11.5px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.45' }}>
            Each clinic administrator can configure only their own clinic’s Phone Number ID. Database unique constraints prevent cross-tenant credential hijacking or duplicate number routing.
          </p>
        </div>
      </div>
    </div>
  );
};
