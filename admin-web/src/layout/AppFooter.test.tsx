import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppFooter } from './AppFooter';
import * as configApi from '../api/config';

describe('AppFooter', () => {
  it('always shows the app version', async () => {
    vi.spyOn(configApi, 'getConfig').mockResolvedValue({ emailDebugMode: false });

    render(<AppFooter />);

    expect(screen.getByText(`v${__APP_VERSION__}`)).toBeInTheDocument();
  });

  it('shows the debug warning when email debug mode is on', async () => {
    vi.spyOn(configApi, 'getConfig').mockResolvedValue({ emailDebugMode: true });

    render(<AppFooter />);

    expect(await screen.findByText(/modo debug activo/i)).toBeInTheDocument();
  });

  it('does not show the debug warning when email debug mode is off', async () => {
    vi.spyOn(configApi, 'getConfig').mockResolvedValue({ emailDebugMode: false });

    render(<AppFooter />);

    await waitFor(() => expect(configApi.getConfig).toHaveBeenCalled());
    expect(screen.queryByText(/modo debug activo/i)).not.toBeInTheDocument();
  });

  it('does not show the debug warning when the config request fails', async () => {
    vi.spyOn(configApi, 'getConfig').mockRejectedValue(new Error('network error'));

    render(<AppFooter />);

    await waitFor(() => expect(configApi.getConfig).toHaveBeenCalled());
    expect(screen.queryByText(/modo debug activo/i)).not.toBeInTheDocument();
  });
});
