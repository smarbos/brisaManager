#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <DHT.h>

#include "config.h"
#include "root_ca.h"
#include "secrets.h"

// Shared by sendAmbientAlert and sendHeartbeat - holds the CA cert so every HTTPS request
// validates api.labrisa.com.ar's certificate against Let's Encrypt's root, rather than each
// call constructing (and needing to reconfigure) its own client.
WiFiClientSecure secureClient;

// 3-pin sound sensor module (OUT, VCC, GND). Confirmed analog: OUT gives a
// peak-detector style envelope that spikes on a loud sound and decays back
// to ~0. The module has no usable digital threshold output.
const int SOUND_SENSOR_PIN = 34; // ADC1, input-only, avoids strapping/flash pins

// 4-pin MQ-7 (carbon monoxide) breakout module (VCC, GND, AO, DO). DO is left unconnected -
// same as the sound sensor, only the raw analog signal is used. This breakout runs its heater
// continuously at 5V with no firmware control, so unlike a datasheet-correct duty-cycled
// reading, this is a relative CO trend rather than a calibrated ppm value.
const int CO_SENSOR_PIN = 35; // ADC1, input-only, distinct from the sound sensor's GPIO34

// 4-pin MQ-2 (smoke/combustible gas) breakout module (VCC, GND, AO, DO) - same shape as the
// MQ-7 breakout: DO unconnected, heater runs continuously on-board, no firmware heater control.
const int SMOKE_SENSOR_PIN = 32; // ADC1, input-only, distinct from GPIO34 (sound) / GPIO35 (CO)

// 3-pin DHT22 module (VCC, DATA, GND) - digital, not analog, so it doesn't need an ADC pin.
// 3-pin breakouts include the required pull-up resistor on DATA on-board.
const int DHT_PIN = 27; // general-purpose digital pin, avoids strapping/flash pins
DHT dht(DHT_PIN, DHT22);

const unsigned long SAMPLE_INTERVAL_MS = 100;
unsigned long lastSampleAt = 0;
unsigned long bootAt = 0;

// A reading at or above this counts as "loud". Send "CALIBRATE" over Serial
// to re-measure this for the room the device is actually installed in
// (see runCalibration) - this fallback only applies on a fresh device or
// after NVS is erased.
const int DEFAULT_LOUD_THRESHOLD = 800;
int loudThreshold = DEFAULT_LOUD_THRESHOLD;

// How long a CALIBRATE run samples for, and how much headroom it adds above
// the loudest thing it saw during that window.
const unsigned long CALIBRATION_DURATION_MS = 5000;
const int CALIBRATION_MARGIN = 400;

// Persists loudThreshold across power cycles (ESP32 NVS flash) so a
// calibration done once survives a reboot/power-off.
Preferences preferences;
const char* PREFS_NAMESPACE = "ambient";
const char* PREFS_KEY_LOUD_THRESHOLD = "loudThresh";

// Repeated-loud-noise rule: alert when this many loud events happen within
// this time window.
const int REPEAT_COUNT = 5;
const unsigned long REPEAT_WINDOW_MS = 30000;

bool wasLoud = false;
unsigned long loudEventTimes[REPEAT_COUNT] = {0};
int loudEventIndex = 0;
int loudEventsRecorded = 0;

int lastAnalogValue = 0;
unsigned long lastHeartbeatAt = 0;
bool wifiWasConnected = false;

// A reading at or above this counts as an elevated CO level. No datasheet-backed default
// exists for this specific uncalibrated breakout, so this is a rough placeholder only - run
// CALIBRATE_CO on the actual installed hardware before trusting alerts.
const int DEFAULT_CO_ALERT_THRESHOLD = 2500;
int coAlertThreshold = DEFAULT_CO_ALERT_THRESHOLD;

// How long a CALIBRATE_CO run samples for, and how much headroom it adds above the highest
// clean-air reading it saw during that window - same shape as the sound sensor's calibration,
// kept as its own constants since MQ-7's electrical range differs from the sound module's.
const unsigned long CO_CALIBRATION_DURATION_MS = 5000;
const int CO_CALIBRATION_MARGIN = 300;

const char* PREFS_KEY_CO_THRESHOLD = "coThresh";

int lastCoValue = 0;
unsigned long coHighSince = 0;   // 0 means "not currently above threshold"
unsigned long lastCoAlertAt = 0; // 0 means "never alerted yet"

