#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>

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

const unsigned long SAMPLE_INTERVAL_MS = 100;
unsigned long lastSampleAt = 0;

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
  pinMode(SOUND_SENSOR_PIN, INPUT);

  secureClient.setCACert(ROOT_CA_ISRG_X1);

  preferences.begin(PREFS_NAMESPACE, false);
  loudThreshold = preferences.getInt(PREFS_KEY_LOUD_THRESHOLD, DEFAULT_LOUD_THRESHOLD);
  Serial.print("Loaded LOUD_THRESHOLD: ");
  Serial.println(loudThreshold);

  Serial.println("millis,analog");
  Serial.println("Send CALIBRATE over Serial (in a quiet room) to re-measure this threshold.");

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

void checkSerialCommand() {
  if (Serial.available()) {
    String command = Serial.readStringUntil('\n');
    command.trim();
    if (command == "CALIBRATE") {
      runCalibration();
    }
  }
}

// Only called for an actual ALERT (repeated loud noise), not every EVENT -
// keeps server/notification traffic to genuine repeated-noise incidents.
void sendAmbientAlert(int level, const String& detail) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Skipping alert POST: WiFi not connected.");
    return;
  }

  HTTPClient http;
  String url = String("https://") + API_HOST + API_AMBIENT_ALERTS_PATH;
  http.begin(secureClient, url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + AMBIENT_API_KEY);

  String body = String("{\"deviceId\":\"") + DEVICE_ID + "\",\"sensor\":\"sound\",\"level\":" + level +
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
// reading (just sound for now) so the Sensors page has something to show.
void sendHeartbeat(int currentSoundLevel) {
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
                "\",\"readings\":[{\"sensor\":\"sound\",\"level\":" + currentSoundLevel + "}]}";

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

      sendAmbientAlert(analogValue, detail);
    }
  }
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
    sendHeartbeat(lastAnalogValue);
    lastHeartbeatAt = now;
  } else if (wifiConnected && now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
    sendHeartbeat(lastAnalogValue);
    lastHeartbeatAt = now;
  }
  wifiWasConnected = wifiConnected;

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
}
