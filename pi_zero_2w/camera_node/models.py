from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping


@dataclass(slots=True)
class CameraState:
    is_online: bool = True
    mode: str = "live"
    ir_mode: str = "auto"
    ir_enabled: bool = False
    pan: int = 0
    tilt: int = 0
    temperature_c: float | None = None
    motion_detected: bool = False
    recording: bool = False


@dataclass(slots=True)
class CameraCommand:
    command_id: str
    camera_id: str
    node_id: str
    action: str
    payload: dict[str, Any] = field(default_factory=dict)
    requested_by_user_id: str = ""
    requested_at: str = ""

    @classmethod
    def from_api(cls, value: Mapping[str, Any]) -> "CameraCommand":
        command_id = str(value.get("commandId", "")).strip()
        camera_id = str(value.get("cameraId", "")).strip()
        node_id = str(value.get("nodeId", "")).strip()
        action = str(value.get("action", "")).strip()

        payload_raw = value.get("payload")
        payload = payload_raw if isinstance(payload_raw, dict) else {}

        return cls(
            command_id=command_id,
            camera_id=camera_id,
            node_id=node_id,
            action=action,
            payload=payload,
            requested_by_user_id=str(value.get("requestedByUserId", "")).strip(),
            requested_at=str(value.get("requestedAt", "")).strip(),
        )


@dataclass(slots=True)
class CommandResult:
    command_id: str
    action: str
    result: str
    reason_code: str | None = None

    def to_api_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "commandId": self.command_id,
            "action": self.action,
            "result": self.result,
        }
        if self.reason_code:
            payload["reasonCode"] = self.reason_code
        return payload
