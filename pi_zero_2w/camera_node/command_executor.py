from __future__ import annotations

import logging

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
