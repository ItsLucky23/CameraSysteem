"""
Calibrate the continuous-rotation pan servo's neutral point.

Two modes:

  --pot   (default)
    Hold the STOP signal (1.5ms pulse) indefinitely. Use this while turning
    the small trim pot on the servo body with a small screwdriver until the
    servo stops moving. When the servo is stationary you've found neutral.
    Press Enter to exit.

  --software
    If your servo has no pot, or you can't get it to stop with the pot,
    use this mode. The script sweeps small offsets around 0 and asks you
    which one made the servo stop. The result is an offset value you put
    in pi_zero_2w/.env as PAN_SERVO_NEUTRAL_ANGLE_OFFSET=<value> so the
    adapter compensates for the mis-calibration in software.

Pre-flight (same as test_pan_servo.py):
  - 10 kOhm pull-down between GPIO 12 and GND
  - External 5V on servo VCC, common ground tied
  - camera_node stopped: sudo pkill -f run.py
  - Run from venv:
        cd /var/www/CameraSysteem/pi_zero_2w
        source .venv/bin/activate
        python3 calibrate_pan_servo.py
        # or:
        python3 calibrate_pan_servo.py --software
"""
from __future__ import annotations

import argparse
import sys
import time

try:
    from gpiozero import AngularServo
except ImportError:
    print("ERROR: gpiozero not installed. Activate the venv?")
    sys.exit(1)


PAN_GPIO_PIN = 12
MIN_PULSE_WIDTH = 1.0 / 1000
MAX_PULSE_WIDTH = 2.0 / 1000
FRAME_WIDTH = 20 / 1000


def make_servo() -> AngularServo:
    return AngularServo(
        PAN_GPIO_PIN,
        min_angle=-90,
        max_angle=90,
        initial_angle=0,
        min_pulse_width=MIN_PULSE_WIDTH,
        max_pulse_width=MAX_PULSE_WIDTH,
        frame_width=FRAME_WIDTH,
    )


def mode_pot(servo: AngularServo) -> int:
    print()
    print("POT CALIBRATION MODE")
    print("=" * 60)
    print("Holding STOP signal (1.5ms pulse) on GPIO 12 indefinitely.")
    print()
    print("On the servo body, find the small recessed screw — it's usually")
    print("on the side opposite the wires, behind a tiny circular opening.")
    print("Use a small flathead or Phillips screwdriver.")
    print()
    print("Turn the screw VERY slowly (a quarter turn at a time):")
    print("  - If the servo is spinning forward, turn one direction.")
    print("  - If still spinning forward, keep going same direction.")
    print("  - If it starts spinning the other way, you went past neutral —")
    print("    turn back slowly until it stops.")
    print()
    print("When the servo is COMPLETELY STILL with no humming, press Enter.")
    print("If you can't find a pot or can't get it to stop, press Ctrl+C and")
    print("re-run with --software flag.")
    print()
    servo.angle = 0
    try:
        input("Press Enter when the servo is fully stationary > ")
    except (EOFError, KeyboardInterrupt):
        print("\nAborted.")
        return 1
    print("Calibration complete. Servo neutral pot is now physically tuned.")
    print("No code change needed — restart camera_node and the press-and-hold")
    print("pan buttons will stop when you release them.")
    return 0


def mode_software(servo: AngularServo) -> int:
    print()
    print("SOFTWARE CALIBRATION MODE")
    print("=" * 60)
    print("I'll sweep small offsets around 0 and you tell me which one")
    print("stopped the servo. The angle that stops it is your offset.")
    print()
    print("Each step holds for 3 seconds. Watch the servo. After all steps")
    print("I'll ask which one looked most stationary.")
    print()
    try:
        input("Ready? Press Enter > ")
    except (EOFError, KeyboardInterrupt):
        print("\nAborted.")
        return 1

    # Sweep -10 to +10 in 0.5 degree steps. AngularServo accepts floats.
    candidates = [round(x * 0.5, 1) for x in range(-20, 21)]
    print()
    for offset in candidates:
        print(f"  offset = {offset:+.1f}°  (pulse ~{1.5 + offset / 90 * 0.5:.3f}ms)")
        servo.angle = offset
        time.sleep(3.0)
        # Brief stop between samples so the human can clearly see the change.
        # If we don't stop, a smooth ramp can mask which sample was neutral.

    servo.angle = 0
    print()
    print("Sweep done. Which offset stopped the servo most cleanly?")
    print("Type a number from the list above (e.g. -2.5, 0, 1.5), or 'q' to")
    print("abort if none looked right.")
    while True:
        try:
            raw = input("offset> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nAborted.")
            return 1
        if raw.lower() in ("q", "quit", "exit"):
            return 1
        try:
            chosen = float(raw)
        except ValueError:
            print("  not a number")
            continue
        if chosen < -10 or chosen > 10:
            print("  must be in the swept range (-10..+10)")
            continue
        print()
        print(f"Selected offset: {chosen:+.1f}°")
        print()
        print("Add this line to /var/www/CameraSysteem/pi_zero_2w/.env:")
        print(f"  PAN_SERVO_NEUTRAL_ANGLE_OFFSET={chosen}")
        print()
        print("Then restart camera_node. The adapter will subtract this offset")
        print("when commanding STOP so the servo actually stops.")
        return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--software",
        action="store_true",
        help="Software offset mode (use if servo has no pot)",
    )
    args = parser.parse_args()

    print(f"Initializing servo on BCM {PAN_GPIO_PIN}")
    servo = make_servo()
    try:
        if args.software:
            return mode_software(servo)
        return mode_pot(servo)
    finally:
        try:
            servo.detach()
            servo.close()
        except Exception:  # noqa: BLE001
            pass


if __name__ == "__main__":
    sys.exit(main())
