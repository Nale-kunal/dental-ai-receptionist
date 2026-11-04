import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar, NavTab } from './components/Sidebar';
import { Header } from './components/Header';
import { ToastProvider, useToast } from './context/ToastContext';
import { ClinicProvider } from './context/ClinicContext';
import { ThemeProvider } from './context/ThemeContext';
import { DashboardView } from './views/DashboardView';
import { AppointmentsView } from './views/AppointmentsView';
import { PatientsView } from './views/PatientsView';
import { ReceptionistView } from './views/ReceptionistView';
import { ScheduleView } from './views/ScheduleView';
import { ServicesView } from './views/ServicesView';
import { AnalyticsView } from './views/AnalyticsView';
import { AuditView } from './views/AuditView';
import { SettingsView } from './views/SettingsView';

// Modals
import { BookingModal } from './components/modals/BookingModal';
import { RescheduleModal } from './components/modals/RescheduleModal';
import { CancelModal } from './components/modals/CancelModal';
import { HandoffModal } from './components/modals/HandoffModal';

import { api } from './api/client';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginView } from './views/LoginView';
import { DemoBanner } from './components/DemoBanner';
import { demoStore } from './demo/demoStore';

interface DashboardContentProps {
  onLogout?: () => void;
  isDemoMode?: boolean;
  onResetDemo?: () => void;
  onExitDemo?: () => void;
}

const VALID_TABS: NavTab[] = ['dashboard', 'appointments', 'patients', 'receptionist', 'schedules', 'services', 'analytics', 'audit', 'settings'];

function getInitialTab(): NavTab {
  if (typeof window === 'undefined') return 'dashboard';
  const params = new URLSearchParams(window.location.search);
  const rawTab = params.get('tab');
  if (rawTab && VALID_TABS.includes(rawTab as NavTab)) return rawTab as NavTab;
  const hash = window.location.hash.toLowerCase().replace('#', '');
  if (hash && VALID_TABS.includes(hash as NavTab)) return hash as NavTab;
  if (hash.includes('whatsapp') || hash.includes('integration') || rawTab === 'whatsapp') return 'receptionist';
  const saved = localStorage.getItem('dental_active_tab');
  if (saved && VALID_TABS.includes(saved as NavTab)) return saved as NavTab;
  return 'dashboard';
}

function getInitialSubTab(): 'chats' | 'settings' | 'integration' {
  if (typeof window === 'undefined') return 'chats';
  const params = new URLSearchParams(window.location.search);
  const subtab = params.get('subtab') as 'chats' | 'settings' | 'integration' | null;
  if (subtab && ['chats', 'settings', 'integration'].includes(subtab)) return subtab;
  const hash = window.location.hash.toLowerCase();
  if (hash.includes('whatsapp') || hash.includes('integration') || params.get('tab') === 'whatsapp') {
    return 'integration';
  }
  return 'chats';
}

