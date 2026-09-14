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
      <AppNav />
      <Outlet />
    </>
  );
}