// A reading at or above this counts as elevated smoke. Same caveat as CO: no datasheet-backed
// default for this uncalibrated breakout - run CALIBRATE_SMOKE on the actual hardware.
const int DEFAULT_SMOKE_ALERT_THRESHOLD = 2500;
int smokeAlertThreshold = DEFAULT_SMOKE_ALERT_THRESHOLD;

const unsigned long SMOKE_CALIBRATION_DURATION_MS = 5000;
const int SMOKE_CALIBRATION_MARGIN = 300;

const char* PREFS_KEY_SMOKE_THRESHOLD = "smokeThresh";

int lastSmokeValue = 0;
bool wasSmokeHigh = false;
unsigned long lastSmokeAlertAt = 0; // 0 means "never alerted yet"

// No alerting/calibration for these - passive reporting only. Kept at their last known-good
// value across a failed read (DHT22 occasionally times out or fails its checksum), rather than
// reporting a wrong/zero value.
int lastTemperature = 0;
int lastHumidity = 0;
unsigned long lastDhtSampleAt = 0;

unsigned long lastWifiRetryAt = 0;

void connectWiFi() {
  Serial.print("Connecting to WiFi");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_CONNECT_TIMEOUT_MS) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi connected, IP: ");
    Serial.println(WiFi.localIP());
  } else {
    // Sensor sampling and local ALERT detection still work without WiFi -
    // maintainWiFi() (called from loop()) keeps retrying every
    // WIFI_RETRY_INTERVAL_MS, and sendAmbientAlert/sendHeartbeat just skip
    // their POST until it reconnects.
    Serial.println("WiFi connect timed out; will keep detecting locally and retry in the background.");
  }
}

// Called every loop() iteration. A no-op while connected; while disconnected (never connected
// at boot, or dropped later), retries WiFi.begin() every WIFI_RETRY_INTERVAL_MS instead of
// giving up - covers a router reboot, a temporary outage, etc. without needing a manual reset.
void maintainWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  unsigned long now = millis();
  if (now - lastWifiRetryAt < WIFI_RETRY_INTERVAL_MS) {
    return;
  }
  lastWifiRetryAt = now;

  Serial.println("WiFi not connected - retrying...");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void setup() {
  Serial.begin(115200);
  bootAt = millis();

  pinMode(SOUND_SENSOR_PIN, INPUT);
  pinMode(CO_SENSOR_PIN, INPUT);
  pinMode(SMOKE_SENSOR_PIN, INPUT);
  dht.begin();

  secureClient.setCACert(ROOT_CA_ISRG_X1);

  preferences.begin(PREFS_NAMESPACE, false);
  loudThreshold = preferences.getInt(PREFS_KEY_LOUD_THRESHOLD, DEFAULT_LOUD_THRESHOLD);
  Serial.print("Loaded LOUD_THRESHOLD: ");
  Serial.println(loudThreshold);

  coAlertThreshold = preferences.getInt(PREFS_KEY_CO_THRESHOLD, DEFAULT_CO_ALERT_THRESHOLD);
  Serial.print("Loaded CO_ALERT_THRESHOLD: ");
  Serial.println(coAlertThreshold);

  smokeAlertThreshold = preferences.getInt(PREFS_KEY_SMOKE_THRESHOLD, DEFAULT_SMOKE_ALERT_THRESHOLD);
  Serial.print("Loaded SMOKE_ALERT_THRESHOLD: ");
  Serial.println(smokeAlertThreshold);

  Serial.println("millis,analog");
  Serial.println("Send CALIBRATE over Serial (in a quiet room) to re-measure the sound threshold.");
  Serial.println("Send CALIBRATE_CO over Serial (in clean air) to re-measure the CO threshold.");
  Serial.println("Send CALIBRATE_SMOKE over Serial (in clean air) to re-measure the smoke threshold.");

  connectWiFi();
}

