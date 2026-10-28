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

interface DashboardContentProps {
  onLogout?: () => void;
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

const DashboardContent: React.FC<DashboardContentProps> = ({ onLogout }) => {
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
    return () => clearInterval(interval);
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

  useEffect(() => {
    api.ensureAuthenticated().then((authenticated) => {
      setIsAuthenticated(authenticated);
    });
  }, []);

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
        {!isAuthenticated ? (
          <LoginView onSuccess={() => setIsAuthenticated(true)} />
        ) : (
          <ClinicProvider>
            <ErrorBoundary name="Clinic Operations Dashboard">
              <DashboardContent onLogout={() => setIsAuthenticated(false)} />
            </ErrorBoundary>
          </ClinicProvider>
        )}
      </ToastProvider>
    </ThemeProvider>
  );
};

export default App;
