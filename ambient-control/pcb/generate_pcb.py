#!/usr/bin/env python3
"""
Generates the ambient-control main board: single-sided, through-hole only, made by
laser-ablating paint off copper-clad pertinax (FR2) and etching it.

Outputs (next to this script):
  laser-copper-bottom.svg          what the laser burns (black = burn), already mirrored
  laser-copper-bottom-1200dpi.png  same, as a 1200 DPI raster for image-mode engraving
  assembly-top.svg                 1:1 component-side placement guide, to print on paper

Requires shapely + matplotlib (text outlines), and rsvg-convert + ImageMagick for the PNG.
All coordinates are millimetres in the component-side (top) view, origin top-left, y down.
"""
import subprocess
from pathlib import Path

from matplotlib.font_manager import FontProperties
from matplotlib.textpath import TextPath
from shapely import affinity
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union

OUT = Path(__file__).resolve().parent

W, H = 70.0, 60.0
PITCH = 2.54

# Process rules, sized for a diode laser + ferric chloride rather than a PCB fab.
ISO = 0.6            # burned isolation channel around every non-GND copper shape
SIG_W = 0.8
PWR_W = 1.5
PAD_R = 0.9          # 1.8 mm round pads for 1.0 mm drills
DRILL_DOT_R = 0.25   # burned dot at each pad centre: etches a pit that centres the drill bit
MIN_CLEARANCE = 0.4

# ESP32 DevKitC 38-pin in two 1x19 female headers. USB faces left (over the empty left side
# of the board), the antenna end overhangs the right edge. MEASURE YOUR BOARD: some 38-pin
# clones use 24.13 mm instead of 25.4 mm between rows - only ESP_ROW_SPACING changes then.
ESP_ROW_SPACING = 25.4
ESP_PIN1_X = 67.5
ESP_J2_Y = 24.0                       # row carrying 3V3, the sensor GPIOs and GND
ESP_J3_Y = ESP_J2_Y + ESP_ROW_SPACING
J2 = ["3V3", "EN", "VP", "VN", "34", "35", "32", "33", "25", "26",
      "27", "14", "12", "GND", "13", "D2", "D3", "CMD", "5V"]
J3 = ["GND", "23", "22", "TX", "RX", "21", "GND", "19", "18", "5",
      "17", "16", "4", "0", "2", "15", "D1", "D0", "CLK"]
J2_NETS = {1: "3V3", 5: "MIC", 6: "CO", 7: "SMOKE", 10: "BUZZ", 11: "DHT", 14: "GND"}
J3_NETS = {1: "GND", 7: "GND"}


def esp_x(pin):
    return ESP_PIN1_X - (pin - 1) * PITCH


# Module connectors: one 3-pin 2.54 mm column per module, rows GND / 3V3 / SIG from the top.
# Column order must match the GPIO order along J2 so the signal traces never cross.
G_Y, V_Y, S_Y = 10.0, 10.0 + PITCH, 10.0 + 2 * PITCH
# (net, label, column x, J2 pin, y where the trace bends toward its pin, module wiring)
CONNECTORS = [
    ("DHT", "DHT", esp_x(11), 11, None, "DATA"),
    ("BUZZ", "BUZ", esp_x(11) + 2 * PITCH, 10, 18.5, "I/O"),
    ("SMOKE", "MQ2", esp_x(11) + 4 * PITCH, 7, None, "AO"),
    ("CO", "MQ7", esp_x(11) + 6 * PITCH, 6, 18.5, "AO"),
    ("MIC", "MIC", esp_x(11) + 8 * PITCH, 5, 16.5, "OUT"),
]

# 100uF electrolytic across 3V3/GND near the connectors (5 mm body, 2.54 mm lead pitch).
CAP_PLUS = (38.5, 17.5)
CAP_MINUS = (CAP_PLUS[0] - PITCH, CAP_PLUS[1])
G_RAIL_X = 30.0
MOUNT_HOLES = [(3.5, 3.5), (W - 3.5, 3.5), (3.5, H - 3.5), (W - 3.5, H - 3.5)]
MOUNT_PAD_R = 2.6
MOUNT_DRILL_R = 1.6

copper = []   # (net, shapely geometry)
pads = []     # (x, y, drill diameter, square?)


