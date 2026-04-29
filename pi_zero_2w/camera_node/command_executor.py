from __future__ import annotations

import logging
from typing import Any

from camera_node.adapters.base import HardwareAdapter
from camera_node.log_flags import is_log_enabled, set_log_flags
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
        if is_log_enabled("commandQueue"):
            logger.info(
                "[commandQueue] received id=%s action=%s payload=%r",
                command.command_id,
                command.action,
                command.payload,
            )

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
                strength = _parse_strength(command.payload, default_when_missing=100)
                if strength is None:
                    return CommandResult(
                        command_id=command.command_id,
                        action=command.action,
                        result="rejected",
                        reason_code="camera.invalidInput",
                    )
                await self._adapter.set_ir_mode("on", strength=strength)
            elif command.action == "irOff":
                await self._adapter.set_ir_mode("off")
            elif command.action == "irAuto":
                await self._adapter.set_ir_mode("auto")
            elif command.action == "irSetStrength":
                strength = _parse_strength(command.payload, default_when_missing=None)
                if strength is None:
                    return CommandResult(
                        command_id=command.command_id,
                        action=command.action,
                        result="rejected",
                        reason_code="camera.invalidInput",
                    )
                await self._adapter.set_ir_strength(strength)
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
                rtp_host, rtp_port, target_fps, bitrate_bps, width, height = validation
                await self._adapter.start_video_stream(
                    rtp_host=rtp_host,
                    rtp_port=rtp_port,
                    target_fps=target_fps,
                    bitrate_bps=bitrate_bps,
                    width=width,
                    height=height,
                )
            elif command.action == "stopVideoStream":
                await self._adapter.stop_video_stream()
            elif command.action == "setLogFlags":
                features = _parse_log_flags(command.payload)
                if features is None:
                    return CommandResult(
                        command_id=command.command_id,
                        action=command.action,
                        result="rejected",
                        reason_code="camera.invalidInput",
                    )
                applied = set_log_flags(features)
                logger.info("[log-flags] active features now: %s", sorted(applied))
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
) -> tuple[str, int, int, int, int | None, int | None] | None:
    rtp_host_raw = payload.get("rtpHost")
    rtp_port_raw = payload.get("rtpPort")
    target_fps_raw = payload.get("targetFps")
    bitrate_bps_raw = payload.get("bitrateBps")
    width_raw = payload.get("width")
    height_raw = payload.get("height")

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

    # Resolution: both-or-neither. When both are absent the publisher falls
    # back to its default FRAME_WIDTH/FRAME_HEIGHT.
    if (width_raw is None) != (height_raw is None):
        return None

    width: int | None = None
    height: int | None = None
    if width_raw is not None and height_raw is not None:
        if isinstance(width_raw, bool) or isinstance(height_raw, bool):
            return None
        if not isinstance(width_raw, int) or not isinstance(height_raw, int):
            return None
        if width_raw < 320 or width_raw > 3840:
            return None
        if height_raw < 240 or height_raw > 2160:
            return None
        width = width_raw
        height = height_raw

    return rtp_host, rtp_port_raw, target_fps_raw, bitrate_bps_raw, width, height


def _parse_log_flags(payload: dict[str, Any]) -> set[str] | None:
    raw = payload.get("features")
    if not isinstance(raw, list):
        return None
    cleaned: set[str] = set()
    for item in raw:
        if not isinstance(item, str):
            return None
        cleaned.add(item)
    return cleaned


def _parse_strength(payload: dict[str, Any], *, default_when_missing: int | None) -> int | None:
    # irOn allows the strength to be omitted (caller supplies default 100).
    # irSetStrength requires it explicitly (caller passes None as default).
    # Both reject any non-int / out-of-range value.
    raw = payload.get("strength")
    if raw is None:
        return default_when_missing
    if isinstance(raw, bool):
        return None
    if not isinstance(raw, int):
        return None
    if raw < 0 or raw > 100:
        return None
    return raw
