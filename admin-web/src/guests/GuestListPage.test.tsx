import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { GuestListPage } from './GuestListPage';
import * as guestsApi from '../api/guests';

function renderPage() {
  return render(
    <MemoryRouter>
      <GuestListPage />
    </MemoryRouter>,
  );
}

describe('GuestListPage', () => {
  it('loads and displays guests', async () => {
    vi.spyOn(guestsApi, 'listGuests').mockResolvedValue([
      {
        id: '1',
        email: 'jane@example.com',
        name: 'Jane Doe',
        phone: '+54911',
        totalStays: 3,
        lastStayAt: '2026-05-01T00:00:00.000Z',
        unsubscribedAt: null,
      },
      {
        id: '2',
        email: 'john@example.com',
        name: 'John Smith',
        phone: null,
        totalStays: 1,
        lastStayAt: '2026-01-01T00:00:00.000Z',
        unsubscribedAt: '2026-02-01T00:00:00.000Z',
      },
    ]);

    renderPage();

    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());
    expect(screen.getByText('John Smith')).toBeInTheDocument();
    expect(screen.getByText(/dado de baja/i)).toBeInTheDocument();

    const nameLink = screen.getByRole('link', { name: 'Jane Doe' });
    expect(nameLink).toHaveAttribute('href', '/guests/1');
    const idLink = screen.getByRole('link', { name: '1' });
    expect(idLink).toHaveAttribute('href', '/guests/1');
  });

  it('filters guests by name, email, or phone', async () => {
    vi.spyOn(guestsApi, 'listGuests').mockResolvedValue([
      {
        id: '1',
        email: 'jane@example.com',
        name: 'Jane Doe',
        phone: '+54911',
        totalStays: 3,
        lastStayAt: '2026-05-01T00:00:00.000Z',
        unsubscribedAt: null,
      },
      {
        id: '2',
        email: 'john@example.com',
        name: 'John Smith',
        phone: null,
        totalStays: 1,
        lastStayAt: '2026-01-01T00:00:00.000Z',
        unsubscribedAt: null,
      },
    ]);

    renderPage();
    await screen.findByText('Jane Doe');

    fireEvent.change(screen.getByLabelText(/buscar/i), { target: { value: 'jane' } });

    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.queryByText('John Smith')).not.toBeInTheDocument();
  });

  it('shows a phone-only guest without an email crashing the list', async () => {
    vi.spyOn(guestsApi, 'listGuests').mockResolvedValue([
      {
        id: '1',
        email: null,
        name: 'María Laura',
        phone: '+591 75278095',
        totalStays: 1,
        lastStayAt: null,
        unsubscribedAt: null,
      },
    ]);

    renderPage();

    await screen.findByText('María Laura');
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows an alert when guests cannot be loaded', async () => {
    vi.spyOn(guestsApi, 'listGuests').mockRejectedValue(new Error('network error'));

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudieron cargar los huéspedes/i);
  });
});
