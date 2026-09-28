import { KeyboardEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getUnreadNotificationCount } from '../api/notifications';
import { subscribeToUnreadCountChanges } from '../notifications/unreadCountBus';
import { getConfig } from '../api/config';

const MOBILE_NAV_ID = 'mobile-nav';

// Polled rather than pushed — the app has no websocket/SSE channel, and a once-a-minute
// staleness window is fine for a low-traffic single-property admin tool. Actions taken in
// this same tab (e.g. marking a notification read) refresh it immediately instead of waiting
// for the next tick - see unreadCountBus.
const UNREAD_POLL_MS = 60_000;

// Same source AppFooter uses for the debug-mode banner — fetched independently here rather
// than shared via context, matching how this component already independently polls the
// unread-notification count. Only the version is used on this side.
const CONFIG_POLL_MS = 5 * 60_000;

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  );
}
function GuestsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.8a3.4 3.4 0 0 1 0 6.4M18 14.4c2 .8 3.5 2.6 3.5 5.6" />
    </svg>
  );
}
function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9zM10 20a2.2 2.2 0 0 0 4 0" />
    </svg>
  );
}
function TemplateIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </svg>
  );
}
function CampaignIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11v3a1 1 0 0 0 1 1h2l6 4V6L6 10H4a1 1 0 0 0-1 1zM16 8.5a4.5 4.5 0 0 1 0 7M19 6a8 8 0 0 1 0 12" />
    </svg>
  );
}
function SensorIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0z" />
      <path d="M12 9v7" />
    </svg>
  );
}
function ActivityIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h4l3-8 4 16 3-8h4" />
    </svg>
  );
}
function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}
function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}
function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  icon: () => ReactNode;
  showUnreadBadge?: boolean;
}

interface NavGroup {
  heading: string;
  items: NavItem[];
}

const groups: NavGroup[] = [
  {
    heading: 'Gestión',
    items: [
      { to: '/', label: 'Reservas', end: true, icon: CalendarIcon },
      { to: '/guests', label: 'Huéspedes', icon: GuestsIcon },
    ],
  },
  {
    heading: 'Comunicación',
    items: [
      { to: '/notifications', label: 'Notificaciones', icon: BellIcon, showUnreadBadge: true },
      { to: '/templates', label: 'Plantillas', icon: TemplateIcon },
      { to: '/campaigns', label: 'Campañas', icon: CampaignIcon },
    ],
  },
  {
    heading: 'Monitoreo',
    items: [
      { to: '/sensors', label: 'Sensores', icon: SensorIcon },
      { to: '/activity', label: 'Registro de actividad', icon: ActivityIcon },
    ],
  },
];

