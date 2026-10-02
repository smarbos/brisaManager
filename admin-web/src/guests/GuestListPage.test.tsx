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

  it('shows each guest\'s masked document in its own column', async () => {
    vi.spyOn(guestsApi, 'listGuests').mockResolvedValue([
      {
        id: '1',
        email: 'jane@example.com',
        name: 'Jane Doe',
        phone: null,
        totalStays: 0,
        lastStayAt: null,
        unsubscribedAt: null,
        documentMasked: 'DNI ···678',
      },
    ]);

    renderPage();

    expect(await screen.findByText('DNI ···678')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Documento' })).toBeInTheDocument();
  });

  it('searches by full document number on the server, then goes back to everyone', async () => {
    const listSpy = vi.spyOn(guestsApi, 'listGuests').mockImplementation((search) =>
      Promise.resolve(
        search
          ? [{ id: '2', email: null, name: 'Found Guest', phone: null, totalStays: 1, lastStayAt: null, unsubscribedAt: null }]
          : [{ id: '1', email: null, name: 'Everyone', phone: null, totalStays: 0, lastStayAt: null, unsubscribedAt: null }],
      ),
    );

    renderPage();
    await screen.findByText('Everyone');

    fireEvent.change(screen.getByLabelText(/buscar por documento/i), { target: { value: '12.345.678' } });
    fireEvent.click(screen.getByRole('button', { name: /^buscar$/i }));

    expect(await screen.findByText('Found Guest')).toBeInTheDocument();
    expect(listSpy).toHaveBeenLastCalledWith({ documentType: 'DNI', document: '12.345.678' });

    fireEvent.click(screen.getByRole('button', { name: /ver todos/i }));
    expect(await screen.findByText('Everyone')).toBeInTheDocument();
  });

  it('sends the issuing country with a passport search', async () => {
    const listSpy = vi.spyOn(guestsApi, 'listGuests').mockResolvedValue([]);

    renderPage();
    await waitFor(() => expect(listSpy).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/tipo de documento/i), { target: { value: 'PASAPORTE' } });
    fireEvent.change(screen.getByLabelText(/país emisor/i), { target: { value: 'ES' } });
    fireEvent.change(screen.getByLabelText(/buscar por documento/i), { target: { value: 'XA123456' } });
    fireEvent.click(screen.getByRole('button', { name: /^buscar$/i }));

    await waitFor(() =>
      expect(listSpy).toHaveBeenLastCalledWith({ documentType: 'PASAPORTE', documentCountry: 'ES', document: 'XA123456' }),
    );
    expect(await screen.findByText(/ningún huésped tiene ese documento/i)).toBeInTheDocument();
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

    fireEvent.change(screen.getByLabelText(/^buscar$/i), { target: { value: 'jane' } });

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
