#!/usr/bin/env python3
"""Live sound-level meter over USB serial - no calibration, just raw values.

Streams the sensor's raw analog readings (already printed by main.cpp every
100ms) as a live bar, plus prints any EVENT/ALERT/POST lines inline so you
can see exactly what value crossed the current threshold. Make different
sounds near the sensor - claps, talking, background noise - and watch what
numbers they produce to help pick a good threshold, then set it with
scripts/calibrate.py (or just eyeball it and set loudThreshold in main.cpp
directly).

Usage:
    python3 scripts/meter.py [port] [--baud 115200]

If no port is given, auto-detects the first USB serial device that looks
like an ESP32 dev board's USB-UART bridge (CP210x/CH340/FTDI). Ctrl+C to
stop.
"""
import argparse
import re
import sys
import time

try:
    import serial
    from serial.tools import list_ports
except ImportError:
    sys.exit("pyserial is required: pip install pyserial")

SAMPLE_LINE = re.compile(r"^\d+,(\d+)$")
ADC_MAX = 4095  # ESP32 analogRead() range
BAR_WIDTH = 50

LIKELY_DESCRIPTIONS = ("cp210", "ch340", "ch910", "ftdi", "usb-serial", "usb2serial")


def autodetect_port():
    candidates = list(list_ports.comports())
    for port in candidates:
        description = f"{port.description} {port.manufacturer or ''}".lower()
        if any(hint in description for hint in LIKELY_DESCRIPTIONS):
            return port.device
    if len(candidates) == 1:
        return candidates[0].device
    if candidates:
        print("Multiple serial ports found, none obviously an ESP32:", file=sys.stderr)
        for port in candidates:
            print(f"  {port.device}  ({port.description})", file=sys.stderr)
    return None


def render_bar(value):
    filled = min(BAR_WIDTH, int(value / ADC_MAX * BAR_WIDTH))
    return "#" * filled + "-" * (BAR_WIDTH - filled)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("port", nargs="?", help="Serial device, e.g. /dev/ttyUSB0 (auto-detected if omitted)")
    parser.add_argument("--baud", type=int, default=115200, help="Baud rate (default: matches Serial.begin(115200) in main.cpp)")
    args = parser.parse_args()

    port = args.port or autodetect_port()
    if not port:
        sys.exit("No serial port found/specified. Pass one explicitly, e.g. python3 scripts/meter.py /dev/ttyUSB0")

    print(f"Opening {port} @ {args.baud} baud...")
    print("Make different sounds near the sensor and watch the raw values below.")
    print("Ctrl+C to stop.\n")

    peak = 0
    try:
        with serial.Serial(port, args.baud, timeout=1) as ser:
            # Discard whatever the OS already buffered before we opened the
            # port - without this, a device that's been running a while can
            # replay a burst of stale duplicate-looking lines before live
            # data catches up.
            time.sleep(0.2)
            ser.reset_input_buffer()

            while True:
                raw = ser.readline()
                if not raw:
                    continue
                line = raw.decode("utf-8", errors="replace").rstrip()
                if not line:
                    continue

                match = SAMPLE_LINE.match(line)
                if match:
                    value = int(match.group(1))
                    peak = max(peak, value)
                    bar = render_bar(value)
                    sys.stdout.write(f"\r{value:5d} [{bar}] peak={peak:5d}")
                    sys.stdout.flush()
                else:
                    # EVENT / ALERT / POST / boot lines - print on their own line so
                    # they stand out from the live-updating meter above.
                    print(f"\n{line}")
    except KeyboardInterrupt:
        print(f"\n\nStopped. Highest raw value seen: {peak}")
    except serial.SerialException as err:
        sys.exit(f"Could not open {port}: {err}")


if __name__ == "__main__":
    main()
