import React, { useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../context/ThemeContext';
import {
  ShieldCheck,
  Lock,
  Mail,
  Building,
  User,
  Clock,
  ArrowRight,
  RefreshCw,
  Sparkles,
  Phone,
  AlertCircle,
  Sun,
  Moon,
} from 'lucide-react';

interface LoginViewProps {
  onSuccess: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onSuccess }) => {
  const toast = useToast();
  const { theme, toggleTheme } = useTheme();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sign In Form State
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Sign Up Form State
  const [clinicName, setClinicName] = useState('');
  const [fullName, setFullName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [timezone, setTimezone] = useState('America/New_York');
  const [phone, setPhone] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setLoading(true);

    try {
      await api.login(loginEmail, loginPassword);
      toast.success('Welcome Back', 'Signed in to clinic operations successfully.');
      onSuccess();
    } catch (err: any) {
      const msg = err.message || 'Invalid email or password.';
      setErrorMessage(msg);
      toast.error('Authentication Failed', msg);
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setLoading(true);

    try {
      await api.signup({
        clinicName,
        fullName,
        email: signupEmail,
        password: signupPassword,
        timezone,
        phone,
      });
      toast.success('Clinic Onboarded', `${clinicName} created with initial administrator account.`);
      onSuccess();
    } catch (err: any) {
      const msg = err.message || 'Unable to register clinic. Please check your inputs.';
      setErrorMessage(msg);
      toast.error('Onboarding Failed', msg);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickDemoLogin = async () => {
    setErrorMessage(null);
    setLoading(true);
    try {
      await api.login('admin@demo.example.com', 'password123');
      toast.success('Demo Clinic Connected', 'Signed in as Demo Administrator.');
      onSuccess();
    } catch (err: any) {
      const msg = err.message || 'Failed to sign in with demo credentials.';
      setErrorMessage(msg);
      toast.error('Demo Login Failed', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100vw',
        backgroundColor: 'var(--bg-app)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        position: 'relative',
        transition: 'background-color var(--transition-normal)',
      }}
    >
      {/* Theme Toggle in top right */}
      <div style={{ position: 'absolute', top: '20px', right: '24px' }}>
        <button
          type="button"
          onClick={toggleTheme}
          title={theme === 'light' ? 'Switch to Dark theme' : 'Switch to Light Cream theme'}
          aria-label={theme === 'light' ? 'Switch to Dark theme' : 'Switch to Light Cream theme'}
          className="btn-icon"
          style={{
            width: '36px',
            height: '36px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-card)',
            backgroundColor: 'var(--bg-surface)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
        </button>
      </div>

      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '440px',
          backgroundColor: 'var(--bg-surface)',
          borderRadius: 'var(--radius-xl)',
          border: '1px solid var(--border-card)',
          boxShadow: 'var(--shadow-lg)',
          padding: '36px 32px',
          color: 'var(--text-primary)',
          transition: 'background-color var(--transition-normal), border-color var(--transition-normal)',
        }}
      >
        {/* Brand Header */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div
            style={{
              width: '46px',
              height: '46px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--accent-subtle)',
              border: '1px solid var(--accent-border)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-primary)',
              marginBottom: '12px',
            }}
          >
            <ShieldCheck size={24} />
          </div>
          <h1
            style={{
              fontSize: '20px',
              fontWeight: 600,
              letterSpacing: '-0.018em',
              margin: '0 0 4px 0',
              color: 'var(--text-primary)',
            }}
          >
            Dental AI Receptionist
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
            Clinic Operations & Patient Communications
          </p>
        </div>

        {/* Tab Toggle: Segmented Control */}
        <div
          style={{
            display: 'flex',
            backgroundColor: 'var(--bg-surface-secondary)',
            borderRadius: 'var(--radius-sm)',
            padding: '3px',
            marginBottom: '20px',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setErrorMessage(null);
            }}
            style={{
              flex: 1,
              padding: '7px 12px',
              borderRadius: 'var(--radius-xs)',
              fontSize: '12.5px',
              fontWeight: 500,
              border: 'none',
              cursor: 'pointer',
              backgroundColor: mode === 'login' ? 'var(--bg-surface)' : 'transparent',
              color: mode === 'login' ? 'var(--text-primary)' : 'var(--text-secondary)',
              boxShadow: mode === 'login' ? 'var(--shadow-sm)' : 'none',
              transition: 'all var(--transition-fast)',
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('signup');
              setErrorMessage(null);
            }}
            style={{
              flex: 1,
              padding: '7px 12px',
              borderRadius: 'var(--radius-xs)',
              fontSize: '12.5px',
              fontWeight: 500,
              border: 'none',
              cursor: 'pointer',
              backgroundColor: mode === 'signup' ? 'var(--bg-surface)' : 'transparent',
              color: mode === 'signup' ? 'var(--text-primary)' : 'var(--text-secondary)',
              boxShadow: mode === 'signup' ? 'var(--shadow-sm)' : 'none',
              transition: 'all var(--transition-fast)',
            }}
          >
            Register Clinic
          </button>
        </div>

        {/* Alert banner for error feedback */}
        {errorMessage && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '9px',
              padding: '10px 12px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--status-cancelled-bg)',
              border: '1px solid var(--status-cancelled-border)',
              color: 'var(--status-cancelled-text)',
              fontSize: '12px',
              marginBottom: '16px',
              lineHeight: 1.4,
            }}
          >
            <AlertCircle size={15} style={{ flexShrink: 0 }} />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Form Body */}
        {mode === 'login' ? (
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label className="form-label">
                Clinic Email
              </label>
              <div style={{ position: 'relative' }}>
                <Mail size={15} style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--text-muted)' }} />
                <input
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="admin@demo.example.com"
                  className="form-input"
                  style={{ paddingLeft: '36px' }}
                />
              </div>
            </div>

            <div>
              <label className="form-label">
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <Lock size={15} style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--text-muted)' }} />
                <input
                  type="password"
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="form-input"
                  style={{ paddingLeft: '36px' }}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              style={{
                marginTop: '6px',
                padding: '10px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: loading ? 'wait' : 'pointer',
                gap: '8px',
              }}
            >
              {loading ? (
                <>
                  <RefreshCw size={14} className="spin" />
                  <span>Verifying Credentials...</span>
                </>
              ) : (
                <>
                  <span>Sign In to Clinic Dashboard</span>
                  <ArrowRight size={14} />
                </>
              )}
            </button>

            {/* Quick Demo Access Button */}
            <div style={{ marginTop: '10px', paddingTop: '14px', borderTop: '1px solid var(--border-subtle)' }}>
              <button
                type="button"
                onClick={handleQuickDemoLogin}
                disabled={loading}
                className="btn btn-secondary"
                style={{
                  width: '100%',
                  padding: '9px',
                  fontSize: '12.5px',
                  fontWeight: 500,
                  cursor: loading ? 'wait' : 'pointer',
                  gap: '6px',
                }}
              >
                <Sparkles size={13} color="var(--accent-primary)" />
                <span>Quick Sign In with Demo Clinic</span>
              </button>
            </div>
          </form>
        ) : (
          /* Clinic Self-Service Onboarding Form */
          <form onSubmit={handleSignup} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label className="form-label">
                Dental Practice / Clinic Name
              </label>
              <div style={{ position: 'relative' }}>
                <Building size={14} style={{ position: 'absolute', left: '11px', top: '10px', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  required
                  value={clinicName}
                  onChange={(e) => setClinicName(e.target.value)}
                  placeholder="Grand Central Dental Associates"
                  className="form-input"
                  style={{ paddingLeft: '34px' }}
                />
              </div>
            </div>

            <div>
              <label className="form-label">
                Clinic Administrator / Doctor Full Name
              </label>
              <div style={{ position: 'relative' }}>
                <User size={14} style={{ position: 'absolute', left: '11px', top: '10px', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Dr. Sarah Johnson, DDS"
                  className="form-input"
                  style={{ paddingLeft: '34px' }}
                />
              </div>
            </div>

            <div>
              <label className="form-label">
                Account Email (Login Identifier)
              </label>
              <div style={{ position: 'relative' }}>
                <Mail size={14} style={{ position: 'absolute', left: '11px', top: '10px', color: 'var(--text-muted)' }} />
                <input
                  type="email"
                  required
                  value={signupEmail}
                  onChange={(e) => setSignupEmail(e.target.value)}
                  placeholder="dr.johnson@grandcentraldental.com"
                  className="form-input"
                  style={{ paddingLeft: '34px' }}
                />
              </div>
            </div>

            <div>
              <label className="form-label">
                Password (min 8 characters)
              </label>
              <div style={{ position: 'relative' }}>
                <Lock size={14} style={{ position: 'absolute', left: '11px', top: '10px', color: 'var(--text-muted)' }} />
                <input
                  type="password"
                  required
                  minLength={8}
                  value={signupPassword}
                  onChange={(e) => setSignupPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="form-input"
                  style={{ paddingLeft: '34px' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label className="form-label">
                  Operating Timezone
                </label>
                <div style={{ position: 'relative' }}>
                  <Clock size={13} style={{ position: 'absolute', left: '9px', top: '10px', color: 'var(--text-muted)' }} />
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="form-input"
                    style={{ paddingLeft: '28px', fontSize: '11.5px' }}
                  >
                    <option value="America/New_York">America/New_York (ET)</option>
                    <option value="America/Chicago">America/Chicago (CT)</option>
                    <option value="America/Denver">America/Denver (MT)</option>
                    <option value="America/Los_Angeles">America/Los_Angeles (PT)</option>
                    <option value="Europe/London">Europe/London (GMT/BST)</option>
                    <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="form-label">
                  Clinic Phone (Optional)
                </label>
                <div style={{ position: 'relative' }}>
                  <Phone size={13} style={{ position: 'absolute', left: '9px', top: '10px', color: 'var(--text-muted)' }} />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1 212-555-0199"
                    className="form-input"
                    style={{ paddingLeft: '28px', fontSize: '11.5px' }}
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              style={{
                marginTop: '8px',
                padding: '10px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: loading ? 'wait' : 'pointer',
                gap: '8px',
              }}
            >
              {loading ? (
                <>
                  <RefreshCw size={14} className="spin" />
                  <span>Creating Clinic Tenant...</span>
                </>
              ) : (
                <>
                  <span>Register & Initialize Clinic</span>
                  <ArrowRight size={14} />
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
