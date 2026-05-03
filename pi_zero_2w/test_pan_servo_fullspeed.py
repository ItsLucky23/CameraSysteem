"""
One-shot full-speed test. Sends 2.0ms pulse (full forward) for 2 seconds,
then 1.0ms (full reverse) for 2 seconds, then stops. Maximum signal so we
can rule out PWM jitter as the reason the servo doesn't respond.

Pre-flight: as in test_pan_servo.py — pull-down wired, external 5V power,
common ground, camera_node stopped, kill switch ready.

    sudo pkill -f run.py
    cd /var/www/CameraSysteem/pi_zero_2w
    source .venv/bin/activate
    python3 test_pan_servo_fullspeed.py
"""
from __future__ import annotations

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


def main() -> int:
    print(f"Initializing servo on BCM {PAN_GPIO_PIN}")
    servo = AngularServo(
        PAN_GPIO_PIN,
        min_angle=-90,
        max_angle=90,
        initial_angle=0,
        min_pulse_width=MIN_PULSE_WIDTH,
        max_pulse_width=MAX_PULSE_WIDTH,
        frame_width=FRAME_WIDTH,
    )
    try:
        print("STOP for 2s...")
        servo.angle = 0
        time.sleep(2.0)

        print("FULL FORWARD (angle=+90, pulse=2.0ms) for 2s — watch the servo")
        servo.angle = 90
        time.sleep(2.0)

        print("STOP for 1s")
        servo.angle = 0
        time.sleep(1.0)

        print("FULL REVERSE (angle=-90, pulse=1.0ms) for 2s — watch the servo")
        servo.angle = -90
        time.sleep(2.0)

        print("STOP")
        servo.angle = 0
        time.sleep(1.0)

        print("Done. Did you see ANY motion at any point? Even a twitch?")
    finally:
        try:
            servo.detach()
            servo.close()
        except Exception:  # noqa: BLE001
            pass

    return 0


if __name__ == "__main__":
    sys.exit(main())
