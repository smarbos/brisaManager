# ambient-control

ESP32 firmware reading ambient sensors (sound, temperature, smoke) and
reporting them to a server for storage and threshold notifications.

## Hardware

- ESP32-WROOM-32 DevKit, 38-pin, USB-C
- Sound sensor module (3-pin: OUT, VCC, GND)

## Wiring (sound sensor)

| Sensor pin | ESP32 pin |
|------------|-----------|
| VCC        | 3V3       |
| GND        | GND       |
| OUT        | GPIO34    |

GPIO34 is an ADC1, input-only pin, chosen to avoid the boot-strapping pins
(0/2/12/15) and the flash SPI pins (6-11).

## Setup

The device talks to the **production** API at `api.labrisa.com.ar` over
HTTPS (see `include/config.h`), not a local dev stack - so this branch's API
changes (the `ambient` module, its Prisma migrations) need to be deployed
to production, and `AMBIENT_API_KEY` added to production's `.env`, before
a flashed device can authenticate.

1. Copy `include/secrets.h.example` to `include/secrets.h` (gitignored) and
   fill in your WiFi SSID/password. `AMBIENT_API_KEY` must match the
   `AMBIENT_API_KEY` set in **production's** `.env`, not the local dev one.
2. Before flashing a second physical device (e.g. one per room), change
   `config.h`'s `DEVICE_ID` and `DEVICE_NAME` first - each device needs a
   distinct id or they'll overwrite each other's state on the server (see
   the Sensors page and the "device offline" section below).

TLS is validated against Let's Encrypt's ISRG Root X1, embedded in
`include/root_ca.h` (downloaded and fingerprint-verified, not typed from
memory - see that file's header comment if it ever needs re-downloading).

## Current status

Reading the sound sensor and detecting repeated loud noises locally; on an
`ALERT` (not on every raw sample or single loud `EVENT`), POSTs to the
brisaManager API's `/ambient-alerts`, which logs it and raises a staff
notification (Notifications page + Activity Log's "Alertas ambientales" tab).

The module is confirmed analog: OUT is a peak-detector envelope that spikes
on a loud sound and decays back to ~0. It has no usable digital threshold
output, so raw analog is the only signal used.

Serial output (115200 baud):

```
millis,analog                        <- every sample, every 100ms
EVENT,millis,analog                  <- a reading crossed LOUD_THRESHOLD
ALERT,millis,5 loud events within 30000ms   <- repeat-noise rule triggered, POSTed to the API
```

- `loudThreshold` marks a sample as "loud" - starts at `DEFAULT_LOUD_THRESHOLD`
  (800) on a fresh device, but should be calibrated for wherever it's
  actually installed: open the Serial Monitor, make sure the room is quiet,
  and send the line `CALIBRATE`. The firmware samples for 5 seconds, sets
  the threshold to the loudest thing it saw plus a safety margin, prints
  `CALIBRATED,threshold,ambientPeak`, and saves it to flash (ESP32 NVS) so
  it survives a power-off - no need to recalibrate after every reboot, only
  when the install location or its background noise changes.
- An `EVENT` is logged on the rising edge only (crossing from below to at/above
  threshold), so one clap's decay tail isn't counted as multiple events.
- An `ALERT` fires when `REPEAT_COUNT` (5) loud events occur within
  `REPEAT_WINDOW_MS` (30000ms), and can re-fire if the pattern continues -
  the server itself dedupes repeat alerts into a single open notification
  (see `api/src/ambient/ambient.service.ts`).
- WiFi connects at boot with a 15s timeout; sensor sampling and local
  `ALERT` detection work regardless of WiFi state. If it never connected
  (or drops later), `maintainWiFi()` (called every `loop()`) retries
  `WiFi.begin()` every `WIFI_RETRY_INTERVAL_MS` (10s) until it's back -
  covers a router reboot or a temporary outage without a manual reset.

### Heartbeat / device offline detection

Once WiFi connects (initially, or after a reconnect - see above), the
device POSTs a heartbeat to `/ambient-heartbeat` right away, then every
`HEARTBEAT_INTERVAL_MS` (5 minutes) after that - carrying its `deviceId`,
`deviceName`, and each sensor's current reading (just sound for now). This
is separate from `/ambient-alerts`: it happens whether or not anything is
alert-worthy, which is what lets the server notice a device that's gone
silent - see `AmbientOfflineSchedulerService` on the API side, which runs
every minute and checks every device's last heartbeat against two
thresholds:

- **12 minutes** (room for one missed beat): raises a `DEVICE_OFFLINE`
  notification - "may be down".
- **30 minutes**: raises a second, more urgent `DEVICE_OFFLINE`
  notification on top of the first - "still down, go check it, likely
  unplugged/tampered/WiFi outright failed".

Both auto-resolve independently the moment the device's next heartbeat
arrives. Each device's last-seen time and latest readings are visible on
the admin UI's "Sensores" page.

Next steps: temperature and smoke sensors (both already differentiated by
the `sensor` field the API and admin UI expect).
