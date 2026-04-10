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
    node_id: str,
    node_secret: str,
    camera_id: str,
    state: CameraState,
    command_result: CommandResult | None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "nodeId": node_id,
        "nodeSecret": node_secret,
        "cameraId": camera_id,
        "isOnline": state.is_online,
        "mode": state.mode,
        "irMode": state.ir_mode,
        "irEnabled": state.ir_enabled,
        "pan": state.pan,
        "tilt": state.tilt,
        "temperatureC": state.temperature_c,
        "motionDetected": state.motion_detected,
        "recording": state.recording,
    }

    if command_result:
        payload["commandResult"] = command_result.to_api_payload()

    return payload
