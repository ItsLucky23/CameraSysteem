"""
Safety-first standalone hardware test for a CONTINUOUS-ROTATION servo on
GPIO 12 (pin 32).

This script targets continuous-rotation servos where the PWM pulse width
selects SPEED + DIRECTION (not angle):
    1.0ms = full reverse
    1.5ms = stop (neutral)
    2.0ms = full forward
We re-use gpiozero.AngularServo because the pulse-width math is identical;
just read every "angle" output as "speed" instead.

PRE-FLIGHT — read before running:
  1. 10 kOhm pull-down resistor wired between GPIO 12 (pin 32) and GND.
     Without it, floating signal can spin the servo uncontrollably.
  2. Servo VCC on the breadboard's external 5V rail (HW-131 set to 5V).
     Servo VCC is NOT connected to any Pi 5V pin.
  3. Common ground: Pi physical pin 6 (GND) bridged to breadboard - rail.
  4. Have a kill switch (in-line switch on servo VCC, or be ready to yank
     the servo's red wire) before powering on. If the servo runs away,
     cut power within 1 second.
  5. Camera_node service is stopped so it isn't fighting us for GPIO 12:
        sudo pkill -f run.py
  6. Run from inside the venv:
        cd /var/www/CameraSysteem/pi_zero_2w
        source .venv/bin/activate
        python3 test_pan_servo.py

What the script does, in order:
  Step A: Send STOP (1.5ms / "speed 0"). Holds 3 seconds. You confirm the
          servo is completely still. If it keeps spinning -> the servo's
          internal neutral is mis-calibrated; turn the small pot on the
          servo body slowly until it stops.
  Step B: Brief slow-forward pulse (~+10% speed for 1.5s, then STOP).
          You confirm it spun briefly forward and then stopped.
  Step C: Same in reverse.
  Step D: Optional speed sweep (slow + medium + fast, both directions,
          each 1.5s with STOP in between).
  Step E: Optional interactive prompt for typing speeds -100..+100.

After every step the script asks for confirmation. Ctrl+C at any time to
force-detach.
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

# Continuous-rotation servo with 1.0ms..2.0ms range:
#   1.0ms = full reverse, 1.5ms = stop, 2.0ms = full forward
# We map gpiozero "angle" -90..0..+90 to "speed" reverse..stop..forward.
# Using a narrower-than-SG90 range so the servo never sees pulses outside
# what its controller expects.
MIN_PULSE_WIDTH = 1.0 / 1000  # 1.0ms = -90 angle = full reverse
MAX_PULSE_WIDTH = 2.0 / 1000  # 2.0ms = +90 angle = full forward
FRAME_WIDTH = 20 / 1000       # 20ms (50Hz)


def confirm(prompt: str) -> bool:
    while True:
        try:
            ans = input(f"{prompt} [y/n/abort]: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            return False
        if ans in ("y", "yes"):
            return True
        if ans in ("n", "no"):
            return False
        if ans in ("a", "abort", "q", "quit"):
            return False


def step_a_stop(servo: AngularServo) -> bool:
    print()
    print("STEP A: commanding STOP (1.5 ms pulse / speed 0)")
    servo.angle = 0
    print("Holding for 3 seconds. Watch the servo.")
    time.sleep(3.0)
    print()
    print("EXPECTED: servo is completely still (no rotation, no humming).")
    print("RED FLAG: servo keeps rotating -> the internal neutral pot is")
    print("          mis-calibrated. KILL POWER, then turn the small screw")
    print("          on the servo body slowly with a small flathead until")
    print("          the servo stops on a 1.5ms pulse, then re-test.")
    return confirm("Did the servo stop?")


def step_b_small_forward(servo: AngularServo) -> bool:
    print()
    print("STEP B: brief slow-forward pulse (~10% speed for 1.5 s, then STOP)")
    servo.angle = 9   # ~10% of full range -> ~1.55ms pulse -> slow forward
    time.sleep(1.5)
    servo.angle = 0   # back to stop (1.5ms)
    time.sleep(1.0)
    print()
    print("EXPECTED: servo spun slowly clockwise for ~1.5s, then stopped.")
    print("RED FLAG: servo kept spinning after the STOP -> kill power.")
    return confirm("Did the servo spin briefly forward and then stop?")


def step_c_small_reverse(servo: AngularServo) -> bool:
    print()
    print("STEP C: brief slow-reverse pulse (~-10% speed for 1.5 s, then STOP)")
    servo.angle = -9
    time.sleep(1.5)
    servo.angle = 0
    time.sleep(1.0)
    print()
    print("EXPECTED: servo spun slowly counter-clockwise, then stopped.")
    return confirm("Did the servo spin briefly reverse and then stop?")


def step_d_sweep(servo: AngularServo) -> bool:
    print()
    print("STEP D (optional): speed sweep — slow/medium/fast in both directions,")
    print("each held 1.5 s with a 1 s STOP in between.")
    if not confirm("Run speed sweep?"):
        return True
    for label, speed in [
        ("slow forward", 9),
        ("medium forward", 45),
        ("fast forward", 90),
        ("slow reverse", -9),
        ("medium reverse", -45),
        ("fast reverse", -90),
    ]:
        print(f"  -> {label} (angle={speed})")
        servo.angle = speed
        time.sleep(1.5)
        print("  -> STOP")
        servo.angle = 0
        time.sleep(1.0)
    print("Sweep done.")
    return True


def step_e_interactive(servo: AngularServo) -> None:
    print()
    print("STEP E (optional): interactive. Type a speed -100..+100 (0 = stop)")
    print("or 'q' to quit. Speed is mapped to the angle range internally.")
    if not confirm("Enter interactive mode?"):
        return
    while True:
        try:
            raw = input("speed> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return
        if raw.lower() in ("q", "quit", "exit"):
            return
        if not raw:
            continue
        try:
            speed = float(raw)
        except ValueError:
            print("  not a number")
            continue
        if speed < -100 or speed > 100:
            print("  out of range; clamping to [-100, +100]")
            speed = max(-100.0, min(100.0, speed))
        # Map -100..+100 speed onto -90..+90 angle (gpiozero internal).
        angle = speed * 0.9
        print(f"  -> speed={speed}% (angle={angle:.1f})")
        servo.angle = angle


def main() -> int:
    print("=" * 70)
    print("PAN SERVO HARDWARE TEST")
    print("=" * 70)
    print()
    print(f"GPIO pin: BCM {PAN_GPIO_PIN} (physical pin 32)")
    print(f"Pulse width range: {MIN_PULSE_WIDTH * 1000}ms - {MAX_PULSE_WIDTH * 1000}ms")
    print(f"Frame rate: {1 / FRAME_WIDTH}Hz")
    print()
    print("READ THE PRE-FLIGHT NOTES IN THIS FILE BEFORE CONTINUING.")
    print()
    if not confirm("Pull-down resistor wired? Servo on external 5V (HW-131)? "
                   "Common ground tied? Kill switch ready?"):
        print("Aborted.")
        return 0

    servo = None
    try:
        print("\nInitializing servo...")
        servo = AngularServo(
            PAN_GPIO_PIN,
            min_angle=-90,
            max_angle=90,
            initial_angle=0,
            min_pulse_width=MIN_PULSE_WIDTH,
            max_pulse_width=MAX_PULSE_WIDTH,
            frame_width=FRAME_WIDTH,
        )

        if not step_a_stop(servo):
            print("\nABORT: servo did not stop. Kill power. Likely a continuous-rotation\n"
                  "servo without a hardware stop. Check the AI's 'antenna effect' note\n"
                  "and confirm the 10k pull-down is wired.")
            return 1

        if not step_b_small_forward(servo):
            print("ABORT after Step B.")
            return 1

        if not step_c_small_reverse(servo):
            print("ABORT after Step C.")
            return 1

        if not step_d_sweep(servo):
            print("ABORT after Step D.")
            return 1

        step_e_interactive(servo)
        print("\nAll tests complete.")
        return 0

    except Exception as error:  # noqa: BLE001
        print(f"\nUNEXPECTED ERROR: {error}")
        return 2

    finally:
        # Always detach + close so the pin stops outputting PWM. Pull-down
        # resistor (if wired) takes over and holds the signal LOW.
        if servo is not None:
            print("Detaching servo, releasing GPIO...")
            try:
                servo.detach()
            except Exception:  # noqa: BLE001
                pass
            try:
                servo.close()
            except Exception:  # noqa: BLE001
                pass


if __name__ == "__main__":
    sys.exit(main())
