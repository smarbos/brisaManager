#!/usr/bin/env python3
"""Trigger the sound sensor's loud-noise calibration over USB serial.

Sends the "CALIBRATE" command that main.cpp's checkSerialCommand() listens
for: the firmware samples for ~5 seconds (keep the room quiet while it
runs), sets loudThreshold to 3x the 99th-percentile quiet reading (at least
+50), and persists it to flash (survives a reboot/power-off).

With --threshold N, skips measuring and sets loudThreshold to N instead
(the firmware's "SET_LOUD_THRESHOLD N" command) - for when the calibrated
value flags the room's normal everyday volume as loud. Also saved to flash.

Both commands require the firmware's SERIAL_ADMIN_PIN, read from
include/secrets.h (override with --pin or the AMBIENT_SERIAL_PIN env var).

Usage:
    python3 scripts/calibrate.py [port] [--baud 115200] [--threshold N] [--pin PIN]

If no port is given, auto-detects the first USB serial device that looks
like an ESP32 dev board's USB-UART bridge (CP210x/CH340/FTDI).
"""
import argparse
import os
import re
import sys
import time

try:
    import serial
    from serial.tools import list_ports
except ImportError:
    # This host may have no pip at all (common on minimal/managed Linux setups), but
    # PlatformIO bundles pyserial for esptool's own use - and anyone running this script
    # already has PlatformIO installed, to flash the firmware in the first place. Re-exec
    # with its Python before giving up.
    # Compare by path, not by realpath() - PlatformIO's venv identifies itself by the
    # directory its interpreter is invoked FROM (a pyvenv.cfg next to it), not by what that
    # interpreter binary resolves to; a venv built on a symlinked system Python resolves to
    # the exact same realpath as the system Python itself, which would make this comparison
    # always look "equal" and never re-exec.
    platformio_python = os.path.expanduser("~/.platformio/penv/bin/python3")
    if os.path.exists(platformio_python) and os.path.abspath(sys.executable) != os.path.abspath(platformio_python):
        os.execv(platformio_python, [platformio_python, __file__, *sys.argv[1:]])
    sys.exit("pyserial is required: pip install pyserial (or install PlatformIO, which bundles it)")

# Printed once loop() is actively running (see main.cpp's per-sample CSV
# line) - used to detect that the firmware is ready for a Serial command,
# whether or not opening the port reset the board (most USB-UART bridges on
# these dev boards toggle DTR/RTS on open, which resets the ESP32; if that
# happens, setup() can block here for up to WIFI_CONNECT_TIMEOUT_MS before
# loop() - and its Serial.available() polling - ever starts).
SAMPLE_LINE = re.compile(r"^\d+,\d+$")
CALIBRATED_LINE = re.compile(r"^CALIBRATED,(\d+),(\d+)$")
THRESHOLD_SET_LINE = re.compile(r"^LOUD_THRESHOLD_SET,(\d+)$")
PIN_FAILURE_LINES = ("PIN_REJECTED", "PIN_LOCKED", "PIN_REQUIRED")

SECRETS_H = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "include", "secrets.h")
SECRETS_PIN = re.compile(r'SERIAL_ADMIN_PIN\s*=\s*"([^"]*)"')

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


def read_pin_from_secrets():
    try:
        with open(SECRETS_H) as f:
            match = SECRETS_PIN.search(f.read())
    except OSError:
        return None
    return match.group(1) if match else None


def check_pin_failure(line):
    if line in PIN_FAILURE_LINES:
        sys.exit(f"\nFirmware refused the command ({line}) - check SERIAL_ADMIN_PIN matches the flashed build.")


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


def run_calibration(ser, pin):
    print("\nKeep the room quiet now.")
    ser.write(f"CALIBRATE {pin}\n".encode())

    deadline = time.time() + CALIBRATION_TIMEOUT_S
    while time.time() < deadline:
        line = read_line(ser)
        if not line:
            continue
        check_pin_failure(line)
        match = CALIBRATED_LINE.match(line)
        if match:
            threshold, ambient_level = match.groups()
            print(f"\nCalibrated: loudThreshold={threshold} (quiet-room 99th percentile was {ambient_level})")
            print("Saved to flash - this survives a reboot/power-off.")
            return True
    return False


def set_threshold(ser, threshold, pin):
    ser.write(f"SET_LOUD_THRESHOLD {threshold} {pin}\n".encode())

    deadline = time.time() + CALIBRATION_TIMEOUT_S
    while time.time() < deadline:
        line = read_line(ser)
        if line:
            check_pin_failure(line)
        if line and THRESHOLD_SET_LINE.match(line):
            print(f"\nSet: loudThreshold={threshold}")
            print("Saved to flash - this survives a reboot/power-off.")
            return True
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("port", nargs="?", help="Serial device, e.g. /dev/ttyUSB0 (auto-detected if omitted)")
    parser.add_argument("--baud", type=int, default=115200, help="Baud rate (default: matches Serial.begin(115200) in main.cpp)")
    parser.add_argument("--threshold", type=int, help="Set loudThreshold to this value instead of calibrating")
    parser.add_argument("--pin", help="SERIAL_ADMIN_PIN (default: AMBIENT_SERIAL_PIN env var, then include/secrets.h)")
    args = parser.parse_args()

    pin = args.pin or os.environ.get("AMBIENT_SERIAL_PIN") or read_pin_from_secrets()
    if not pin:
        sys.exit("No SERIAL_ADMIN_PIN found - pass --pin, set AMBIENT_SERIAL_PIN, or define it in include/secrets.h")

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

            if args.threshold is not None:
                if not set_threshold(ser, args.threshold, pin):
                    sys.exit(f"\nNo LOUD_THRESHOLD_SET line seen within {CALIBRATION_TIMEOUT_S}s - check the firmware has the SET_LOUD_THRESHOLD command.")
                return

            if not run_calibration(ser, pin):
                sys.exit(f"\nNo CALIBRATED line seen within {CALIBRATION_TIMEOUT_S}s - check the sketch is the version with checkSerialCommand().")
    except serial.SerialException as err:
        sys.exit(f"Could not open {port}: {err}")


if __name__ == "__main__":
    main()
