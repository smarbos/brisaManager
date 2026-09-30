# ambient-control

ESP32 firmware reading ambient sensors (sound, temperature, smoke) and
reporting them to a server for storage and threshold notifications.

## Hardware

- ESP32-WROOM-32 DevKit, 38-pin, USB-C
- MAX9814 electret mic amplifier module (5-pin: AR, OUT, GAIN, VDD, GND)
- MQ-7 carbon monoxide sensor module (4-pin: VCC, GND, AO, DO)
- MQ-2 smoke/combustible gas sensor module (4-pin: VCC, GND, AO, DO)
- DHT22 temperature/humidity sensor module (3-pin: VCC, DATA, GND)
- Active buzzer module (2-3 pin, has its own oscillator) - alert buzzer

## Wiring (mic amp, MAX9814)

| Sensor pin | ESP32 pin     |
|------------|---------------|
| VDD        | 3V3           |
| GND        | GND           |
| OUT        | GPIO34        |
| GAIN       | 3V3           |
| AR         | not connected |

GPIO34 is an ADC1, input-only pin, chosen to avoid the boot-strapping pins
(0/2/12/15) and the flash SPI pins (6-11).

`GAIN` and `AR` are hardware-only 3-state pins (float/GND/VDD), not signals to read - they
pick a fixed behavior on the chip itself rather than something the firmware controls. Per the
module's datasheet:
- `GAIN`: floating = 60dB (most sensitive), tied to GND = 50dB, tied to VDD = 40dB. Tied to
  VDD (3V3) here: at 60dB the chip's automatic gain control raised a quiet room's background
  noise until it filled most of the ADC range, so quiet and loud read almost the same.
  Recalibrate after changing it.
