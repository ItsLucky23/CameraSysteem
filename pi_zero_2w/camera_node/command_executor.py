from __future__ import annotations

import logging
from typing import Any

from camera_node.adapters.base import HardwareAdapter
from camera_node.models import CameraCommand, CommandResult


logger = logging.getLogger(__name__)


class CommandExecutor:
    def __init__(self, adapter: HardwareAdapter, *, ptz_step: int) -> None:
        self._adapter = adapter
        self._ptz_step = max(1, ptz_step)

    async def execute(self, command: CameraCommand) -> CommandResult:
        logger.info("Executing command %s (%s)", command.command_id, command.action)

        if not command.command_id or not command.action:
            return CommandResult(
                command_id=command.command_id,
                action=command.action,
                result="rejected",
                reason_code="camera.invalidInput",
            )

        try:
            if command.action == "panLeft":
                await self._adapter.pan(-self._ptz_step)
            elif command.action == "panRight":
                await self._adapter.pan(self._ptz_step)
            elif command.action == "tiltUp":
                await self._adapter.tilt(self._ptz_step)
            elif command.action == "tiltDown":
                await self._adapter.tilt(-self._ptz_step)
            elif command.action == "irOn":
                await self._adapter.set_ir_mode("on")
            elif command.action == "irOff":
                await self._adapter.set_ir_mode("off")
            elif command.action == "recordStart":
                await self._adapter.set_recording(True)
            elif command.action == "recordStop":
                await self._adapter.set_recording(False)
            elif command.action == "startVideoStream":
                validation = _validate_start_video_stream(command.payload)
                if validation is None:
                    return CommandResult(
                        command_id=command.command_id,
                        action=command.action,
                        result="rejected",
                        reason_code="camera.invalidInput",
                    )
                rtp_host, rtp_port = validation
                await self._adapter.start_video_stream(rtp_host=rtp_host, rtp_port=rtp_port)
            elif command.action == "stopVideoStream":
                await self._adapter.stop_video_stream()
            else:
                return CommandResult(
                    command_id=command.command_id,
                    action=command.action,
                    result="rejected",
                    reason_code="camera.invalidInput",
                )
        except Exception as error:  # noqa: BLE001
            logger.exception("Command execution failed: %s", error)
            return CommandResult(
                command_id=command.command_id,
                action=command.action,
                result="failed",
                reason_code="camera.commandFailed",
            )

        return CommandResult(
            command_id=command.command_id,
            action=command.action,
            result="executed",
        )


def _validate_start_video_stream(payload: dict[str, Any]) -> tuple[str, int] | None:
    rtp_host_raw = payload.get("rtpHost")
    rtp_port_raw = payload.get("rtpPort")

    logger.warning(
        "startVideoStream payload debug: payload_type=%s keys=%s rtpHost=%r (type=%s) rtpPort=%r (type=%s)",
        type(payload).__name__,
        list(payload.keys()) if isinstance(payload, dict) else "N/A",
        rtp_host_raw,
        type(rtp_host_raw).__name__,
        rtp_port_raw,
        type(rtp_port_raw).__name__,
    )

    if not isinstance(rtp_host_raw, str):
        return None
    rtp_host = rtp_host_raw.strip()
    if not rtp_host:
        return None

    if isinstance(rtp_port_raw, bool):
        return None
    if not isinstance(rtp_port_raw, int):
        return None
    if rtp_port_raw <= 0 or rtp_port_raw > 65535:
        return None

    return rtp_host, rtp_port_raw
