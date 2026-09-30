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

// MAX9814 electret mic amplifier module (5-pin: AR, OUT, GAIN, VDD, GND).
// Unlike the old 3-pin module, OUT is NOT a peak-detector envelope - it's the
// raw AC-coupled audio waveform, biased around a ~1.25V DC offset with up to
// 2Vpp swing, oscillating at actual audio frequencies. A single analogRead()
// per loop would just catch a random instantaneous point on that waveform,
// not "how loud" - see readSoundLevel() below, which derives a loudness
// value (peak-to-peak amplitude over a short sampling window) the same way
// every MAX9814 sound-level project does.
// GAIN and AR are hardware-only 3-state pins (float/GND/VDD), not wired to
// the ESP32 - see PINOUT.md for what each position does and the chosen
// default.
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

// Active buzzer (2-3 pin module with its own oscillator) - simple HIGH/LOW drive, no tone()/PWM
// needed. Only sounds during a declared emergency (see updateBuzzer()), not for every alert.
const int BUZZER_PIN = 26; // general-purpose digital output, avoids strapping/flash pins

const unsigned long SAMPLE_INTERVAL_MS = 100;
unsigned long lastSampleAt = 0;
unsigned long bootAt = 0;

// How long readSoundLevel() spends sampling the raw MAX9814 waveform per call - long enough
// to catch several cycles even of a low-pitched sound (~100Hz -> 10ms/cycle), short enough to
// stay well inside SAMPLE_INTERVAL_MS's 100ms budget alongside the CO/smoke/DHT22 work.
const unsigned long SOUND_WINDOW_MS = 20;

// Derives a "loudness" value from the MAX9814's raw AC audio output: the peak-to-peak
// amplitude (max - min ADC reading) seen while sampling continuously for SOUND_WINDOW_MS.
// Silence stays near 0 (the waveform barely moves off its ~1.25V DC bias); louder sound widens
// the swing. This replaces the old 3-pin module's own hardware envelope detection, which the
// MAX9814 doesn't have - see the SOUND_SENSOR_PIN comment above.
int readSoundLevel() {
  int minValue = 4095;
  int maxValue = 0;
  unsigned long start = millis();
  while (millis() - start < SOUND_WINDOW_MS) {
    int sample = analogRead(SOUND_SENSOR_PIN);
    if (sample < minValue) minValue = sample;
    if (sample > maxValue) maxValue = sample;
  }
  return maxValue - minValue;
}

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

// Emergency tier (see checkSmokeEmergency/checkCoEmergency) - independent from the "since" state
// above, since crossing the normal alert threshold and crossing the (higher) emergency threshold
// are different events that don't necessarily start at the same moment.
unsigned long smokeEmergencyHighSince = 0; // 0 means "not currently above the emergency threshold"
bool smokeEmergencyActive = false;

unsigned long coEmergencyHighSince = 0; // 0 means "not currently above the emergency threshold"
bool coEmergencyActive = false;

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

  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

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
    int value = readSoundLevel();
    if (value > ambientPeak) {
      ambientPeak = value;
    }
  }

  loudThreshold = ambientPeak + CALIBRATION_MARGIN;
  preferences.putInt(PREFS_KEY_LOUD_THRESHOLD, loudThreshold);

  Serial.print("CALIBRATED,");
  Serial.print(loudThreshold);
  Serial.print(",");
  Serial.println(ambientPeak);

  // Reset in case ambient room noise right at calibration's end happened to read as loud.
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

// Defined further down (after updateBuzzer(), which it calls) - forward-declared here so
// checkSerialCommand() can dispatch to it despite appearing earlier in the file.
void testBuzzer();

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
    } else if (command == "TEST_BUZZER") {
      testBuzzer();
    }
  }
}

// Only called for an actual ALERT (repeated loud noise, sustained elevated CO, or a smoke
// threshold crossing), not every raw sample - keeps server/notification traffic to genuine
// incidents. `threshold` is this sensor's own calibrated alert threshold (loudThreshold,
// coAlertThreshold, or smokeAlertThreshold) at the moment of the alert - reported alongside
// the raw level so the Sensors page can show the reading relative to what actually triggered
// it, instead of a bare uncalibrated number. Always the sensor's normal alert threshold, even
// for an emergency-tier alert, so "threshold" means the same thing everywhere it's shown.
void sendAmbientAlert(const String& sensor, int level, int threshold, const String& detail) {
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
                ",\"threshold\":" + threshold + ",\"detail\":\"" + detail + "\"}";

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

  // sound/co/smoke each report their own current calibrated alert threshold (loudThreshold,
  // coAlertThreshold, smokeAlertThreshold - all globals, read directly rather than threaded
  // through as parameters) alongside the raw level - see sendAmbientAlert's comment for why.
  // temperature/humidity have no threshold concept, so that key is simply omitted for them;
  // AmbientReadingDto treats it as optional either way.
  String body = String("{\"deviceId\":\"") + DEVICE_ID + "\",\"deviceName\":\"" + DEVICE_NAME +
                "\",\"readings\":[{\"sensor\":\"sound\",\"level\":" + currentSoundLevel +
                ",\"threshold\":" + loudThreshold +
                "},{\"sensor\":\"co\",\"level\":" + currentCoLevel +
                ",\"threshold\":" + coAlertThreshold +
                "},{\"sensor\":\"smoke\",\"level\":" + currentSmokeLevel +
                ",\"threshold\":" + smokeAlertThreshold +
                "},{\"sensor\":\"temperature\",\"level\":" + currentTemperature +
                "},{\"sensor\":\"humidity\",\"level\":" + currentHumidity + "}]}";

  int statusCode = http.POST(body);
  Serial.print("HEARTBEAT POST ");
  Serial.print(url);
  Serial.print(" -> ");
  Serial.println(statusCode);

  // The heartbeat response carries any command the admin page queued for this device (see
  // AmbientService.recordHeartbeat on the API side) - "TEST_BUZZER" is the only one that
  // exists today, so a plain substring check is enough; a real JSON parser would only be
  // worth adding once there's more than one possible command.
  if (statusCode == 200) {
    String response = http.getString();
    if (response.indexOf("TEST_BUZZER") >= 0) {
      testBuzzer();
    }
  }

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

      sendAmbientAlert("sound", analogValue, loudThreshold, detail);
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

  sendAmbientAlert("co", coValue, coAlertThreshold, detail);
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

  sendAmbientAlert("smoke", smokeValue, smokeAlertThreshold, detail);
  lastSmokeAlertAt = now;
}

