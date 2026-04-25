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
        # Blank line before each [executor] line so the (executor + adapter)
        # pair stands out in the journal stream.
        print("")
        print(f"[executor] action={command.action} payload={command.payload}")
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
            elif command.action == "zoomIn":
                state = await self._adapter.get_state()
                new_level = min(100, (state.zoom_level or 50) + 10)
                await self._adapter.set_zoom(new_level)
            elif command.action == "zoomOut":
                state = await self._adapter.get_state()
                new_level = max(1, (state.zoom_level or 50) - 10)
                await self._adapter.set_zoom(new_level)
            elif command.action == "talkbackOn":
                await self._adapter.set_talkback(True)
            elif command.action == "talkbackOff":
                await self._adapter.set_talkback(False)
            elif command.action == "startVideoStream":
                validation = _validate_start_video_stream(command.payload)
                if validation is None:
                    return CommandResult(
                        command_id=command.command_id,
                        action=command.action,
                        result="rejected",
                        reason_code="camera.invalidInput",
                    )
                rtp_host, rtp_port, target_fps, bitrate_bps = validation
                await self._adapter.start_video_stream(
                    rtp_host=rtp_host,
                    rtp_port=rtp_port,
                    target_fps=target_fps,
                    bitrate_bps=bitrate_bps,
                )
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


def _validate_start_video_stream(
    payload: dict[str, Any],
) -> tuple[str, int, int, int] | None:
    rtp_host_raw = payload.get("rtpHost")
    rtp_port_raw = payload.get("rtpPort")
    target_fps_raw = payload.get("targetFps")
    bitrate_bps_raw = payload.get("bitrateBps")

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

    if isinstance(target_fps_raw, bool):
        return None
    if not isinstance(target_fps_raw, int):
        return None
    # 0 = uncapped (no --framerate flag, sensor runs at native max).
    if target_fps_raw < 0 or target_fps_raw > 60:
        return None

    if isinstance(bitrate_bps_raw, bool):
        return None
    if not isinstance(bitrate_bps_raw, int):
        return None
    # Sanity window: 100 kbps .. 20 Mbps
    if bitrate_bps_raw < 100_000 or bitrate_bps_raw > 20_000_000:
        return None

    return rtp_host, rtp_port_raw, target_fps_raw, bitrate_bps_raw
