import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ReservationFormPage } from './ReservationFormPage';
import * as reservationsApi from '../api/reservations';
import * as reservationImportApi from '../api/reservation-import';

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

    fireEvent.change(screen.getByLabelText(/nombre del huésped/i), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText(/check-in/i), { target: { value: '2026-01-10' } });
    fireEvent.change(screen.getByLabelText(/check-out/i), { target: { value: '2026-01-15' } });
    fireEvent.change(screen.getByLabelText(/monto total/i), { target: { value: '100000' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() => expect(createSpy).toHaveBeenCalled());
  });

  it('imports fields from a screenshot and pre-fills the form', async () => {
    vi.spyOn(reservationImportApi, 'parseScreenshot').mockResolvedValue({
      guestName: 'Weber Clara',
      checkIn: '2026-11-06',
      checkOut: '2026-11-08',
      paxCount: 3,
      externalReference: 'booking-manual-5459856627',
    });

    render(
      <MemoryRouter initialEntries={['/reservations/new']}>
        <Routes>
          <Route path="/reservations/new" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const file = new File(['fake-image-bytes'], 'screenshot.jpg', { type: 'image/jpeg' });
    const input = screen.getByLabelText(/importar desde captura de booking\.com/i);
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByLabelText(/nombre del huésped/i)).toHaveValue('Weber Clara'));
    expect(screen.getByLabelText(/check-in/i)).toHaveValue('2026-11-06');
    expect(screen.getByLabelText(/check-out/i)).toHaveValue('2026-11-08');
    expect(screen.getByLabelText(/huéspedes/i)).toHaveValue(3);
    expect(screen.getByLabelText(/canal/i)).toHaveValue('BOOKING');
  });

  it('does not overwrite a field the user already typed when the extraction returns null for it', async () => {
    vi.spyOn(reservationImportApi, 'parseScreenshot').mockResolvedValue({
      guestName: null,
      checkIn: '2026-11-06',
      checkOut: '2026-11-08',
      paxCount: 3,
      externalReference: 'booking-manual-5459856627',
    });

    render(
      <MemoryRouter initialEntries={['/reservations/new']}>
        <Routes>
          <Route path="/reservations/new" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/nombre del huésped/i), { target: { value: 'Ya escrito' } });

    const file = new File(['fake-image-bytes'], 'screenshot.jpg', { type: 'image/jpeg' });
    const input = screen.getByLabelText(/importar desde captura de booking\.com/i);
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByLabelText(/check-in/i)).toHaveValue('2026-11-06'));
    expect(screen.getByLabelText(/nombre del huésped/i)).toHaveValue('Ya escrito');
  });

  it('shows a fallback notice when the import fails', async () => {
    vi.spyOn(reservationImportApi, 'parseScreenshot').mockRejectedValue(new Error('network error'));

    render(
      <MemoryRouter initialEntries={['/reservations/new']}>
        <Routes>
          <Route path="/reservations/new" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const file = new File(['fake-image-bytes'], 'screenshot.jpg', { type: 'image/jpeg' });
    const input = screen.getByLabelText(/importar desde captura de booking\.com/i);
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/no pudimos leer los datos de la captura/i);
  });

  it('shows the fallback notice and does not change the channel when every extracted field is null', async () => {
    vi.spyOn(reservationImportApi, 'parseScreenshot').mockResolvedValue({
      guestName: null,
      checkIn: null,
      checkOut: null,
      paxCount: null,
      externalReference: null,
    });

    render(
      <MemoryRouter initialEntries={['/reservations/new']}>
        <Routes>
          <Route path="/reservations/new" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const file = new File(['fake-image-bytes'], 'screenshot.jpg', { type: 'image/jpeg' });
    const input = screen.getByLabelText(/importar desde captura de booking\.com/i);
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/no pudimos leer los datos de la captura/i);
    expect(screen.getByLabelText(/canal/i)).toHaveValue('DIRECT');
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

    const button = await screen.findByRole('button', { name: /marcar pago del 30% como recibido/i });
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

    const button = await screen.findByRole('button', { name: /marcar pago del 30% como recibido/i });
    fireEvent.click(button);

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo marcar el pago del 30%/i);
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

    expect(await screen.findByText(/ya no está en el calendario del canal/i)).toBeInTheDocument();
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