const settingsItem: NavItem = { to: '/settings', label: 'Configuración', icon: SettingsIcon };

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface [&_svg]:h-[18px] [&_svg]:w-[18px] [&_svg]:shrink-0 ${
    isActive ? 'bg-accent text-accent-fg' : 'text-text-muted hover:bg-bg hover:text-heading'
  }`;

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-xs font-bold text-white"
      aria-label={`${count} sin leer`}
    >
      {count}
    </span>
  );
}

export function AppNav() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [appVersion, setAppVersion] = useState<string | null>(null);
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

  useEffect(() => {
    function refreshVersion() {
      getConfig()
        .then((config) => setAppVersion(config.version))
        .catch(() => {});
    }
    refreshVersion();
    const interval = setInterval(refreshVersion, CONFIG_POLL_MS);
    return () => clearInterval(interval);
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

  const navContent = (
    <nav className="flex flex-1 flex-col gap-1">
      {groups.map((group) => (
        <div key={group.heading}>
          <div className="px-3 pb-1.5 pt-4 text-[11px] font-bold uppercase tracking-wider text-text-muted first:pt-0">
            {group.heading}
          </div>
          {group.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={linkClass}
              onClick={() => setMenuOpen(false)}
            >
              <item.icon />
              {item.label}
              {item.showUnreadBadge && <UnreadBadge count={unreadCount} />}
            </NavLink>
          ))}
        </div>
      ))}
      <div className="flex-1" />
      <NavLink to={settingsItem.to} className={linkClass} onClick={() => setMenuOpen(false)}>
        <settingsItem.icon />
        {settingsItem.label}
      </NavLink>
    </nav>
  );

  return (
    <>
      {/* Mobile top bar — the sidebar below becomes a slide-in drawer at this breakpoint */}
      <header className="sticky top-0 z-30 flex items-center gap-2.5 border-b border-border bg-surface px-3.5 py-2.5 sm:hidden">
        <button
          type="button"
          ref={menuToggleRef}
          aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'}
          aria-expanded={menuOpen}
          aria-controls={MOBILE_NAV_ID}
          onClick={() => setMenuOpen((v) => !v)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border text-heading [&_svg]:h-5 [&_svg]:w-5"
        >
          {menuOpen ? <CloseIcon /> : <MenuIcon />}
        </button>
        <span className="flex-1 font-heading text-lg font-semibold text-heading">
          La <em className="italic text-accent">Brisa</em>
        </span>
        {/* Distinct accessible name from the sidebar's own "Notificaciones" link below —
            both exist in the DOM at once (the sidebar is just off-screen on mobile, not
            unmounted), so an identical name would make both ambiguous to a11y tooling and
            to tests. */}
        <NavLink
          to="/notifications"
          aria-label="Ir a notificaciones"
          className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border text-heading [&_svg]:h-5 [&_svg]:w-5"
        >
          <BellIcon />
          {unreadCount > 0 && (
            // Decorative duplicate of the sidebar link's own badge below (which stays in
            // the DOM, off-screen, at this breakpoint) — the parent link's aria-label
            // already says where it goes, so this doesn't need its own accessible name too.
            <span
              aria-hidden="true"
              className="absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-xs font-bold text-white"
            >
              {unreadCount}
            </span>
          )}
        </NavLink>
      </header>

      {menuOpen && (
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          onClick={closeMenu}
          className="fixed inset-0 z-30 bg-heading/40 sm:hidden"
        />
      )}

      {/* One sidebar, not two: sticky/always-visible from the sm breakpoint up, a
          fixed off-canvas drawer (toggled by translate-x) below it — matching the mockup's
          own approach of a single aside whose CSS changes at the breakpoint. Rendering a
          second, CSS-only-hidden copy for mobile would double every link in the DOM (jsdom
          doesn't evaluate media queries), breaking every test that queries by role/name. */}
      <aside
        id={MOBILE_NAV_ID}
        ref={mobileNavRef}
        onKeyDown={handleMenuKeyDown}
        className={`fixed inset-y-0 left-0 z-40 flex w-[86vw] max-w-[288px] flex-col overflow-y-auto bg-surface px-3.5 py-5 shadow-2xl transition-transform duration-200 sm:sticky sm:top-0 sm:z-auto sm:h-screen sm:w-[252px] sm:max-w-none sm:translate-x-0 sm:shadow-none sm:transition-none sm:border-r sm:border-border ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Navegación principal"
      >
        <div className="mb-4 hidden items-center gap-2.5 px-2.5 sm:flex">
          <svg viewBox="0 0 46 24" fill="none" className="h-3.5 w-[26px] shrink-0 text-accent" aria-hidden="true">
            <path
              d="M1 14c4-6 8-6 12 0s8 6 12 0 8-6 12 0 6 5 8 3"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
          <span className="font-heading text-[22px] font-semibold leading-none tracking-tight text-heading">
            La <em className="italic text-accent">Brisa</em>
          </span>
        </div>
        {navContent}
        <div className="mt-3 flex flex-col gap-2.5 border-t border-border pt-3.5">
          <span className="px-3 text-[11.5px] text-text-muted">
            v{__APP_VERSION__}
            {appVersion && ` · API v${appVersion}`}
          </span>
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-sm text-text-muted hover:border-text-muted hover:text-heading [&_svg]:h-[17px] [&_svg]:w-[17px]"
          >
            <LogoutIcon />
            Cerrar sesión
          </button>
        </div>
      </aside>
    </>
  );
}
