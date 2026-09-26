import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getUnreadNotificationCount } from '../api/notifications';
import { subscribeToUnreadCountChanges } from '../notifications/unreadCountBus';
import { Button } from '../ui';

const MOBILE_NAV_ID = 'mobile-nav';

// Polled rather than pushed — the app has no websocket/SSE channel, and a once-a-minute
// staleness window is fine for a low-traffic single-property admin tool. Actions taken in
// this same tab (e.g. marking a notification read) refresh it immediately instead of waiting
// for the next tick - see unreadCountBus.
const UNREAD_POLL_MS = 60_000;

const sections = [
  { to: '/', label: 'Reservas', end: true },
  { to: '/guests', label: 'Huéspedes' },
  { to: '/templates', label: 'Plantillas' },
  { to: '/campaigns', label: 'Campañas' },
  { to: '/activity', label: 'Registro de actividad' },
  { to: '/notifications', label: 'Notificaciones' },
  { to: '/sensors', label: 'Sensores' },
  { to: '/settings', label: 'Configuración' },
];

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded px-3 py-1.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
    isActive ? 'bg-accent text-accent-fg' : 'text-text-muted hover:text-heading'
  }`;

export function AppNav() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const mobileNavRef = useRef<HTMLElement>(null);

  useEffect(() => {
    function refreshUnreadCount() {
      getUnreadNotificationCount()
        .then(({ count }) => setUnreadCount(count))
        .catch(() => {});
    }
    refreshUnreadCount();
    const interval = setInterval(refreshUnreadCount, UNREAD_POLL_MS);
    const unsubscribe = subscribeToUnreadCountChanges(refreshUnreadCount);
    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, []);

  // Move focus into the opened menu (first link) so keyboard/screen-reader users land
  // somewhere useful instead of the menu just appearing with focus still on the toggle.
  useEffect(() => {
    if (menuOpen) {
      mobileNavRef.current?.querySelector<HTMLElement>('a')?.focus();
    }
  }, [menuOpen]);

  function closeMenu() {
    setMenuOpen(false);
    menuToggleRef.current?.focus();
  }

  function handleMenuKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      closeMenu();
    }
  }

  function handleLogout() {
    setMenuOpen(false);
    logout();
    navigate('/login');
  }

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <span className="font-heading text-lg font-bold text-heading">
          La <span className="italic">Brisa</span>
        </span>
        <nav className="hidden flex-wrap items-center gap-1 text-sm sm:flex">
          {sections.map((section) => (
            <NavLink key={section.to} to={section.to} end={section.end} className={linkClass}>
              {section.label}
              {section.to === '/notifications' && unreadCount > 0 && (
                <span
                  className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-xs font-bold text-white"
                  aria-label={`${unreadCount} sin leer`}
                >
                  {unreadCount}
                </span>
              )}
            </NavLink>
          ))}
          <Button type="button" variant="secondary" className="ml-2" onClick={handleLogout}>
            Cerrar sesión
          </Button>
        </nav>
        <button
          type="button"
          ref={menuToggleRef}
          aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'}
          aria-expanded={menuOpen}
          aria-controls={MOBILE_NAV_ID}
          onClick={() => setMenuOpen((v) => !v)}
          className="flex min-h-11 min-w-11 items-center justify-center rounded text-xl text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:hidden"
        >
          {menuOpen ? '✕' : '☰'}
        </button>
      </div>
      {menuOpen && (
        <nav
          id={MOBILE_NAV_ID}
          ref={mobileNavRef}
          onKeyDown={handleMenuKeyDown}
          className="flex flex-col gap-1 border-t border-border px-4 py-3 text-sm sm:hidden"
        >
          {sections.map((section) => (
            <NavLink
              key={section.to}
              to={section.to}
              end={section.end}
              onClick={() => setMenuOpen(false)}
              className={linkClass}
            >
              {section.label}
              {section.to === '/notifications' && unreadCount > 0 && (
                <span
                  className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-xs font-bold text-white"
                  aria-label={`${unreadCount} sin leer`}
                >
                  {unreadCount}
                </span>
              )}
            </NavLink>
          ))}
          <Button type="button" variant="secondary" className="mt-2" onClick={handleLogout}>
            Cerrar sesión
          </Button>
        </nav>
      )}
    </header>
  );
}
