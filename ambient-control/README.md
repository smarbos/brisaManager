# ambient-control

ESP32 firmware reading ambient sensors (sound, temperature, smoke) and
reporting them to a server for storage and threshold notifications.

## Hardware

- ESP32-WROOM-32 DevKit, 38-pin, USB-C
- Sound sensor module (3-pin: OUT, VCC, GND)
- MQ-7 carbon monoxide sensor module (4-pin: VCC, GND, AO, DO)
- MQ-2 smoke/combustible gas sensor module (4-pin: VCC, GND, AO, DO)
- DHT22 temperature/humidity sensor module (3-pin: VCC, DATA, GND)

## Wiring (sound sensor)

| Sensor pin | ESP32 pin |
|------------|-----------|
| VCC        | 3V3       |
| GND        | GND       |
| OUT        | GPIO34    |

GPIO34 is an ADC1, input-only pin, chosen to avoid the boot-strapping pins
(0/2/12/15) and the flash SPI pins (6-11).

## Wiring (MQ-7 carbon monoxide sensor)

| Sensor pin | ESP32 pin |
|------------|-----------|
| VCC        | 3V3       |
| GND        | GND       |
| AO         | GPIO35    |
| DO         | not connected |

Like the sound sensor, only the raw analog signal is used - DO is a
threshold comparator with an on-board trimmer, and isn't read. GPIO35 is
another ADC1, input-only pin, distinct from the sound sensor's GPIO34.

This is a simple breakout that runs the MQ-7's heater continuously at 5V
with no firmware control. A datasheet-correct reading duty-cycles the
heater (~60s at 5V, ~90s at 1.4V) for calibrated ppm values - this board
doesn't expose that, so readings here are a relative CO trend, not a
calibrated ppm measurement.

## Wiring (MQ-2 smoke sensor)

| Sensor pin | ESP32 pin |
|------------|-----------|
| VCC        | 3V3       |
| GND        | GND       |
| AO         | GPIO32    |
| DO         | not connected |

Same shape as the MQ-7 breakout: DO unconnected, heater runs continuously
on-board with no firmware control, so readings are a relative smoke trend.
GPIO32 is another ADC1, input-only pin, distinct from GPIO34 (sound) and
GPIO35 (CO).

## Wiring (DHT22 temperature/humidity sensor)

| Sensor pin | ESP32 pin |
|------------|-----------|
| VCC        | 3V3       |
| DATA       | GPIO27    |
| GND        | GND       |

Unlike the other three sensors, this one is digital (a single-wire
protocol), not analog - GPIO27 is a general-purpose digital pin, not one
of the ADC1 pins the analog sensors use. 3-pin breakouts include the
required pull-up resistor on DATA on-board, so no external component is
needed. Requires the "DHT sensor library" + "Adafruit Unified Sensor"
dependencies (declared in `platformio.ini`'s `lib_deps` - PlatformIO
fetches them automatically on build).

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
The MQ-7 CO and MQ-2 smoke sensors are read the same way, alongside it,
each with its own alert rule (see below). The DHT22 temperature/humidity
sensor is reported passively (heartbeat only, no alerting) on its own
slower timer.

The sound module is confirmed analog: OUT is a peak-detector envelope that
spikes on a loud sound and decays back to ~0. It has no usable digital
threshold output, so raw analog is the only signal used.

Serial output (115200 baud):