const DashboardContent: React.FC<DashboardContentProps> = ({
  onLogout,
  isDemoMode,
  onResetDemo,
  onExitDemo,
}) => {
  // Immediate fail-closed guard: if non-demo and credentials missing from storage, conceal dashboard immediately
  const hasValidStorage = typeof window === 'undefined' || !!localStorage.getItem('dental_token');
  if (!isDemoMode && (!api.getToken() || !api.getUser() || !hasValidStorage)) {
    return null;
  }

  const toast = useToast();
  const [activeTab, setActiveTabState] = useState<NavTab>(getInitialTab);
  const [receptionistSubTab, setReceptionistSubTab] = useState<'chats' | 'settings' | 'integration'>(getInitialSubTab);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pendingHandoffsCount, setPendingHandoffsCount] = useState(0);

  const setActiveTab = useCallback((tab: NavTab) => {
    setActiveTabState(tab);
    try {
      localStorage.setItem('dental_active_tab', tab);
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      if (tab !== 'receptionist') {
        url.searchParams.delete('conversationId');
        url.searchParams.delete('subtab');
      }
      window.history.replaceState({}, '', url.toString());
    } catch {
      // browser storage guard
    }
  }, []);

  // URL hash and query param listener for direct navigation & back/forward buttons
  useEffect(() => {
    const handleUrlChange = () => {
      const tab = getInitialTab();
      setActiveTabState(tab);
      const subtab = getInitialSubTab();
      setReceptionistSubTab(subtab);
    };
    window.addEventListener('popstate', handleUrlChange);
    window.addEventListener('hashchange', handleUrlChange);
    return () => {
      window.removeEventListener('popstate', handleUrlChange);
      window.removeEventListener('hashchange', handleUrlChange);
    };
  }, []);

  // Modal states
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [bookingDoctorId, setBookingDoctorId] = useState<string | undefined>(undefined);

  const [rescheduleModalOpen, setRescheduleModalOpen] = useState(false);
  const [selectedAppointmentForReschedule, setSelectedAppointmentForReschedule] = useState<any | null>(null);

  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [selectedAppointmentForCancel, setSelectedAppointmentForCancel] = useState<any | null>(null);

  const [handoffModalOpen, setHandoffModalOpen] = useState(false);
  const [selectedHandoff, setSelectedHandoff] = useState<any | null>(null);

  // Poll / fetch pending handoffs count for badge
  const updateHandoffBadge = useCallback(async () => {
    try {
      const res = await api.getHandoffs('pending');
      setPendingHandoffsCount(res.total || (res.items ? res.items.length : 0));
    } catch (err) {
      // silent catch for badge
    }
  }, []);

  useEffect(() => {
    // Initial auto-login check
    api.ensureAuthenticated().then(() => {
      updateHandoffBadge();
    });
    const interval = setInterval(updateHandoffBadge, 30000);

    const handleConvDeleted = () => {
      updateHandoffBadge();
    };
    const handleRefreshDash = () => {
      updateHandoffBadge();
    };
    window.addEventListener('clinic:conversation_deleted', handleConvDeleted);
    window.addEventListener('clinic:refresh_dashboard', handleRefreshDash);

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('dental_clinic_sync');
      bc.onmessage = (event) => {
        if (event?.data?.type === 'CONVERSATION_DELETED') {
          updateHandoffBadge();
          window.dispatchEvent(new CustomEvent('clinic:conversation_deleted', { detail: event.data }));
        }
      };
    } catch {
      // BroadcastChannel unsupported fallback
    }

    return () => {
      clearInterval(interval);
      window.removeEventListener('clinic:conversation_deleted', handleConvDeleted);
      window.removeEventListener('clinic:refresh_dashboard', handleRefreshDash);
      if (bc) bc.close();
    };
  }, [updateHandoffBadge]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setRefreshKey((k) => k + 1);
    await updateHandoffBadge();
    setTimeout(() => {
      setIsRefreshing(false);
      toast.info('Data Synchronized', 'Clinic records and appointment schedules are up to date.');
    }, 400);
  };

  const handleOpenBooking = (doctorId?: string) => {
    setBookingDoctorId(doctorId);
    setBookingModalOpen(true);
  };

  const handleOpenReschedule = (appt: any) => {
    setSelectedAppointmentForReschedule(appt);
    setRescheduleModalOpen(true);
  };

  const handleOpenCancel = (appt: any) => {
    setSelectedAppointmentForCancel(appt);
    setCancelModalOpen(true);
  };

  const handleOpenHandoff = (handoff: any) => {
    setSelectedHandoff(handoff);
    setHandoffModalOpen(true);
  };

  const handleConversationSelect = useCallback((convId: string) => {
    try {
      if (convId) {
        localStorage.setItem('dental_active_conversation_id', convId);
        const url = new URL(window.location.href);
        url.searchParams.set('tab', 'receptionist');
        url.searchParams.set('conversationId', convId);
        window.history.replaceState({}, '', url.toString());
      } else {
        localStorage.removeItem('dental_active_conversation_id');
        const url = new URL(window.location.href);
        url.searchParams.delete('conversationId');
        window.history.replaceState({}, '', url.toString());
      }
    } catch {
      // storage guard
    }
  }, []);

  const getSectionMetadata = () => {
    switch (activeTab) {
      case 'dashboard':
        return { title: 'Clinic Operations Command Center', subtitle: 'Live status, today\'s appointments, and patient enquiries requiring attention' };
      case 'appointments':
        return { title: 'Appointment Registry & Schedule', subtitle: 'Search, book, reschedule, or cancel patient bookings with instant conflict prevention' };
      case 'patients':
        return { title: 'Patient Directory & Medical History', subtitle: 'Directory of registered clinic patients and appointment histories' };
      case 'receptionist':
        return { title: 'AI Receptionist & Patient Inquiries', subtitle: 'Patient WhatsApp conversations, human handoffs, and receptionist behavior' };
      case 'schedules':
        return { title: 'Practitioner Rosters & Operating Hours', subtitle: 'Dentist availability, clinic business hours, and appointment slots' };
      case 'services':
        return { title: 'Clinical Services & Procedures', subtitle: 'Treatment catalog, service codes, durations, and buffer rules' };
      case 'analytics':
        return { title: 'Executive Analytics & Performance', subtitle: 'AI containment rate, patient conversions, and peak visit hours' };
      case 'audit':
        return { title: 'Compliance & Audit Trail', subtitle: 'Verified activity log tracking appointment booking and status changes' };
      case 'settings':
        return { title: 'Clinic Configuration & Settings', subtitle: 'Practice details, operating hours, treatments, and receptionist preferences' };
      default:
        return { title: 'Clinic Dashboard', subtitle: '' };
    }
  };

  const meta = getSectionMetadata();

  return (
    <div style={{ display: 'flex', height: '100vh', maxHeight: '100vh', overflow: 'hidden', backgroundColor: 'var(--bg-app)' }}>
      {/* Sidebar Navigation */}
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        pendingHandoffsCount={pendingHandoffsCount}
      />

      {/* Main Content Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, height: '100%', minHeight: 0, overflow: 'hidden' }}>
        {isDemoMode && onResetDemo && onExitDemo && (
          <DemoBanner onReset={onResetDemo} onExit={onExitDemo} />
        )}
        <Header
          title={meta.title}
          subtitle={meta.subtitle}
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing}
          onOpenBookingModal={() => handleOpenBooking()}
          pendingHandoffsCount={pendingHandoffsCount}
          onSelectTab={setActiveTab}
          onLogout={onLogout}
        />

        <main
          style={{
            flex: 1,
            padding: activeTab === 'receptionist' ? '20px 24px' : '20px 24px 0 24px',
            overflowY: activeTab === 'receptionist' ? 'hidden' : 'auto',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <div
            key={refreshKey}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            {activeTab === 'dashboard' && (
              <DashboardView
                key={refreshKey}
                onNavigate={setActiveTab}
                onOpenBookingModal={() => handleOpenBooking()}
                onOpenHandoffModal={handleOpenHandoff}
              />
            )}
            {activeTab === 'appointments' && (
              <AppointmentsView
                onOpenBookingModal={handleOpenBooking}
                onOpenRescheduleModal={handleOpenReschedule}
                onOpenCancelModal={handleOpenCancel}
              />
            )}
            {activeTab === 'patients' && (
              <PatientsView onOpenBookingModal={handleOpenBooking} />
            )}
            {activeTab === 'receptionist' && (
              <ReceptionistView
                onOpenHandoffModal={handleOpenHandoff}
                initialTab={receptionistSubTab}
                initialConversationId={new URLSearchParams(window.location.search).get('conversationId') || localStorage.getItem('dental_active_conversation_id') || undefined}
                onConversationSelect={handleConversationSelect}
              />
            )}
            {activeTab === 'schedules' && (
              <ScheduleView onOpenBookingModal={handleOpenBooking} />
            )}
            {activeTab === 'services' && <ServicesView />}
            {activeTab === 'analytics' && <AnalyticsView />}
            {activeTab === 'audit' && <AuditView />}
            {activeTab === 'settings' && <SettingsView onNavigate={setActiveTab} />}

            {/* Dedicated trailing bottom spacer: guarantees exactly 20px visible space below final content when scrolled */}
            {activeTab !== 'receptionist' && (
              <div
                data-testid="page-bottom-spacer"
                aria-hidden="true"
                style={{
                  height: '20px',
                  minHeight: '20px',
                  maxHeight: '20px',
                  flexShrink: 0,
                  width: '100%',
                  pointerEvents: 'none',
                }}
              />
            )}
          </div>
        </main>
      </div>

      {/* Action Modals */}
      <BookingModal
        isOpen={bookingModalOpen}
        onClose={() => setBookingModalOpen(false)}
        onSuccess={handleRefresh}
        preselectedDoctorId={bookingDoctorId}
      />

      <RescheduleModal
        isOpen={rescheduleModalOpen}
        appointment={selectedAppointmentForReschedule}
        onClose={() => setRescheduleModalOpen(false)}
        onSuccess={handleRefresh}
      />

      <CancelModal
        isOpen={cancelModalOpen}
        appointment={selectedAppointmentForCancel}
        onClose={() => setCancelModalOpen(false)}
        onSuccess={handleRefresh}
      />

      <HandoffModal
        isOpen={handoffModalOpen}
        handoff={selectedHandoff}
        onClose={() => setHandoffModalOpen(false)}
        onSuccess={handleRefresh}
      />
    </div>
  );
};

