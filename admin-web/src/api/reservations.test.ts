import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from './client';
import { listReservations } from './reservations';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('listReservations', () => {
  it('sends several statuses as repeated status parameters', async () => {
    const spy = vi.spyOn(apiClient, 'request').mockResolvedValue([]);

    await listReservations({ status: ['PENDING', 'CONFIRMED'] });

    expect(spy).toHaveBeenCalledWith('/reservations?status=PENDING&status=CONFIRMED');
  });

  it('sends no query string without filters', async () => {
    const spy = vi.spyOn(apiClient, 'request').mockResolvedValue([]);

    await listReservations();

    expect(spy).toHaveBeenCalledWith('/reservations');
  });
});
