import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SensoresTab } from './SensoresTab';
import * as ambientApi from '../../api/ambient';

describe('SensoresTab', () => {
  it('shows an Ideal chip for a reading below its threshold', async () => {
    vi.spyOn(ambientApi, 'getAmbientReadings').mockResolvedValue([
      {
        id: 'dev-1',
        name: 'Living room',
        online: true,
        lastSeenAt: '2026-09-27T12:00:00.000Z',
        readings: [{ id: 'r-1', sensor: 'smoke', level: 300, threshold: 2500, updatedAt: '2026-09-27T12:00:00.000Z' }],
      },
    ]);

    render(<SensoresTab token="tok-1" />);

    expect(await screen.findByText('Ideal')).toBeInTheDocument();
  });

  it('shows an Alto chip for a reading at or above its threshold', async () => {
    vi.spyOn(ambientApi, 'getAmbientReadings').mockResolvedValue([
      {
        id: 'dev-1',
        name: 'Living room',
        online: true,
        lastSeenAt: '2026-09-27T12:00:00.000Z',
        readings: [{ id: 'r-1', sensor: 'co', level: 2600, threshold: 2500, updatedAt: '2026-09-27T12:00:00.000Z' }],
      },
    ]);

    render(<SensoresTab token="tok-1" />);

    expect(await screen.findByText('Alto')).toBeInTheDocument();
  });

  it('shows no status chip for a sensor with no threshold, like temperature', async () => {
    vi.spyOn(ambientApi, 'getAmbientReadings').mockResolvedValue([
      {
        id: 'dev-1',
        name: 'Living room',
        online: true,
        lastSeenAt: '2026-09-27T12:00:00.000Z',
        readings: [
          { id: 'r-1', sensor: 'temperature', level: 23, threshold: null, updatedAt: '2026-09-27T12:00:00.000Z' },
        ],
      },
    ]);

    render(<SensoresTab token="tok-1" />);

    expect(await screen.findByText('23')).toBeInTheDocument();
    expect(screen.getByText('°C')).toBeInTheDocument();
    expect(screen.queryByText('Ideal')).not.toBeInTheDocument();
    expect(screen.queryByText('Alto')).not.toBeInTheDocument();
  });

  it('shows an empty-state message when there are no devices', async () => {
    vi.spyOn(ambientApi, 'getAmbientReadings').mockResolvedValue([]);

    render(<SensoresTab token="tok-1" />);

    expect(await screen.findByText(/todavía no hay datos/i)).toBeInTheDocument();
  });

  it('shows an empty-state message on a fetch failure', async () => {
    vi.spyOn(ambientApi, 'getAmbientReadings').mockRejectedValue(new Error('forbidden'));

    render(<SensoresTab token="tok-1" />);

    expect(await screen.findByText(/todavía no hay datos/i)).toBeInTheDocument();
  });
});
