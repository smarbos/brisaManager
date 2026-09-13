import { describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from './client';

describe('apiClient.request', () => {
  it('drops an expired token when the API answers 401', async () => {
    // Start on /login so the redirect is a no-op: jsdom cannot navigate.
    window.history.pushState({}, '', '/login');
    localStorage.setItem('accessToken', 'expired-token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 })),
    );

    await expect(apiClient.request('/reservations')).rejects.toBeInstanceOf(ApiError);
    expect(localStorage.getItem('accessToken')).toBeNull();
  });

  it('keeps the token for non-401 failures', async () => {
    localStorage.setItem('accessToken', 'a-token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Boom', { status: 500 })),
    );

    await expect(apiClient.request('/reservations')).rejects.toBeInstanceOf(ApiError);
    expect(localStorage.getItem('accessToken')).toBe('a-token');
  });
});
