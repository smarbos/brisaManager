import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';
import * as settingsApi from '../api/settings';
import * as googleCalendarApi from '../api/google-calendar';

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.spyOn(googleCalendarApi, 'getGoogleCalendarStatus').mockResolvedValue({
      connected: false,
      lastSyncAt: null,
      lastSyncError: null,
    });
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/settings');
  });

  it('loads existing settings and saves changes', async () => {
    vi.spyOn(settingsApi, 'getSettings').mockResolvedValue({
      houseRulesText: 'Existing rules',
      paymentInstructions: 'Existing payment info',
      bookingIcalUrl: null,
      airbnbIcalUrl: null,
      lastChannelSyncAt: null,
      lastChannelSyncError: null,
    });
    const updateSpy = vi.spyOn(settingsApi, 'updateSettings').mockResolvedValue({
      houseRulesText: 'Existing rules',
      paymentInstructions: 'Existing payment info',
      bookingIcalUrl: null,
      airbnbIcalUrl: null,
      lastChannelSyncAt: null,
      lastChannelSyncError: null,
    });

    render(<SettingsPage />);

    await waitFor(() => expect(screen.getByLabelText(/reglas de la casa/i)).toHaveValue('Existing rules'));

    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith({
      houseRulesText: 'Existing rules',
      paymentInstructions: 'Existing payment info',
      bookingIcalUrl: '',
      airbnbIcalUrl: '',
      lastChannelSyncAt: null,
      lastChannelSyncError: null,
    }));
    expect(await screen.findByRole('status')).toHaveTextContent(/guardado/i);
  });

  it('shows an alert when loading settings fails', async () => {
    vi.spyOn(settingsApi, 'getSettings').mockRejectedValue(new Error('network error'));

    render(<SettingsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo cargar la configuración/i);
  });

  it('shows an alert when saving settings fails', async () => {
    vi.spyOn(settingsApi, 'getSettings').mockResolvedValue({
      houseRulesText: 'Existing rules',
      paymentInstructions: 'Existing payment info',
      bookingIcalUrl: null,
      airbnbIcalUrl: null,
      lastChannelSyncAt: null,
      lastChannelSyncError: null,
    });
    vi.spyOn(settingsApi, 'updateSettings').mockRejectedValue(new Error('network error'));

    render(<SettingsPage />);

    await waitFor(() => expect(screen.getByLabelText(/reglas de la casa/i)).toHaveValue('Existing rules'));

    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo guardar la configuración/i);
  });

  it('loads and displays iCal URLs and sync status, and triggers a sync', async () => {
    vi.spyOn(settingsApi, 'getSettings')
      .mockResolvedValueOnce({
        houseRulesText: 'Rules',
        paymentInstructions: 'Pay',
        bookingIcalUrl: 'https://booking.example/cal.ics',
        airbnbIcalUrl: null,
        lastChannelSyncAt: null,
        lastChannelSyncError: null,
      })
      .mockResolvedValueOnce({
        houseRulesText: 'Rules',
        paymentInstructions: 'Pay',
        bookingIcalUrl: 'https://booking.example/cal.ics',
        airbnbIcalUrl: null,
        lastChannelSyncAt: '2026-09-13T12:00:00.000Z',
        lastChannelSyncError: null,
      });
    const syncSpy = vi.spyOn(settingsApi, 'runChannelSync').mockResolvedValue({ triggeredAt: '2026-09-13T12:00:00.000Z' });

    render(<SettingsPage />);

    await waitFor(() => expect(screen.getByLabelText(/url de ical de booking\.com/i)).toHaveValue('https://booking.example/cal.ics'));

    fireEvent.click(screen.getByRole('button', { name: /sincronizar ahora/i }));

    await waitFor(() => expect(syncSpy).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('Última sincronización: nunca')).not.toBeInTheDocument());
    expect(screen.getByText(/^última sincronización: (?!nunca)\S/i)).toBeInTheDocument();
  });

  it('shows "Connect Google Calendar" when not connected, and starts the OAuth flow', async () => {
    vi.spyOn(settingsApi, 'getSettings').mockResolvedValue({
      houseRulesText: 'Rules',
      paymentInstructions: 'Pay',
      bookingIcalUrl: null,
      airbnbIcalUrl: null,
      lastChannelSyncAt: null,
      lastChannelSyncError: null,
    });
    const connectUrlSpy = vi
      .spyOn(googleCalendarApi, 'getGoogleCalendarConnectUrl')
      .mockResolvedValue({ url: 'https://accounts.google.com/o/oauth2/auth?mock=1' });

    render(<SettingsPage />);

    const connectButton = await screen.findByRole('button', { name: /conectar google calendar/i });
    fireEvent.click(connectButton);

    await waitFor(() => expect(connectUrlSpy).toHaveBeenCalled());
    // Not asserting on window.location.href itself: jsdom's handling of location reassignment
    // is version-sensitive and not something this codebase's tests rely on elsewhere. Knowing
    // the connect-url call happened is enough — the `window.location.href = url` line in the
    // handler is a trivial one-liner once that call resolves.
  });

  it('shows connected status with Disconnect and Sync now when connected', async () => {
    vi.spyOn(settingsApi, 'getSettings').mockResolvedValue({
      houseRulesText: 'Rules',
      paymentInstructions: 'Pay',
      bookingIcalUrl: null,
      airbnbIcalUrl: null,
      lastChannelSyncAt: null,
      lastChannelSyncError: null,
    });
    vi.spyOn(googleCalendarApi, 'getGoogleCalendarStatus').mockResolvedValue({
      connected: true,
      lastSyncAt: '2026-09-13T12:00:00.000Z',
      lastSyncError: null,
    });
    const disconnectSpy = vi.spyOn(googleCalendarApi, 'disconnectGoogleCalendar').mockResolvedValue({ disconnected: true });
    const syncSpy = vi.spyOn(googleCalendarApi, 'runGoogleCalendarSync').mockResolvedValue({ triggeredAt: '2026-09-13T12:05:00.000Z' });

    render(<SettingsPage />);

    expect(await screen.findByRole('button', { name: /desconectar/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /sincronizar google calendar ahora/i }));
    await waitFor(() => expect(syncSpy).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /desconectar/i }));
    await waitFor(() => expect(disconnectSpy).toHaveBeenCalled());
  });

  it('shows a success message and cleans the URL when redirected back with ?googleCalendar=connected', async () => {
    vi.spyOn(settingsApi, 'getSettings').mockResolvedValue({
      houseRulesText: 'Rules',
      paymentInstructions: 'Pay',
      bookingIcalUrl: null,
      airbnbIcalUrl: null,
      lastChannelSyncAt: null,
      lastChannelSyncError: null,
    });
    window.history.pushState(null, '', '/settings?googleCalendar=connected');

    render(<SettingsPage />);

    expect(await screen.findByText(/google calendar conectado/i)).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('shows an alert when redirected back with ?googleCalendar=error', async () => {
    vi.spyOn(settingsApi, 'getSettings').mockResolvedValue({
      houseRulesText: 'Rules',
      paymentInstructions: 'Pay',
      bookingIcalUrl: null,
      airbnbIcalUrl: null,
      lastChannelSyncAt: null,
      lastChannelSyncError: null,
    });
    window.history.pushState(null, '', '/settings?googleCalendar=error');

    render(<SettingsPage />);

    expect(await screen.findByText(/no se pudo conectar google calendar/i)).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });
});
