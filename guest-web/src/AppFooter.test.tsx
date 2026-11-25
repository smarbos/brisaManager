import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppFooter } from './AppFooter';
import * as configApi from './api/config';

describe('AppFooter', () => {
  it('always shows a build identifier', async () => {
    vi.spyOn(configApi, 'getConfig').mockResolvedValue({ debugMode: false, ambientControlEnabled: false });

    render(<AppFooter />);

    // No VITE_COMMIT_HASH is set in the test environment, so this exercises the 'dev' fallback.
    expect(screen.getByText('dev')).toBeInTheDocument();
  });

  it('shows the debug warning when email debug mode is on', async () => {
    vi.spyOn(configApi, 'getConfig').mockResolvedValue({ debugMode: true, ambientControlEnabled: false });

    render(<AppFooter />);

    expect(await screen.findByText(/modo debug activo/i)).toBeInTheDocument();
  });

  it('mentions the sensors in the debug warning only when ambient control is on', async () => {
    vi.spyOn(configApi, 'getConfig').mockResolvedValue({ debugMode: true, ambientControlEnabled: true });

    render(<AppFooter />);

    expect(await screen.findByText(/los sensores son visibles/i)).toBeInTheDocument();
  });

  it('leaves the sensors out of the debug warning when ambient control is off', async () => {
    vi.spyOn(configApi, 'getConfig').mockResolvedValue({ debugMode: true, ambientControlEnabled: false });

    render(<AppFooter />);

    expect(await screen.findByText(/modo debug activo/i)).toBeInTheDocument();
    expect(screen.queryByText(/sensores/i)).not.toBeInTheDocument();
  });

  it('does not show the debug warning when email debug mode is off', async () => {
    vi.spyOn(configApi, 'getConfig').mockResolvedValue({ debugMode: false, ambientControlEnabled: false });

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