// Triggered by sending the line "CALIBRATE" over Serial. Pauses normal
// sampling for CALIBRATION_DURATION_MS, measures the loudest reading seen
// during that window (the room should be quiet), and sets loudThreshold to
// that peak plus a safety margin. Persisted immediately, so it survives a
// power-off - no need to recalibrate after every reboot.
void runCalibration() {
  Serial.println("CALIBRATING... keep the room quiet for 5 seconds.");

  int ambientPeak = 0;
  unsigned long start = millis();
  while (millis() - start < CALIBRATION_DURATION_MS) {
    int value = analogRead(SOUND_SENSOR_PIN);
    if (value > ambientPeak) {
      ambientPeak = value;
    }
    delay(10);
  }

  loudThreshold = ambientPeak + CALIBRATION_MARGIN;
  preferences.putInt(PREFS_KEY_LOUD_THRESHOLD, loudThreshold);

  Serial.print("CALIBRATED,");
  Serial.print(loudThreshold);
  Serial.print(",");
  Serial.println(ambientPeak);

  // Avoid a spurious EVENT immediately after calibration if the sensor was
  // mid-decay from a sound when the window ended.
  wasLoud = false;
}

// Triggered by sending "CALIBRATE_CO" over Serial - independent from the sound sensor's
// CALIBRATE command, so recalibrating one sensor never disturbs the other's saved threshold.
// Measures this specific MQ-7 unit's clean-air baseline (accounts for manufacturing variance
// between individual sensors) and sets coAlertThreshold to that peak plus a safety margin.
// Persisted immediately, survives a power-off.
void runCoCalibration() {
  Serial.println("CALIBRATING CO... keep the air clean for 5 seconds.");

  int cleanAirPeak = 0;
  unsigned long start = millis();
  while (millis() - start < CO_CALIBRATION_DURATION_MS) {
    int value = analogRead(CO_SENSOR_PIN);
    if (value > cleanAirPeak) {
      cleanAirPeak = value;
    }
    delay(10);
  }

  coAlertThreshold = cleanAirPeak + CO_CALIBRATION_MARGIN;
  preferences.putInt(PREFS_KEY_CO_THRESHOLD, coAlertThreshold);

  Serial.print("CALIBRATED_CO,");
  Serial.print(coAlertThreshold);
  Serial.print(",");
  Serial.println(cleanAirPeak);

  // Avoid a spurious sustained-high reading firing immediately after calibration if the air
  // was mid-drift from the sensor's own warm-up when the window ended.
  coHighSince = 0;
}

// Triggered by sending "CALIBRATE_SMOKE" over Serial - independent from the other two
// calibration commands, same shape as runCoCalibration(). Measures this specific MQ-2 unit's
// clean-air baseline and sets smokeAlertThreshold to that peak plus a safety margin.
void runSmokeCalibration() {
  Serial.println("CALIBRATING SMOKE... keep the air clean for 5 seconds.");

  int cleanAirPeak = 0;
  unsigned long start = millis();
  while (millis() - start < SMOKE_CALIBRATION_DURATION_MS) {
    int value = analogRead(SMOKE_SENSOR_PIN);
    if (value > cleanAirPeak) {
      cleanAirPeak = value;
    }
    delay(10);
  }

  smokeAlertThreshold = cleanAirPeak + SMOKE_CALIBRATION_MARGIN;
  preferences.putInt(PREFS_KEY_SMOKE_THRESHOLD, smokeAlertThreshold);

  Serial.print("CALIBRATED_SMOKE,");
  Serial.print(smokeAlertThreshold);
  Serial.print(",");
  Serial.println(cleanAirPeak);

  // Avoid a spurious alert immediately after calibration if the air was mid-drift from the
  // sensor's own warm-up when the window ended.
  wasSmokeHigh = false;
}

void checkSerialCommand() {
  if (Serial.available()) {
    String command = Serial.readStringUntil('\n');
    command.trim();
    if (command == "CALIBRATE") {
      runCalibration();
    } else if (command == "CALIBRATE_CO") {
      runCoCalibration();
    } else if (command == "CALIBRATE_SMOKE") {
      runSmokeCalibration();
    }
  }
}

// Only called for an actual ALERT (repeated loud noise, sustained elevated CO, or a smoke
// threshold crossing), not every raw sample - keeps server/notification traffic to genuine
// incidents.
void sendAmbientAlert(const String& sensor, int level, const String& detail) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Skipping alert POST: WiFi not connected.");
    return;
  }

  HTTPClient http;
  String url = String("https://") + API_HOST + API_AMBIENT_ALERTS_PATH;
  http.begin(secureClient, url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + AMBIENT_API_KEY);

  String body = String("{\"deviceId\":\"") + DEVICE_ID + "\",\"sensor\":\"" + sensor + "\",\"level\":" + level +
                ",\"detail\":\"" + detail + "\"}";

  int statusCode = http.POST(body);
  Serial.print("POST ");
  Serial.print(url);
  Serial.print(" -> ");
  Serial.println(statusCode);
  http.end();
}