```
millis,analog                        <- sound sample, every 100ms
EVENT,millis,analog                  <- a sound reading crossed LOUD_THRESHOLD
ALERT,millis,5 loud events within 30000ms   <- repeat-noise rule triggered, POSTed to the API
CO,millis,analog                     <- CO sample, every 100ms
CO_HIGH,millis,analog                <- CO reading just crossed coAlertThreshold
CO_ALERT,millis,CO level sustained...  <- stayed elevated for CO_SUSTAINED_MS, POSTed to the API
SMOKE,millis,analog                  <- smoke sample, every 100ms
SMOKE_ALERT,millis,Smoke level at/above...  <- crossed smokeAlertThreshold, POSTed to the API
TEMPERATURE,celsius                  <- DHT22 sample, every 5s (only on a successful read)
HUMIDITY,percent                     <- DHT22 sample, every 5s (only on a successful read)
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
- `coAlertThreshold` marks a reading as elevated - starts at
  `DEFAULT_CO_ALERT_THRESHOLD` (2500, an uncalibrated placeholder) on a fresh
  device. Calibrate it independently from the sound sensor: with the sensor
  in clean air, send `CALIBRATE_CO`. Same shape as `CALIBRATE` - 5 seconds of
  sampling, sets the threshold to the highest clean-air reading plus a
  margin, prints `CALIBRATED_CO,threshold,cleanAirPeak`, saves to flash.
- Unlike the sound sensor's spike detection, a CO reading must stay at/above
  `coAlertThreshold` continuously for `CO_SUSTAINED_MS` (1 minute) before it
  counts as a real exposure - a single noisy sample won't alert. Once
  sustained, it alerts, then re-alerts at most every `CO_REALERT_INTERVAL_MS`
  (5 minutes) while it stays elevated (the server dedupes these into one open
  notification, same as the sound sensor's repeat alerts).
- For `CO_WARMUP_MS` (3 minutes) after boot, CO readings are sampled and
  reported as usual, but alert logic is suppressed - the sensor's reading
  isn't meaningful until it's warmed up, so this avoids a false alert from
  an unstable just-powered-on value.
- `smokeAlertThreshold` marks a reading as elevated smoke - starts at
  `DEFAULT_SMOKE_ALERT_THRESHOLD` (2500, uncalibrated placeholder). Calibrate
  independently with `CALIBRATE_SMOKE` (clean air, 5 seconds, same shape as
  the other two commands) - prints `CALIBRATED_SMOKE,threshold,cleanAirPeak`.
- Unlike CO, smoke alerts fire immediately on a threshold crossing (same
  rising-edge shape as the sound sensor's `EVENT`) since smoke response
  needs to be fast, not averaged over time. While it stays elevated, it
  re-alerts at most every `SMOKE_REALERT_INTERVAL_MS` (2 minutes). Also has
  its own `SMOKE_WARMUP_MS` (3 minutes) suppressing alerts right after boot.
- The DHT22 is sampled every `DHT_SAMPLE_INTERVAL_MS` (5 seconds, well above
  its ~2s datasheet minimum) - independent from the 100ms analog-sensor
  loop. No calibration, no threshold, no alerting - just reported, rounded
  to the nearest whole degree/percent. A failed read (occasional timing
  glitch or checksum failure) keeps the last known-good value rather than
  reporting garbage or a stale error as if it were real.
- WiFi connects at boot with a 15s timeout; sensor sampling and local
  `ALERT` detection work regardless of WiFi state. If it never connected
  (or drops later), `maintainWiFi()` (called every `loop()`) retries
  `WiFi.begin()` every `WIFI_RETRY_INTERVAL_MS` (10s) until it's back -
  covers a router reboot or a temporary outage without a manual reset.

### Heartbeat / device offline detection

Once WiFi connects (initially, or after a reconnect - see above), the
device POSTs a heartbeat to `/ambient-heartbeat` right away, then every
`HEARTBEAT_INTERVAL_MS` (5 minutes) after that - carrying its `deviceId`,
`deviceName`, and each sensor's current reading (sound, CO, smoke,
temperature, and humidity). This
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

All five sensors this device is expected to carry (sound, CO, smoke,
temperature, humidity) are now implemented.

Note on MQ-7/MQ-2 accuracy: neither breakout exposes heater control, so
readings are a relative trend rather than a datasheet-calibrated ppm
value. If a future revision swaps in a bare sensor with separate heater
pins and a driver transistor, the firmware would need to duty-cycle the
heater (~60s at 5V, ~90s at 1.4V for the MQ-7; MQ-2 typically runs its
heater continuously even in datasheet-correct usage) and only sample
during the appropriate phase for accurate readings - not implemented here.
