import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../ui';

const MOBILE_NAV_ID = 'mobile-nav';

const sections = [
  { to: '/', label: 'Reservas', end: true },
  { to: '/guests', label: 'Huéspedes' },
  { to: '/templates', label: 'Plantillas' },
  { to: '/campaigns', label: 'Campañas' },
  { to: '/activity', label: 'Registro de actividad' },
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
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const mobileNavRef = useRef<HTMLElement>(null);

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
