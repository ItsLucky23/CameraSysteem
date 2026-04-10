from __future__ import annotations

import asyncio
import logging
import time

from camera_node.adapters.base import HardwareAdapter
from camera_node.api_client import Pi5ApiClient, Pi5ApiError
from camera_node.command_executor import CommandExecutor
from camera_node.config import NodeSettings
from camera_node.models import CommandResult
from camera_node.telemetry import read_cpu_temperature_c, to_ingest_payload


logger = logging.getLogger(__name__)


class CameraNodeRuntime:
    def __init__(
        self,
        *,
        settings: NodeSettings,
        api_client: Pi5ApiClient,
        adapter: HardwareAdapter,
        executor: CommandExecutor,
    ) -> None:
        self._settings = settings
        self._api_client = api_client
        self._adapter = adapter
        self._executor = executor
        self._running = True
        self._last_telemetry_at = 0.0

    def request_stop(self) -> None:
        self._running = False

    async def run(self) -> None:
        logger.info("Starting camera node runtime for camera %s", self._settings.camera_id)
        await self._adapter.startup()

        try:
            async with self._api_client:
                await self._send_telemetry(command_result=None)

                while self._running:
                    processed_command = False

                    try:
                        commands = await self._api_client.get_pending_commands(
                            node_id=self._settings.node_id,
                            node_secret=self._settings.node_secret,
                            limit=self._settings.command_batch_limit,
                        )
                    except Pi5ApiError as error:
                        logger.warning(
                            "Failed to poll commands: %s (code=%s, status=%s)",
                            error,
                            error.error_code,
                            error.http_status,
                        )
                        await self._sleep_poll_interval()
                        continue

                    for command in commands:
                        result = await self._executor.execute(command)
                        await self._send_telemetry(command_result=result)
                        processed_command = True

                    if not processed_command and self._telemetry_due():
                        await self._send_telemetry(command_result=None)

                    await self._sleep_poll_interval()
        finally:
            await self._adapter.shutdown()
            logger.info("Camera node runtime stopped")

    async def _send_telemetry(self, command_result: CommandResult | None) -> None:
        state = await self._adapter.get_state()

        # Keep CPU temperature as a local fallback source if adapter does not set it.
        if state.temperature_c is None:
            state.temperature_c = read_cpu_temperature_c(self._settings.cpu_temp_path)

        payload = to_ingest_payload(
            node_id=self._settings.node_id,
            node_secret=self._settings.node_secret,
            camera_id=self._settings.camera_id,
            state=state,
            command_result=command_result,
        )

        try:
            await self._api_client.ingest_telemetry(payload)
            self._last_telemetry_at = time.monotonic()
        except Pi5ApiError as error:
            logger.warning(
                "Failed to send telemetry: %s (code=%s, status=%s)",
                error,
                error.error_code,
                error.http_status,
            )

    def _telemetry_due(self) -> bool:
        if self._last_telemetry_at <= 0:
            return True

        elapsed = time.monotonic() - self._last_telemetry_at
        return elapsed >= self._settings.telemetry_interval_sec

    async def _sleep_poll_interval(self) -> None:
        await asyncio.sleep(self._settings.poll_interval_ms / 1000.0)
