import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';
import * as settingsApi from '../api/settings';

describe('SettingsPage', () => {
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

    await waitFor(() => expect(screen.getByLabelText(/house rules/i)).toHaveValue('Existing rules'));

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith({
      houseRulesText: 'Existing rules',
      paymentInstructions: 'Existing payment info',
      bookingIcalUrl: '',
      airbnbIcalUrl: '',
      lastChannelSyncAt: null,
      lastChannelSyncError: null,
    }));
    expect(await screen.findByRole('status')).toHaveTextContent(/saved/i);
  });

  it('shows an alert when loading settings fails', async () => {
    vi.spyOn(settingsApi, 'getSettings').mockRejectedValue(new Error('network error'));

    render(<SettingsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load the settings/i);
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

    await waitFor(() => expect(screen.getByLabelText(/house rules/i)).toHaveValue('Existing rules'));

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save the settings/i);
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

    await waitFor(() => expect(screen.getByLabelText(/booking\.com ical url/i)).toHaveValue('https://booking.example/cal.ics'));

    fireEvent.click(screen.getByRole('button', { name: /sync now/i }));

    await waitFor(() => expect(syncSpy).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('Last synced: never')).not.toBeInTheDocument());
    expect(screen.getByText(/^last synced: (?!never)\S/i)).toBeInTheDocument();
  });
});
