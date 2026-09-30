#include <Arduino.h>
#include <algorithm>
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
// value (RMS amplitude over a short sampling window) from it.
// GAIN and AR are hardware-only 3-state pins (float/GND/VDD), not ESP32
// signals. GAIN is tied to VDD (40dB, the least sensitive setting): at the
// floating 60dB default the chip's AGC turned a quiet room's background noise
// up until it filled most of the ADC range, leaving little room between
// "quiet" and "loud" - see PINOUT.md.
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

// How long readSoundLevel() spends sampling the raw MAX9814 waveform per call - several cycles
// even of a low-pitched sound (~100Hz -> 10ms/cycle), and long enough for the RMS to average
// out single-sample ADC spikes, while staying inside SAMPLE_INTERVAL_MS's 100ms budget alongside
// the CO/smoke/DHT22 work.
const unsigned long SOUND_WINDOW_MS = 50;

// Derives a "loudness" value from the MAX9814's raw AC audio output: the RMS amplitude of the
// waveform around its own mean (the ~1.25V DC bias) while sampling continuously for
// SOUND_WINDOW_MS. Silence stays near the ADC's own noise floor; louder sound raises it. RMS
// rather than peak-to-peak (max - min) because max - min is set by the two most extreme samples
// in the window, so a single ADC spike reads as loud - it made a quiet room read anywhere from
// ~550 to ~1900. With the chip's output capped at ~2Vpp, the highest this reaches is ~850.
int readSoundLevel() {
  int64_t sum = 0;
  int64_t sumOfSquares = 0;
  int32_t count = 0;
  unsigned long start = millis();
  while (millis() - start < SOUND_WINDOW_MS) {
    int32_t sample = analogRead(SOUND_SENSOR_PIN);
    sum += sample;
    sumOfSquares += sample * sample;
    count++;
  }
  // Variance = mean of squares - square of mean; a tiny negative from rounding clamps to 0.
  double mean = (double)sum / count;
  double variance = (double)sumOfSquares / count - mean * mean;
  return variance > 0 ? (int)lround(sqrt(variance)) : 0;
}

// A reading at or above this counts as "loud". Send "CALIBRATE" over Serial
// to re-measure this for the room the device is actually installed in
// (see runCalibration) - this fallback only applies on a fresh device or
// after NVS is erased. A rough placeholder for GAIN at 40dB, not a measured value.
const int DEFAULT_LOUD_THRESHOLD = 150;
int loudThreshold = DEFAULT_LOUD_THRESHOLD;

// How long a CALIBRATE run samples for, and how the threshold is derived from it: the 99th
// percentile of the quiet-room readings (not the single highest one, so one stray spike during
// the run can't inflate it), times CALIBRATION_FACTOR (3x amplitude, ~+10dB), but at least
// CALIBRATION_MIN_MARGIN above it - a proportional margin alone would sit right on top of the
// ADC's own noise if the room is very quiet.
const unsigned long CALIBRATION_DURATION_MS = 5000;
const int CALIBRATION_PERCENTILE = 99;
const int CALIBRATION_FACTOR = 3;
const int CALIBRATION_MIN_MARGIN = 50;
// Enough room for every readSoundLevel() call CALIBRATION_DURATION_MS can fit.
const int CALIBRATION_MAX_READINGS = CALIBRATION_DURATION_MS / SOUND_WINDOW_MS + 1;

// Persists loudThreshold across power cycles (ESP32 NVS flash) so a
// calibration done once survives a reboot/power-off. The key changed along with the reading's
// units (peak-to-peak -> RMS), so a threshold calibrated for the old measurement is ignored
// instead of loaded as if it still meant the same thing.
Preferences preferences;
const char* PREFS_NAMESPACE = "ambient";
const char* PREFS_KEY_LOUD_THRESHOLD = "loudRms";

// A sound only counts as loud after LOUD_SUSTAIN_SAMPLES consecutive readings at/above
// loudThreshold (~250ms at SAMPLE_INTERVAL_MS), so one noisy reading can't start an event.
// Once loud, it stays loud until a reading drops below LOUD_RELEASE_PERCENT of the threshold -
// the gap keeps a level hovering right at the threshold from counting as many separate events.
const int LOUD_SUSTAIN_SAMPLES = 3;
const int LOUD_RELEASE_PERCENT = 75;

// A sound that stays loud continuously (music, a party) counts as another loud event every
// LOUD_REPEAT_MS - otherwise it would be a single event however long it lasted, and never reach
// the repeated-loud-noise rule below.
const unsigned long LOUD_REPEAT_MS = 5000;

