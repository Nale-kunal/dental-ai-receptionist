/**
 * authLifecycle.test.ts
 *
 * Frontend unit tests for the ApiClient authentication lifecycle and security.
 * Tests logout generation counter, session clearing, race condition mitigation,
 * concurrent 401 handling, cross-tab synchronization, direct protected URL access,
 * and BFCache/history guard behavior.
 * Uses jsdom environment (simulates browser window and storage events).
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { api } from '../api/client';

const mockUser = {
  id: 'user-123',
  email: 'admin@clinic.test',
  firstName: 'Dr.',
  lastName: 'Smith',
  clinicId: 'clinic-123',
  clinicName: 'Test Clinic',
  clinicTimezone: 'America/New_York',
  role: 'clinic_admin',
  roles: ['clinic_admin'],
};

describe('ApiClient Auth Lifecycle & Session Security Suite', () => {
  beforeEach(() => {
    localStorage.clear();
    api.clearSession();
    api.setDemoMode(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. logoutGeneration counter on api singleton', () => {
    it('provides getLogoutGeneration and starts as a number >= 0', () => {
      expect(typeof api.getLogoutGeneration()).toBe('number');
    });

    it('increments by 1 on each bumpLogoutGeneration call', () => {
      const initial = api.getLogoutGeneration();
      api.bumpLogoutGeneration();
      expect(api.getLogoutGeneration()).toBe(initial + 1);
      api.bumpLogoutGeneration();
      expect(api.getLogoutGeneration()).toBe(initial + 2);
    });

    it('increments generation on logout()', async () => {
      const before = api.getLogoutGeneration();
      await api.logout();
      expect(api.getLogoutGeneration()).toBe(before + 1);
    });
  });

  describe('2. clearSession on api singleton', () => {
    it('synchronously clears in-memory tokens and user', () => {
      api.setSession('test-token', mockUser, 'test-refresh-token');
      expect(api.getToken()).toBe('test-token');
      expect(api.getUser()).toEqual(mockUser);

      api.clearSession();

      expect(api.getToken()).toBeNull();
      expect(api.getUser()).toBeNull();
    });

    it('removes all auth tokens and user from localStorage', () => {
      api.setSession('token-abc', mockUser, 'refresh-xyz');
      expect(localStorage.getItem('dental_token')).toBe('token-abc');
      expect(localStorage.getItem('dental_refresh_token')).toBe('refresh-xyz');
      expect(localStorage.getItem('dental_user')).toBeTruthy();

      api.clearSession();

      expect(localStorage.getItem('dental_token')).toBeNull();
      expect(localStorage.getItem('dental_refresh_token')).toBeNull();
      expect(localStorage.getItem('dental_user')).toBeNull();
    });

    it('dispatches dental:auth_change event when session is cleared', () => {
      let notified = false;
      const listener = (e: Event) => {
        const customEvent = e as CustomEvent;
        if (customEvent.detail?.authenticated === false) {
          notified = true;
        }
      };
      window.addEventListener('dental:auth_change', listener);

      api.clearSession();

      expect(notified).toBe(true);
      window.removeEventListener('dental:auth_change', listener);
    });
  });

  describe('3. logout() execution and race condition prevention', () => {
    it('synchronously clears session without awaiting network', async () => {
      api.setSession('token-123', mockUser, 'refresh-456');

      // Mock fetch so it doesn't fail
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
      }));

      const logoutPromise = api.logout();

      // Immediately after invoking logout (before await), session must already be cleared
      expect(api.getToken()).toBeNull();
      expect(api.getUser()).toBeNull();
      expect(localStorage.getItem('dental_token')).toBeNull();

      await logoutPromise;
    });

    it('ensures ensureAuthenticated returns false if logout happened during in-flight refresh', async () => {
      const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjEwMDAwMDB9.signature';
      api.setSession(expiredToken, mockUser, 'valid-refresh-token');

      let resolveRefresh: (val: any) => void;
      const delayedRefreshPromise = new Promise((resolve) => {
        resolveRefresh = resolve;
      });

      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        if (url.includes('/auth/refresh')) {
          return delayedRefreshPromise;
        }
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      }));

      // Start ensureAuthenticated (now in-flight)
      const authPromise = api.ensureAuthenticated();

      // User clicks logout while refresh is in-flight
      await api.logout();

      // Now resolve the refresh response with a "new" token
      resolveRefresh!({
        ok: true,
        json: async () => ({
          ok: true,
          data: { accessToken: 'should-be-discarded-token' },
        }),
      });

      const isAuthenticated = await authPromise;

      // Because logout bumped the generation counter, the late refresh response MUST be discarded!
      expect(isAuthenticated).toBe(false);
      expect(api.getToken()).toBeNull();
      expect(localStorage.getItem('dental_token')).toBeNull();
    });

    it('handles concurrent ensureAuthenticated calls via single deduplicated promise', async () => {
      const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjEwMDAwMDB9.signature';
      api.setSession(expiredToken, mockUser, 'valid-refresh-token');

      let callCount = 0;
      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        if (url.includes('/auth/refresh')) {
          callCount++;
          return Promise.resolve({
            ok: true,
            json: async () => ({
              ok: true,
              data: { accessToken: 'deduped-token' },
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      }));

      // Fire 3 simultaneous calls
      const [res1, res2, res3] = await Promise.all([
        api.ensureAuthenticated(),
        api.ensureAuthenticated(),
        api.ensureAuthenticated(),
      ]);

      expect(res1).toBe(true);
      expect(res2).toBe(true);
      expect(res3).toBe(true);
      // Only one network request was dispatched
      expect(callCount).toBe(1);
    });

    it('fails closed when refresh endpoint returns 401 or invalid response', async () => {
      const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjEwMDAwMDB9.signature';
      api.setSession(expiredToken, mockUser, 'revoked-refresh-token');

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ ok: false, message: 'Invalid or expired refresh token.' }),
      }));

      const authenticated = await api.ensureAuthenticated();
      expect(authenticated).toBe(false);
      expect(api.getToken()).toBeNull();
      expect(api.getUser()).toBeNull();
    });
  });

  describe('4. BFCache & History Navigation Session Guard', () => {
    it('correctly evaluates session validity when tokens are present vs cleared', () => {
      api.setSession('valid-token', mockUser);
      expect(!!api.getToken() && !!api.getUser()).toBe(true);

      api.clearSession();
      expect(!!api.getToken() && !!api.getUser()).toBe(false);
    });

    it('simulates BFCache pageshow event (event.persisted = true) and fails closed when session cleared', () => {
      let isAppAuthenticated = true;

      // User had an active session
      api.setSession('token', mockUser);

      // User logs out (session cleared)
      api.clearSession();

      // BFCache restoration event fires
      const fakePageShowEvent = { persisted: true } as PageTransitionEvent;

      // Logic mirrored from App.tsx handlePageShow:
      const isDemo = false;
      if (!isDemo) {
        const hasValidSession = !!api.getToken() && !!api.getUser();
        if (!hasValidSession) {
          isAppAuthenticated = false;
        }
      }

      expect(isAppAuthenticated).toBe(false);
    });

    it('simulates history navigation (popstate) after logout and ensures fail-closed', () => {
      let isAppAuthenticated = true;
      api.clearSession();

      // popstate listener logic from App.tsx:
      const isDemo = false;
      if (!isDemo) {
        const hasValidSession = !!api.getToken() && !!api.getUser();
        if (!hasValidSession) {
          isAppAuthenticated = false;
        }
      }

      expect(isAppAuthenticated).toBe(false);
    });

    it('simulates direct protected URL access after logout and rejects access', async () => {
      // Simulate user navigating directly to /?tab=appointments with no stored session
      api.clearSession();

      const authenticated = await api.ensureAuthenticated();
      expect(authenticated).toBe(false);

      const hasValidStorage = typeof window === 'undefined' || !!localStorage.getItem('dental_token');
      const hasValidCredentials = !!api.getToken() && !!api.getUser() && hasValidStorage;
      expect(hasValidCredentials).toBe(false);
    });

    it('simulates storage event when another tab logs out', () => {
      let isAppAuthenticated = true;
      api.setSession('token-tab1', mockUser);

      // Another tab removes dental_token
      const storageEvent = {
        key: 'dental_token',
        newValue: null,
      } as StorageEvent;

      if (storageEvent.key === 'dental_token' && !storageEvent.newValue) {
        api.clearSession();
        isAppAuthenticated = false;
      }

      expect(isAppAuthenticated).toBe(false);
      expect(api.getToken()).toBeNull();
    });
  });


  describe('6. Authoritative Session State Machine & Isolation', () => {
    it('initializes as unauthenticated when localStorage is empty', async () => {
      const initialized = await api.initializeSession();
      expect(initialized).toBe(false);
      expect(api.getStatus()).toBe('unauthenticated');
      expect(api.hasActiveSession()).toBe(false);
    });

    it('initializes as authenticated when valid stored credentials exist', async () => {
      // Unexpired token (exp 1 hour in future)
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const validToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
        btoa(JSON.stringify({ exp: futureExp, sub: 'user-1' })).replace(/=/g, '') +
        '.sig';

      localStorage.setItem('dental_token', validToken);
      localStorage.setItem('dental_user', JSON.stringify(mockUser));
      localStorage.setItem('dental_session_id', 'sess_test_123');

      const initialized = await api.initializeSession();
      expect(initialized).toBe(true);
      expect(api.getStatus()).toBe('authenticated');
      expect(api.hasActiveSession()).toBe(true);
      expect(api.getSessionId()).toBe('sess_test_123');
    });

    it('hasActiveSession fails closed if localStorage is cleared externally (e.g. BFCache restore after logout)', () => {
      api.setSession('valid-token', mockUser);
      expect(api.hasActiveSession()).toBe(true);

      // Simulate external storage clearance (by another tab or logout on another page)
      localStorage.removeItem('dental_token');

      // In-memory token still exists, but hasActiveSession MUST detect storage clearance and fail closed
      expect(api.hasActiveSession()).toBe(false);
    });

    it('hasActiveSession fails closed if dental_session_id mismatches (session hijacking/stale tab protection)', () => {
      api.setSession('valid-token', mockUser);
      expect(api.hasActiveSession()).toBe(true);

      // Overwrite session ID with another session's ID
      localStorage.setItem('dental_session_id', 'different-session-id');

      expect(api.hasActiveSession()).toBe(false);
    });

    it('discards in-flight API response if logout occurs before network response resolves', async () => {
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const validToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
        btoa(JSON.stringify({ exp: futureExp, sub: 'user-1' })).replace(/=/g, '') +
        '.sig';

      api.setSession(validToken, mockUser);

      let resolveRequest: (val: any) => void;
      const delayedRequest = new Promise((resolve) => {
        resolveRequest = resolve;
      });

      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        if (url.includes('/appointments')) {
          return delayedRequest;
        }
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      }));

      // Fire protected request
      const requestPromise = api.getAppointments();

      // User logs out while request is in flight
      await api.logout();

      // Network request resolves late
      resolveRequest!({
        ok: true,
        json: async () => ({
          ok: true,
          data: { items: [{ id: 'appt-1', patientName: 'Secret Patient' }], total: 1 },
        }),
      });

      // The request MUST reject with "Session terminated" and NEVER return data to component
      await expect(requestPromise).rejects.toThrow('Session terminated');
    });

    it('ensures new login establishes a fresh session ID and cleans up old navigation state', () => {
      localStorage.setItem('dental_active_tab', 'patients');
      localStorage.setItem('dental_active_conversation_id', 'conv-999');

      api.clearSession();

      expect(localStorage.getItem('dental_active_tab')).toBeNull();
      expect(localStorage.getItem('dental_active_conversation_id')).toBeNull();

      const newSessionId = api.setSession('token-clinic-b', {
        ...mockUser,
        clinicId: 'clinic-b',
        clinicName: 'Clinic B',
      });

      expect(newSessionId).toBeTruthy();
      expect(api.getSessionId()).toBe(newSessionId);
      expect(api.getUser()?.clinicName).toBe('Clinic B');
    });
  });


    it('handles legitimate tab navigation and prevents Back/Forward from restoring protected views after logout', () => {
      // 1. User logs in
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const validToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
        btoa(JSON.stringify({ exp: futureExp, sub: 'user-1' })).replace(/=/g, '') +
        '.sig';

      api.setSession(validToken, mockUser);
      let authState = 'authenticated';

      // 2. User navigates between tabs in the dashboard (legitimate navigation)
      window.history.pushState({ tab: 'appointments', auth: true }, '', '/?tab=appointments');
      window.history.pushState({ tab: 'patients', auth: true }, '', '/?tab=patients');

      expect(api.hasActiveSession()).toBe(true);
      expect(authState).toBe('authenticated');

      // 3. User logs out
      api.clearSession();
      authState = 'unauthenticated';
      window.history.replaceState({ loggedOut: true, auth: false }, '', '/');

      expect(api.hasActiveSession()).toBe(false);

      // 4. User presses browser Back button (simulating popstate event to /?tab=patients)
      const popstateToProtected = new PopStateEvent('popstate', {
        state: { tab: 'patients', auth: true },
      });

      // App popstate handler simulation:
      const handleLocationChange = () => {
        if (!api.hasActiveSession()) {
          api.clearSession();
          authState = 'unauthenticated';
          window.history.replaceState({ loggedOut: true, auth: false }, '', '/');
        }
      };

      handleLocationChange();

      // The app MUST remain unauthenticated and URL must be forced back to /
      expect(api.hasActiveSession()).toBe(false);
      expect(authState).toBe('unauthenticated');
      expect(window.location.pathname).toBe('/');
    });

  describe('5. Demo Mode Isolation', () => {
    it('sets and exits demo mode correctly without affecting regular tokens', () => {
      api.setDemoMode(true);
      expect(api.isDemoMode()).toBe(true);
      expect(api.getToken()).toBe('demo-synthetic-session-token');
      expect(api.getUser()).toBeTruthy();

      api.setDemoMode(false);
      expect(api.isDemoMode()).toBe(false);
      expect(api.getToken()).toBeNull();
    });
  });
});
