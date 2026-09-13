import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';
import * as settingsApi from '../api/settings';

describe('SettingsPage', () => {
  it('loads existing settings and saves changes', async () => {
    vi.spyOn(settingsApi, 'getSettings').mockResolvedValue({
      houseRulesText: 'Existing rules',
      paymentInstructions: 'Existing payment info',
    });
    const updateSpy = vi.spyOn(settingsApi, 'updateSettings').mockResolvedValue({
      houseRulesText: 'Existing rules',
      paymentInstructions: 'Existing payment info',
    });

    render(<SettingsPage />);

    await waitFor(() => expect(screen.getByLabelText(/house rules/i)).toHaveValue('Existing rules'));

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith({
      houseRulesText: 'Existing rules',
      paymentInstructions: 'Existing payment info',
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
    });
    vi.spyOn(settingsApi, 'updateSettings').mockRejectedValue(new Error('network error'));

    render(<SettingsPage />);

    await waitFor(() => expect(screen.getByLabelText(/house rules/i)).toHaveValue('Existing rules'));

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save the settings/i);
  });
});
