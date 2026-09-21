import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExtensionErrorsTab } from './ExtensionErrorsTab';
import * as extensionErrorsApi from '../api/extension-errors';

describe('ExtensionErrorsTab', () => {
  it('loads and displays extension errors with a readable operation label', async () => {
    vi.spyOn(extensionErrorsApi, 'listExtensionErrors').mockResolvedValue([
      {
        id: 'err-1',
        source: 'airbnb',
        resId: '1000000484',
        operation: 'submit_reservation',
        message: 'La Brisa respondió con un error (500).',
        detail: '{"error":"internal"}',
        url: 'https://www.airbnb.com/hosting/messages/1000000484',
        extensionVersion: '0.2.0',
        createdAt: '2026-09-20T17:00:00.000Z',
      },
    ]);

    render(<ExtensionErrorsTab />);

    expect(await screen.findByText('Enviar reserva')).toBeInTheDocument();
    expect(screen.getByText('La Brisa respondió con un error (500).')).toBeInTheDocument();
    expect(screen.getByText('{"error":"internal"}')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '1000000484' })).toHaveAttribute(
      'href',
      'https://www.airbnb.com/hosting/messages/1000000484',
    );
  });

  it('shows an empty state when there are no errors', async () => {
    vi.spyOn(extensionErrorsApi, 'listExtensionErrors').mockResolvedValue([]);

    render(<ExtensionErrorsTab />);

    expect(await screen.findByText(/todavía no se reportaron errores del plugin/i)).toBeInTheDocument();
  });

  it('shows an alert when the log cannot be loaded', async () => {
    vi.spyOn(extensionErrorsApi, 'listExtensionErrors').mockRejectedValue(new Error('network error'));

    render(<ExtensionErrorsTab />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudieron cargar los errores del plugin/i);
  });
});
