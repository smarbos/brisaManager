#pragma once

// Production API, reached over HTTPS through Traefik (see brisaManager's
// docker-compose.prod.yml) - not this machine's local LAN IP. TLS is validated against
// Let's Encrypt's root CA (see root_ca.h), not skipped.
#define API_HOST "api.labrisa.com.ar"
#define API_AMBIENT_ALERTS_PATH "/ambient-alerts"
#define API_AMBIENT_HEARTBEAT_PATH "/ambient-heartbeat"

// Identifies this device in AmbientEvent/Notification/AmbientDevice records - distinguishes
// it from any other ambient-control device (e.g. living room vs. first floor). Change both
// before flashing a second physical device so they don't collide as the same device.
#define DEVICE_ID "ambient-control-living-room"
#define DEVICE_NAME "Living room"

constexpr unsigned long WIFI_CONNECT_TIMEOUT_MS = 15000;

// How often loop() retries WiFi.begin() while disconnected - covers both "never connected at
// boot" and "dropped later". Matches the retry cadence used in the sibling plampstify project.
constexpr unsigned long WIFI_RETRY_INTERVAL_MS = 10000; // 10 seconds

// How often this device tells the server it's still alive (and what it's currently reading)
// - see AmbientOfflineSchedulerService on the API side, which alerts staff if a device misses
// enough of these in a row.
constexpr unsigned long HEARTBEAT_INTERVAL_MS = 5UL * 60UL * 1000UL; // 5 minutes

// MQ-7 (carbon monoxide) sensor timing. The sensor's reading isn't meaningful until it's been
// powered for a while (manufacturing datasheet burn-in behavior) - readings are sampled and
// reported from boot, but CO_WARMUP_MS suppresses alert logic until the reading has settled.
constexpr unsigned long CO_WARMUP_MS = 3UL * 60UL * 1000UL; // 3 minutes

// A CO reading must stay at/above coAlertThreshold continuously for this long before it counts
// as a real exposure worth alerting on - unlike the sound sensor's spike detection, a single
// noisy ADC sample shouldn't trigger a carbon monoxide alert.
constexpr unsigned long CO_SUSTAINED_MS = 60UL * 1000UL; // 1 minute

// Once sustained-high, re-sends an ALERT at most this often while it stays elevated - the API
// dedupes repeated alerts for the same device+sensor into one open notification (see
// AmbientService.recordAlert), so this is a "still elevated" ping, not new-notification spam.
constexpr unsigned long CO_REALERT_INTERVAL_MS = HEARTBEAT_INTERVAL_MS; // 5 minutes

// MQ-2 (smoke/combustible gas) sensor timing. Same warm-up rationale as the MQ-7 (readings
// aren't meaningful until the sensor's settled), but unlike CO's sustained-exposure model,
// smoke alerts fire immediately on a threshold crossing - smoke response needs to be fast, not
// averaged over a minute like CO exposure.
constexpr unsigned long SMOKE_WARMUP_MS = 3UL * 60UL * 1000UL; // 3 minutes

// While still elevated after the initial alert, re-sends at most this often - avoids spamming
// the API from ADC noise bouncing right at the threshold, while still re-confirming quickly
// (much shorter than CO's re-alert interval, since smoke is more urgent).
constexpr unsigned long SMOKE_REALERT_INTERVAL_MS = 2UL * 60UL * 1000UL; // 2 minutes

// DHT22 (temperature/humidity) read interval. The sensor's datasheet requires at least 2s
// between reads; sampled independently from the 100ms analog-sensor loop, well above that
// minimum with margin.
constexpr unsigned long DHT_SAMPLE_INTERVAL_MS = 5000; // 5 seconds

// "Emergency" tier: sustained, much-higher-than-alert readings from either gas sensor sound the
// physical alert buzzer (see BUZZER_PIN in main.cpp), on top of the existing API alerts above.
// Each sensor's emergency threshold is a multiple of that sensor's own calibrated alert
// threshold, so it stays proportional across recalibration instead of needing its own
// CALIBRATE_* command and persisted value.
constexpr int EMERGENCY_THRESHOLD_MULTIPLIER = 2;

// Hard upper bounds on the CO/smoke alert thresholds, enforced in firmware no matter what a
// CALIBRATE_CO/CALIBRATE_SMOKE run measures or what's stored in NVS. Calibration exists to make
// a sensor *more* sensitive than the uncalibrated default (tuning to this unit's clean-air
// baseline), never less - without a cap, calibrating in contaminated air (or holding a gas
// source to the sensor during the 5s window) would raise the threshold arbitrarily and
// silently disable life-safety alerts. A calibration that would land above the cap is
// rejected outright (the old threshold is kept), since a "clean air" peak that high means the
// air isn't clean or the sensor is faulty. Raising these requires a reflash, not a serial
// command.
constexpr int MAX_CO_ALERT_THRESHOLD = 2500;
// Higher than CO's: the living-room MQ-2 reads ~2550-2630 in normal air (measured 2026-10-01
// after warm-up; its calibrated threshold was 2726), so a 2500 cap would sit below its own
// baseline and raise a permanent false smoke alert.
constexpr int MAX_SMOKE_ALERT_THRESHOLD = 3200;

// The ESP32's 12-bit ADC saturates at 4095, so alertThreshold * EMERGENCY_THRESHOLD_MULTIPLIER
// alone could land above anything the sensor can ever read (2500 * 2 = 5000) and the buzzer
// would never sound. The emergency threshold is capped here, just under saturation.
constexpr int MAX_EMERGENCY_THRESHOLD = 4000;

// After a wrong SERIAL_ADMIN_PIN, every serial command is ignored for this long - turns a
// brute-force of the PIN over USB from seconds into years.
constexpr unsigned long SERIAL_PIN_FAILURE_LOCKOUT_MS = 5000;

// How long a reading must stay at/above the emergency threshold before the buzzer sounds - a
// brief spike isn't an emergency, only a sustained one.
constexpr unsigned long EMERGENCY_SUSTAINED_MS = 60UL * 1000UL; // 1 minute
