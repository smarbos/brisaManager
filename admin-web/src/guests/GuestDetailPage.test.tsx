import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { GuestDetailPage } from './GuestDetailPage';
import * as guestsApi from '../api/guests';

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/guests/${id}`]}>
      <Routes>
        <Route path="/guests/:id" element={<GuestDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('GuestDetailPage', () => {
  it('shows the guest id and all known fields', async () => {
    vi.spyOn(guestsApi, 'getGuest').mockResolvedValue({
      id: 'guest-1',
      email: 'jane@example.com',
      name: 'Jane Doe',
      phone: '+54911',
      totalStays: 2,
      lastStayAt: '2026-05-01T00:00:00.000Z',
      unsubscribedAt: null,
      reservations: [],
    });

    renderAt('guest-1');

    await waitFor(() => expect(screen.getByText(/guest-1/i)).toBeInTheDocument());
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
    expect(screen.getByText('+54911')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText(/suscripto/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /volver a huéspedes/i })).toHaveAttribute('href', '/guests');
  });

  it('lists the guest reservations with a link to each one', async () => {
    vi.spyOn(guestsApi, 'getGuest').mockResolvedValue({
      id: 'guest-1',
      email: 'jane@example.com',
      name: 'Jane Doe',
      phone: null,
      totalStays: 1,
      lastStayAt: null,
      unsubscribedAt: null,
      reservations: [
        {
          id: 'res-1',
          guestName: 'Jane Doe',
          checkIn: '2026-05-01',
          checkOut: '2026-05-05',
          paxCount: 2,
          source: 'DIRECT',
          totalAmount: 100000,
          currency: 'ARS',
          status: 'CONFIRMED',
          confirmationToken: 'tok-1',
        },
      ],
    });

    renderAt('guest-1');

    const reservationLink = await screen.findByRole('link', { name: 'res-1' });
    expect(reservationLink).toHaveAttribute('href', '/reservations/res-1');
  });

  it('shows a message when the guest has no reservations', async () => {
    vi.spyOn(guestsApi, 'getGuest').mockResolvedValue({
      id: 'guest-1',
      email: 'jane@example.com',
      name: 'Jane Doe',
      phone: null,
      totalStays: 0,
      lastStayAt: null,
      unsubscribedAt: null,
      reservations: [],
    });

    renderAt('guest-1');

    expect(await screen.findByText(/todavía no tiene reservas/i)).toBeInTheDocument();
  });

  it('shows an alert when the guest cannot be loaded', async () => {
    vi.spyOn(guestsApi, 'getGuest').mockRejectedValue(new Error('network error'));

    renderAt('guest-1');

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo cargar el huésped/i);
  });
});
