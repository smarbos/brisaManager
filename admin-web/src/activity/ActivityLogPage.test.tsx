import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ActivityLogPage } from './ActivityLogPage';
import * as reservationEventsApi from '../api/reservation-events';
import * as extensionErrorsApi from '../api/extension-errors';

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

    await waitFor(() => expect(screen.getAllByText('Reserva creada').length).toBeGreaterThan(0));
    expect(screen.getByText('Created via Booking.com calendar sync')).toBeInTheDocument();
    expect(screen.getByText('Booking.com Guest')).toBeInTheDocument();
    expect(screen.getAllByText('Fechas confirmadas').length).toBeGreaterThan(0);
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

  it('filters by event type', async () => {
    vi.spyOn(reservationEventsApi, 'listActivityLog').mockResolvedValue([
      {
        id: 'evt-1',
        reservationId: 'res-1',
        type: 'RESERVATION_CREATED',
        detail: null,
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
    await screen.findByText('Jane Doe');

    fireEvent.change(screen.getByLabelText(/tipo de evento/i), { target: { value: 'DATES_CONFIRMED' } });

    expect(screen.queryByText('Booking.com Guest')).not.toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });

  it('filters by guest name', async () => {
    vi.spyOn(reservationEventsApi, 'listActivityLog').mockResolvedValue([
      {
        id: 'evt-1',
        reservationId: 'res-1',
        type: 'RESERVATION_CREATED',
        detail: null,
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
    await screen.findByText('Jane Doe');

    fireEvent.change(screen.getByLabelText(/huésped/i), { target: { value: 'jane' } });

    expect(screen.queryByText('Booking.com Guest')).not.toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });

  it('filters by date range', async () => {
    vi.spyOn(reservationEventsApi, 'listActivityLog').mockResolvedValue([
      {
        id: 'evt-1',
        reservationId: 'res-1',
        type: 'RESERVATION_CREATED',
        detail: null,
        createdAt: '2026-09-14T17:00:00.000Z',
        reservation: { guestName: 'Booking.com Guest', source: 'BOOKING' },
      },
      {
        id: 'evt-2',
        reservationId: 'res-2',
        type: 'DATES_CONFIRMED',
        detail: null,
        createdAt: '2026-09-01T12:00:00.000Z',
        reservation: { guestName: 'Jane Doe', source: 'DIRECT' },
      },
    ]);

    renderPage();
    await screen.findByText('Jane Doe');

    fireEvent.change(screen.getByLabelText(/^desde$/i), { target: { value: '2026-09-10' } });

    expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument();
    expect(screen.getByText('Booking.com Guest')).toBeInTheDocument();
  });

  it('shows an alert when the log cannot be loaded', async () => {
    vi.spyOn(reservationEventsApi, 'listActivityLog').mockRejectedValue(new Error('network error'));

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo cargar el registro de actividad/i);
  });

  it('switches to the extension errors tab and loads it lazily', async () => {
    vi.spyOn(reservationEventsApi, 'listActivityLog').mockResolvedValue([]);
    const listExtensionErrors = vi.spyOn(extensionErrorsApi, 'listExtensionErrors').mockResolvedValue([
      {
        id: 'err-1',
        source: 'airbnb',
        resId: '1000000484',
        operation: 'check_status',
        message: 'No pudimos conectar con La Brisa.',
        detail: null,
        url: 'https://www.airbnb.com/hosting/messages/1000000484',
        extensionVersion: '0.2.0',
        createdAt: '2026-09-20T17:00:00.000Z',
      },
    ]);

    renderPage();
    await screen.findByText('Todavía no hay eventos registrados.');
    expect(listExtensionErrors).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: 'Errores del plugin' }));

    expect(await screen.findByText('No pudimos conectar con La Brisa.')).toBeInTheDocument();
    expect(listExtensionErrors).toHaveBeenCalledTimes(1);
  });
});
