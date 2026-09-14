import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { LoginPage } from './auth/LoginPage';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { ReservationListPage } from './reservations/ReservationListPage';
import { ReservationFormPage } from './reservations/ReservationFormPage';
import { SettingsPage } from './settings/SettingsPage';
import { GuestListPage } from './guests/GuestListPage';
import { TemplatesPage } from './templates/TemplatesPage';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<ReservationListPage />} />
            <Route path="/reservations/new" element={<ReservationFormPage />} />
            <Route path="/reservations/:id" element={<ReservationFormPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/guests" element={<GuestListPage />} />
            <Route path="/templates" element={<TemplatesPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
