import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TodayPage } from './TodayPage';
import { TimelinePage } from './TimelinePage';
import * as reservationsApi from '../api/reservations';
import { Reservation } from '../reservations/types';

function stay(id: string, guestName: string, checkIn: string, checkOut: string, overrides: Partial<Reservation> = {}): Reservation {
  return {
    id,
    guestName,
    checkIn: `${checkIn}T00:00:00.000Z`,
    checkOut: `${checkOut}T00:00:00.000Z`,
    paxCount: 2,
    source: 'AIRBNB',
    totalAmount: 0,
    currency: 'ARS',
    status: 'CONFIRMED',
    confirmationToken: `tok-${id}`,
    ...overrides,
  };
}

beforeEach(() => {
  // Only Date is faked: real timers keep testing-library's findBy* polling working.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 4, 10, 0));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TodayPage', () => {
  it('shows who is in the house, who arrives next and the cleaning window', async () => {
    vi.spyOn(reservationsApi, 'listReservations').mockResolvedValue([
      stay('1', 'Jane Doe', '2026-10-01', '2026-10-06'),
      stay('2', 'John Smith', '2026-10-09', '2026-10-12', { status: 'PENDING', paxCount: 4 }),
      stay('3', 'Gone Guest', '2026-10-02', '2026-10-03', { status: 'CANCELLED' }),
    ]);

    render(
      <MemoryRouter>
        <TodayPage />
      </MemoryRouter>,
    );

    const now = await screen.findByRole('region', { name: 'En la casa ahora' });
    expect(within(now).getByRole('link', { name: 'Jane Doe' })).toHaveAttribute('href', '/reservations/1');
    expect(now).toHaveTextContent(/se va en 2 días/i);

    const next = screen.getByRole('region', { name: 'Próximo huésped' });
    expect(within(next).getByRole('link', { name: 'John Smith' })).toBeInTheDocument();
    expect(next).toHaveTextContent(/llega en 5 días/i);
    expect(next).toHaveTextContent(/4 huéspedes/);

    const cleaning = screen.getByRole('region', { name: 'Limpieza' });
    expect(cleaning).toHaveTextContent(/3 noches libres/);

    expect(screen.queryByText('Gone Guest')).not.toBeInTheDocument();
  });

  it('flags a same-day turnover', async () => {
    vi.spyOn(reservationsApi, 'listReservations').mockResolvedValue([
      stay('1', 'Leaving Today', '2026-10-01', '2026-10-04'),
      stay('2', 'Arriving Today', '2026-10-04', '2026-10-07'),
    ]);

    render(
      <MemoryRouter>
        <TodayPage />
      </MemoryRouter>,
    );

    const cleaning = await screen.findByRole('region', { name: 'Limpieza' });
    expect(cleaning).toHaveTextContent(/recambio hoy/i);
    expect(screen.getAllByText('Recambio mismo día').length).toBeGreaterThan(0);
  });

  it('shows an error when the reservations cannot be loaded', async () => {
    vi.spyOn(reservationsApi, 'listReservations').mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <MemoryRouter>
        <TodayPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudieron cargar las reservas/i);
  });
});

describe('TimelinePage', () => {
  it('draws a bar per stay linking to the reservation, without cancelled ones', async () => {
    vi.spyOn(reservationsApi, 'listReservations').mockResolvedValue([
      stay('1', 'Jane Doe', '2026-10-01', '2026-10-06'),
      stay('2', 'John Smith', '2026-10-09', '2026-10-12'),
      stay('3', 'Gone Guest', '2026-10-02', '2026-10-03', { status: 'CANCELLED' }),
    ]);

    render(
      <MemoryRouter>
        <TimelinePage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('link', { name: /^Jane Doe:/ })).toHaveAttribute('href', '/reservations/1');
    expect(screen.getByRole('link', { name: /^John Smith:/ })).toHaveAttribute('href', '/reservations/2');
    expect(screen.queryByText('Gone Guest')).not.toBeInTheDocument();
    expect(screen.getByText('3 libres')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('warns about overlapping reservations', async () => {
    vi.spyOn(reservationsApi, 'listReservations').mockResolvedValue([
      stay('1', 'Jane Doe', '2026-10-01', '2026-10-08'),
      stay('2', 'John Smith', '2026-10-05', '2026-10-10'),
    ]);

    render(
      <MemoryRouter>
        <TimelinePage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(/superpuestas/i);
    expect(screen.getByRole('link', { name: /^John Smith:.*se superpone/ })).toBeInTheDocument();
  });
});
