import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GuestEventsTab } from './GuestEventsTab';
import * as guestEventsApi from '../api/guest-events';

describe('GuestEventsTab', () => {
  it('loads and displays guest change events with a readable type label', async () => {
    vi.spyOn(guestEventsApi, 'listGuestActivityLog').mockResolvedValue([
      {
        id: 'evt-1',
        guestId: 'guest-1',
        type: 'NAME_CHANGED',
        detail: 'Nombre: "Jane" → "Jane Doe"',
        createdAt: '2026-09-20T12:00:00.000Z',
        guest: { name: 'Jane Doe', email: 'jane@example.com' },
      },
    ]);

    render(<GuestEventsTab />);

    expect(await screen.findByText('Nombre modificado')).toBeInTheDocument();
    expect(screen.getByText('Nombre: "Jane" → "Jane Doe"')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });

  it('shows an empty state when there are no guest change events', async () => {
    vi.spyOn(guestEventsApi, 'listGuestActivityLog').mockResolvedValue([]);

    render(<GuestEventsTab />);

    expect(await screen.findByText(/todavía no hay cambios de huéspedes registrados/i)).toBeInTheDocument();
  });

  it('shows an alert when the log cannot be loaded', async () => {
    vi.spyOn(guestEventsApi, 'listGuestActivityLog').mockRejectedValue(new Error('network error'));

    render(<GuestEventsTab />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudieron cargar los cambios de huéspedes/i);
  });
});
