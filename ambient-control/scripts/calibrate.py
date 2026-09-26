#!/usr/bin/env python3
"""Trigger the sound sensor's loud-noise calibration over USB serial.

Sends the "CALIBRATE" command that main.cpp's checkSerialCommand() listens
for: the firmware samples for ~5 seconds (keep the room quiet while it
runs), sets loudThreshold to the loudest reading it saw plus a safety
margin, and persists it to flash (survives a reboot/power-off).

Usage:
    python3 scripts/calibrate.py [port] [--baud 115200]

If no port is given, auto-detects the first USB serial device that looks
like an ESP32 dev board's USB-UART bridge (CP210x/CH340/FTDI).
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

# Printed once loop() is actively running (see main.cpp's per-sample CSV
# line) - used to detect that the firmware is ready for a Serial command,
# whether or not opening the port reset the board (most USB-UART bridges on
# these dev boards toggle DTR/RTS on open, which resets the ESP32; if that
# happens, setup() can block here for up to WIFI_CONNECT_TIMEOUT_MS before
# loop() - and its Serial.available() polling - ever starts).
SAMPLE_LINE = re.compile(r"^\d+,\d+$")
CALIBRATED_LINE = re.compile(r"^CALIBRATED,(\d+),(\d+)$")

READY_TIMEOUT_S = 20  # covers a worst-case WiFi connect timeout, plus margin
CALIBRATION_TIMEOUT_S = 10  # firmware's own calibration window is 5s

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


def read_line(ser):
    raw = ser.readline()
    if not raw:
        return None
    line = raw.decode("utf-8", errors="replace").rstrip()
    if line:
        print(line)
    return line


def wait_until_ready(ser):
    print(f"Waiting for the firmware to be ready (up to {READY_TIMEOUT_S}s)...")
    deadline = time.time() + READY_TIMEOUT_S
    while time.time() < deadline:
        line = read_line(ser)
        if line and SAMPLE_LINE.match(line):
            return True
    return False


def run_calibration(ser):
    print("\nKeep the room quiet now.")
    ser.write(b"CALIBRATE\n")

    deadline = time.time() + CALIBRATION_TIMEOUT_S
    while time.time() < deadline:
        line = read_line(ser)
        if not line:
            continue
        match = CALIBRATED_LINE.match(line)
        if match:
            threshold, ambient_peak = match.groups()
            print(f"\nCalibrated: loudThreshold={threshold} (ambient peak was {ambient_peak})")
            print("Saved to flash - this survives a reboot/power-off.")
            return True
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("port", nargs="?", help="Serial device, e.g. /dev/ttyUSB0 (auto-detected if omitted)")
    parser.add_argument("--baud", type=int, default=115200, help="Baud rate (default: matches Serial.begin(115200) in main.cpp)")
    args = parser.parse_args()

    port = args.port or autodetect_port()
    if not port:
        sys.exit("No serial port found/specified. Pass one explicitly, e.g. python3 scripts/calibrate.py /dev/ttyUSB0")

    print(f"Opening {port} @ {args.baud} baud...")
    try:
        with serial.Serial(port, args.baud, timeout=1) as ser:
            # Discard whatever the OS already buffered before we opened the
            # port - without this, a device that's been running a while can
            # replay a burst of stale duplicate-looking lines before live
            # data catches up.
            time.sleep(0.2)
            ser.reset_input_buffer()

            if not wait_until_ready(ser):
                sys.exit(f"\nFirmware never looked ready within {READY_TIMEOUT_S}s - check it's flashed and running.")

            if not run_calibration(ser):
                sys.exit(f"\nNo CALIBRATED line seen within {CALIBRATION_TIMEOUT_S}s - check the sketch is the version with checkSerialCommand().")
    except serial.SerialException as err:
        sys.exit(f"Could not open {port}: {err}")


if __name__ == "__main__":
    main()