- `AR` (attack/release ratio for the chip's own automatic gain control): floating is the
  default used here; GND and VDD select faster release ratios.

`OUT` here is a raw AC-coupled audio waveform - datasheet-specified ~1.25V DC bias, up to 2Vpp
swing - not a pre-detected loudness envelope like the 3-pin module this replaced. See
`readSoundLevel()` in `src/main.cpp`: it samples continuously for a short window
(`SOUND_WINDOW_MS`, 50ms) and reports the RMS amplitude as the loudness value. RMS rather than
peak-to-peak, because peak-to-peak is set by the two most extreme samples in the window, so a
single ADC spike reads as loud.

## Wiring (MQ-7 carbon monoxide sensor)

| Sensor pin | ESP32 pin |
|------------|-----------|
| VCC        | 3V3       |
| GND        | GND       |
| AO         | GPIO35    |
| DO         | not connected |

Like the mic amp, only the raw analog signal is used - DO is a
threshold comparator with an on-board trimmer, and isn't read. GPIO35 is
another ADC1, input-only pin, distinct from the mic amp's GPIO34.

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

## Wiring (alert buzzer)

| Buzzer pin | ESP32 pin |
|------------|-----------|
| VCC/+      | 3V3       |
| GND/-      | GND       |
| I/O        | GPIO26    |

This is an active buzzer (has its own oscillator), so it's driven with a
plain digital HIGH/LOW - no `tone()`/PWM needed. GPIO26 is a
general-purpose digital output pin, distinct from every other pin already
in use. It only sounds during a declared "emergency" - see the Current
status section below for what that means and how it clears.

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
slower timer. On top of its own immediate alert, each gas sensor also has
an "emergency" tier - a sustained, much-higher-than-alert reading - that
sounds the physical alert buzzer (GPIO26) for as long as the emergency
persists, auto-clearing once the reading drops back down. The buzzer can
also be tested on demand - either by sending `TEST_BUZZER` over Serial, or
remotely, by clicking "Probar sirena" for the device on the admin web's
Sensores page (queued on the server, delivered on the device's next
heartbeat - see the API's `AmbientService.recordHeartbeat` - so it can take
up to `HEARTBEAT_INTERVAL_MS`, 5 minutes, to actually beep).

The mic amp (MAX9814) has no built-in loudness detection: OUT is the raw AC-coupled audio
waveform (~1.25V DC bias, up to 2Vpp swing). `readSoundLevel()` derives a loudness value from
it in firmware - RMS amplitude over a short sampling window - which the sound-alerting logic
below then compares against `loudThreshold`.

Serial output (115200 baud):

```
millis,analog                        <- sound sample, every 100ms
EVENT,millis,analog                  <- a loud event: sustained loud sound, or another 5s of it
ALERT,millis,5 loud events within 30000ms   <- repeat-noise rule triggered, POSTed to the API
CO,millis,analog                     <- CO sample, every 100ms
CO_HIGH,millis,analog                <- CO reading just crossed coAlertThreshold
CO_ALERT,millis,CO level sustained...  <- stayed elevated for CO_SUSTAINED_MS, POSTed to the API
CO_EMERGENCY,millis,EMERGENCIA: CO level sustained...  <- crossed the (higher) emergency threshold for a full minute; buzzer sounds, POSTed to the API
SMOKE,millis,analog                  <- smoke sample, every 100ms
SMOKE_ALERT,millis,Smoke level at/above...  <- crossed smokeAlertThreshold, POSTed to the API
SMOKE_EMERGENCY,millis,EMERGENCIA: smoke level sustained...  <- crossed the (higher) emergency threshold for a full minute; buzzer sounds, POSTed to the API
TEMPERATURE,celsius                  <- DHT22 sample, every 5s (only on a successful read)
HUMIDITY,percent                     <- DHT22 sample, every 5s (only on a successful read)
TEST_BUZZER: beeping for 1 second.   <- buzzer test triggered (Serial command or admin page)
```

- `loudThreshold` marks a sample as "loud" - starts at `DEFAULT_LOUD_THRESHOLD`
  (150, a rough placeholder for 40dB gain) on a fresh device, but should be
  calibrated for wherever it's actually installed: make sure the room is
  quiet and run `scripts/calibrate.py` (or send the line `CALIBRATE` from the
  Serial Monitor). The firmware samples for 5 seconds, takes the 99th
  percentile of those quiet readings (so one stray spike can't inflate it),
  sets the threshold to 3x that (at least +50), prints
  `CALIBRATED,threshold,ambientLevel`, and saves it to flash (ESP32 NVS) so
  it survives a power-off - no need to recalibrate after every reboot, only
  when the install location, its background noise, or the `GAIN` wiring
  changes. The saved key changed along with the switch from peak-to-peak to
  RMS, so a threshold calibrated before that is ignored.
- A sound counts as loud only after 3 consecutive readings (~250ms) at/above
  the threshold - single spikes and one-off claps or bangs don't count - and
  stays loud until a reading drops below 75% of the threshold, so a level
  hovering right at the threshold isn't counted as many events. An `EVENT` is
  logged when it becomes loud, and again every 5s it stays loud, so
  continuous noise (music, a party) still reaches the repeat rule below.
- The heartbeat reports the average sound level since the previous
  heartbeat, not a single reading.
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
- An "emergency" is a sustained, much-higher-than-alert reading from
  either gas sensor: at/above `smokeAlertThreshold` (or `coAlertThreshold`)
  times `EMERGENCY_THRESHOLD_MULTIPLIER` (2x), continuously, for
  `EMERGENCY_SUSTAINED_MS` (1 minute) - independent of, and in addition to,
  that sensor's own immediate/sustained alert above. The emergency
  threshold is derived from the sensor's own calibrated alert threshold, so
  it stays proportional across recalibration; there's no separate
  `CALIBRATE_*_EMERGENCY` command. The physical buzzer (GPIO26) sounds for
  as long as either sensor is in its emergency state, and auto-clears the
  instant both drop back below their emergency thresholds - no
  acknowledgment/reset needed. Each emergency also fires its own
  `sendAmbientAlert` once, on the rising edge into the emergency state
  (not repeated every loop, since the buzzer itself is the continuous
  local signal and the existing alert above already re-confirms
  periodically over the API).
- `TEST_BUZZER` beeps the buzzer for exactly one second, independent of any
  real emergency - send it over Serial, or trigger it remotely from the
  admin web's Sensores page ("Probar sirena" button). The remote trigger
  works by queuing the command server-side (`AmbientDevice.pendingCommand`)
  and piggybacking it onto the device's next heartbeat response - there's
  no separate inbound channel to the device - so it can take up to
  `HEARTBEAT_INTERVAL_MS` (5 minutes) to actually beep, and delivery is
  best-effort (if the response never reaches the device, the command is
  silently lost; just click the button again).
- Every heartbeat and alert also reports the sensor's own current calibrated
  threshold (`loudThreshold`/`coAlertThreshold`/`smokeAlertThreshold`)
  alongside its raw reading - temperature/humidity have none, so that field
  is simply omitted for them. Raw readings are uncalibrated ADC counts
  (0-4095) with no real-world unit (see "Note on MQ-7/MQ-2 accuracy"
  above), so the Sensors page shows the reading against this threshold
  instead - e.g. "1242 / 2500 (50%)" - rather than a bare number with
  nothing to compare it to.

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
temperature, humidity) are now implemented, along with the alert buzzer.

Note on MQ-7/MQ-2 accuracy: neither breakout exposes heater control, so
readings are a relative trend rather than a datasheet-calibrated ppm
value. If a future revision swaps in a bare sensor with separate heater
pins and a driver transistor, the firmware would need to duty-cycle the
heater (~60s at 5V, ~90s at 1.4V for the MQ-7; MQ-2 typically runs its
heater continuously even in datasheet-correct usage) and only sample
during the appropriate phase for accurate readings - not implemented here.
