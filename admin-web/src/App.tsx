import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { LoginPage } from './auth/LoginPage';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { ReservationListPage } from './reservations/ReservationListPage';
import { ReservationFormPage } from './reservations/ReservationFormPage';
import { SettingsPage } from './settings/SettingsPage';
import { GuestListPage } from './guests/GuestListPage';
import { GuestDetailPage } from './guests/GuestDetailPage';
import { TemplatesPage } from './templates/TemplatesPage';
import { CampaignsPage } from './campaigns/CampaignsPage';
import { ActivityLogPage } from './activity/ActivityLogPage';
import { NotificationsPage } from './notifications/NotificationsPage';
import { AppFooter } from './layout/AppFooter';

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
            <Route path="/guests/:id" element={<GuestDetailPage />} />
            <Route path="/templates" element={<TemplatesPage />} />
            <Route path="/campaigns" element={<CampaignsPage />} />
            <Route path="/activity" element={<ActivityLogPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
          </Route>
        </Routes>
        <AppFooter />
      </AuthProvider>
    </BrowserRouter>
  );
}
