import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ReservationFormPage } from './ReservationFormPage';
import * as reservationsApi from '../api/reservations';

describe('ReservationFormPage', () => {
  it('submits a new reservation', async () => {
    const createSpy = vi.spyOn(reservationsApi, 'createReservation').mockResolvedValue({ id: '1' } as never);

    render(
      <MemoryRouter initialEntries={['/reservations/new']}>
        <Routes>
          <Route path="/reservations/new" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/guest name/i), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText(/check-in/i), { target: { value: '2026-01-10' } });
    fireEvent.change(screen.getByLabelText(/check-out/i), { target: { value: '2026-01-15' } });
    fireEvent.change(screen.getByLabelText(/total amount/i), { target: { value: '100000' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(createSpy).toHaveBeenCalled());
  });

  it('marks the 30% payment as received and refreshes the progress list', async () => {
    vi.spyOn(reservationsApi, 'getReservation').mockResolvedValue({
      id: '1',
      guestName: 'Jane Doe',
      checkIn: '2026-01-10',
      checkOut: '2026-01-15',
      paxCount: 2,
      source: 'DIRECT',
      totalAmount: 100000,
      currency: 'ARS',
      status: 'PENDING',
      confirmationToken: 'tok-1',
    } as never);
    vi.spyOn(reservationsApi, 'listReservationEvents').mockResolvedValue([]);
    const markSpy = vi.spyOn(reservationsApi, 'markPaymentReceived').mockResolvedValue({
      id: '1',
      confirmationPaymentReceivedAt: '2026-01-01T00:00:00.000Z',
    } as never);

    render(
      <MemoryRouter initialEntries={['/reservations/1']}>
        <Routes>
          <Route path="/reservations/:id" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const button = await screen.findByRole('button', { name: /mark 30% payment received/i });
    fireEvent.click(button);

    await waitFor(() => expect(markSpy).toHaveBeenCalledWith('1'));
  });

  it('shows an alert when marking the 30% payment received fails', async () => {
    vi.spyOn(reservationsApi, 'getReservation').mockResolvedValue({
      id: '1',
      guestName: 'Jane Doe',
      checkIn: '2026-01-10',
      checkOut: '2026-01-15',
      paxCount: 2,
      source: 'DIRECT',
      totalAmount: 100000,
      currency: 'ARS',
      status: 'PENDING',
      confirmationToken: 'tok-1',
    } as never);
    vi.spyOn(reservationsApi, 'listReservationEvents').mockResolvedValue([]);
    vi.spyOn(reservationsApi, 'markPaymentReceived').mockRejectedValue(new Error('network error'));

    render(
      <MemoryRouter initialEntries={['/reservations/1']}>
        <Routes>
          <Route path="/reservations/:id" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const button = await screen.findByRole('button', { name: /mark 30% payment received/i });
    fireEvent.click(button);

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not mark the 30% payment/i);
  });

  it('shows a warning banner when editing a reservation missing from its channel feed', async () => {
    vi.spyOn(reservationsApi, 'getReservation').mockResolvedValue({
      id: '1',
      guestName: 'Jane Doe',
      checkIn: '2026-01-10',
      checkOut: '2026-01-15',
      paxCount: 2,
      source: 'BOOKING',
      totalAmount: 100000,
      currency: 'ARS',
      status: 'PENDING',
      confirmationToken: 'tok-1',
      missingFromChannelAt: '2026-01-01T00:00:00.000Z',
    } as never);
    vi.spyOn(reservationsApi, 'listReservationEvents').mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={['/reservations/1']}>
        <Routes>
          <Route path="/reservations/:id" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/no longer found in the channel's calendar/i)).toBeInTheDocument();
  });

  it('shows a warning when the entered dates overlap an existing reservation', async () => {
    const overlapSpy = vi.spyOn(reservationsApi, 'checkOverlap').mockResolvedValue([
      { id: '2', guestName: 'Other Guest', checkIn: '2026-01-12', checkOut: '2026-01-16', source: 'AIRBNB' } as never,
    ]);

    render(
      <MemoryRouter initialEntries={['/reservations/new']}>
        <Routes>
          <Route path="/reservations/new" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/check-in/i), { target: { value: '2026-01-10' } });
    fireEvent.change(screen.getByLabelText(/check-out/i), { target: { value: '2026-01-15' } });

    await waitFor(() => expect(overlapSpy).toHaveBeenCalledWith('2026-01-10', '2026-01-15', undefined));
    expect(await screen.findByText(/other guest/i)).toBeInTheDocument();
  });
});
