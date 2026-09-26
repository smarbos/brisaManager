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
