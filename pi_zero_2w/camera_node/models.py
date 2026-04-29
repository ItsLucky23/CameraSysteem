from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping


@dataclass(slots=True)
class CameraState:
    is_online: bool = True
    mode: str = "live"
    ir_mode: str = "auto"
    ir_enabled: bool = False
    # User-set persisted strength (0..100). Authoritative copy lives in the
    # Pi 5 DB; the adapter mirrors it locally for fast control.
    ir_strength: int = 100
    # Live PWM duty cycle the LED is actually being driven at right now.
    # Equals ir_strength in 'on' mode; the auto controller picks it in 'auto';
    # 0 in 'off'.
    ir_active_strength: int = 0
    pan: int = 0
    tilt: int = 0
    temperature_c: float | None = None
    # MOTION DETECTION LOGIC (paused — these fields remain in the model but are never set true while paused)
    motion_detected: bool = False
    # ISO-8601 UTC timestamp of the most recent PIR motion edge. None until
    # the sensor first triggers (or stays None forever if no PIR is wired).
    last_motion_at: str | None = None
    recording: bool = False
    # Live video pipeline stats. None when the stream is not running or
    # ffmpeg has not yet produced a stats line.
    measured_fps: float | None = None
    last_frame_age_ms: int | None = None
    # Ephemeral zoom state owned by the adapter. None until adapter starts.
    zoom_level: int | None = None


@dataclass(slots=True)
class CameraCommand:
    command_id: str
    camera_id: str
    camera_ip: str
    action: str
    payload: dict[str, Any] = field(default_factory=dict)
    requested_by_user_id: str = ""
    requested_at: str = ""

    @classmethod
    def from_api(cls, value: Mapping[str, Any]) -> "CameraCommand":
        command_id = str(value.get("commandId", "")).strip()
        camera_id = str(value.get("cameraId", "")).strip()
        camera_ip = str(value.get("cameraIp", "")).strip()
        action = str(value.get("action", "")).strip()

        payload_raw = value.get("payload")
        payload = payload_raw if isinstance(payload_raw, dict) else {}

        return cls(
            command_id=command_id,
            camera_id=camera_id,
            camera_ip=camera_ip,
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