export const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isDemoMode, setIsDemoMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.location.pathname.startsWith('/demo');
    }
    return false;
  });

  // Effective authentication state: fails closed immediately if credentials are missing
  const hasValidStoredCredentials = isDemoMode
    ? true
    : (!!api.getToken() && !!api.getUser() && (typeof window === 'undefined' || !!localStorage.getItem('dental_token')));
  const effectiveAuthenticated = isAuthenticated === true && hasValidStoredCredentials;

  useEffect(() => {
    const isInitialDemo = typeof window !== 'undefined' && window.location.pathname.startsWith('/demo');
    if (isInitialDemo) {
      api.setDemoMode(true);
      setIsDemoMode(true);
      setIsAuthenticated(true);
    } else {
      api.ensureAuthenticated().then((authenticated) => {
        setIsAuthenticated(authenticated);
      });
    }

    // BFCache & page restoration guard: re-validate auth whenever page is shown
    const handlePageShow = (event: PageTransitionEvent) => {
      const isDemo = typeof window !== 'undefined' && window.location.pathname.startsWith('/demo');
      if (isDemo) return;

      // Fail-closed session check: if tokens or user are missing, transition to unauthenticated
      const hasValidSession = !!api.getToken() && !!api.getUser();
      if (!hasValidSession) {
        setIsAuthenticated(false);
      } else if (event.persisted) {
        // When restored from BFCache with tokens, verify validity against token expiry
        api.ensureAuthenticated().then((authenticated) => {
          if (!authenticated) {
            setIsAuthenticated(false);
          }
        });
      }
    };
    window.addEventListener('pageshow', handlePageShow);

    // History navigation listener: Back and Forward buttons
    const handleLocationChange = () => {
      const isDemo = typeof window !== 'undefined' && window.location.pathname.startsWith('/demo');
      if (isDemo !== api.isDemoMode()) {
        api.setDemoMode(isDemo);
        setIsDemoMode(isDemo);
        if (isDemo) {
          setIsAuthenticated(true);
        } else {
          api.ensureAuthenticated().then((authenticated) => {
            setIsAuthenticated(authenticated);
          });
        }
      } else if (!isDemo) {
        // Enforce fail-closed check on history navigation:
        const hasValidSession = !!api.getToken() && !!api.getUser();
        if (!hasValidSession) {
          setIsAuthenticated(false);
        }
      }
    };

    // Cross-tab logout listener: invalidate when tokens are removed in another tab
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'dental_token' && !e.newValue) {
        api.clearSession();
        setIsAuthenticated(false);
      }
    };
    window.addEventListener('storage', handleStorageChange);

    // Intra-app auth change listener: triggered whenever clearSession() is executed (e.g. on 401s)
    const handleAuthChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.authenticated === false) {
        setIsAuthenticated(false);
      }
    };
    window.addEventListener('dental:auth_change', handleAuthChange);

    window.addEventListener('popstate', handleLocationChange);
    return () => {
      window.removeEventListener('popstate', handleLocationChange);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('dental:auth_change', handleAuthChange);
    };
  }, []);

  const handleEnterDemo = () => {
    api.setDemoMode(true);
    try {
      window.history.pushState({}, '', '/demo' + (window.location.search || ''));
    } catch {
      // browser history guard
    }
    setIsDemoMode(true);
    setIsAuthenticated(true);
  };

  const handleExitDemo = () => {
    api.setDemoMode(false);
    try {
      window.history.pushState({}, '', '/');
    } catch {
      // browser history guard
    }
    setIsDemoMode(false);
    setIsAuthenticated(api.getUser() !== null && !!api.getToken());
  };

  const handleResetDemo = () => {
    demoStore.reset();
    window.dispatchEvent(new CustomEvent('clinic:refresh_dashboard'));
  };

  if (isAuthenticated === null) {
    return (
      <div
        style={{
          display: 'flex',
          height: '100vh',
          width: '100vw',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'var(--bg-app)',
          color: 'var(--text-secondary)',
          fontSize: '14px',
          fontFamily: 'var(--font-sans, system-ui, sans-serif)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            className="spin"
            style={{
              width: '20px',
              height: '20px',
              border: '2px solid var(--accent-primary)',
              borderTopColor: 'transparent',
              borderRadius: '50%',
            }}
          />
          <span style={{ fontWeight: 500 }}>Connecting to Clinic Operations...</span>
        </div>
      </div>
    );
  }

  return (
    <ThemeProvider>
      <ToastProvider>
        {!effectiveAuthenticated ? (
          <LoginView
            onSuccess={() => setIsAuthenticated(true)}
            onExploreDemo={handleEnterDemo}
          />
        ) : (
          <ClinicProvider>
            <ErrorBoundary name="Clinic Operations Dashboard">
              <DashboardContent
                onLogout={() => {
                  if (isDemoMode) {
                    handleExitDemo();
                  } else {
                    // 1. Synchronously clear session credentials from memory and storage immediately
                    api.clearSession();
                    // 2. Dispatch non-blocking server revocation request
                    api.logout().catch(() => {});
                    // 3. Clear session-specific localStorage keys
                    try {
                      localStorage.removeItem('dental_active_tab');
                      localStorage.removeItem('dental_active_conversation_id');
                    } catch {/* storage guard */}
                    // 4. Transition to unauthenticated state immediately
                    setIsAuthenticated(false);
                    // 5. Replace current history entry so Back doesn't restore this URL as authenticated
                    try {
                      window.history.replaceState({ loggedOut: true }, '', '/');
                    } catch {/* history guard */}
                  }
                }}
                isDemoMode={isDemoMode}
                onResetDemo={handleResetDemo}
                onExitDemo={handleExitDemo}
              />
            </ErrorBoundary>
          </ClinicProvider>
        )}
      </ToastProvider>
    </ThemeProvider>
  );
};

export default App;