def trace(net, points, width):
    copper.append((net, LineString(points).buffer(width / 2, quad_segs=16)))


def pad(net, x, y, drill=1.0, square=False):
    shape = box(x - PAD_R, y - PAD_R, x + PAD_R, y + PAD_R) if square \
        else Point(x, y).buffer(PAD_R, quad_segs=16)
    copper.append((net, shape))
    pads.append((x, y, drill, square))


# ESP32 headers
for i in range(1, 20):
    pad(J2_NETS.get(i, f"NC_J2_{i}"), esp_x(i), ESP_J2_Y)
    pad(J3_NETS.get(i, f"NC_J3_{i}"), esp_x(i), ESP_J3_Y)

# Module connectors + their signal traces
for net, _, cx, pin, bend_y, _ in CONNECTORS:
    pad("GND", cx, G_Y)
    pad("3V3", cx, V_Y)
    pad(net, cx, S_Y)
    px = esp_x(pin)
    if bend_y is None:
        trace(net, [(cx, S_Y), (px, ESP_J2_Y)], SIG_W)
    else:
        dx = cx - px
        trace(net, [(cx, S_Y), (cx, bend_y), (px, bend_y + dx), (px, ESP_J2_Y)], SIG_W)

# 3V3: cap(+) -> along the 3V3 row -> around the right end -> J2 pin 1
trace("3V3", [CAP_PLUS, (CAP_PLUS[0], V_Y), (esp_x(1), V_Y), (esp_x(1), ESP_J2_Y)], PWR_W)
# GND: along the GND row -> around the left end -> J2 pin 14, plus the cap(-) spur
trace("GND", [(CONNECTORS[-1][2], G_Y), (G_RAIL_X, G_Y), (G_RAIL_X, 21.0),
              (esp_x(14), 21.0), (esp_x(14), ESP_J2_Y)], PWR_W)
trace("GND", [CAP_MINUS, (G_RAIL_X, CAP_MINUS[1])], PWR_W)
pad("3V3", *CAP_PLUS, drill=0.8, square=True)
pad("GND", *CAP_MINUS, drill=0.8)

for mx, my in MOUNT_HOLES:
    copper.append(("GND", Point(mx, my).buffer(MOUNT_PAD_R, quad_segs=16)))

# No copper under the WROOM antenna end of the module.
ANTENNA_KEEPOUT = box(esp_x(1) - 1.8, ESP_J2_Y - 1.6, W, ESP_J3_Y + 1.6)

# Copper-side text, placed in copper-side (mirrored) coordinates so it reads correctly there.
FONT = FontProperties(family="DejaVu Sans", weight="bold")


def text_shape(s, cx, cy, size):
    tp = TextPath((0, 0), s, size=size, prop=FONT)
    shape = Polygon()
    for ring in tp.to_polygons():
        if len(ring) >= 3:
            shape = shape.symmetric_difference(Polygon(ring).buffer(0))
    shape = affinity.scale(shape, 1, -1, origin=(0, 0))
    minx, miny, maxx, maxy = shape.bounds
    return affinity.translate(shape, cx - (minx + maxx) / 2, cy - (miny + maxy) / 2)


def mirror_x(x):
    return W - x


copper_text = [text_shape(label, mirror_x(cx), 6.6, 1.6) for _, label, cx, *_ in CONNECTORS]
copper_text += [text_shape("G", mirror_x(65.3), G_Y, 1.6), text_shape("S", mirror_x(65.3), S_Y, 1.6)]
copper_text += [text_shape(s, mirror_x(9.5), y, 2.2)
                for s, y in [("AMBIENT", 30.0), ("CONTROL", 33.4), ("v1", 36.8)]]
copper_text = unary_union(copper_text)


def build():
    all_copper = unary_union([g for _, g in copper])
    non_gnd = unary_union([g for n, g in copper if n != "GND"])
    burn = unary_union([non_gnd.buffer(ISO, quad_segs=16), ANTENNA_KEEPOUT]).difference(all_copper)
    dots = unary_union([Point(x, y).buffer(DRILL_DOT_R, quad_segs=12) for x, y, *_ in pads] +
                       [Point(x, y).buffer(DRILL_DOT_R, quad_segs=12) for x, y in MOUNT_HOLES])
    mount_rings = unary_union([Point(x, y).buffer(MOUNT_DRILL_R + 0.12, quad_segs=24)
                               .difference(Point(x, y).buffer(MOUNT_DRILL_R - 0.12, quad_segs=24))
                               for x, y in MOUNT_HOLES])
    outline = box(0, 0, W, H).difference(box(0.3, 0.3, W - 0.3, H - 0.3))
    burn_top = unary_union([burn, dots, mount_rings, outline])
    burn_bottom = unary_union([affinity.scale(burn_top, -1, 1, origin=(W / 2, 0)), copper_text])
    return all_copper, burn_bottom


