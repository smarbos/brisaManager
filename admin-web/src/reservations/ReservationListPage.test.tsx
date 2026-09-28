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
    expect(screen.getByRole('link', { name: '1' })).toHaveAttribute('href', '/reservations/1');
  });

  it('shows an error when the reservations cannot be loaded', async () => {
    vi.spyOn(reservationsApi, 'listReservations').mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    renderPage();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/no se pudieron cargar las reservas/i));
  });

  it('filters the visible reservations by guest name', async () => {
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
      {
        id: '2',
        guestName: 'John Smith',
        checkIn: '2026-01-10',
        checkOut: '2026-01-15',
        paxCount: 2,
        source: 'AIRBNB',
        totalAmount: 100000,
        currency: 'ARS',
        status: 'PENDING',
        confirmationToken: 'tok-2',
      },
    ]);

    renderPage();
    await screen.findByText('John Smith');

    fireEvent.change(screen.getByLabelText(/buscar/i), { target: { value: 'jane' } });

    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.queryByText('John Smith')).not.toBeInTheDocument();
  });

  it('defaults the status filter to Pendiente', async () => {
    vi.spyOn(reservationsApi, 'listReservations').mockResolvedValue([]);

    renderPage();

    expect(await screen.findByLabelText(/estado/i)).toHaveValue('PENDING');
  });

  it('shows the formatted price for a reservation with a total amount', async () => {
    vi.spyOn(reservationsApi, 'listReservations').mockResolvedValue([
      {
        id: '1',
        guestName: 'Jane Doe',
        checkIn: '2026-01-10',
        checkOut: '2026-01-15',
        paxCount: 2,
        source: 'AIRBNB',
        totalAmount: 270400,
        currency: 'ARS',
        status: 'PENDING',
        confirmationToken: 'tok-1',
      },
    ]);

    renderPage();

    expect(await screen.findByText('ARS 270.400')).toBeInTheDocument();
  });

  it('shows a dash for a reservation with no total amount', async () => {
    vi.spyOn(reservationsApi, 'listReservations').mockResolvedValue([
      {
        id: '1',
        guestName: 'Jane Doe',
        checkIn: '2026-01-10',
        checkOut: '2026-01-15',
        paxCount: 2,
        source: 'AIRBNB',
        totalAmount: 0,
        currency: 'ARS',
        status: 'PENDING',
        confirmationToken: 'tok-1',
      },
    ]);

    renderPage();

    await screen.findByText('Jane Doe');
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows an alert icon with details when the confirmation email failed to send', async () => {
    vi.spyOn(reservationsApi, 'listReservations').mockResolvedValue([
      {
        id: '1',
        guestName: 'Jane Doe',
        guestEmail: 'jane@example.com',
        checkIn: '2026-01-10',
        checkOut: '2026-01-15',
        paxCount: 2,
        source: 'DIRECT',
        totalAmount: 100000,
        currency: 'ARS',
        status: 'PENDING',
        confirmationEmailSentAt: null,
      } as never,
    ]);

    renderPage();

    const icon = await screen.findByRole('img', { name: /el email de confirmación no se envió/i });
    expect(icon).toHaveAttribute('title', 'El email de confirmación no se envió');
  });

  it('shows an alert icon when both email and phone are missing', async () => {
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

    renderPage();

    expect(await screen.findByRole('img', { name: /falta el email y el teléfono/i })).toBeInTheDocument();
  });

  it('does not show an alert icon for a cancelled reservation missing everything', async () => {
    vi.spyOn(reservationsApi, 'listReservations').mockResolvedValue([
      {
        id: '1',
        guestName: 'Jane Doe',
        checkIn: '2026-01-10',
        checkOut: '2026-01-15',
        paxCount: 2,
        source: 'DIRECT',
        totalAmount: 0,
        currency: 'ARS',
        status: 'CANCELLED',
      } as never,
    ]);

    renderPage();

    await screen.findByText('Jane Doe');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('refetches when the source filter changes', async () => {
    const spy = vi.spyOn(reservationsApi, 'listReservations').mockResolvedValue([]);

    renderPage();

    await waitFor(() => expect(spy).toHaveBeenCalledWith({ source: undefined, status: 'PENDING' }));

    fireEvent.change(screen.getByLabelText(/canal/i), { target: { value: 'AIRBNB' } });

    await waitFor(() => expect(spy).toHaveBeenCalledWith({ source: 'AIRBNB', status: 'PENDING' }));
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

  it('cancels a reservation after a second click confirms it, and reloads the list', async () => {
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
    expect(cancelSpy).not.toHaveBeenCalled();

    const confirmButton = await screen.findByRole('button', { name: /¿seguro\? tocá de nuevo/i });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(cancelSpy).toHaveBeenCalledWith('1'));
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
  });

  it('does not cancel on a single click — it only arms the confirmation', async () => {
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
    expect(await screen.findByRole('button', { name: /¿seguro\? tocá de nuevo/i })).toBeInTheDocument();
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
