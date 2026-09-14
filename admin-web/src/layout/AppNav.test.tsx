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

    expect(screen.getByRole('link', { name: 'Reservations' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Guests' })).toHaveAttribute('href', '/guests');
    expect(screen.getByRole('link', { name: 'Templates' })).toHaveAttribute('href', '/templates');
    expect(screen.getByRole('link', { name: 'Campaigns' })).toHaveAttribute('href', '/campaigns');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  });

  it('clears the stored token when logging out', async () => {
    localStorage.setItem('accessToken', 'a-token');

    renderNav();

    fireEvent.click(screen.getByRole('button', { name: /log out/i }));

    await waitFor(() => expect(localStorage.getItem('accessToken')).toBeNull());
  });
});