// Repeated-loud-noise rule: alert when this many loud events happen within
// this time window.
const int REPEAT_COUNT = 5;
const unsigned long REPEAT_WINDOW_MS = 30000;

bool isLoud = false;
int loudSampleStreak = 0;
unsigned long lastLoudEventAt = 0;
unsigned long loudEventTimes[REPEAT_COUNT] = {0};
int loudEventIndex = 0;
int loudEventsRecorded = 0;

int lastAnalogValue = 0;
// Running total of every sound reading since the last heartbeat, so the heartbeat reports the
// average level over its whole interval rather than one arbitrary 50ms reading.
uint32_t soundLevelSum = 0;
uint32_t soundLevelCount = 0;
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
// sampling for CALIBRATION_DURATION_MS, records every reading during that
// window (the room should be quiet), and sets loudThreshold from their
// CALIBRATION_PERCENTILE - see CALIBRATION_FACTOR for the margin on top.
// Persisted immediately, so it survives a power-off - no need to recalibrate
// after every reboot.
void runCalibration() {
  Serial.println("CALIBRATING... keep the room quiet for 5 seconds.");

  static int readings[CALIBRATION_MAX_READINGS];
  int readingCount = 0;
  unsigned long start = millis();
  while (millis() - start < CALIBRATION_DURATION_MS && readingCount < CALIBRATION_MAX_READINGS) {
    readings[readingCount++] = readSoundLevel();
  }

  std::sort(readings, readings + readingCount);
  int ambientLevel = readings[(readingCount - 1) * CALIBRATION_PERCENTILE / 100];

  loudThreshold = max(ambientLevel * CALIBRATION_FACTOR, ambientLevel + CALIBRATION_MIN_MARGIN);
  preferences.putInt(PREFS_KEY_LOUD_THRESHOLD, loudThreshold);

  Serial.print("CALIBRATED,");
  Serial.print(loudThreshold);
  Serial.print(",");
  Serial.println(ambientLevel);

  // Reset in case ambient room noise right at calibration's end happened to read as loud.
  isLoud = false;
  loudSampleStreak = 0;
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
// reading so the Sensors page has something to show (for sound, the average level since the
// previous heartbeat - see takeAverageSoundLevel()).
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

// Called with every sound reading. Enters the loud state (and records an event) after
// LOUD_SUSTAIN_SAMPLES consecutive readings at/above loudThreshold, records another event every
// LOUD_REPEAT_MS it stays loud, and leaves it once a reading drops below LOUD_RELEASE_PERCENT of
// the threshold.
void updateLoudState(unsigned long now, int analogValue) {
  if (!isLoud) {
    loudSampleStreak = analogValue >= loudThreshold ? loudSampleStreak + 1 : 0;
    if (loudSampleStreak >= LOUD_SUSTAIN_SAMPLES) {
      isLoud = true;
      lastLoudEventAt = now;
      recordLoudEvent(now, analogValue);
    }
    return;
  }

  if (analogValue * 100 < loudThreshold * LOUD_RELEASE_PERCENT) {
    isLoud = false;
    loudSampleStreak = 0;
  } else if (now - lastLoudEventAt >= LOUD_REPEAT_MS) {
    lastLoudEventAt = now;
    recordLoudEvent(now, analogValue);
  }
}

// Average sound level since the last call (i.e. since the last heartbeat), then starts a new
// interval. Falls back to the latest reading if none were taken in between.
int takeAverageSoundLevel() {
  int average = soundLevelCount > 0 ? soundLevelSum / soundLevelCount : lastAnalogValue;
  soundLevelSum = 0;
  soundLevelCount = 0;
  return average;
}

// Unlike the sound sensor's ~250ms loud detection, CO danger comes from a sustained elevated
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
// from below to at/above threshold), so a real smoke event gets reported within one sample
// instead of waiting a minute. While it stays
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
    sendHeartbeat(takeAverageSoundLevel(), lastCoValue, lastSmokeValue, lastTemperature, lastHumidity);
    lastHeartbeatAt = now;
  } else if (wifiConnected && now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
    sendHeartbeat(takeAverageSoundLevel(), lastCoValue, lastSmokeValue, lastTemperature, lastHumidity);
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
  soundLevelSum += analogValue;
  soundLevelCount++;

  Serial.print(now);
  Serial.print(",");
  Serial.println(analogValue);

  updateLoudState(now, analogValue);

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
