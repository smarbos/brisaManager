import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
});
