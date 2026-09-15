import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ReservationListPage } from './ReservationListPage';
import * as reservationsApi from '../api/reservations';

function renderPage() {
  return render(
    <MemoryRouter>
      <ReservationListPage />
    </MemoryRouter>,
  );
}

describe('ReservationListPage', () => {
  it('renders reservations returned by the API', async () => {
    vi.spyOn(reservationsApi, 'listReservations').mockResolvedValue([
      {
        id: '1',
        guestName: 'Jane Doe',
        checkIn: '2026-01-10',
        checkOut: '2026-01-15',
        paxCount: 2,
        source: 'AIRBNB',
        totalAmount: 100000,
        currency: 'ARS',
        status: 'PENDING',
        confirmationToken: 'tok-1',
      },
    ]);

    renderPage();

    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());
  });

  it('shows an error when the reservations cannot be loaded', async () => {
    vi.spyOn(reservationsApi, 'listReservations').mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    renderPage();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/no se pudieron cargar las reservas/i));
  });

  it('refetches when the source filter changes', async () => {
    const spy = vi.spyOn(reservationsApi, 'listReservations').mockResolvedValue([]);

    renderPage();

    await waitFor(() => expect(spy).toHaveBeenCalledWith({ source: undefined, status: undefined }));

    fireEvent.change(screen.getByLabelText(/canal/i), { target: { value: 'AIRBNB' } });

    await waitFor(() => expect(spy).toHaveBeenCalledWith({ source: 'AIRBNB', status: undefined }));
  });

  it('shows a warning badge for a reservation missing from its channel feed', async () => {
    vi.spyOn(reservationsApi, 'listReservations').mockResolvedValue([
      {
        id: '1',
        guestName: 'Jane Doe',
        checkIn: '2026-01-10',
        checkOut: '2026-01-15',
        paxCount: 2,
        source: 'BOOKING',
        totalAmount: 100000,
        currency: 'ARS',
        status: 'PENDING',
        missingFromChannelAt: '2026-01-01T00:00:00.000Z',
      } as never,
    ]);

    renderPage();

    expect(await screen.findByText(/ya no está en el calendario del canal/i)).toBeInTheDocument();
  });

  it('cancels a reservation after confirming and reloads the list', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const listSpy = vi.spyOn(reservationsApi, 'listReservations').mockResolvedValue([
      {
        id: '1',
        guestName: 'Jane Doe',
        checkIn: '2026-01-10',
        checkOut: '2026-01-15',
        paxCount: 2,
        source: 'DIRECT',
        totalAmount: 100000,
        currency: 'ARS',
        status: 'PENDING',
      } as never,
    ]);
    const cancelSpy = vi.spyOn(reservationsApi, 'cancelReservation').mockResolvedValue({ id: '1' } as never);

    renderPage();

    const button = await screen.findByRole('button', { name: /cancelar/i });
    fireEvent.click(button);

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Jane Doe'));
    await waitFor(() => expect(cancelSpy).toHaveBeenCalledWith('1'));
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
  });

  it('does not cancel when the confirmation dialog is dismissed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    vi.spyOn(reservationsApi, 'listReservations').mockResolvedValue([
      {
        id: '1',
        guestName: 'Jane Doe',
        checkIn: '2026-01-10',
        checkOut: '2026-01-15',
        paxCount: 2,
        source: 'DIRECT',
        totalAmount: 100000,
        currency: 'ARS',
        status: 'PENDING',
      } as never,
    ]);
    const cancelSpy = vi.spyOn(reservationsApi, 'cancelReservation').mockResolvedValue({ id: '1' } as never);

    renderPage();

    const button = await screen.findByRole('button', { name: /cancelar/i });
    fireEvent.click(button);

    expect(cancelSpy).not.toHaveBeenCalled();
  });

  it('does not show a cancel button for an already-cancelled or completed reservation', async () => {
    vi.spyOn(reservationsApi, 'listReservations').mockResolvedValue([
      {
        id: '1',
        guestName: 'Cancelled Guest',
        checkIn: '2026-01-10',
        checkOut: '2026-01-15',
        paxCount: 2,
        source: 'DIRECT',
        totalAmount: 100000,
        currency: 'ARS',
        status: 'CANCELLED',
      } as never,
      {
        id: '2',
        guestName: 'Completed Guest',
        checkIn: '2026-01-10',
        checkOut: '2026-01-15',
        paxCount: 2,
        source: 'DIRECT',
        totalAmount: 100000,
        currency: 'ARS',
        status: 'COMPLETED',
      } as never,
    ]);

    renderPage();

    await screen.findByText('Cancelled Guest');
    expect(screen.queryByRole('button', { name: /cancelar/i })).not.toBeInTheDocument();
  });
});
