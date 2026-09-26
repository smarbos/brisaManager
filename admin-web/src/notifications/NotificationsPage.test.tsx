import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { NotificationsPage } from './NotificationsPage';
import * as notificationsApi from '../api/notifications';
import { subscribeToUnreadCountChanges } from './unreadCountBus';

function renderPage() {
  return render(
    <MemoryRouter>
      <NotificationsPage />
    </MemoryRouter>,
  );
}

describe('NotificationsPage', () => {
  it('loads and displays notifications, with a reservation link when there is one', async () => {
    vi.spyOn(notificationsApi, 'listNotifications').mockResolvedValue([
      {
        id: 'n-1',
        type: 'CALENDAR_MISMATCH',
        message: 'Booking.com muestra un día bloqueado sin reserva cargada.',
        reservationId: null,
        reservation: null,
        readAt: null,
        createdAt: '2026-09-20T12:00:00.000Z',
      },
      {
        id: 'n-2',
        type: 'PAYMENT_RECEIPT_UPLOADED',
        message: 'Jane Doe subió un comprobante de pago.',
        reservationId: 'res-1',
        reservation: { id: 'res-1', guestName: 'Jane Doe' },
        readAt: '2026-09-20T13:00:00.000Z',
        createdAt: '2026-09-20T12:30:00.000Z',
      },
    ]);

    renderPage();

    await waitFor(() => expect(screen.getByText(/booking\.com muestra un día bloqueado/i)).toBeInTheDocument());
    expect(screen.getByText(/jane doe subió un comprobante/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Jane Doe' })).toHaveAttribute('href', '/reservations/res-1');
  });

  it('shows an empty state when there are no notifications', async () => {
    vi.spyOn(notificationsApi, 'listNotifications').mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText(/no hay notificaciones/i)).toBeInTheDocument();
  });

  it('shows an alert when notifications cannot be loaded', async () => {
    vi.spyOn(notificationsApi, 'listNotifications').mockRejectedValue(new Error('network error'));

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudieron cargar las notificaciones/i);
  });

  it('marks a notification as read and reloads the list', async () => {
    const listSpy = vi.spyOn(notificationsApi, 'listNotifications').mockResolvedValue([
      {
        id: 'n-1',
        type: 'CALENDAR_MISMATCH',
        message: 'Booking.com muestra un día bloqueado sin reserva cargada.',
        reservationId: null,
        reservation: null,
        readAt: null,
        createdAt: '2026-09-20T12:00:00.000Z',
      },
    ]);
    const markReadSpy = vi.spyOn(notificationsApi, 'markNotificationRead').mockResolvedValue({} as never);

    renderPage();

    const button = await screen.findByRole('button', { name: /marcar como leída/i });
    fireEvent.click(button);

    await waitFor(() => expect(markReadSpy).toHaveBeenCalledWith('n-1'));
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
  });

  it('tells the nav badge to refresh immediately after marking a notification as read', async () => {
    vi.spyOn(notificationsApi, 'listNotifications').mockResolvedValue([
      {
        id: 'n-1',
        type: 'CALENDAR_MISMATCH',
        message: 'Booking.com muestra un día bloqueado sin reserva cargada.',
        reservationId: null,
        reservation: null,
        readAt: null,
        createdAt: '2026-09-20T12:00:00.000Z',
      },
    ]);
    vi.spyOn(notificationsApi, 'markNotificationRead').mockResolvedValue({} as never);
    const listener = vi.fn();
    const unsubscribe = subscribeToUnreadCountChanges(listener);

    renderPage();

    const button = await screen.findByRole('button', { name: /marcar como leída/i });
    fireEvent.click(button);

    await waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    unsubscribe();
  });

  it('does not show a "mark as read" button for an already-read notification', async () => {
    vi.spyOn(notificationsApi, 'listNotifications').mockResolvedValue([
      {
        id: 'n-1',
        type: 'PAYMENT_RECEIPT_UPLOADED',
        message: 'Jane Doe subió un comprobante de pago.',
        reservationId: 'res-1',
        reservation: { id: 'res-1', guestName: 'Jane Doe' },
        readAt: '2026-09-20T13:00:00.000Z',
        createdAt: '2026-09-20T12:30:00.000Z',
      },
    ]);

    renderPage();

    await screen.findByText(/jane doe subió un comprobante/i);
    expect(screen.queryByRole('button', { name: /marcar como leída/i })).not.toBeInTheDocument();
  });
});
