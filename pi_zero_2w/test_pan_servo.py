"""
Standalone hardware test for the pan servo on GPIO 12 (physical pin 32).

Run on the Pi Zero with the camera node service stopped:
    sudo systemctl stop camera_node    # or: pkill -f run.py
    cd /var/www/CameraSysteem/pi_zero_2w
    source .venv/bin/activate
    python3 test_pan_servo.py

What it does:
  1. Initializes the SG90 with SG90-specific pulse widths (0.5-2.5ms range)
     instead of the gpiozero defaults (1-2ms), which gives the servo its
     full physical sweep instead of half of it.
  2. Sweeps a known sequence so you can watch the horn move.
  3. Drops to an interactive prompt so you can type angles manually.

If this script can move the servo but the cameras-page buttons can't, the
problem is in the camera_node command pipeline (not the hardware). If this
script can't move the servo either, the problem is wiring / power / pin.
"""
from __future__ import annotations

import sys
import time

try:
    from gpiozero import AngularServo
except ImportError:
    print("ERROR: gpiozero not installed. Did you activate the venv?")
    sys.exit(1)


PAN_GPIO_PIN = 12  # BCM 12 = physical pin 32

# SG90 spec: 0.5ms (-90°) to 2.5ms (+90°), 20ms frame (50Hz).
# gpiozero's defaults are 1ms/2ms which only sweeps half the SG90's range
# and produces sluggish/incomplete movement.
MIN_PULSE_WIDTH = 0.5 / 1000  # 0.5ms
MAX_PULSE_WIDTH = 2.5 / 1000  # 2.5ms
FRAME_WIDTH = 20 / 1000       # 20ms (50Hz)


def sweep(servo: AngularServo) -> None:
    print()
    print("Sweep test — watch the horn:")
    moves = [
        (0,    "  center (0°)"),
        (-45,  "  left 45°"),
        (-90,  "  left 90° (full left)"),
        (0,    "  back to center"),
        (45,   "  right 45°"),
        (90,   "  right 90° (full right)"),
        (0,    "  back to center"),
    ]
    for angle, label in moves:
        print(f"{label}", flush=True)
        servo.angle = angle
        time.sleep(1.0)
    print("Sweep complete.\n")


def interactive(servo: AngularServo) -> None:
    print("Interactive mode. Type an angle from -90 to 90, or 'q' to quit.")
    while True:
        try:
            raw = input("angle> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return
        if raw.lower() in ("q", "quit", "exit"):
            return
        if not raw:
            continue
        try:
            angle = float(raw)
        except ValueError:
            print("  not a number")
            continue
        if angle < -90 or angle > 90:
            print("  out of range; clamping to [-90, 90]")
            angle = max(-90.0, min(90.0, angle))
        print(f"  -> moving to {angle}°")
        servo.angle = angle


def main() -> int:
    print(f"Initializing SG90 on BCM GPIO {PAN_GPIO_PIN} (physical pin 32)")
    print(f"  pulse range: {MIN_PULSE_WIDTH * 1000}ms - {MAX_PULSE_WIDTH * 1000}ms")
    print(f"  frame rate:  {1 / FRAME_WIDTH}Hz")
    print()

    try:
        servo = AngularServo(
            PAN_GPIO_PIN,
            min_angle=-90,
            max_angle=90,
            initial_angle=0,
            min_pulse_width=MIN_PULSE_WIDTH,
            max_pulse_width=MAX_PULSE_WIDTH,
            frame_width=FRAME_WIDTH,
        )
    except Exception as error:  # noqa: BLE001
        print(f"FAILED to init servo: {error}")
        print("Likely causes:")
        print("  - GPIO already claimed by another process (camera_node still running?)")
        print("  - lgpio not installed (see pi_zero_2w/README.md setup section)")
        print("  - wrong pin number")
        return 1

    print("Servo initialized. Letting it settle at 0° for 1s...")
    time.sleep(1.0)

    try:
        sweep(servo)
        interactive(servo)
    finally:
        print("Detaching and closing servo (LED stays where it is, no more PWM).")
        try:
            servo.detach()
        except Exception:  # noqa: BLE001
            pass
        try:
            servo.close()
        except Exception:  # noqa: BLE001
            pass

    return 0


if __name__ == "__main__":
    sys.exit(main())
