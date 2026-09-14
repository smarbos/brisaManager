import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ActivityLogPage } from './ActivityLogPage';
import * as reservationEventsApi from '../api/reservation-events';

function renderPage() {
  return render(
    <MemoryRouter>
      <ActivityLogPage />
    </MemoryRouter>,
  );
}

describe('ActivityLogPage', () => {
  it('loads and displays activity log entries with a readable event label', async () => {
    vi.spyOn(reservationEventsApi, 'listActivityLog').mockResolvedValue([
      {
        id: 'evt-1',
        reservationId: 'res-1',
        type: 'RESERVATION_CREATED',
        detail: 'Created via Booking.com calendar sync',
        createdAt: '2026-09-14T17:00:00.000Z',
        reservation: { guestName: 'Booking.com Guest', source: 'BOOKING' },
      },
      {
        id: 'evt-2',
        reservationId: 'res-2',
        type: 'DATES_CONFIRMED',
        detail: null,
        createdAt: '2026-09-13T12:00:00.000Z',
        reservation: { guestName: 'Jane Doe', source: 'DIRECT' },
      },
    ]);

    renderPage();

    await waitFor(() => expect(screen.getByText('Reserva creada')).toBeInTheDocument());
    expect(screen.getByText('Created via Booking.com calendar sync')).toBeInTheDocument();
    expect(screen.getByText('Booking.com Guest')).toBeInTheDocument();
    expect(screen.getByText('Fechas confirmadas')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });

  it('links each entry to its reservation', async () => {
    vi.spyOn(reservationEventsApi, 'listActivityLog').mockResolvedValue([
      {
        id: 'evt-1',
        reservationId: 'res-1',
        type: 'RESERVATION_CREATED',
        detail: 'Created via Booking.com calendar sync',
        createdAt: '2026-09-14T17:00:00.000Z',
        reservation: { guestName: 'Booking.com Guest', source: 'BOOKING' },
      },
    ]);

    renderPage();

    const link = await screen.findByRole('link', { name: 'Booking.com Guest' });
    expect(link).toHaveAttribute('href', '/reservations/res-1');
  });

  it('shows an alert when the log cannot be loaded', async () => {
    vi.spyOn(reservationEventsApi, 'listActivityLog').mockRejectedValue(new Error('network error'));

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo cargar el registro de actividad/i);
  });
});
