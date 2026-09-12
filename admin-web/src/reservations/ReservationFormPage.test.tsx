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
});
