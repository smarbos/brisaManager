import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';
import * as settingsApi from '../api/settings';
import * as googleCalendarApi from '../api/google-calendar';

// Shared across every test below — the Settings type requires every field, so this keeps
// each test's mock focused on only the values it actually cares about varying.
const baseSettings: settingsApi.Settings = {
  houseRulesText: 'Rules',
  paymentInstructions: 'Pay',
  depositInstructions: 'Deposit info',
  propertyAddress: '123 Main St',
  googleMapsUrl: 'https://maps.example/labrisa',
  initialEmailTemplate: 'Hi {{guestName}}, {{confirmationUrl}}',
  finalEmailTemplate: 'Hi {{guestName}}, {{propertyAddress}} {{googleMapsUrl}}',
  cancellationEmailTemplate: 'Hi {{guestName}}, {{checkIn}} to {{checkOut}}',
  bookingIcalUrl: null,
  airbnbIcalUrl: null,
  lastChannelSyncAt: null,
  lastChannelSyncError: null,
};

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
      ...baseSettings,
      houseRulesText: 'Existing rules',
      paymentInstructions: 'Existing payment info',
    });
    const updateSpy = vi.spyOn(settingsApi, 'updateSettings').mockResolvedValue({
      ...baseSettings,
      houseRulesText: 'Existing rules',
      paymentInstructions: 'Existing payment info',
    });

    render(<SettingsPage />);

    await waitFor(() => expect(screen.getByLabelText(/reglas de la casa/i)).toHaveValue('Existing rules'));

    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith({
        ...baseSettings,
        houseRulesText: 'Existing rules',
        paymentInstructions: 'Existing payment info',
        bookingIcalUrl: '',
        airbnbIcalUrl: '',
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(/guardado/i);
  });

  it('loads and saves the deposit description, address, maps link, and email templates', async () => {
    vi.spyOn(settingsApi, 'getSettings').mockResolvedValue(baseSettings);
    const updateSpy = vi.spyOn(settingsApi, 'updateSettings').mockResolvedValue(baseSettings);

    render(<SettingsPage />);

    await waitFor(() =>
      expect(screen.getByLabelText(/descripción del depósito de garantía/i)).toHaveValue('Deposit info'),
    );
    expect(screen.getByLabelText(/dirección del alojamiento/i)).toHaveValue('123 Main St');
    expect(screen.getByLabelText(/link de google maps/i)).toHaveValue('https://maps.example/labrisa');
    expect(screen.getByLabelText(/email inicial/i)).toHaveValue('Hi {{guestName}}, {{confirmationUrl}}');
    expect(screen.getByLabelText(/email de confirmación final/i)).toHaveValue(
      'Hi {{guestName}}, {{propertyAddress}} {{googleMapsUrl}}',
    );
    expect(screen.getByLabelText(/email de cancelación/i)).toHaveValue('Hi {{guestName}}, {{checkIn}} to {{checkOut}}');

    fireEvent.change(screen.getByLabelText(/email de cancelación/i), {
      target: { value: 'Updated cancellation copy' },
    });
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ cancellationEmailTemplate: 'Updated cancellation copy' }),
      ),
    );
  });

  it('shows an alert when loading settings fails', async () => {
    vi.spyOn(settingsApi, 'getSettings').mockRejectedValue(new Error('network error'));

    render(<SettingsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo cargar la configuración/i);
  });

  it('shows an alert when saving settings fails', async () => {
    vi.spyOn(settingsApi, 'getSettings').mockResolvedValue({
      ...baseSettings,
      houseRulesText: 'Existing rules',
      paymentInstructions: 'Existing payment info',
    });
    vi.spyOn(settingsApi, 'updateSettings').mockRejectedValue(new Error('network error'));

    render(<SettingsPage />);

    await waitFor(() => expect(screen.getByLabelText(/reglas de la casa/i)).toHaveValue('Existing rules'));

    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo guardar la configuración/i);
  });

  it('loads and displays iCal URLs and sync status, and triggers a sync', async () => {
    vi.spyOn(settingsApi, 'getSettings')
      .mockResolvedValueOnce({ ...baseSettings, bookingIcalUrl: 'https://booking.example/cal.ics' })
      .mockResolvedValueOnce({
        ...baseSettings,
        bookingIcalUrl: 'https://booking.example/cal.ics',
        lastChannelSyncAt: '2026-09-13T12:00:00.000Z',
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
    vi.spyOn(settingsApi, 'getSettings').mockResolvedValue(baseSettings);
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
    vi.spyOn(settingsApi, 'getSettings').mockResolvedValue(baseSettings);
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
    vi.spyOn(settingsApi, 'getSettings').mockResolvedValue(baseSettings);
    window.history.pushState(null, '', '/settings?googleCalendar=connected');

    render(<SettingsPage />);

    expect(await screen.findByText(/google calendar conectado/i)).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('shows an alert when redirected back with ?googleCalendar=error', async () => {
    vi.spyOn(settingsApi, 'getSettings').mockResolvedValue(baseSettings);
    window.history.pushState(null, '', '/settings?googleCalendar=error');

    render(<SettingsPage />);

    expect(await screen.findByText(/no se pudo conectar google calendar/i)).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });
});
