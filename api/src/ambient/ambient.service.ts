import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LogAmbientAlertDto } from './dto/log-ambient-alert.dto';
import { LogAmbientHeartbeatDto } from './dto/log-ambient-heartbeat.dto';
import { AmbientReadingDto } from './dto/ambient-reading.dto';

// A device heartbeats every HEARTBEAT_INTERVAL_MS (5 minutes - see ambient-control's
// config.h). This allows for one missed beat (network hiccup) plus margin before treating it
// as actually offline, rather than false-alarming on the first delay.
export const DEVICE_OFFLINE_THRESHOLD_MS = 12 * 60 * 1000;

// A second, more urgent tier: if a device is STILL silent after this much longer, something
// more than a brief WiFi hiccup is going on (unplugged, tampered with, WiFi.begin() failing
// outright). Independent notification/dedupeKey from the warning above, so both can be open
// at once and both auto-resolve on their own the moment the device checks back in.
export const DEVICE_OFFLINE_CRITICAL_THRESHOLD_MS = 30 * 60 * 1000;

function deviceOfflineDedupeKey(deviceId: string): string {
  return `device-offline:${deviceId}`;
}

function deviceOfflineCriticalDedupeKey(deviceId: string): string {
  return `device-offline-critical:${deviceId}`;
}

// Builds the staff-facing message per sensor type, so "sonido" and "humo" alerts read
// distinctly instead of relaying the firmware's raw technical detail string verbatim.
// Falls back to a generic message for sensor types this hasn't been taught about yet, so a
// new sensor shipped on the firmware side still shows up sensibly without an API change.
const SENSOR_MESSAGE_BUILDERS: Record<string, (deviceId: string, detail?: string | null) => string> = {
  sound: (deviceId, detail) =>
    `Ruido fuerte repetido detectado (dispositivo ${deviceId})${detail ? `: ${detail}` : '.'}`,
  smoke: (deviceId, detail) => `¡Posible humo detectado! (dispositivo ${deviceId})${detail ? `: ${detail}` : '.'}`,
};

function buildMessage(sensor: string, deviceId: string, detail?: string | null): string {
  const builder = SENSOR_MESSAGE_BUILDERS[sensor];
  if (builder) {
    return builder(deviceId, detail);
  }
  return `Alerta del sensor "${sensor}" (dispositivo ${deviceId})${detail ? `: ${detail}` : '.'}`;
}

@Injectable()
export class AmbientService {
  private readonly logger = new Logger(AmbientService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async recordAlert(dto: LogAmbientAlertDto) {
    const message = buildMessage(dto.sensor, dto.deviceId, dto.detail);

    const event = await this.prisma.ambientEvent.create({
      data: {
        deviceId: dto.deviceId,
        sensor: dto.sensor,
        level: dto.level ?? null,
        message,
      },
    });

    // An alert also proves the device is alive - and it's a reading in its own right, so the
    // Sensors page reflects it too even between heartbeats.
    const readings = dto.level != null ? [{ sensor: dto.sensor, level: dto.level }] : [];
    await this.recordDeviceActivity(dto.deviceId, undefined, readings);

    // Deduped the same way CALENDAR_MISMATCH is (see NotificationsService.hasOpen): while an
    // unread alert for this device+sensor is still open, repeated reports keep landing in the
    // log above but don't pile up new unread notifications.
    const dedupeKey = `ambient-alert:${dto.deviceId}:${dto.sensor}`;
    if (!(await this.notificationsService.hasOpen(dedupeKey))) {
      await this.notificationsService.create({
        type: 'AMBIENT_ALERT',
        message,
        dedupeKey,
      });
    }

    return event;
  }

  async recordHeartbeat(dto: LogAmbientHeartbeatDto) {
    return this.recordDeviceActivity(dto.deviceId, dto.deviceName, dto.readings);
  }

  // Shared by recordAlert and recordHeartbeat - anything a device sends proves it's alive and
  // carries at least one sensor reading, so both update the same device/reading state and
  // both can resolve a stale DEVICE_OFFLINE notification.
  private async recordDeviceActivity(deviceId: string, deviceName: string | undefined, readings: AmbientReadingDto[]) {
    const device = await this.prisma.ambientDevice.upsert({
      where: { id: deviceId },
      create: { id: deviceId, name: deviceName ?? '', lastSeenAt: new Date() },
      update: { ...(deviceName ? { name: deviceName } : {}), lastSeenAt: new Date() },
    });

    for (const reading of readings) {
      await this.prisma.ambientDeviceReading.upsert({
        where: { deviceId_sensor: { deviceId, sensor: reading.sensor } },
        create: { deviceId, sensor: reading.sensor, level: reading.level },
        update: { level: reading.level },
      });
    }

    await this.notificationsService.resolveOpen(deviceOfflineDedupeKey(deviceId));
    await this.notificationsService.resolveOpen(deviceOfflineCriticalDedupeKey(deviceId));

    return device;
  }

  listAll() {
    return this.prisma.ambientEvent.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async listDevices() {
    const devices = await this.prisma.ambientDevice.findMany({
      orderBy: { name: 'asc' },
      include: { readings: { orderBy: { sensor: 'asc' } } },
    });

    const now = Date.now();
    return devices.map((device) => ({
      ...device,
      online: device.lastSeenAt != null && now - device.lastSeenAt.getTime() <= DEVICE_OFFLINE_THRESHOLD_MS,
    }));
  }

  // Run every minute by AmbientOfflineSchedulerService. Cheap regardless of the 5-minute
  // heartbeat interval - most runs will find nothing stale.
  async checkOfflineDevices() {
    const staleBefore = new Date(Date.now() - DEVICE_OFFLINE_THRESHOLD_MS);
    const devices = await this.prisma.ambientDevice.findMany({
      where: { lastSeenAt: { lt: staleBefore } },
    });

    for (const device of devices) {
      const label = device.name || device.id;
      const offlineSince = device.lastSeenAt?.toISOString() ?? 'never';

      const dedupeKey = deviceOfflineDedupeKey(device.id);
      if (!(await this.notificationsService.hasOpen(dedupeKey))) {
        this.logger.warn(`Device offline: ${label} (last seen ${offlineSince})`);
        await this.notificationsService.create({
          type: 'DEVICE_OFFLINE',
          message: `El dispositivo "${label}" dejó de reportarse. Puede estar desenchufado, sin WiFi, o manipulado.`,
          dedupeKey,
        });
      }

      const isStillOfflineAfterCritical =
        device.lastSeenAt == null || Date.now() - device.lastSeenAt.getTime() >= DEVICE_OFFLINE_CRITICAL_THRESHOLD_MS;
      if (!isStillOfflineAfterCritical) {
        continue;
      }

      const criticalDedupeKey = deviceOfflineCriticalDedupeKey(device.id);
      if (await this.notificationsService.hasOpen(criticalDedupeKey)) {
        continue;
      }

      this.logger.warn(`Device still offline after 30+ minutes: ${label} (last seen ${offlineSince})`);
      await this.notificationsService.create({
        type: 'DEVICE_OFFLINE',
        message: `El dispositivo "${label}" lleva más de 30 minutos sin reportarse. Revisalo cuanto antes: es probable que esté desconectado, desenchufado o manipulado.`,
        dedupeKey: criticalDedupeKey,
      });
    }
  }
}
