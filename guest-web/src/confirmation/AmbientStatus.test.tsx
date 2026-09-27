import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AmbientStatus } from './AmbientStatus';
import * as ambientApi from '../api/ambient';

describe('AmbientStatus', () => {
  it('renders each device with its readings, labeled in Spanish', async () => {
    vi.spyOn(ambientApi, 'getAmbientReadings').mockResolvedValue([
      {
        id: 'dev-1',
        name: 'Living room',
        online: true,
        lastSeenAt: '2026-09-27T12:00:00.000Z',
        readings: [
          { id: 'r-1', sensor: 'temperature', level: 23, updatedAt: '2026-09-27T12:00:00.000Z' },
          { id: 'r-2', sensor: 'humidity', level: 45, updatedAt: '2026-09-27T12:00:00.000Z' },
        ],
      },
    ]);

    render(<AmbientStatus token="tok-1" />);

    expect(await screen.findByText('Living room')).toBeInTheDocument();
    expect(screen.getByText(/Temperatura: 23/)).toBeInTheDocument();
    expect(screen.getByText(/Humedad: 45/)).toBeInTheDocument();
    expect(screen.getByText('En línea')).toBeInTheDocument();
  });

  it('renders nothing on a fetch failure', async () => {
    vi.spyOn(ambientApi, 'getAmbientReadings').mockRejectedValue(new Error('forbidden'));

    const { container } = render(<AmbientStatus token="tok-1" />);

    await waitFor(() => expect(ambientApi.getAmbientReadings).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when there are no devices', async () => {
    vi.spyOn(ambientApi, 'getAmbientReadings').mockResolvedValue([]);

    const { container } = render(<AmbientStatus token="tok-1" />);

    await waitFor(() => expect(ambientApi.getAmbientReadings).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
