import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DebugModeBanner } from './DebugModeBanner';
import * as configApi from '../api/config';

describe('DebugModeBanner', () => {
  it('shows a warning when email debug mode is on', async () => {
    vi.spyOn(configApi, 'getConfig').mockResolvedValue({ emailDebugMode: true });

    render(<DebugModeBanner />);

    expect(await screen.findByText(/modo debug activo/i)).toBeInTheDocument();
  });

  it('renders nothing when email debug mode is off', async () => {
    vi.spyOn(configApi, 'getConfig').mockResolvedValue({ emailDebugMode: false });

    const { container } = render(<DebugModeBanner />);

    await waitFor(() => expect(configApi.getConfig).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the config request fails', async () => {
    vi.spyOn(configApi, 'getConfig').mockRejectedValue(new Error('network error'));

    const { container } = render(<DebugModeBanner />);

    await waitFor(() => expect(configApi.getConfig).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