// "Emergency" tier on top of the normal smoke alert above: requires a much higher reading
// (smokeAlertThreshold * EMERGENCY_THRESHOLD_MULTIPLIER) sustained for EMERGENCY_SUSTAINED_MS,
// not just an instantaneous crossing. Drives the physical buzzer (see updateBuzzer()) and fires
// its own API alert once, on the rising edge into the emergency state - the existing immediate
// smoke alert above already keeps staff informed while it stays elevated, so this only needs to
// announce the emergency starting, not repeat it every loop.
void checkSmokeEmergency(unsigned long now, int smokeValue) {
  int emergencyThreshold = smokeAlertThreshold * EMERGENCY_THRESHOLD_MULTIPLIER;
  bool isEmergencyHigh = smokeValue >= emergencyThreshold;

  if (!isEmergencyHigh) {
    smokeEmergencyHighSince = 0;
    smokeEmergencyActive = false;
    return;
  }

  if (smokeEmergencyHighSince == 0) {
    smokeEmergencyHighSince = now;
  }

  unsigned long highDuration = now - smokeEmergencyHighSince;
  bool wasActive = smokeEmergencyActive;
  smokeEmergencyActive = highDuration >= EMERGENCY_SUSTAINED_MS;

  if (smokeEmergencyActive && !wasActive) {
    String detail = "EMERGENCIA: smoke level sustained at/above " + String(emergencyThreshold) + " for " +
                    String(highDuration) + "ms (current: " + String(smokeValue) + ")";

    Serial.print("SMOKE_EMERGENCY,");
    Serial.print(now);
    Serial.print(",");
    Serial.println(detail);

    sendAmbientAlert("smoke", smokeValue, smokeAlertThreshold, detail);
  }
}

// Same shape as checkSmokeEmergency, for CO - independent from checkCoAlert's own "since" state
// (coHighSince), since the normal alert threshold and the (higher) emergency threshold are
// crossed at different moments.
void checkCoEmergency(unsigned long now, int coValue) {
  int emergencyThreshold = coAlertThreshold * EMERGENCY_THRESHOLD_MULTIPLIER;
  bool isEmergencyHigh = coValue >= emergencyThreshold;

  if (!isEmergencyHigh) {
    coEmergencyHighSince = 0;
    coEmergencyActive = false;
    return;
  }

  if (coEmergencyHighSince == 0) {
    coEmergencyHighSince = now;
  }

  unsigned long highDuration = now - coEmergencyHighSince;
  bool wasActive = coEmergencyActive;
  coEmergencyActive = highDuration >= EMERGENCY_SUSTAINED_MS;

  if (coEmergencyActive && !wasActive) {
    String detail = "EMERGENCIA: CO level sustained at/above " + String(emergencyThreshold) + " for " +
                    String(highDuration) + "ms (current: " + String(coValue) + ")";

    Serial.print("CO_EMERGENCY,");
    Serial.print(now);
    Serial.print(",");
    Serial.println(detail);

    sendAmbientAlert("co", coValue, coAlertThreshold, detail);
  }
}

// Sounds the physical buzzer for as long as either gas sensor is in its emergency state -
// auto-clears the instant both drop back below their emergency thresholds, no separate
// acknowledgment/reset mechanism needed.
void updateBuzzer() {
  digitalWrite(BUZZER_PIN, (smokeEmergencyActive || coEmergencyActive) ? HIGH : LOW);
}

// Triggered by sending "TEST_BUZZER" over Serial, or remotely from the admin page (delivered
// through the next heartbeat response - see sendHeartbeat). Beeps for exactly one second so
// staff can confirm the buzzer itself works without needing a real smoke/CO emergency. Restores
// the pin via updateBuzzer() afterward, rather than forcing it LOW, so testing during an actual
// emergency doesn't silence the real alarm.
void testBuzzer() {
  Serial.println("TEST_BUZZER: beeping for 1 second.");
  digitalWrite(BUZZER_PIN, HIGH);
  delay(1000);
  updateBuzzer();
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

  int analogValue = readSoundLevel();
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
    checkCoEmergency(now, coValue);
  }

  int smokeValue = analogRead(SMOKE_SENSOR_PIN);
  lastSmokeValue = smokeValue;

  Serial.print("SMOKE,");
  Serial.print(now);
  Serial.print(",");
  Serial.println(smokeValue);

  if (now - bootAt >= SMOKE_WARMUP_MS) {
    checkSmokeAlert(now, smokeValue);
    checkSmokeEmergency(now, smokeValue);
  }

  updateBuzzer();
}
