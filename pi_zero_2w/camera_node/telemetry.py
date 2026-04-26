from __future__ import annotations

from pathlib import Path
from typing import Any

from camera_node.boot_probe import CapabilityReport
from camera_node.models import CameraState, CommandResult


def read_cpu_temperature_c(cpu_temp_path: str) -> float | None:
    path = Path(cpu_temp_path)
    if not path.exists():
        return None

    try:
        raw = path.read_text(encoding="utf-8").strip()
        if not raw:
            return None

        parsed = float(raw)
        if parsed > 1000:
            parsed = parsed / 1000.0

        return round(parsed, 2)
    except (ValueError, OSError):
        return None


def to_ingest_payload(
    *,
    camera_ip: str,
    node_secret: str,
    state: CameraState,
    command_result: CommandResult | None,
    capabilities: CapabilityReport | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "cameraIp": camera_ip,
        "nodeSecret": node_secret,
        "isOnline": state.is_online,
        "mode": state.mode,
        "irMode": state.ir_mode,
        "irEnabled": state.ir_enabled,
        "pan": state.pan,
        "tilt": state.tilt,
        "temperatureC": state.temperature_c,
        "motionDetected": state.motion_detected,
        "lastMotionAt": state.last_motion_at,
        "recording": state.recording,
        "measuredFps": state.measured_fps,
        "lastFrameAgeMs": state.last_frame_age_ms,
        "zoomLevel": state.zoom_level,
    }

    if capabilities is not None:
        # Capabilities don't change at runtime, but we send them every tick so
        # a Pi 5 restart self-heals from the next ~5s telemetry. ~80 bytes.
        payload["capabilities"] = {
            "hasCamera": capabilities.has_camera,
            "hasIR": capabilities.has_ir,
            "hasPanTilt": capabilities.has_pan_tilt,
            "hasMicrophone": capabilities.has_microphone,
            "hasSpeaker": capabilities.has_speaker,
            "hasMotion": capabilities.has_motion,
            "hasZoom": capabilities.has_zoom,
            "hasTemperature": capabilities.has_temperature,
        }

    if command_result:
        payload["commandResult"] = command_result.to_api_payload()

    return payload