// Sent once right after WiFi connects, then every HEARTBEAT_INTERVAL_MS - proves the device
// is alive even when nothing is currently alert-worthy, and reports each sensor's latest
// reading so the Sensors page has something to show.
void sendHeartbeat(int currentSoundLevel, int currentCoLevel, int currentSmokeLevel, int currentTemperature, int currentHumidity) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Skipping heartbeat POST: WiFi not connected.");
    return;
  }

  HTTPClient http;
  String url = String("https://") + API_HOST + API_AMBIENT_HEARTBEAT_PATH;
  http.begin(secureClient, url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + AMBIENT_API_KEY);

  String body = String("{\"deviceId\":\"") + DEVICE_ID + "\",\"deviceName\":\"" + DEVICE_NAME +
                "\",\"readings\":[{\"sensor\":\"sound\",\"level\":" + currentSoundLevel +
                "},{\"sensor\":\"co\",\"level\":" + currentCoLevel +
                "},{\"sensor\":\"smoke\",\"level\":" + currentSmokeLevel +
                "},{\"sensor\":\"temperature\",\"level\":" + currentTemperature +
                "},{\"sensor\":\"humidity\",\"level\":" + currentHumidity + "}]}";

  int statusCode = http.POST(body);
  Serial.print("HEARTBEAT POST ");
  Serial.print(url);
  Serial.print(" -> ");
  Serial.println(statusCode);
  http.end();
}

void recordLoudEvent(unsigned long now, int analogValue) {
  Serial.print("EVENT,");
  Serial.print(now);
  Serial.print(",");
  Serial.println(analogValue);

  loudEventTimes[loudEventIndex] = now;
  loudEventIndex = (loudEventIndex + 1) % REPEAT_COUNT;
  if (loudEventsRecorded < REPEAT_COUNT) {
    loudEventsRecorded++;
  }

  if (loudEventsRecorded == REPEAT_COUNT) {
    // The slot we're about to overwrite next holds the oldest of the last
    // REPEAT_COUNT events.
    unsigned long oldest = loudEventTimes[loudEventIndex];
    if (now - oldest <= REPEAT_WINDOW_MS) {
      String detail = String(REPEAT_COUNT) + " loud events within " + REPEAT_WINDOW_MS + "ms";

      Serial.print("ALERT,");
      Serial.print(now);
      Serial.print(",");
      Serial.println(detail);

      sendAmbientAlert("sound", analogValue, detail);
    }
  }
}

// Unlike the sound sensor's spike detection, CO danger comes from a sustained elevated
// reading, not a brief crossing - a single noisy ADC sample shouldn't trigger an alert. Tracks
// how long the reading has stayed at/above coAlertThreshold, and only alerts once that's held
// for CO_SUSTAINED_MS. While it remains elevated, re-sends at most every CO_REALERT_INTERVAL_MS
// as a "still elevated" ping - the API dedupes repeated alerts for the same device+sensor into
// one open notification, so this isn't new-notification spam.
void checkCoAlert(unsigned long now, int coValue) {
  bool isHigh = coValue >= coAlertThreshold;

  if (!isHigh) {
    coHighSince = 0;
    return;
  }

  if (coHighSince == 0) {
    coHighSince = now;
    Serial.print("CO_HIGH,");
    Serial.print(now);
    Serial.print(",");
    Serial.println(coValue);
    return;
  }

  unsigned long highDuration = now - coHighSince;
  if (highDuration < CO_SUSTAINED_MS) {
    return;
  }

  if (lastCoAlertAt != 0 && now - lastCoAlertAt < CO_REALERT_INTERVAL_MS) {
    return;
  }

  String detail = "CO level sustained at/above " + String(coAlertThreshold) + " for " + String(highDuration) +
                  "ms (current: " + String(coValue) + ")";

  Serial.print("CO_ALERT,");
  Serial.print(now);
  Serial.print(",");
  Serial.println(detail);

  sendAmbientAlert("co", coValue, detail);
  lastCoAlertAt = now;
}