def drc(all_copper):
    nets = {}
    for n, g in copper:
        nets.setdefault(n, []).append(g)
    merged = {n: unary_union(gs) for n, gs in nets.items()}
    names = sorted(merged)
    worst = (99.0, None, None)
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            d = merged[a].distance(merged[b])
            if d < worst[0]:
                worst = (d, a, b)
    mirrored = affinity.scale(unary_union([g for n, g in copper]), -1, 1, origin=(W / 2, 0))
    text_gap = copper_text.distance(mirrored)
    print(f"min clearance between nets: {worst[0]:.2f} mm ({worst[1]} <-> {worst[2]})")
    print(f"copper text to nearest pad/trace: {text_gap:.2f} mm")
    ok = worst[0] >= MIN_CLEARANCE and text_gap >= 0.3
    print("DRC", "OK" if ok else "FAILED")
    return ok


def svg_path(geom):
    polys = getattr(geom, "geoms", [geom])
    d = []
    for p in polys:
        for ring in [p.exterior, *p.interiors]:
            pts = list(ring.coords)
            d.append("M" + " L".join(f"{x:.3f} {y:.3f}" for x, y in pts) + "Z")
    return " ".join(d)


def write_laser_svg(burn):
    svg = f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{W}mm" height="{H}mm" viewBox="0 0 {W} {H}">
  <title>ambient-control v1 - copper side (mirrored), black = burn</title>
  <path fill="#000" fill-rule="evenodd" d="{svg_path(burn)}"/>
