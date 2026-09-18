import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppNav } from './AppNav';
import { AuthProvider } from '../auth/AuthContext';

function renderNav() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <AppNav />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('AppNav', () => {
  it('renders a link to every section', () => {
    renderNav();

    expect(screen.getByRole('link', { name: 'Reservas' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Huéspedes' })).toHaveAttribute('href', '/guests');
    expect(screen.getByRole('link', { name: 'Plantillas' })).toHaveAttribute('href', '/templates');
    expect(screen.getByRole('link', { name: 'Campañas' })).toHaveAttribute('href', '/campaigns');
    expect(screen.getByRole('link', { name: 'Registro de actividad' })).toHaveAttribute('href', '/activity');
    expect(screen.getByRole('link', { name: 'Configuración' })).toHaveAttribute('href', '/settings');
  });

  it('clears the stored token when logging out', async () => {
    localStorage.setItem('accessToken', 'a-token');

    renderNav();

    fireEvent.click(screen.getByRole('button', { name: /cerrar sesión/i }));

    await waitFor(() => expect(localStorage.getItem('accessToken')).toBeNull());
  });

  it('toggles the mobile menu open and closed', () => {
    renderNav();

    fireEvent.click(screen.getByRole('button', { name: /abrir menú/i }));
    expect(screen.getByRole('button', { name: /cerrar menú/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /cerrar menú/i }));
    expect(screen.getByRole('button', { name: /abrir menú/i })).toBeInTheDocument();
  });

  it('points the toggle button at the mobile menu via aria-controls', () => {
    renderNav();

    const toggle = screen.getByRole('button', { name: /abrir menú/i });
    fireEvent.click(toggle);

    const menuId = screen.getByRole('button', { name: /cerrar menú/i }).getAttribute('aria-controls');
    expect(menuId).toBeTruthy();
    const menu = document.getElementById(menuId!)!;
    expect(within(menu).getByRole('link', { name: 'Reservas' })).toBeInTheDocument();
  });

  it('moves focus into the menu when opened', async () => {
    renderNav();

    fireEvent.click(screen.getByRole('button', { name: /abrir menú/i }));

    const menu = document.getElementById('mobile-nav')!;
    await waitFor(() => expect(within(menu).getByRole('link', { name: 'Reservas' })).toHaveFocus());
  });

  it('closes on Escape and returns focus to the toggle button', async () => {
    renderNav();

    const toggle = screen.getByRole('button', { name: /abrir menú/i });
    fireEvent.click(toggle);
    const menu = document.getElementById('mobile-nav')!;
    const firstLink = within(menu).getByRole('link', { name: 'Reservas' });
    await waitFor(() => expect(firstLink).toHaveFocus());

    fireEvent.keyDown(firstLink, { key: 'Escape' });

    expect(screen.getByRole('button', { name: /abrir menú/i })).toHaveFocus();
  });
});
