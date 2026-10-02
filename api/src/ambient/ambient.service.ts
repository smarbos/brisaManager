import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { isWithinSoundAlertWindow, parseSoundAlertWindows } from './sound-alert-windows';
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

// How stale a device's last heartbeat can be before the Sensores page shows it as offline.
// Deliberately tighter than the alerting thresholds above (which have slack to avoid
// false-alarm notifications from one delayed beat) - this is a live status display, not an
// alert, so it should reflect reality close to one missed heartbeat, not several.
export const DEVICE_ONLINE_DISPLAY_THRESHOLD_MS = 7 * 60 * 1000;

// Mirrors MAX_CO_ALERT_THRESHOLD/MAX_SMOKE_ALERT_THRESHOLD in ambient-control's config.h. The
// firmware already refuses to go above these; a heartbeat reporting more means the device runs
// older or modified firmware, which is itself worth flagging.
export const MAX_GAS_ALERT_THRESHOLD: Record<string, number> = { co: 2500, smoke: 3200 };

const GAS_SENSOR_LABELS: Record<string, string> = { co: 'CO', smoke: 'humo' };

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
  co: (deviceId, detail) =>
    `¡Posible monóxido de carbono detectado! (dispositivo ${deviceId})${detail ? `: ${detail}` : '.'}`,
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
    private readonly settingsService: SettingsService,
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
    const readings = dto.level != null ? [{ sensor: dto.sensor, level: dto.level, threshold: dto.threshold }] : [];
    await this.recordDeviceActivity(dto.deviceId, undefined, readings);

    // Repeated-loud-noise alerts are complaint-style, not safety-critical (unlike smoke/CO,
    // which always notify) - staff only wants to be paged about them during configured quiet
    // hours. The event above is still logged either way, so the raw history stays complete.
    if (dto.sensor === 'sound') {
      const settings = await this.settingsService.get();
      const windows = parseSoundAlertWindows(settings.soundAlertWindows);
      if (!isWithinSoundAlertWindow(windows, new Date())) {
        return event;
      }
    }

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
    const device = await this.recordDeviceActivity(dto.deviceId, dto.deviceName, dto.readings);

    // Deliver any queued command (see queueTestBuzzer) by piggybacking it onto this response -
    // the device has no other inbound channel. Cleared here, not in recordDeviceActivity (which
    // recordAlert also calls), so a coincidental alert between now and the next heartbeat can't
    // consume the command before the device ever sees it. Best-effort/at-most-once: if this
    // response never reaches the device, the command is lost silently.
    if (device.pendingCommand == null) {
      return { pendingCommand: null };
    }

    const pendingCommand = device.pendingCommand;
    await this.prisma.ambientDevice.update({
      where: { id: dto.deviceId },
      data: { pendingCommand: null },
    });

    return { pendingCommand };
  }

  // Queues a one-shot command for a device, delivered on its next heartbeat (see
  // recordHeartbeat). "TEST_BUZZER" is the only command that exists today.
  async queueTestBuzzer(deviceId: string) {
    const device = await this.prisma.ambientDevice.findUnique({ where: { id: deviceId } });
    if (!device) {
      throw new NotFoundException(`Ambient device ${deviceId} not found`);
    }

    return this.prisma.ambientDevice.update({
      where: { id: deviceId },
      data: { pendingCommand: 'TEST_BUZZER' },
    });
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
      const threshold = reading.threshold ?? null;
      if (threshold != null && reading.sensor in MAX_GAS_ALERT_THRESHOLD) {
        await this.checkGasThreshold(deviceId, reading.sensor, threshold);
      }
      await this.prisma.ambientDeviceReading.upsert({
        where: { deviceId_sensor: { deviceId, sensor: reading.sensor } },
        create: { deviceId, sensor: reading.sensor, level: reading.level, threshold },
        update: { level: reading.level, threshold },
      });
    }

    await this.notificationsService.resolveOpen(deviceOfflineDedupeKey(deviceId));
    await this.notificationsService.resolveOpen(deviceOfflineCriticalDedupeKey(deviceId));

    return device;
  }

  // CO/smoke thresholds are life-safety settings: raising one (e.g. by calibrating in
  // contaminated air over USB) silently weakens alerts, so staff hears about every change, and
  // about any value above the firmware cap.
  private async checkGasThreshold(deviceId: string, sensor: string, threshold: number) {
    const previous = await this.prisma.ambientDeviceReading.findUnique({
      where: { deviceId_sensor: { deviceId, sensor } },
    });
    const label = GAS_SENSOR_LABELS[sensor];

    const previousThreshold = previous?.threshold ?? null;
    if (previousThreshold != null && previousThreshold !== threshold) {
      const message = `El umbral de alerta de ${label} del dispositivo ${deviceId} cambió de ${previousThreshold} a ${threshold}. Si nadie lo recalibró, revisá el dispositivo.`;
      this.logger.warn(message);
      await this.prisma.ambientEvent.create({ data: { deviceId, sensor, level: threshold, message } });
      await this.notificationsService.create({ type: 'AMBIENT_ALERT', message });
    }

    const max = MAX_GAS_ALERT_THRESHOLD[sensor];
    const overCapDedupeKey = `ambient-threshold-over-cap:${deviceId}:${sensor}`;
    if (threshold > max && !(await this.notificationsService.hasOpen(overCapDedupeKey))) {
      await this.notificationsService.create({
        type: 'AMBIENT_ALERT',
        message: `El umbral de alerta de ${label} del dispositivo ${deviceId} es ${threshold} y supera el máximo permitido (${max}): las alertas pueden no dispararse. Revisá el firmware del dispositivo.`,
        dedupeKey: overCapDedupeKey,
      });
    }
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
      online: device.lastSeenAt != null && now - device.lastSeenAt.getTime() <= DEVICE_ONLINE_DISPLAY_THRESHOLD_MS,
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
