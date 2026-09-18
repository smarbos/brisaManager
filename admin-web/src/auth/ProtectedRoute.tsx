import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { AppNav } from '../layout/AppNav';

export function ProtectedRoute() {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-20 focus:rounded focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-fg"
      >
        Saltar al contenido
      </a>
      <AppNav />
      <Outlet />
    </>
  );
}
