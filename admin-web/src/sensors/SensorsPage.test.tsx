import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SensorsPage } from './SensorsPage';
import * as ambientDevicesApi from '../api/ambient-devices';

describe('SensorsPage', () => {
  it('shows an empty state when no device has connected yet', async () => {
    vi.spyOn(ambientDevicesApi, 'listAmbientDevices').mockResolvedValue([]);

    render(<SensorsPage />);

    expect(await screen.findByText(/todavía no se conectó ningún dispositivo/i)).toBeInTheDocument();
  });

  it('shows a device online with its last connection as relative time and its readings', async () => {
    // Relative to the real current time (not frozen) - RTL's findBy* polling relies on real
    // timers, which fake timers interfere with.
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    vi.spyOn(ambientDevicesApi, 'listAmbientDevices').mockResolvedValue([
      {
        id: 'ambient-control-living-room',
        name: 'Living room',
        lastSeenAt: fiveMinutesAgo.toISOString(),
        online: true,
        readings: [{ id: 'r-1', sensor: 'sound', level: 120, updatedAt: fiveMinutesAgo.toISOString() }],
      },
    ]);

    render(<SensorsPage />);

    expect(await screen.findByText('Living room')).toBeInTheDocument();
    expect(screen.getByText('En línea')).toBeInTheDocument();
    expect(screen.getByText('hace 5 minutos')).toBeInTheDocument();
    expect(screen.getByText('Sonido: 120')).toBeInTheDocument();
  });

  it('shows a device offline, falling back to the raw deviceId when it has no name', async () => {
    vi.spyOn(ambientDevicesApi, 'listAmbientDevices').mockResolvedValue([
      {
        id: 'ambient-control-01',
        name: '',
        lastSeenAt: null,
        online: false,
        readings: [],
      },
    ]);

    render(<SensorsPage />);

    expect(await screen.findByText('ambient-control-01')).toBeInTheDocument();
    expect(screen.getByText('Sin conexión')).toBeInTheDocument();
    expect(screen.getByText('Nunca')).toBeInTheDocument();
  });

  it('shows an alert when devices cannot be loaded', async () => {
    vi.spyOn(ambientDevicesApi, 'listAmbientDevices').mockRejectedValue(new Error('network error'));

    render(<SensorsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudieron cargar los dispositivos/i);
  });
});
