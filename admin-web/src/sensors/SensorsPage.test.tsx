import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SensorsPage } from './SensorsPage';
import * as ambientDevicesApi from '../api/ambient-devices';

const device = {
  id: 'ambient-control-living-room',
  name: 'Living room',
  lastSeenAt: null,
  online: true,
  readings: [],
};

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
        readings: [{ id: 'r-1', sensor: 'sound', level: 120, threshold: null, updatedAt: fiveMinutesAgo.toISOString() }],
      },
    ]);

    render(<SensorsPage />);

    expect(await screen.findByText('Living room')).toBeInTheDocument();
    expect(screen.getByText('En línea')).toBeInTheDocument();
    expect(screen.getByText('hace 5 minutos')).toBeInTheDocument();
    expect(screen.getByText('Sonido: 120')).toBeInTheDocument();
  });

  it('shows a reading with a calibrated threshold as a fraction and percentage', async () => {
    vi.spyOn(ambientDevicesApi, 'listAmbientDevices').mockResolvedValue([
      {
        id: 'ambient-control-living-room',
        name: 'Living room',
        lastSeenAt: null,
        online: true,
        readings: [
          { id: 'r-1', sensor: 'co', level: 1242, threshold: 2500, updatedAt: new Date().toISOString() },
          { id: 'r-2', sensor: 'temperature', level: 21, threshold: null, updatedAt: new Date().toISOString() },
        ],
      },
    ]);

    render(<SensorsPage />);

    expect(await screen.findByText(/Monóxido de carbono: 1242 \/ 2500 \(50%\)/)).toBeInTheDocument();
    expect(screen.getByText(/Temperatura: 21/)).toBeInTheDocument();
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

  it('queues a buzzer test and confirms it was sent', async () => {
    vi.spyOn(ambientDevicesApi, 'listAmbientDevices').mockResolvedValue([device]);
    const testSpy = vi.spyOn(ambientDevicesApi, 'testAmbientDeviceBuzzer').mockResolvedValue(device);

    render(<SensorsPage />);

    const button = await screen.findByRole('button', { name: /probar sirena/i });
    fireEvent.click(button);

    await waitFor(() => expect(testSpy).toHaveBeenCalledWith('ambient-control-living-room'));
    expect(await screen.findByText(/próximo heartbeat/i)).toBeInTheDocument();
  });

  it('shows an alert when queuing the buzzer test fails', async () => {
    vi.spyOn(ambientDevicesApi, 'listAmbientDevices').mockResolvedValue([device]);
    vi.spyOn(ambientDevicesApi, 'testAmbientDeviceBuzzer').mockRejectedValue(new Error('network error'));

    render(<SensorsPage />);

    const button = await screen.findByRole('button', { name: /probar sirena/i });
    fireEvent.click(button);

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo enviar el comando/i);
  });
});
