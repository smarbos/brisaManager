import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ReservationFormPage } from './ReservationFormPage';
import * as reservationsApi from '../api/reservations';
import * as outboundEmailsApi from '../api/outbound-emails';
import * as reservationImagesApi from '../api/reservation-images';

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
    fireEvent.change(screen.getByLabelText(/email del huésped/i), { target: { value: 'jane@example.com' } });
    fireEvent.change(screen.getByLabelText(/teléfono del huésped/i), { target: { value: '+5491100000000' } });
    fireEvent.change(screen.getByLabelText(/check-in/i), { target: { value: '2026-01-10' } });
    fireEvent.change(screen.getByLabelText(/check-out/i), { target: { value: '2026-01-15' } });
    fireEvent.change(screen.getByLabelText(/monto total/i), { target: { value: '100000' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ guestEmail: 'jane@example.com', guestPhone: '+5491100000000' }),
      ),
    );
  });

  it('accepts a decimal total amount (dollars and cents)', async () => {
    const createSpy = vi.spyOn(reservationsApi, 'createReservation').mockResolvedValue({ id: '1' } as never);

    render(
      <MemoryRouter initialEntries={['/reservations/new']}>
        <Routes>
          <Route path="/reservations/new" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    // step="0.01" is what lets the browser's native number-input validation accept cents
    // instead of rejecting anything but a whole number (the bug this test guards against).
    expect(screen.getByLabelText(/monto total/i)).toHaveAttribute('step', '0.01');

    fireEvent.change(screen.getByLabelText(/nombre del huésped/i), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText(/email del huésped/i), { target: { value: 'jane@example.com' } });
    fireEvent.change(screen.getByLabelText(/teléfono del huésped/i), { target: { value: '+5491100000000' } });
    fireEvent.change(screen.getByLabelText(/check-in/i), { target: { value: '2026-01-10' } });
    fireEvent.change(screen.getByLabelText(/check-out/i), { target: { value: '2026-01-15' } });
    fireEvent.change(screen.getByLabelText(/monto total/i), { target: { value: '145.80' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ totalAmount: 145.8 })),
    );
  });

  it('blocks saving and shows an inline error for an invalid guest phone', async () => {
    const createSpy = vi.spyOn(reservationsApi, 'createReservation').mockResolvedValue({ id: '1' } as never);

    render(
      <MemoryRouter initialEntries={['/reservations/new']}>
        <Routes>
          <Route path="/reservations/new" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/nombre del huésped/i), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText(/teléfono del huésped/i), { target: { value: '123' } });
    fireEvent.change(screen.getByLabelText(/check-in/i), { target: { value: '2026-01-10' } });
    fireEvent.change(screen.getByLabelText(/check-out/i), { target: { value: '2026-01-15' } });
    fireEvent.change(screen.getByLabelText(/monto total/i), { target: { value: '100000' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/número de teléfono válido/i);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('allows saving with no guest phone at all, since the field is optional', async () => {
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

    await waitFor(() => expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ guestPhone: '' })));
  });

  it('shows a link back to the reservations list', () => {
    render(
      <MemoryRouter initialEntries={['/reservations/new']}>
        <Routes>
          <Route path="/reservations/new" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /volver a reservas/i })).toHaveAttribute('href', '/');
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
    vi.spyOn(reservationImagesApi, 'listReservationImages').mockResolvedValue([]);
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

    expect(await screen.findByText(/id de reserva: 1/i)).toBeInTheDocument();

    const button = await screen.findByRole('button', { name: /marcar pago del 30% como recibido/i });
    fireEvent.click(button);

    await waitFor(() => expect(markSpy).toHaveBeenCalledWith('1'));
  });

  it('shows who made a change alongside the event, when known', async () => {
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
    vi.spyOn(reservationsApi, 'listReservationEvents').mockResolvedValue([
      {
        id: 'ev-1',
        type: 'FIELD_CHANGED',
        detail: 'Email del huésped: "a@example.com" → "b@example.com"',
        field: 'guestEmail',
        oldValue: 'a@example.com',
        newValue: 'b@example.com',
        actor: 'Huésped',
        createdAt: '2026-01-02T00:00:00.000Z',
      },
      {
        id: 'ev-2',
        type: 'RESERVATION_CREATED',
        detail: 'Creada manualmente por el personal',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ] as never);
    vi.spyOn(reservationImagesApi, 'listReservationImages').mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={['/reservations/1']}>
        <Routes>
          <Route path="/reservations/:id" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/\(Huésped\)/)).toBeInTheDocument();
    // An event with no actor (e.g. a pre-existing event from before this field existed)
    // shows no parenthetical at all, rather than "(null)" or an empty "()".
    expect(screen.getByText(/creada manualmente por el personal/i).textContent).not.toMatch(/\(/);
  });

  it('shows uploaded receipt images and marks payment/deposit received from that section', async () => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn().mockReturnValue('blob:fake-url'),
      revokeObjectURL: vi.fn(),
    });
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
    vi.spyOn(reservationImagesApi, 'listReservationImages').mockResolvedValue([
      {
        id: 'img-1',
        reservationId: '1',
        originalName: 'comprobante.png',
        mimeType: 'image/png',
        sizeBytes: 123,
        message: 'es la seña',
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ]);
    vi.spyOn(reservationImagesApi, 'getReservationImageBlob').mockResolvedValue(new Blob(['x']));
    const markPaymentSpy = vi.spyOn(reservationsApi, 'markPaymentReceived').mockResolvedValue({ id: '1' } as never);
    const markDepositSpy = vi.spyOn(reservationsApi, 'markDepositReceived').mockResolvedValue({ id: '1' } as never);

    render(
      <MemoryRouter initialEntries={['/reservations/1']}>
        <Routes>
          <Route path="/reservations/:id" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/comprobantes de pago/i)).toBeInTheDocument();
    expect(await screen.findByAltText('comprobante.png')).toHaveAttribute('src', 'blob:fake-url');
    expect(screen.getByText('es la seña')).toBeInTheDocument();

    const paymentButtons = screen.getAllByRole('button', { name: /marcar pago del 30% como recibido/i });
    fireEvent.click(paymentButtons[0]);
    await waitFor(() => expect(markPaymentSpy).toHaveBeenCalledWith('1'));

    const depositButtons = screen.getAllByRole('button', { name: /marcar depósito como recibido/i });
    fireEvent.click(depositButtons[0]);
    await waitFor(() => expect(markDepositSpy).toHaveBeenCalledWith('1'));
  });

  it('opens a receipt in a lightbox viewer when clicked, and closes it', async () => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn().mockReturnValue('blob:fake-url'),
      revokeObjectURL: vi.fn(),
    });
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
    vi.spyOn(reservationImagesApi, 'listReservationImages').mockResolvedValue([
      {
        id: 'img-1',
        reservationId: '1',
        originalName: 'comprobante.png',
        mimeType: 'image/png',
        sizeBytes: 123,
        message: null,
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ]);
    vi.spyOn(reservationImagesApi, 'getReservationImageBlob').mockResolvedValue(new Blob(['x']));

    render(
      <MemoryRouter initialEntries={['/reservations/1']}>
        <Routes>
          <Route path="/reservations/:id" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const thumbnail = await screen.findByAltText('comprobante.png');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(thumbnail);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('img')).toHaveAttribute('src', 'blob:fake-url');

    fireEvent.click(screen.getByRole('button', { name: /cerrar/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not show the receipts section when no images were uploaded', async () => {
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
    vi.spyOn(reservationImagesApi, 'listReservationImages').mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={['/reservations/1']}>
        <Routes>
          <Route path="/reservations/:id" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText(/id de reserva: 1/i);
    expect(screen.queryByText(/comprobantes de pago/i)).not.toBeInTheDocument();
  });

  it('resends the initial confirmation email and refreshes the record', async () => {
    vi.spyOn(reservationsApi, 'getReservation').mockResolvedValue({
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
      confirmationToken: 'tok-1',
    } as never);
    vi.spyOn(reservationsApi, 'listReservationEvents').mockResolvedValue([]);
    vi.spyOn(reservationImagesApi, 'listReservationImages').mockResolvedValue([]);
    const resendSpy = vi
      .spyOn(reservationsApi, 'resendInitialEmail')
      .mockResolvedValue({ sent: true, reservation: {} as never });

    render(
      <MemoryRouter initialEntries={['/reservations/1']}>
        <Routes>
          <Route path="/reservations/:id" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const button = await screen.findByRole('button', { name: /reenviar email de confirmación/i });
    fireEvent.click(button);

    await waitFor(() => expect(resendSpy).toHaveBeenCalledWith('1'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('resends the final confirmation email for a confirmed reservation', async () => {
    vi.spyOn(reservationsApi, 'getReservation').mockResolvedValue({
      id: '1',
      guestName: 'Jane Doe',
      guestEmail: 'jane@example.com',
      checkIn: '2026-01-10',
      checkOut: '2026-01-15',
      paxCount: 2,
      source: 'DIRECT',
      totalAmount: 100000,
      currency: 'ARS',
      status: 'CONFIRMED',
      confirmationToken: 'tok-1',
    } as never);
    vi.spyOn(reservationsApi, 'listReservationEvents').mockResolvedValue([]);
    vi.spyOn(reservationImagesApi, 'listReservationImages').mockResolvedValue([]);
    const resendSpy = vi
      .spyOn(reservationsApi, 'resendFinalEmail')
      .mockResolvedValue({ sent: true, reservation: {} as never });

    render(
      <MemoryRouter initialEntries={['/reservations/1']}>
        <Routes>
          <Route path="/reservations/:id" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const button = await screen.findByRole('button', { name: /reenviar email de confirmación final/i });
    fireEvent.click(button);

    await waitFor(() => expect(resendSpy).toHaveBeenCalledWith('1'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('resends the cancellation email for a cancelled reservation', async () => {
    vi.spyOn(reservationsApi, 'getReservation').mockResolvedValue({
      id: '1',
      guestName: 'Jane Doe',
      guestEmail: 'jane@example.com',
      checkIn: '2026-01-10',
      checkOut: '2026-01-15',
      paxCount: 2,
      source: 'DIRECT',
      totalAmount: 100000,
      currency: 'ARS',
      status: 'CANCELLED',
      confirmationToken: 'tok-1',
    } as never);
    vi.spyOn(reservationsApi, 'listReservationEvents').mockResolvedValue([]);
    vi.spyOn(reservationImagesApi, 'listReservationImages').mockResolvedValue([]);
    const resendSpy = vi
      .spyOn(reservationsApi, 'resendCancellationEmail')
      .mockResolvedValue({ sent: true, reservation: {} as never });

    render(
      <MemoryRouter initialEntries={['/reservations/1']}>
        <Routes>
          <Route path="/reservations/:id" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const button = await screen.findByRole('button', { name: /reenviar email de cancelación/i });
    fireEvent.click(button);

    await waitFor(() => expect(resendSpy).toHaveBeenCalledWith('1'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not show the final/cancellation resend rows for a reservation still pending', async () => {
    vi.spyOn(reservationsApi, 'getReservation').mockResolvedValue({
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
      confirmationToken: 'tok-1',
    } as never);
    vi.spyOn(reservationsApi, 'listReservationEvents').mockResolvedValue([]);
    vi.spyOn(reservationImagesApi, 'listReservationImages').mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={['/reservations/1']}>
        <Routes>
          <Route path="/reservations/:id" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByRole('button', { name: /reenviar email de confirmación$/i });
    expect(screen.queryByRole('button', { name: /reenviar email de confirmación final/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reenviar email de cancelación/i })).not.toBeInTheDocument();
  });

  it('pre-fills the email and phone fields when editing an existing reservation', async () => {
    vi.spyOn(reservationsApi, 'getReservation').mockResolvedValue({
      id: '1',
      guestName: 'Jane Doe',
      guestEmail: 'jane@example.com',
      guestPhone: '+5491100000000',
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
    vi.spyOn(reservationImagesApi, 'listReservationImages').mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={['/reservations/1']}>
        <Routes>
          <Route path="/reservations/:id" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByLabelText(/email del huésped/i)).toHaveValue('jane@example.com'));
    expect(screen.getByLabelText(/teléfono del huésped/i)).toHaveValue('+5491100000000');
  });

  it('shows an alert when the resent email fails to deliver', async () => {
    vi.spyOn(reservationsApi, 'getReservation').mockResolvedValue({
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
      confirmationToken: 'tok-1',
    } as never);
    vi.spyOn(reservationsApi, 'listReservationEvents').mockResolvedValue([]);
    vi.spyOn(reservationImagesApi, 'listReservationImages').mockResolvedValue([]);
    vi.spyOn(reservationsApi, 'resendInitialEmail').mockResolvedValue({ sent: false, reservation: {} as never });

    render(
      <MemoryRouter initialEntries={['/reservations/1']}>
        <Routes>
          <Route path="/reservations/:id" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const button = await screen.findByRole('button', { name: /reenviar email de confirmación/i });
    fireEvent.click(button);

    expect(await screen.findByRole('alert')).toHaveTextContent(/el email no se pudo programar/i);
  });

  it('does not show the resend button when the reservation has no guest email', async () => {
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
    vi.spyOn(reservationImagesApi, 'listReservationImages').mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={['/reservations/1']}>
        <Routes>
          <Route path="/reservations/:id" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText(/la reserva no tiene un email de huésped/i);
    expect(screen.queryByRole('button', { name: /reenviar email de confirmación/i })).not.toBeInTheDocument();
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
    vi.spyOn(reservationImagesApi, 'listReservationImages').mockResolvedValue([]);
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
    vi.spyOn(reservationImagesApi, 'listReservationImages').mockResolvedValue([]);

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

  it('cancels the reservation after a second click confirms it, and refreshes the record', async () => {
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
    vi.spyOn(reservationImagesApi, 'listReservationImages').mockResolvedValue([]);
    const cancelSpy = vi.spyOn(reservationsApi, 'cancelReservation').mockResolvedValue({ id: '1' } as never);

    render(
      <MemoryRouter initialEntries={['/reservations/1']}>
        <Routes>
          <Route path="/reservations/:id" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const button = await screen.findByRole('button', { name: /cancelar reserva/i });
    fireEvent.click(button);
    expect(cancelSpy).not.toHaveBeenCalled();

    const confirmButton = await screen.findByRole('button', { name: /¿cancelar\? tocá de nuevo/i });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(cancelSpy).toHaveBeenCalledWith('1'));
  });

  it('does not cancel on a single click — it only arms the confirmation', async () => {
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
    vi.spyOn(reservationImagesApi, 'listReservationImages').mockResolvedValue([]);
    const cancelSpy = vi.spyOn(reservationsApi, 'cancelReservation').mockResolvedValue({ id: '1' } as never);

    render(
      <MemoryRouter initialEntries={['/reservations/1']}>
        <Routes>
          <Route path="/reservations/:id" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const button = await screen.findByRole('button', { name: /cancelar reserva/i });
    fireEvent.click(button);

    expect(cancelSpy).not.toHaveBeenCalled();
  });

  it('does not show a cancel button for a reservation that is already cancelled', async () => {
    vi.spyOn(reservationsApi, 'getReservation').mockResolvedValue({
      id: '1',
      guestName: 'Jane Doe',
      checkIn: '2026-01-10',
      checkOut: '2026-01-15',
      paxCount: 2,
      source: 'DIRECT',
      totalAmount: 100000,
      currency: 'ARS',
      status: 'CANCELLED',
      confirmationToken: 'tok-1',
    } as never);
    vi.spyOn(reservationsApi, 'listReservationEvents').mockResolvedValue([]);
    vi.spyOn(reservationImagesApi, 'listReservationImages').mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={['/reservations/1']}>
        <Routes>
          <Route path="/reservations/:id" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText(/copiar link de confirmación/i);
    expect(screen.queryByRole('button', { name: /cancelar reserva/i })).not.toBeInTheDocument();
  });
  const reservationWithPhone = {
    id: '1',
    guestName: 'Jane Doe',
    guestPhone: '+5491122334455',
    checkIn: '2026-01-10',
    checkOut: '2026-01-15',
    paxCount: 2,
    source: 'DIRECT',
    totalAmount: 100000,
    currency: 'ARS',
    status: 'PENDING',
    confirmationToken: 'tok-1',
  };

  function renderReservationPage() {
    render(
      <MemoryRouter initialEntries={['/reservations/1']}>
        <Routes>
          <Route path="/reservations/:id" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('sends the check-in link over WhatsApp', async () => {
    vi.spyOn(reservationsApi, 'getReservation').mockResolvedValue(reservationWithPhone as never);
    vi.spyOn(reservationsApi, 'listReservationEvents').mockResolvedValue([]);
    vi.spyOn(reservationImagesApi, 'listReservationImages').mockResolvedValue([]);
    const sendSpy = vi
      .spyOn(reservationsApi, 'sendInitialWhatsapp')
      .mockResolvedValue({ sent: true, reservation: {} as never });

    renderReservationPage();

    fireEvent.click(await screen.findByRole('button', { name: /enviar link por whatsapp/i }));

    await waitFor(() => expect(sendSpy).toHaveBeenCalledWith('1'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an error when the WhatsApp could not be sent', async () => {
    vi.spyOn(reservationsApi, 'getReservation').mockResolvedValue(reservationWithPhone as never);
    vi.spyOn(reservationsApi, 'listReservationEvents').mockResolvedValue([]);
    vi.spyOn(reservationImagesApi, 'listReservationImages').mockResolvedValue([]);
    vi.spyOn(reservationsApi, 'sendInitialWhatsapp').mockResolvedValue({ sent: false, reservation: {} as never });

    renderReservationPage();

    fireEvent.click(await screen.findByRole('button', { name: /enviar link por whatsapp/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/el whatsapp no pudo enviarse/i);
  });

  it('hides the WhatsApp button when the reservation has no phone', async () => {
    vi.spyOn(reservationsApi, 'getReservation').mockResolvedValue({
      ...reservationWithPhone,
      guestPhone: undefined,
    } as never);
    vi.spyOn(reservationsApi, 'listReservationEvents').mockResolvedValue([]);
    vi.spyOn(reservationImagesApi, 'listReservationImages').mockResolvedValue([]);

    renderReservationPage();

    expect(await screen.findByText(/la reserva no tiene un teléfono de huésped/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /enviar link por whatsapp/i })).not.toBeInTheDocument();
  });

  it("shows this reservation's emails, with the outbox actions", async () => {
    vi.spyOn(reservationsApi, 'getReservation').mockResolvedValue({
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
      confirmationToken: 'tok-1',
    } as never);
    vi.spyOn(reservationsApi, 'listReservationEvents').mockResolvedValue([]);
    vi.spyOn(reservationImagesApi, 'listReservationImages').mockResolvedValue([]);
    const listSpy = vi.spyOn(outboundEmailsApi, 'listOutboundEmails').mockResolvedValue([
      {
        id: 'e1',
        kind: 'INITIAL_CONFIRMATION',
        status: 'SCHEDULED',
        to: 'jane@example.com',
        sentTo: null,
        subject: 'Confirmá tu reserva en La Brisa de Mar del Plata',
        html: '<p>Hola</p>',
        replyTo: null,
        sendAt: new Date(Date.now() + 120_000).toISOString(),
        sentAt: null,
        abortedAt: null,
        attempts: 0,
        lastError: null,
        reservationId: '1',
        resentFromId: null,
        createdAt: new Date().toISOString(),
      },
    ]);

    render(
      <MemoryRouter initialEntries={['/reservations/1']}>
        <Routes>
          <Route path="/reservations/:id" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const row = await screen.findByTestId('outbound-email-e1');
    expect(listSpy).toHaveBeenCalledWith({ reservationId: '1' });
    expect(row).toHaveTextContent(/se envía en/i);
    expect(screen.getByRole('button', { name: /abortar/i })).toBeInTheDocument();
  });

  it('shows a waiting confirmation email as scheduled and hides its resend button, so it is not queued twice', async () => {
    vi.spyOn(reservationsApi, 'getReservation').mockResolvedValue({
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
      confirmationToken: 'tok-1',
      confirmationEmailSentAt: null,
    } as never);
    vi.spyOn(reservationsApi, 'listReservationEvents').mockResolvedValue([]);
    vi.spyOn(reservationImagesApi, 'listReservationImages').mockResolvedValue([]);
    vi.spyOn(outboundEmailsApi, 'listOutboundEmails').mockResolvedValue([
      {
        id: 'e1',
        kind: 'INITIAL_CONFIRMATION',
        status: 'SCHEDULED',
        to: 'jane@example.com',
        sentTo: null,
        subject: 'Confirmá tu reserva en La Brisa de Mar del Plata',
        html: '<p>Hola</p>',
        replyTo: null,
        sendAt: new Date(Date.now() + 120_000).toISOString(),
        sentAt: null,
        abortedAt: null,
        attempts: 0,
        lastError: null,
        reservationId: '1',
        resentFromId: null,
        createdAt: new Date().toISOString(),
      },
    ]);

    render(
      <MemoryRouter initialEntries={['/reservations/1']}>
        <Routes>
          <Route path="/reservations/:id" element={<ReservationFormPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/programado para las \d{2}:\d{2}/i)).toBeInTheDocument();
    expect(screen.queryByText('No enviado')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reenviar email de confirmación$/i })).not.toBeInTheDocument();
  });
});
