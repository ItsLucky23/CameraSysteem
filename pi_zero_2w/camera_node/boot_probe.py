from __future__ import annotations

import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any


# Each probe returns a (status, detail, ok) triple. Status is one of
# OK / FAIL / SKIP / STUB. ok is the boolean used to fill the
# CapabilityReport returned to telemetry.
ProbeResult = tuple[str, str, bool]


@dataclass(slots=True)
class CapabilityReport:
    has_camera: bool
    has_ir: bool
    has_pan_tilt: bool       # True only if BOTH pan and tilt servos init successfully
    has_microphone: bool
    has_speaker: bool
    has_motion: bool         # always False for now (stub)
    has_zoom: bool           # always False for now (no real zoom hardware)
    has_temperature: bool    # True if /sys/class/thermal/thermal_zone0/temp readable


def _probe_camera() -> ProbeResult:
    rpicam = shutil.which("rpicam-vid")
    if rpicam is None:
        return ("FAIL", "rpicam-vid not on PATH", False)

    try:
        completed = subprocess.run(
            ["rpicam-still", "--timeout", "50", "-o", "/dev/null"],
            capture_output=True,
            timeout=3,
        )
    except FileNotFoundError:
        # rpicam-vid present but rpicam-still missing - still report OK
        # since the capture binary we actually use exists.
        return ("OK", f"{rpicam} (rpicam-still missing, capture not verified)", True)
    except subprocess.TimeoutExpired:
        return ("FAIL", "rpicam-still timed out (camera busy?)", False)
    except Exception as error:  # noqa: BLE001
        return ("FAIL", f"capture probe raised: {error}", False)

    if completed.returncode == 0:
        return ("OK", f"{rpicam} capture verified", True)

    stderr_tail = (completed.stderr or b"").decode(errors="replace").strip().splitlines()
    detail = stderr_tail[-1] if stderr_tail else f"rpicam-still exit={completed.returncode}"
    return ("FAIL", detail, False)


def _probe_ir(ir_gpio_pin: int | None) -> ProbeResult:
    if ir_gpio_pin is None:
        return ("SKIP", "not configured", False)

    try:
        from gpiozero import OutputDevice  # type: ignore
    except Exception as error:  # noqa: BLE001
        return ("FAIL", f"gpiozero import failed: {error}", False)

    try:
        device = OutputDevice(ir_gpio_pin, active_high=True, initial_value=False)
    except Exception as error:  # noqa: BLE001
        return ("FAIL", f"GPIO {ir_gpio_pin} init failed: {error}", False)

    try:
        device.close()
    except Exception:
        pass

    return ("OK", f"GPIO {ir_gpio_pin} (pin claim ok — wiring not verified)", True)


def _probe_servo(label: str, gpio_pin: int | None) -> ProbeResult:
    if gpio_pin is None:
        return ("SKIP", "not configured", False)

    try:
        from gpiozero import AngularServo  # type: ignore
    except Exception as error:  # noqa: BLE001
        return ("FAIL", f"gpiozero import failed: {error}", False)

    try:
        servo = AngularServo(gpio_pin, min_angle=-90, max_angle=90, initial_angle=0)
    except Exception as error:  # noqa: BLE001
        return ("FAIL", f"GPIO {gpio_pin} init failed: {error}", False)

    try:
        servo.detach()
    except Exception:
        pass
    try:
        servo.close()
    except Exception:
        pass

    return ("OK", f"GPIO {gpio_pin} (pin claim ok — wiring not verified)", True)


_CARD_LINE_RE = re.compile(r"^card\s+(\d+)\s*:\s*([^\[]+?)\s*\[([^\]]*)\]", re.MULTILINE | re.IGNORECASE)

# Built-in Pi audio devices that show up in `aplay -l` even with nothing
# physically connected. We exclude these so the speaker probe only reports OK
# when a real external sound card (USB, I2S DAC, etc.) is attached.
_INTERNAL_AUDIO_TOKENS = (
    "bcm2835",
    "vc4hdmi",
    "vc4-hdmi",
    "headphones",
)


def _is_internal_card(name: str, label: str) -> bool:
    haystack = f"{name} {label}".lower()
    return any(token in haystack for token in _INTERNAL_AUDIO_TOKENS)


def _probe_alsa(binary: str) -> ProbeResult:
    if shutil.which(binary) is None:
        return ("FAIL", f"{binary} not on PATH", False)

    try:
        completed = subprocess.run(
            [binary, "-l"],
            capture_output=True,
            timeout=3,
        )
    except subprocess.TimeoutExpired:
        return ("FAIL", f"{binary} -l timed out", False)
    except Exception as error:  # noqa: BLE001
        return ("FAIL", f"{binary} -l raised: {error}", False)

    stdout = (completed.stdout or b"").decode(errors="replace")
    cards = _CARD_LINE_RE.findall(stdout)
    if not cards:
        return ("FAIL", "no device found", False)

    external = [c for c in cards if not _is_internal_card(c[1], c[2])]
    if not external:
        return ("FAIL", f"only built-in Pi audio detected ({len(cards)} card(s))", False)

    return ("OK", f"{len(external)} external card(s) detected", True)


