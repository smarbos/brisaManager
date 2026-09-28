# Pinout

ESP32-WROOM-32 DevKit (38-pin). Pin choices avoid the boot-strapping pins
(0/2/12/15) and the flash SPI pins (6-11) — see each sensor's own comment in
`src/main.cpp` for the reasoning specific to that pin.

| Sensor              | Sensor pin | ESP32 pin | Signal type            |
|---------------------|------------|-----------|------------------------|
| Sound sensor        | VCC        | 3V3       | Power                  |
|                     | GND        | GND       | Ground                 |
|                     | OUT        | GPIO34    | Analog (ADC1, input-only) |
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
  trimmer pot; only the raw analog (`AO`) signal is read, same as the sound sensor.
- **DHT22 is digital, not analog** — it doesn't need an ADC-capable pin like the other three.
  GPIO27 is a general-purpose digital pin.
- **3-pin sensor breakouts (sound, DHT22) need no external components.** The DHT22's 3-pin
  breakout includes the required DATA pull-up resistor on-board.
- **4-pin gas sensor breakouts (MQ-7, MQ-2) run their heaters continuously at 5V**, wired
  internally on the breakout board — no external driver circuit needed, but also no
  datasheet-correct duty-cycled heating, so their readings are a relative trend rather than a
  calibrated ppm value. See `README.md`'s "Note on MQ-7/MQ-2 accuracy" for more detail.
- **The buzzer is an active buzzer module (has its own oscillator)** — driven with a plain
  digital HIGH/LOW, no `tone()`/PWM needed. It only sounds during a declared "emergency"
  (sustained, much-higher-than-alert smoke or CO reading) — see `README.md`'s buzzer section.

See `README.md` for the full wiring rationale per sensor, the serial protocol, and calibration
instructions.
