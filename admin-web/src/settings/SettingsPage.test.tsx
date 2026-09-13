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
});
