#!/usr/bin/env python3
"""Trigger the alert buzzer's one-second test beep over USB serial.

Sends the "TEST_BUZZER" command that main.cpp's checkSerialCommand() listens
for: the firmware beeps the buzzer (GPIO26) for exactly one second, then
restores it to whatever the current emergency state says it should be, and
prints a confirmation line. Useful for confirming the buzzer itself is wired
correctly without waiting for a real sustained smoke/CO emergency (or for the
remote "Probar sirena" trigger's up-to-5-minute heartbeat delay).

Usage:
    python3 scripts/test_buzzer.py [port] [--baud 115200]

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
TEST_BUZZER_LINE = re.compile(r"^TEST_BUZZER: beeping for 1 second\.$")

READY_TIMEOUT_S = 20  # covers a worst-case WiFi connect timeout, plus margin
TEST_BUZZER_TIMEOUT_S = 5  # firmware's own beep only lasts 1s

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


def run_test_buzzer(ser):
    print("\nTriggering the buzzer test - it should beep for one second now.")
    ser.write(b"TEST_BUZZER\n")

    deadline = time.time() + TEST_BUZZER_TIMEOUT_S
    while time.time() < deadline:
        line = read_line(ser)
        if not line:
            continue
        if TEST_BUZZER_LINE.match(line):
            print("\nConfirmed: the firmware ran the buzzer test.")
            return True
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("port", nargs="?", help="Serial device, e.g. /dev/ttyUSB0 (auto-detected if omitted)")
    parser.add_argument("--baud", type=int, default=115200, help="Baud rate (default: matches Serial.begin(115200) in main.cpp)")
    args = parser.parse_args()

    port = args.port or autodetect_port()
    if not port:
        sys.exit("No serial port found/specified. Pass one explicitly, e.g. python3 scripts/test_buzzer.py /dev/ttyUSB0")

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

            if not run_test_buzzer(ser):
                sys.exit(f"\nNo TEST_BUZZER confirmation seen within {TEST_BUZZER_TIMEOUT_S}s - check the sketch is the version with the buzzer feature.")
    except serial.SerialException as err:
        sys.exit(f"Could not open {port}: {err}")


if __name__ == "__main__":
    main()
