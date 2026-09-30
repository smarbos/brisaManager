// Standalone bring-up sketch for the mic amp (MAX9814) wiring - no WiFi, no other sensors, no
// alert/threshold logic, just the sound reading itself. Build and flash with:
//
//   pio run -e sound-sensor-test --target upload --upload-port /dev/ttyUSB0
//
// Then open the Serial Monitor at 115200 baud. Flash the real firmware back with the default
// `esp32dev` environment when done (see the main README).
#include <Arduino.h>

const int SOUND_SENSOR_PIN = 34; // MAX9814 OUT - see ../../PINOUT.md

// Same window and RMS calculation the real firmware's readSoundLevel() uses (src/main.cpp).
const unsigned long WINDOW_MS = 50;

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("Sound sensor bring-up test - GPIO34 only, nothing else.");
  Serial.println("raw,peakToPeak,rms");
  Serial.println("raw: one instantaneous ADC sample (should sit near ~1550, the ADC count for the datasheet's ~1.25V DC bias, when quiet).");
  Serial.println("peakToPeak: max-min over a 50ms window, for comparison only - a single ADC spike inflates it.");
  Serial.println("rms: RMS amplitude over the same window - the actual loudness value the real firmware uses.");
}

void loop() {
  int minValue = 4095;
  int maxValue = 0;
  int lastRaw = 0;
  int64_t sum = 0;
  int64_t sumOfSquares = 0;
  int32_t count = 0;

  unsigned long start = millis();
  while (millis() - start < WINDOW_MS) {
    lastRaw = analogRead(SOUND_SENSOR_PIN);
    if (lastRaw < minValue) minValue = lastRaw;
    if (lastRaw > maxValue) maxValue = lastRaw;
    sum += lastRaw;
    sumOfSquares += (int32_t)lastRaw * lastRaw;
    count++;
  }

  double mean = (double)sum / count;
  double variance = (double)sumOfSquares / count - mean * mean;
  int rms = variance > 0 ? (int)lround(sqrt(variance)) : 0;

  Serial.print(lastRaw);
  Serial.print(",");
  Serial.print(maxValue - minValue);
  Serial.print(",");
  Serial.println(rms);
}
