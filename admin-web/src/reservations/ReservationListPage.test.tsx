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

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not load the reservations/i));
  });

  it('refetches when the source filter changes', async () => {
    const spy = vi.spyOn(reservationsApi, 'listReservations').mockResolvedValue([]);

    renderPage();

    await waitFor(() => expect(spy).toHaveBeenCalledWith({ source: undefined, status: undefined }));

    fireEvent.change(screen.getByLabelText(/source/i), { target: { value: 'AIRBNB' } });

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

    expect(await screen.findByText(/no longer in channel feed/i)).toBeInTheDocument();
  });
});
