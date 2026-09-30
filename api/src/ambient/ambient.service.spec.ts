import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AmbientService,
  DEVICE_OFFLINE_THRESHOLD_MS,
  DEVICE_OFFLINE_CRITICAL_THRESHOLD_MS,
  DEVICE_ONLINE_DISPLAY_THRESHOLD_MS,
} from './ambient.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';

describe('AmbientService', () => {
  let service: AmbientService;
  let prisma: {
    ambientEvent: { create: jest.Mock; findMany: jest.Mock };
    ambientDevice: { upsert: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    ambientDeviceReading: { upsert: jest.Mock };
  };
  let notificationsService: { hasOpen: jest.Mock; create: jest.Mock; resolveOpen: jest.Mock };
  let settingsService: { get: jest.Mock };

  beforeEach(async () => {
    prisma = {
      ambientEvent: { create: jest.fn(), findMany: jest.fn() },
      ambientDevice: {
        upsert: jest.fn().mockResolvedValue({ id: 'ambient-control-01', pendingCommand: null }),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      ambientDeviceReading: { upsert: jest.fn() },
    };
    notificationsService = {
      hasOpen: jest.fn().mockResolvedValue(false),
      create: jest.fn(),
      resolveOpen: jest.fn(),
    };
    // Covers every sound-alert test below that isn't specifically exercising the time-window
    // gate itself: a window covering all but one minute of any day, so those tests keep
    // observing today's "sound always notifies" behavior without needing real-time control or
    // to know about this feature. The dedicated "sound alert time windows" tests below need
    // precise control over the current time, so they freeze it locally instead.
    settingsService = { get: jest.fn().mockResolvedValue({ soundAlertWindows: '00:00-23:59' }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AmbientService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: SettingsService, useValue: settingsService },
      ],
    }).compile();

    service = moduleRef.get(AmbientService);
  });

  describe('recordAlert', () => {
    it('builds a sound-specific message and logs it', async () => {
      prisma.ambientEvent.create.mockResolvedValue({ id: '1' });

      await service.recordAlert({
        deviceId: 'ambient-control-01',
        sensor: 'sound',
        level: 1935,
        detail: '5 loud events within 30000ms',
      });

      expect(prisma.ambientEvent.create).toHaveBeenCalledWith({
        data: {
          deviceId: 'ambient-control-01',
          sensor: 'sound',
          level: 1935,
          message: 'Ruido fuerte repetido detectado (dispositivo ambient-control-01): 5 loud events within 30000ms',
        },
      });
    });

    it('builds a smoke-specific message, distinct from sound', async () => {
      prisma.ambientEvent.create.mockResolvedValue({ id: '1' });

      await service.recordAlert({ deviceId: 'ambient-control-01', sensor: 'smoke' });

      expect(prisma.ambientEvent.create).toHaveBeenCalledWith({
        data: {
          deviceId: 'ambient-control-01',
          sensor: 'smoke',
          level: null,
          message: '¡Posible humo detectado! (dispositivo ambient-control-01).',
        },
      });
    });

    it('builds a co-specific message, distinct from sound and smoke', async () => {
      prisma.ambientEvent.create.mockResolvedValue({ id: '1' });

      await service.recordAlert({ deviceId: 'ambient-control-01', sensor: 'co', level: 2100 });

      expect(prisma.ambientEvent.create).toHaveBeenCalledWith({
        data: {
          deviceId: 'ambient-control-01',
          sensor: 'co',
          level: 2100,
          message: '¡Posible monóxido de carbono detectado! (dispositivo ambient-control-01).',
        },
      });
    });

    it('falls back to a generic message for an unrecognized sensor type', async () => {
      prisma.ambientEvent.create.mockResolvedValue({ id: '1' });

      await service.recordAlert({ deviceId: 'ambient-control-01', sensor: 'vibration' });

      expect(prisma.ambientEvent.create).toHaveBeenCalledWith({
        data: {
          deviceId: 'ambient-control-01',
          sensor: 'vibration',
          level: null,
          message: 'Alerta del sensor "vibration" (dispositivo ambient-control-01).',
        },
      });
    });

    it('creates a deduped notification when none is open for this device+sensor', async () => {
      prisma.ambientEvent.create.mockResolvedValue({ id: '1' });
      notificationsService.hasOpen.mockResolvedValue(false);

      await service.recordAlert({ deviceId: 'ambient-control-01', sensor: 'sound', level: 1935 });

      expect(notificationsService.hasOpen).toHaveBeenCalledWith('ambient-alert:ambient-control-01:sound');
      expect(notificationsService.create).toHaveBeenCalledWith({
        type: 'AMBIENT_ALERT',
        message: 'Ruido fuerte repetido detectado (dispositivo ambient-control-01).',
        dedupeKey: 'ambient-alert:ambient-control-01:sound',
      });
    });

    it('skips creating a new notification while one is already open for this device+sensor', async () => {
      prisma.ambientEvent.create.mockResolvedValue({ id: '1' });
      notificationsService.hasOpen.mockResolvedValue(true);

      await service.recordAlert({ deviceId: 'ambient-control-01', sensor: 'sound', level: 1935 });

      expect(notificationsService.create).not.toHaveBeenCalled();
    });

    it('also records the alert as a device reading and resolves any open offline notification', async () => {
      prisma.ambientEvent.create.mockResolvedValue({ id: '1' });

      await service.recordAlert({ deviceId: 'ambient-control-01', sensor: 'sound', level: 1935 });

      expect(prisma.ambientDevice.upsert).toHaveBeenCalledWith({
        where: { id: 'ambient-control-01' },
        create: { id: 'ambient-control-01', name: '', lastSeenAt: expect.any(Date) },
        update: { lastSeenAt: expect.any(Date) },
      });
      expect(prisma.ambientDeviceReading.upsert).toHaveBeenCalledWith({
        where: { deviceId_sensor: { deviceId: 'ambient-control-01', sensor: 'sound' } },
        create: { deviceId: 'ambient-control-01', sensor: 'sound', level: 1935, threshold: null },
        update: { level: 1935, threshold: null },
      });
      expect(notificationsService.resolveOpen).toHaveBeenCalledWith('device-offline:ambient-control-01');
    });

    it('carries the threshold through to the reading upsert when the alert includes one', async () => {
      prisma.ambientEvent.create.mockResolvedValue({ id: '1' });

      await service.recordAlert({ deviceId: 'ambient-control-01', sensor: 'co', level: 2600, threshold: 2500 });

      expect(prisma.ambientDeviceReading.upsert).toHaveBeenCalledWith({
        where: { deviceId_sensor: { deviceId: 'ambient-control-01', sensor: 'co' } },
        create: { deviceId: 'ambient-control-01', sensor: 'co', level: 2600, threshold: 2500 },
        update: { level: 2600, threshold: 2500 },
      });
    });

    it('skips the reading upsert when the alert carries no level', async () => {
      prisma.ambientEvent.create.mockResolvedValue({ id: '1' });

      await service.recordAlert({ deviceId: 'ambient-control-01', sensor: 'smoke' });

      expect(prisma.ambientDeviceReading.upsert).not.toHaveBeenCalled();
    });
  });

  describe('recordAlert - sound alert time windows', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('does not create a notification for a sound alert outside the configured windows, but still logs the event', async () => {
      settingsService.get.mockResolvedValue({ soundAlertWindows: '22:00-08:00' });
      jest.setSystemTime(new Date('2026-01-15T15:00:00.000Z')); // Buenos Aires 12:00 - outside 22:00-08:00
      prisma.ambientEvent.create.mockResolvedValue({ id: '1' });

      const event = await service.recordAlert({ deviceId: 'ambient-control-01', sensor: 'sound', level: 1935 });

      expect(prisma.ambientEvent.create).toHaveBeenCalled();
      expect(notificationsService.create).not.toHaveBeenCalled();
      expect(event).toEqual({ id: '1' });
    });

    it('creates a notification for a sound alert inside a configured window', async () => {
      settingsService.get.mockResolvedValue({ soundAlertWindows: '22:00-08:00' });
      jest.setSystemTime(new Date('2026-01-15T02:00:00.000Z')); // Buenos Aires 23:00 - inside 22:00-08:00
      prisma.ambientEvent.create.mockResolvedValue({ id: '1' });

      await service.recordAlert({ deviceId: 'ambient-control-01', sensor: 'sound', level: 1935 });

      expect(notificationsService.create).toHaveBeenCalled();
    });

    it('never notifies for a sound alert when no windows are configured at all', async () => {
      settingsService.get.mockResolvedValue({ soundAlertWindows: '' });
      prisma.ambientEvent.create.mockResolvedValue({ id: '1' });

      await service.recordAlert({ deviceId: 'ambient-control-01', sensor: 'sound', level: 1935 });

      expect(notificationsService.create).not.toHaveBeenCalled();
    });

    it('still respects the open-notification dedupe when inside a configured window', async () => {
      settingsService.get.mockResolvedValue({ soundAlertWindows: '00:00-23:59' });
      notificationsService.hasOpen.mockResolvedValue(true);
      prisma.ambientEvent.create.mockResolvedValue({ id: '1' });

      await service.recordAlert({ deviceId: 'ambient-control-01', sensor: 'sound', level: 1935 });

      expect(notificationsService.create).not.toHaveBeenCalled();
    });

    it('always notifies for smoke and co regardless of sound window configuration, without even consulting it', async () => {
      settingsService.get.mockResolvedValue({ soundAlertWindows: '' }); // would block sound entirely
      prisma.ambientEvent.create.mockResolvedValue({ id: '1' });

      await service.recordAlert({ deviceId: 'ambient-control-01', sensor: 'smoke', level: 3000 });

      expect(notificationsService.create).toHaveBeenCalled();
      expect(settingsService.get).not.toHaveBeenCalled();
    });
  });

  describe('recordHeartbeat', () => {
    it('upserts the device with its name and every reading it carries', async () => {
      await service.recordHeartbeat({
        deviceId: 'ambient-control-01',
        deviceName: 'Living room',
        readings: [{ sensor: 'sound', level: 120 }],
      });

      expect(prisma.ambientDevice.upsert).toHaveBeenCalledWith({
        where: { id: 'ambient-control-01' },
        create: { id: 'ambient-control-01', name: 'Living room', lastSeenAt: expect.any(Date) },
        update: { name: 'Living room', lastSeenAt: expect.any(Date) },
      });
      expect(prisma.ambientDeviceReading.upsert).toHaveBeenCalledWith({
        where: { deviceId_sensor: { deviceId: 'ambient-control-01', sensor: 'sound' } },
        create: { deviceId: 'ambient-control-01', sensor: 'sound', level: 120, threshold: null },
        update: { level: 120, threshold: null },
      });
      expect(notificationsService.resolveOpen).toHaveBeenCalledWith('device-offline:ambient-control-01');
    });

    it('stores the threshold a reading carries, and null for a sensor with none (e.g. temperature)', async () => {
      await service.recordHeartbeat({
        deviceId: 'ambient-control-01',
        readings: [
          { sensor: 'smoke', level: 445, threshold: 2500 },
          { sensor: 'temperature', level: 21 },
        ],
      });

      expect(prisma.ambientDeviceReading.upsert).toHaveBeenCalledWith({
        where: { deviceId_sensor: { deviceId: 'ambient-control-01', sensor: 'smoke' } },
        create: { deviceId: 'ambient-control-01', sensor: 'smoke', level: 445, threshold: 2500 },
        update: { level: 445, threshold: 2500 },
      });
      expect(prisma.ambientDeviceReading.upsert).toHaveBeenCalledWith({
        where: { deviceId_sensor: { deviceId: 'ambient-control-01', sensor: 'temperature' } },
        create: { deviceId: 'ambient-control-01', sensor: 'temperature', level: 21, threshold: null },
        update: { level: 21, threshold: null },
      });
    });

    it('does not overwrite the stored name when deviceName is omitted', async () => {
      await service.recordHeartbeat({ deviceId: 'ambient-control-01', readings: [] });

      expect(prisma.ambientDevice.upsert).toHaveBeenCalledWith({
        where: { id: 'ambient-control-01' },
        create: { id: 'ambient-control-01', name: '', lastSeenAt: expect.any(Date) },
        update: { lastSeenAt: expect.any(Date) },
      });
    });

    it('responds with a null pendingCommand and touches nothing else when none is queued', async () => {
      prisma.ambientDevice.upsert.mockResolvedValue({ id: 'ambient-control-01', pendingCommand: null });

      const result = await service.recordHeartbeat({ deviceId: 'ambient-control-01', readings: [] });

      expect(result).toEqual({ pendingCommand: null });
      expect(prisma.ambientDevice.update).not.toHaveBeenCalled();
    });

    it('hands back a queued command and clears it so it is only delivered once', async () => {
      prisma.ambientDevice.upsert.mockResolvedValue({ id: 'ambient-control-01', pendingCommand: 'TEST_BUZZER' });

      const result = await service.recordHeartbeat({ deviceId: 'ambient-control-01', readings: [] });

      expect(result).toEqual({ pendingCommand: 'TEST_BUZZER' });
      expect(prisma.ambientDevice.update).toHaveBeenCalledWith({
        where: { id: 'ambient-control-01' },
        data: { pendingCommand: null },
      });
    });
  });

  describe('queueTestBuzzer', () => {
    it('sets pendingCommand to TEST_BUZZER for an existing device', async () => {
      prisma.ambientDevice.findUnique.mockResolvedValue({ id: 'ambient-control-01' });

      await service.queueTestBuzzer('ambient-control-01');

      expect(prisma.ambientDevice.update).toHaveBeenCalledWith({
        where: { id: 'ambient-control-01' },
        data: { pendingCommand: 'TEST_BUZZER' },
      });
    });

    it('throws NotFoundException for a device that does not exist', async () => {
      prisma.ambientDevice.findUnique.mockResolvedValue(null);

      await expect(service.queueTestBuzzer('does-not-exist')).rejects.toThrow(NotFoundException);
      expect(prisma.ambientDevice.update).not.toHaveBeenCalled();
    });
  });

  describe('listDevices', () => {
    it('marks a device online when its last heartbeat is within the online-display threshold', async () => {
      prisma.ambientDevice.findMany.mockResolvedValue([
        { id: 'ambient-control-01', name: 'Living room', lastSeenAt: new Date(), readings: [] },
      ]);

      const [device] = await service.listDevices();

      expect(device.online).toBe(true);
    });

    it('marks a device offline once its last heartbeat is older than the online-display threshold', async () => {
      const staleDate = new Date(Date.now() - DEVICE_ONLINE_DISPLAY_THRESHOLD_MS - 1000);
      prisma.ambientDevice.findMany.mockResolvedValue([
        { id: 'ambient-control-01', name: 'Living room', lastSeenAt: staleDate, readings: [] },
      ]);

      const [device] = await service.listDevices();

      expect(device.online).toBe(false);
    });

    it('marks a device offline for display purposes well before the (looser) alerting threshold fires', async () => {
      // Simulates the bug report this threshold split fixes: a device that just went silent
      // shouldn't still read "online" for the full 12-minute alerting grace period.
      const justPastOnlineWindow = new Date(Date.now() - DEVICE_ONLINE_DISPLAY_THRESHOLD_MS - 1000);
      expect(Date.now() - justPastOnlineWindow.getTime()).toBeLessThan(DEVICE_OFFLINE_THRESHOLD_MS);
      prisma.ambientDevice.findMany.mockResolvedValue([
        { id: 'ambient-control-01', name: 'Living room', lastSeenAt: justPastOnlineWindow, readings: [] },
      ]);

      const [device] = await service.listDevices();

      expect(device.online).toBe(false);
    });

    it('marks a device that never checked in as offline', async () => {
      prisma.ambientDevice.findMany.mockResolvedValue([
        { id: 'ambient-control-01', name: 'Living room', lastSeenAt: null, readings: [] },
      ]);

      const [device] = await service.listDevices();

      expect(device.online).toBe(false);
    });
  });

  describe('checkOfflineDevices', () => {
    // Past the warning threshold, but not yet the critical one.
    const warningOnlyDate = new Date(Date.now() - DEVICE_OFFLINE_THRESHOLD_MS - 1000);
    // Past both.
    const criticalDate = new Date(Date.now() - DEVICE_OFFLINE_CRITICAL_THRESHOLD_MS - 1000);

    it('creates only the warning-tier notification for a device past the warning threshold but not the critical one', async () => {
      prisma.ambientDevice.findMany.mockResolvedValue([
        { id: 'ambient-control-01', name: 'Living room', lastSeenAt: warningOnlyDate },
      ]);
      notificationsService.hasOpen.mockResolvedValue(false);

      await service.checkOfflineDevices();

      expect(notificationsService.hasOpen).toHaveBeenCalledWith('device-offline:ambient-control-01');
      expect(notificationsService.hasOpen).not.toHaveBeenCalledWith('device-offline-critical:ambient-control-01');
      expect(notificationsService.create).toHaveBeenCalledTimes(1);
      expect(notificationsService.create).toHaveBeenCalledWith({
        type: 'DEVICE_OFFLINE',
        message: 'El dispositivo "Living room" dejó de reportarse. Puede estar desenchufado, sin WiFi, o manipulado.',
        dedupeKey: 'device-offline:ambient-control-01',
      });
    });

    it('also creates the critical-tier notification once a device has been stale for 30+ minutes', async () => {
      prisma.ambientDevice.findMany.mockResolvedValue([
        { id: 'ambient-control-01', name: 'Living room', lastSeenAt: criticalDate },
      ]);
      notificationsService.hasOpen.mockResolvedValue(false);

      await service.checkOfflineDevices();

      expect(notificationsService.create).toHaveBeenCalledTimes(2);
      expect(notificationsService.create).toHaveBeenCalledWith({
        type: 'DEVICE_OFFLINE',
        message:
          'El dispositivo "Living room" lleva más de 30 minutos sin reportarse. Revisalo cuanto antes: es probable que esté desconectado, desenchufado o manipulado.',
        dedupeKey: 'device-offline-critical:ambient-control-01',
      });
    });

    it('falls back to the raw deviceId in the message when the device has no name', async () => {
      prisma.ambientDevice.findMany.mockResolvedValue([{ id: 'ambient-control-01', name: '', lastSeenAt: warningOnlyDate }]);
      notificationsService.hasOpen.mockResolvedValue(false);

      await service.checkOfflineDevices();

      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'El dispositivo "ambient-control-01" dejó de reportarse. Puede estar desenchufado, sin WiFi, o manipulado.',
        }),
      );
    });

    it('skips the warning tier when it already has an open notification, independently of the critical tier', async () => {
      prisma.ambientDevice.findMany.mockResolvedValue([
        { id: 'ambient-control-01', name: 'Living room', lastSeenAt: criticalDate },
      ]);
      notificationsService.hasOpen.mockImplementation((key: string) => Promise.resolve(key === 'device-offline:ambient-control-01'));

      await service.checkOfflineDevices();

      expect(notificationsService.create).toHaveBeenCalledTimes(1);
      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ dedupeKey: 'device-offline-critical:ambient-control-01' }),
      );
    });

    it('skips a stale device that already has both tiers open', async () => {
      prisma.ambientDevice.findMany.mockResolvedValue([
        { id: 'ambient-control-01', name: 'Living room', lastSeenAt: criticalDate },
      ]);
      notificationsService.hasOpen.mockResolvedValue(true);

      await service.checkOfflineDevices();

      expect(notificationsService.create).not.toHaveBeenCalled();
    });

    it('only queries devices whose lastSeenAt is older than the warning offline threshold', async () => {
      prisma.ambientDevice.findMany.mockResolvedValue([]);

      await service.checkOfflineDevices();

      expect(prisma.ambientDevice.findMany).toHaveBeenCalledWith({
        where: { lastSeenAt: { lt: expect.any(Date) } },
      });
    });
  });

  describe('listAll', () => {
    it('lists every event most-recent-first', async () => {
      prisma.ambientEvent.findMany.mockResolvedValue([]);

      await service.listAll();

      expect(prisma.ambientEvent.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
      });
    });
  });
});
