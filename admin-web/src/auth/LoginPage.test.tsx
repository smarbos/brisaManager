import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';
import { AuthProvider } from './AuthContext';
import * as apiClient from '../api/client';

describe('LoginPage', () => {
  it('shows an error when login fails', async () => {
    vi.spyOn(apiClient, 'login').mockRejectedValue(new Error('unauthorized'));

    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/correo electrónico/i), { target: { value: 'admin@labrisa.com.ar' } });
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: /iniciar sesión/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/email o contraseña incorrectos/i));
  });
});