</svg>
"""
    path = OUT / "laser-copper-bottom.svg"
    path.write_text(svg)
    png = OUT / "laser-copper-bottom-1200dpi.png"
    subprocess.run(["rsvg-convert", "--dpi-x", "1200", "--dpi-y", "1200", "-b", "white",
                    "-o", str(png), str(path)], check=True)
    subprocess.run(["magick", str(png), "-colorspace", "Gray", "-threshold", "50%",
                    "-units", "PixelsPerInch", "-density", "1200", str(png)], check=True)


def write_assembly_svg(all_copper):
    m = 10.0
    cw, ch = W + 2 * m, H + m + 50
    e = []
    t = lambda x, y, s, size=1.6, anchor="middle", extra="": e.append(
        f'<text x="{x:.2f}" y="{y:.2f}" font-size="{size}" text-anchor="{anchor}" {extra}>{s}</text>')
    e.append(f'<rect x="0" y="0" width="{W}" height="{H}" fill="#e9d6aa" stroke="#444" stroke-width="0.3"/>')
    e.append(f'<path d="{svg_path(all_copper)}" fill="#c87533" fill-opacity="0.28" fill-rule="evenodd"/>')
    # ESP32 module outline (approximate body; the pins are what matter)
    x0, x1 = esp_x(19) - 4.4, esp_x(1) + 5.5
    y0, y1 = ESP_J2_Y - 1.25, ESP_J3_Y + 1.25
    e.append(f'<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" fill="none" '
             f'stroke="#1f4e9c" stroke-width="0.35" stroke-dasharray="1.2 0.8"/>')
    e.append(f'<rect x="{esp_x(1) - 1.8}" y="{y0}" width="{x1 - esp_x(1) + 1.8}" height="{y1 - y0}" '
             f'fill="#1f4e9c" fill-opacity="0.12"/>')
    t(esp_x(10), (y0 + y1) / 2, "ESP32 DevKit 38-pin (component side up)", 2.0, extra='fill="#1f4e9c"')
    t(esp_x(10), (y0 + y1) / 2 + 3, "USB-C ← this end · antenna → this end", 1.6, extra='fill="#1f4e9c"')
    for row_y, names in [(ESP_J2_Y, J2), (ESP_J3_Y, J3)]:
        e.append(f'<rect x="{esp_x(19) - 1.27}" y="{row_y - 1.27}" width="{18 * PITCH + 2.54}" '
                 f'height="2.54" fill="none" stroke="#000" stroke-width="0.25"/>')
        ly = row_y + 2.0 if row_y == ESP_J2_Y else row_y - 2.0
        for i, nm in enumerate(names, start=1):
            used = (row_y == ESP_J2_Y and i in J2_NETS)
            t(esp_x(i) + 0.4, ly, nm, 1.05, "start" if row_y == ESP_J2_Y else "end",
              f'transform="rotate(90 {esp_x(i) + 0.4:.2f} {ly:.2f})" '
              f'fill="{"#b00" if used else "#555"}" font-weight="{"bold" if used else "normal"}"')
    for _, label, cx, *_ in CONNECTORS:
        e.append(f'<rect x="{cx - 1.27}" y="{G_Y - 1.27}" width="2.54" height="{3 * PITCH}" '
                 f'fill="none" stroke="#000" stroke-width="0.25"/>')
        t(cx, G_Y - 3.0, label, 1.4, extra='font-weight="bold"')
    for nm, y in [("GND", G_Y), ("3V3", V_Y), ("SIG", S_Y)]:
        t(CONNECTORS[-1][2] + 2.0, y + 0.5, nm, 1.2, "start")
    cx = (CAP_PLUS[0] + CAP_MINUS[0]) / 2
    e.append(f'<circle cx="{cx}" cy="{CAP_PLUS[1]}" r="2.5" fill="none" stroke="#000" stroke-width="0.25"/>')
    t(CAP_PLUS[0] + 0.2, CAP_PLUS[1] - 1.5, "+", 1.8, extra='font-weight="bold"')
    t(cx, CAP_PLUS[1] + 4.3, "100µF", 1.3)
    for x, y, drill, square in pads:
        e.append(f'<circle cx="{x}" cy="{y}" r="{drill / 2}" fill="#fff" stroke="#000" stroke-width="0.15"/>')
    for x, y in MOUNT_HOLES:
        e.append(f'<circle cx="{x}" cy="{y}" r="{MOUNT_DRILL_R}" fill="#fff" stroke="#000" stroke-width="0.2"/>')
    # Scale check + notes below the board
    sy = H + 6
    e.append(f'<path d="M0 {sy} H50 M0 {sy - 1} V{sy + 1} M50 {sy - 1} V{sy + 1}" stroke="#000" stroke-width="0.3"/>')
    t(25, sy - 1.5, "50 mm - measure after printing (print at 100%, no scaling)", 1.8)
    notes = [
        "TOP (component) side. Copper is underneath, shown faintly.",
        "Each module: 3-pin Dupont column, top→bottom = GND / 3V3 / SIG.",
        "DHT (DHT22): VCC→3V3, DATA→SIG.",
        "BUZ (buzzer): VCC/+→3V3, GND/-→GND, I/O→SIG.",
        "MQ2 / MQ7: VCC→3V3, AO→SIG, DO unconnected.",
        "MIC (MAX9814): VDD→3V3, OUT→SIG, AR floating.",
        "   Bridge GAIN to VDD on the mic module itself (40 dB, as in PINOUT.md).",
        "Drills: 1.0 mm headers · 0.8 mm cap · 3.2 mm mounting holes.",
        "Red pin names = the ones this board uses. Check them against your",
        "ESP32's silkscreen before soldering the female headers.",
    ]
    for i, line in enumerate(notes):
        t(0, sy + 6 + i * 3.4, line, 2.1, "start")
    svg = f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{cw}mm" height="{ch}mm" viewBox="{-m} {-m} {cw} {ch}"
     font-family="DejaVu Sans, Arial, sans-serif">
  <title>ambient-control v1 - assembly (top view, 1:1)</title>
  <rect x="{-m}" y="{-m}" width="{cw}" height="{ch}" fill="#fff"/>
  {chr(10).join("  " + x for x in e)}
</svg>
"""
    (OUT / "assembly-top.svg").write_text(svg)


if __name__ == "__main__":
    all_copper, burn = build()
    ok = drc(all_copper)
    write_laser_svg(burn)
    write_assembly_svg(all_copper)
    raise SystemExit(0 if ok else 1)
