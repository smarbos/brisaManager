import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ReservationListPage } from './ReservationListPage';
import * as reservationsApi from '../api/reservations';

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
      },
    ]);

    render(
      <MemoryRouter>
        <ReservationListPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());
  });

  it('refetches when the source filter changes', async () => {
    const spy = vi.spyOn(reservationsApi, 'listReservations').mockResolvedValue([]);

    render(
      <MemoryRouter>
        <ReservationListPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(spy).toHaveBeenCalledWith({ source: undefined, status: undefined }));

    fireEvent.change(screen.getByLabelText(/source/i), { target: { value: 'AIRBNB' } });

    await waitFor(() => expect(spy).toHaveBeenCalledWith({ source: 'AIRBNB', status: undefined }));
  });
});
