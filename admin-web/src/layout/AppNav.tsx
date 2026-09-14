import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../ui';

const sections = [
  { to: '/', label: 'Reservas' },
  { to: '/guests', label: 'Huéspedes' },
  { to: '/templates', label: 'Plantillas' },
  { to: '/campaigns', label: 'Campañas' },
  { to: '/activity', label: 'Registro de actividad' },
  { to: '/settings', label: 'Configuración' },
];

export function AppNav() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-bg">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <span className="font-heading text-lg font-semibold text-heading">La Brisa</span>
        <nav className="flex flex-wrap items-center gap-4 text-sm">
          {sections.map((section) => (
            <Link key={section.to} to={section.to} className="text-accent hover:underline">
              {section.label}
            </Link>
          ))}
          <Button type="button" variant="secondary" onClick={handleLogout}>
            Cerrar sesión
          </Button>
        </nav>
      </div>
    </header>
  );
}
