"""
Raw-pulse-width diagnostic for the pan servo.

Use this when calibrate_pan_servo.py couldn't find a neutral inside the
1.0-2.0 ms range. This script lets you type pulse widths directly in
milliseconds across a much wider range (0.4 ms to 2.6 ms), so you can
hunt for the value that actually stops your specific servo.

How it works under the hood: we drive GPIO 12 with raw PWM at 50 Hz and
manually compute the duty cycle from the pulse width you type. No
AngularServo abstraction — what you type is what the wire sees.

Pre-flight (same as the other test scripts):
  - 10 kOhm pull-down between GPIO 12 and GND
  - External 5V on servo VCC, common ground tied
  - camera_node stopped: sudo pkill -f run.py
  - Run from venv:
        cd /var/www/CameraSysteem/pi_zero_2w
        source .venv/bin/activate
        python3 diag_pan_servo.py

Suggested hunt strategy:
  1. Start with 1.5 (typical neutral). Note direction + speed.
  2. If spinning forward, try 1.4, then 1.3, then 1.2, etc.
  3. If spinning reverse, try 1.6, then 1.7, then 1.8, etc.
  4. The pulse that stops the servo is the true neutral.
  5. If you sweep the full 0.4-2.6 ms range and NOTHING stops it, the
     servo's controller is defective. Replace the servo.
"""
from __future__ import annotations

import sys
import time

try:
    from gpiozero import PWMOutputDevice
except ImportError:
    print("ERROR: gpiozero not installed. Activate the venv?")
    sys.exit(1)


PAN_GPIO_PIN = 12
PWM_FREQUENCY_HZ = 50  # Standard servo control rate; period = 20ms
FRAME_PERIOD_MS = 1000.0 / PWM_FREQUENCY_HZ  # = 20.0


def pulse_to_duty_cycle(pulse_ms: float) -> float:
    """Convert pulse width (ms) to PWMOutputDevice duty cycle (0.0..1.0).

    duty = pulse_width / frame_period.
    Example: 1.5ms / 20ms = 0.075 (servo neutral is 7.5% duty cycle at 50Hz).
    """
    duty = pulse_ms / FRAME_PERIOD_MS
    # Safety clamp — refuse to drive outside a sane window even on typo.
    return max(0.01, min(0.20, duty))


def main() -> int:
    print(f"Initializing PWM on BCM {PAN_GPIO_PIN} at {PWM_FREQUENCY_HZ} Hz")
    print(f"Period = {FRAME_PERIOD_MS} ms")
    print()
    print("Type a pulse width in ms (e.g. 1.5, 0.8, 2.3). Range: 0.4 to 2.6.")
    print("'stop' or 0 sends a duty-cycle 0 (no PWM, pull-down holds line LOW).")
    print("'q' to quit. Each command takes effect immediately and holds until")
    print("you type the next one.")
    print()

    pwm = PWMOutputDevice(
        PAN_GPIO_PIN,
        frequency=PWM_FREQUENCY_HZ,
        initial_value=0.0,
    )
    try:
        while True:
            try:
                raw = input("pulse_ms> ").strip().lower()
            except (EOFError, KeyboardInterrupt):
                print()
                break
            if raw in ("q", "quit", "exit"):
                break
            if not raw:
                continue
            if raw in ("stop", "0", "0.0"):
                pwm.value = 0.0
                print("  -> duty=0 (no PWM)")
                continue
            try:
                pulse_ms = float(raw)
            except ValueError:
                print("  not a number")
                continue
            if pulse_ms < 0.4 or pulse_ms > 2.6:
                print("  out of safe range (0.4-2.6 ms); ignoring")
                continue
            duty = pulse_to_duty_cycle(pulse_ms)
            pwm.value = duty
            print(f"  -> pulse={pulse_ms} ms  duty={duty:.4f}  ({duty * 100:.2f}%)")
            # Print direction hint for common values
            if pulse_ms < 1.45:
                print("     (spec: this is REVERSE)")
            elif pulse_ms > 1.55:
                print("     (spec: this is FORWARD)")
            else:
                print("     (spec: this should be NEUTRAL/STOP)")
    finally:
        pwm.value = 0.0
        time.sleep(0.1)
        try:
            pwm.close()
        except Exception:  # noqa: BLE001
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
