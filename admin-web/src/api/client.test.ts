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

describe('apiClient.upload', () => {
  it('attaches the auth header and does not force a Content-Type, letting the browser set the multipart boundary', async () => {
    localStorage.setItem('accessToken', 'a-token');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const formData = new FormData();

    await apiClient.upload('/reservation-import/parse-screenshot', formData);

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers).toEqual({ Authorization: 'Bearer a-token' });
    expect(options.body).toBe(formData);
  });

  it('drops an expired token when the API answers 401', async () => {
    window.history.pushState({}, '', '/login');
    localStorage.setItem('accessToken', 'expired-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 })));

    await expect(apiClient.upload('/reservation-import/parse-screenshot', new FormData())).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(localStorage.getItem('accessToken')).toBeNull();
  });
});
