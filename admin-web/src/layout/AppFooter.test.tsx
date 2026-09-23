import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppFooter } from './AppFooter';
import * as configApi from '../api/config';

describe('AppFooter', () => {
  it('always shows the client version', async () => {
    vi.spyOn(configApi, 'getConfig').mockResolvedValue({ emailDebugMode: false, version: '9.9.9' });

    render(<AppFooter />);

    // exact: false since the API version may already be appended to the same text node by
    // the time this runs, depending on microtask timing.
    expect(screen.getByText(`v${__APP_VERSION__}`, { exact: false })).toBeInTheDocument();
  });

  it('shows the API version once /config responds', async () => {
    vi.spyOn(configApi, 'getConfig').mockResolvedValue({ emailDebugMode: false, version: '9.9.9' });

    render(<AppFooter />);

    expect(await screen.findByText(/API v9\.9\.9/)).toBeInTheDocument();
  });

  it('does not show an API version when the config request fails', async () => {
    vi.spyOn(configApi, 'getConfig').mockRejectedValue(new Error('network error'));

    render(<AppFooter />);

    await waitFor(() => expect(configApi.getConfig).toHaveBeenCalled());
    expect(screen.queryByText(/API v/)).not.toBeInTheDocument();
  });

  it('shows the debug warning when email debug mode is on', async () => {
    vi.spyOn(configApi, 'getConfig').mockResolvedValue({ emailDebugMode: true, version: '9.9.9' });

    render(<AppFooter />);

    expect(await screen.findByText(/modo debug activo/i)).toBeInTheDocument();
  });

  it('does not show the debug warning when email debug mode is off', async () => {
    vi.spyOn(configApi, 'getConfig').mockResolvedValue({ emailDebugMode: false, version: '9.9.9' });

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