# MOTION DETECTION LOGIC (start)
# def _probe_motion(motion_gpio_pin: int | None) -> ProbeResult:
#     if motion_gpio_pin is None:
#         return ("STUB", "no GPIO pin configured", False)
#
#     try:
#         from gpiozero import MotionSensor  # type: ignore
#     except Exception as error:  # noqa: BLE001
#         return ("FAIL", f"gpiozero import failed: {error}", False)
#
#     try:
#         sensor = MotionSensor(motion_gpio_pin)
#     except Exception as error:  # noqa: BLE001
#         return ("FAIL", f"GPIO {motion_gpio_pin} init failed: {error}", False)
#
#     try:
#         sensor.close()
#     except Exception:
#         pass
#
#     return ("OK", f"GPIO {motion_gpio_pin}", True)
# MOTION DETECTION LOGIC (end)


def _probe_temperature() -> ProbeResult:
    path = Path("/sys/class/thermal/thermal_zone0/temp")
    if not path.exists():
        return ("FAIL", f"{path} not present", False)

    try:
        raw = path.read_text(encoding="utf-8").strip()
    except OSError as error:
        return ("FAIL", f"read failed: {error}", False)

    if not raw:
        return ("FAIL", "thermal_zone0 returned empty", False)

    return ("OK", "CPU thermal_zone0 (fallback)", True)


def _format_line(label: str, status: str, detail: str) -> str:
    # Two leading spaces + 27-char label column + 10-char status column + detail.
    return f"  {label:<27}{status:<10}{detail}"


def _safe_probe(probe_fn: Any, *args: Any) -> ProbeResult:
    try:
        return probe_fn(*args)
    except Exception as error:  # noqa: BLE001
        return ("FAIL", f"probe raised: {error}", False)


def run_hardware_probe(
    adapter: Any,
    *,
    camera_id: str,
    hostname: str,
) -> CapabilityReport:
    """
    Probes each configurable hardware component, prints a banner with the
    detection result, and returns a CapabilityReport for telemetry to send
    to the Pi 5. Never raises - missing hardware logs FAIL but never crashes.
    """

    ir_gpio_pin = getattr(adapter, "_ir_gpio_pin", None)
    pan_gpio_pin = getattr(adapter, "_pan_servo_gpio_pin", None)
    tilt_gpio_pin = getattr(adapter, "_tilt_servo_gpio_pin", None)
    # MOTION DETECTION LOGIC (start)
    # motion_gpio_pin = getattr(adapter, "_motion_gpio_pin", None)
    # MOTION DETECTION LOGIC (end)

    camera = _safe_probe(_probe_camera)
    ir = _safe_probe(_probe_ir, ir_gpio_pin)
    pan = _safe_probe(_probe_servo, "pan servo", pan_gpio_pin)
    tilt = _safe_probe(_probe_servo, "tilt servo", tilt_gpio_pin)
    microphone = _safe_probe(_probe_alsa, "arecord")
    speaker = _safe_probe(_probe_alsa, "aplay")
    # MOTION DETECTION LOGIC (start)
    # motion = _safe_probe(_probe_motion, motion_gpio_pin)
    # MOTION DETECTION LOGIC (end)
    temperature = _safe_probe(_probe_temperature)

    divider = "=" * 60
    lines = [
        "",
        "",
        divider,
        "  CAMERA NODE BOOT - HARDWARE PROBE",
        f"  cameraId={camera_id}  hostname={hostname}",
        divider,
        _format_line("camera (rpicam-vid)", camera[0], camera[1]),
        _format_line("ir led", ir[0], ir[1]),
        _format_line("pan servo", pan[0], pan[1]),
        _format_line("tilt servo", tilt[0], tilt[1]),
        _format_line("microphone", microphone[0], microphone[1]),
        _format_line("speaker", speaker[0], speaker[1]),
        # MOTION DETECTION LOGIC (start)
        # _format_line("motion detection", motion[0], motion[1]),
        # MOTION DETECTION LOGIC (end)
        _format_line("temperature", temperature[0], temperature[1]),
        divider,
        "",
        "",
    ]

    print("\n".join(lines))

    return CapabilityReport(
        has_camera=camera[2],
        has_ir=ir[2],
        has_pan_tilt=pan[2] and tilt[2],
        has_microphone=microphone[2],
        has_speaker=speaker[2],
        # MOTION DETECTION LOGIC (start) — paused, always reports False
        has_motion=False,
        # MOTION DETECTION LOGIC (end)
        has_zoom=False,
        has_temperature=temperature[2],
    )
