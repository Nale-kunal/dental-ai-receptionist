import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Pre-Mount Fail-Closed Bootstrap Guard:
// Synchronously inspect session credentials before React even evaluates or renders
function syncDocumentAuthState() {
  if (typeof window === 'undefined') return;
  const token = localStorage.getItem('dental_token');
  const user = localStorage.getItem('dental_user');
  const demoActive = sessionStorage.getItem('dental_demo_active') === 'true' && window.location.pathname.startsWith('/demo');

  if ((token && user) || demoActive) {
    document.documentElement.classList.add('auth-authenticated');
    document.documentElement.classList.remove('auth-unauthenticated');
    document.documentElement.setAttribute('data-auth-state', 'authenticated');
  } else {
    document.documentElement.classList.add('auth-unauthenticated');
    document.documentElement.classList.remove('auth-authenticated');
    document.documentElement.setAttribute('data-auth-state', 'unauthenticated');
  }
}

// Initial bootstrap run before mounting
syncDocumentAuthState();

// Global pre-render BFCache restoration trap: runs before any frame is painted
window.addEventListener('pageshow', () => {
  const token = localStorage.getItem('dental_token');
  const demoActive = sessionStorage.getItem('dental_demo_active') === 'true' && window.location.pathname.startsWith('/demo');
  const hasValidAuth = Boolean(token || demoActive);

  if (!hasValidAuth) {
    // Immediately conceal protected container at document level
    document.documentElement.classList.add('auth-unauthenticated');
    document.documentElement.classList.remove('auth-authenticated');
    document.documentElement.setAttribute('data-auth-state', 'unauthenticated');

    if (window.location.search || window.location.hash || window.location.pathname.startsWith('/demo')) {
      try {
        window.history.replaceState({ loggedOut: true, auth: false }, '', '/');
      } catch {}
    }
  }
});

// Global pre-render popstate trap: runs immediately when user presses Back/Forward
window.addEventListener('popstate', () => {
  const token = localStorage.getItem('dental_token');
  const demoActive = sessionStorage.getItem('dental_demo_active') === 'true' && window.location.pathname.startsWith('/demo');
  const hasValidAuth = Boolean(token || demoActive);

  if (!hasValidAuth) {
    document.documentElement.classList.add('auth-unauthenticated');
    document.documentElement.classList.remove('auth-authenticated');
    document.documentElement.setAttribute('data-auth-state', 'unauthenticated');

    if (window.location.search || window.location.hash || window.location.pathname.startsWith('/demo')) {
      try {
        window.history.replaceState({ loggedOut: true, auth: false }, '', '/');
      } catch {}
    }
  }
});

// Global pagehide trap: when page is frozen into BFCache, ensure fail-closed state
window.addEventListener('pagehide', () => {
  const token = localStorage.getItem('dental_token');
  const demoActive = sessionStorage.getItem('dental_demo_active') === 'true' && window.location.pathname.startsWith('/demo');
  if (!token && !demoActive) {
    document.documentElement.classList.add('auth-unauthenticated');
    document.documentElement.classList.remove('auth-authenticated');
    document.documentElement.setAttribute('data-auth-state', 'unauthenticated');
  }
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
