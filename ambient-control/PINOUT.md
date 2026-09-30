# Pinout

ESP32-WROOM-32 DevKit (38-pin). Pin choices avoid the boot-strapping pins
(0/2/12/15) and the flash SPI pins (6-11) — see each sensor's own comment in
`src/main.cpp` for the reasoning specific to that pin.

| Sensor              | Sensor pin | ESP32 pin | Signal type            |
|---------------------|------------|-----------|------------------------|
| Mic amp (MAX9814)   | VDD        | 3V3       | Power                  |
|                     | GND        | GND       | Ground                 |
|                     | OUT        | GPIO34    | Analog (ADC1, input-only) |
|                     | GAIN       | 3V3       | Hardware select (tied to VDD = 40dB) |
|                     | AR         | not connected | Hardware select (floating = default attack/release) |
| MQ-7 (CO)           | VCC        | 3V3       | Power                  |
|                     | GND        | GND       | Ground                 |
|                     | AO         | GPIO35    | Analog (ADC1, input-only) |
|                     | DO         | not connected | —                  |
| MQ-2 (smoke)        | VCC        | 3V3       | Power                  |
|                     | GND        | GND       | Ground                 |
|                     | AO         | GPIO32    | Analog (ADC1, input-only) |
|                     | DO         | not connected | —                  |
| DHT22 (temp/humidity) | VCC      | 3V3       | Power                  |
|                     | DATA       | GPIO27    | Digital (single-wire)  |
|                     | GND        | GND       | Ground                 |
| Alert buzzer (active) | VCC/+   | 3V3       | Power                  |
|                     | GND/-      | GND       | Ground                 |
|                     | I/O        | GPIO26    | Digital output         |

## Notes

- **MQ-7 and MQ-2's `DO` pins are unused.** Both are on-board threshold comparators with a
  trimmer pot; only the raw analog (`AO`) signal is read, same as the mic amp's `OUT`.
- **DHT22 is digital, not analog** — it doesn't need an ADC-capable pin like the other three.
  GPIO27 is a general-purpose digital pin. Its 3-pin breakout includes the required DATA
  pull-up resistor on-board, so it needs no external components either.
- **The mic amp's `GAIN` and `AR` pins are hardware-only 3-state selects (float/GND/VDD),
  not wired to ESP32 GPIOs.** `GAIN` picks a fixed gain: floating = 60dB (most sensitive),
  tied to GND = 50dB, tied to VDD = 40dB. It's tied to VDD (3V3) here: at 60dB the chip's
  automatic gain control turned a quiet room's background noise up until it filled most of the
  ADC range, so "quiet" and "loud" read almost the same. `AR` picks the on-board AGC's
  attack/release ratio: floating is the default (least aggressive); GND and VDD select faster
  ratios. `OUT` is a raw AC-coupled audio waveform (~1.25V DC bias, up to 2Vpp), not a
  pre-detected envelope like the old 3-pin sound module — `readSoundLevel()` in `src/main.cpp`
  derives a loudness value from it by sampling for a short window and taking the RMS amplitude.
  Recalibrate (`scripts/calibrate.py`) after changing `GAIN`.
- **4-pin gas sensor breakouts (MQ-7, MQ-2) run their heaters continuously at 5V**, wired
  internally on the breakout board — no external driver circuit needed, but also no
  datasheet-correct duty-cycled heating, so their readings are a relative trend rather than a
  calibrated ppm value. See `README.md`'s "Note on MQ-7/MQ-2 accuracy" for more detail.
- **The buzzer is an active buzzer module (has its own oscillator)** — driven with a plain
  digital HIGH/LOW, no `tone()`/PWM needed. It only sounds during a declared "emergency"
  (sustained, much-higher-than-alert smoke or CO reading) — see `README.md`'s buzzer section.

See `README.md` for the full wiring rationale per sensor, the serial protocol, and calibration
instructions.
