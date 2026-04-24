from __future__ import annotations

from pathlib import Path
from typing import Any

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
        "recording": state.recording,
        "measuredFps": state.measured_fps,
        "lastFrameAgeMs": state.last_frame_age_ms,
    }

    if command_result:
        payload["commandResult"] = command_result.to_api_payload()

    return payload
