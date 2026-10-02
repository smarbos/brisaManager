# Main board (single-sided, through-hole)

70 × 60 mm board made on painted copper-clad pertinax: a diode laser burns the paint off,
then the exposed copper is etched away. Wiring matches `../PINOUT.md`.

| File | Use |
|------|-----|
| `laser-copper-bottom.svg` | Laser file. Black = burn. Already mirrored (it's the copper side). |
| `laser-copper-bottom-1200dpi.png` | Same as a 1200 DPI bitmap, for image-mode engraving (70 × 60 mm). |
| `assembly-top.svg` | Component-side guide. Print at 100% and check the 50 mm bar. |
| `generate_pcb.py` | Regenerates all three. Edit the constants at the top, then run it. |

## Parts

- 2 × 1x19 female header, 2.54 mm (ESP32 DevKit 38-pin socket)
- 5 × 1x3 male header, 2.54 mm (one per module)
- 1 × 100 µF ≥6.3 V electrolytic, 5 mm body (optional bulk cap on 3V3)
- 4 × M3 screws + standoffs

## Before burning

1. **Check the DevKit row spacing.** Most 38-pin boards are 25.4 mm (1.0") between rows;
   some clones are 24.13 mm. If yours differs, change `ESP_ROW_SPACING` and rerun.
2. Print `assembly-top.svg` on paper and lay the DevKit on it. The red pin names must
   line up with your board's silkscreen.

## Process notes

- The leftover copper is GND. Only 0.6 mm channels are burned around everything else,
  which keeps laser time short and uses up less etchant.
- A small dot is burned at each pad centre. It etches into a pit that keeps the drill bit
  centred. Drills: 1.0 mm for headers, 0.8 mm for the cap, 3.2 mm for mounting holes.
- The copper under the WiFi antenna end is cleared on purpose.
- Regenerate: `pip install shapely matplotlib`, then `python3 generate_pcb.py`. It needs
  `rsvg-convert` and ImageMagick for the PNG. It prints a clearance check (minimum 0.4 mm).