// Smoke is urgent, unlike CO's sustained-exposure model - alerts on the rising edge (crossing
// from below to at/above threshold), same shape as the sound sensor's EVENT detection, so a
// real smoke event gets reported within one sample instead of waiting a minute. While it stays
// elevated, re-sends at most every SMOKE_REALERT_INTERVAL_MS - avoids spamming the API from
// ADC noise bouncing right at the threshold, while still re-confirming reasonably often.
void checkSmokeAlert(unsigned long now, int smokeValue) {
  bool isHigh = smokeValue >= smokeAlertThreshold;

  if (!isHigh) {
    wasSmokeHigh = false;
    return;
  }

  bool justCrossed = !wasSmokeHigh;
  wasSmokeHigh = true;

  if (!justCrossed && lastSmokeAlertAt != 0 && now - lastSmokeAlertAt < SMOKE_REALERT_INTERVAL_MS) {
    return;
  }

  String detail = "Smoke level at/above " + String(smokeAlertThreshold) + " (current: " + String(smokeValue) + ")";

  Serial.print("SMOKE_ALERT,");
  Serial.print(now);
  Serial.print(",");
  Serial.println(detail);

  sendAmbientAlert("smoke", smokeValue, detail);
  lastSmokeAlertAt = now;
}

// Passive reporting only, no alerting - the DHT22 gets its own slower, independent sample
// timer (DHT_SAMPLE_INTERVAL_MS) rather than the 100ms loop the analog sensors use, since the
// sensor's datasheet requires at least 2s between reads. A failed read (occasional timing
// glitch or checksum failure) keeps the last known-good value rather than reporting garbage.
void readDht() {
  float humidity = dht.readHumidity();
  float temperature = dht.readTemperature();

  if (isnan(humidity) || isnan(temperature)) {
    Serial.println("DHT22 read failed - keeping last known values.");
    return;
  }

  lastTemperature = (int)round(temperature);
  lastHumidity = (int)round(humidity);

  Serial.print("TEMPERATURE,");
  Serial.println(lastTemperature);
  Serial.print("HUMIDITY,");
  Serial.println(lastHumidity);
}

void loop() {
  checkSerialCommand();
  maintainWiFi();

  unsigned long now = millis();
  bool wifiConnected = WiFi.status() == WL_CONNECTED;

  if (wifiConnected && !wifiWasConnected) {
    // Just connected - either the very first time, or a reconnect after a drop. Report in
    // right away rather than waiting for the next scheduled heartbeat, so the server (and
    // anyone who got a DEVICE_OFFLINE alert) finds out we're back as soon as possible.
    sendHeartbeat(lastAnalogValue, lastCoValue, lastSmokeValue, lastTemperature, lastHumidity);
    lastHeartbeatAt = now;
  } else if (wifiConnected && now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
    sendHeartbeat(lastAnalogValue, lastCoValue, lastSmokeValue, lastTemperature, lastHumidity);
    lastHeartbeatAt = now;
  }
  wifiWasConnected = wifiConnected;

  // Independent of the 100ms analog-sensor sampling below - the DHT22 needs a much slower,
  // dedicated cadence (see DHT_SAMPLE_INTERVAL_MS), so this check isn't gated by the early
  // return just below it.
  if (now - lastDhtSampleAt >= DHT_SAMPLE_INTERVAL_MS) {
    lastDhtSampleAt = now;
    readDht();
  }

  if (now - lastSampleAt < SAMPLE_INTERVAL_MS) {
    return;
  }
  lastSampleAt = now;

  int analogValue = analogRead(SOUND_SENSOR_PIN);
  lastAnalogValue = analogValue;

  Serial.print(now);
  Serial.print(",");
  Serial.println(analogValue);

  bool isLoud = analogValue >= loudThreshold;
  if (isLoud && !wasLoud) {
    recordLoudEvent(now, analogValue);
  }
  wasLoud = isLoud;

  int coValue = analogRead(CO_SENSOR_PIN);
  lastCoValue = coValue;

  Serial.print("CO,");
  Serial.print(now);
  Serial.print(",");
  Serial.println(coValue);

  if (now - bootAt >= CO_WARMUP_MS) {
    checkCoAlert(now, coValue);
  }

  int smokeValue = analogRead(SMOKE_SENSOR_PIN);
  lastSmokeValue = smokeValue;

  Serial.print("SMOKE,");
  Serial.print(now);
  Serial.print(",");
  Serial.println(smokeValue);

  if (now - bootAt >= SMOKE_WARMUP_MS) {
    checkSmokeAlert(now, smokeValue);
  }
}
