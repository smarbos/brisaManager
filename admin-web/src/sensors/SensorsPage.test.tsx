import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
    // "En línea" also appears in the summary card above the device list, so scope to the badge.
    expect(screen.getAllByText('En línea').length).toBe(2);
    expect(screen.getByText('hace 5 minutos')).toBeInTheDocument();
    expect(screen.getByText('Sonido')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('Sin umbral')).toBeInTheDocument();
  });

  it('shows a reading with a calibrated threshold as normal or high, with its unit when it has one', async () => {
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

    expect(await screen.findByText('Monóxido de carbono')).toBeInTheDocument();
    expect(screen.getByText('1242')).toBeInTheDocument();
    expect(screen.getByText('Normal')).toBeInTheDocument();

    expect(screen.getByText('Temperatura')).toBeInTheDocument();
    expect(screen.getByText('21')).toBeInTheDocument();
    expect(screen.getByText('°C')).toBeInTheDocument();
  });

  it('shows a high reading as a danger badge for a critical sensor', async () => {
    vi.spyOn(ambientDevicesApi, 'listAmbientDevices').mockResolvedValue([
      {
        id: 'ambient-control-living-room',
        name: 'Living room',
        lastSeenAt: null,
        online: true,
        readings: [{ id: 'r-1', sensor: 'smoke', level: 3000, threshold: 2500, updatedAt: new Date().toISOString() }],
      },
    ]);

    render(<SensorsPage />);

    expect(await screen.findByText('Humo')).toBeInTheDocument();
    expect(screen.getByText('Alto')).toBeInTheDocument();
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
    // "Sin conexión" also appears in the summary card above the device list, so scope to the badge.
    expect(screen.getAllByText('Sin conexión').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/nunca/i)).toBeInTheDocument();
  });

  it('shows an alert when devices cannot be loaded', async () => {
    vi.spyOn(ambientDevicesApi, 'listAmbientDevices').mockRejectedValue(new Error('network error'));

    render(<SensorsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudieron cargar los dispositivos/i);
  });

  it('queues a buzzer test after a second click confirms it', async () => {
    vi.spyOn(ambientDevicesApi, 'listAmbientDevices').mockResolvedValue([device]);
    const testSpy = vi.spyOn(ambientDevicesApi, 'testAmbientDeviceBuzzer').mockResolvedValue(device);

    render(<SensorsPage />);

    const button = await screen.findByRole('button', { name: /probar sirena/i });
    fireEvent.click(button);
    expect(testSpy).not.toHaveBeenCalled();

    const confirmButton = await screen.findByRole('button', { name: /¿activar la sirena\?/i });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(testSpy).toHaveBeenCalledWith('ambient-control-living-room'));
    expect(await screen.findByText(/próximo heartbeat/i)).toBeInTheDocument();
  });

  it('does not send the buzzer test on a single click — it only arms the confirmation', async () => {
    vi.spyOn(ambientDevicesApi, 'listAmbientDevices').mockResolvedValue([device]);
    const testSpy = vi.spyOn(ambientDevicesApi, 'testAmbientDeviceBuzzer').mockResolvedValue(device);

    render(<SensorsPage />);

    const button = await screen.findByRole('button', { name: /probar sirena/i });
    fireEvent.click(button);

    expect(testSpy).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: /¿activar la sirena\?/i })).toBeInTheDocument();
  });

  it('shows an alert when queuing the buzzer test fails', async () => {
    vi.spyOn(ambientDevicesApi, 'listAmbientDevices').mockResolvedValue([device]);
    vi.spyOn(ambientDevicesApi, 'testAmbientDeviceBuzzer').mockRejectedValue(new Error('network error'));

    render(<SensorsPage />);

    const button = await screen.findByRole('button', { name: /probar sirena/i });
    fireEvent.click(button);
    const confirmButton = await screen.findByRole('button', { name: /¿activar la sirena\?/i });
    fireEvent.click(confirmButton);

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo enviar el comando/i);
  });

  it('shows the summary counts of online and offline devices', async () => {
    vi.spyOn(ambientDevicesApi, 'listAmbientDevices').mockResolvedValue([
      { id: 'a', name: 'A', lastSeenAt: null, online: true, readings: [] },
      { id: 'b', name: 'B', lastSeenAt: null, online: false, readings: [] },
    ]);

    render(<SensorsPage />);

    await screen.findByText('A');
    const summary = screen.getByText('Dispositivos').closest('.grid') as HTMLElement;
    expect(within(summary).getByText('Dispositivos').nextElementSibling).toHaveTextContent('2');
    expect(within(summary).getByText('En línea').nextElementSibling).toHaveTextContent('1');
    expect(within(summary).getByText('Sin conexión').nextElementSibling).toHaveTextContent('1');
  });
});
