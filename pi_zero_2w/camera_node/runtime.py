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
        logger.info("Starting camera node runtime for camera IP %s", self._settings.camera_ip)
        await self._adapter.startup()

        try:
            async with self._api_client:
                # Best-effort first ping; if Pi 5 is down we still enter the loop
                # and keep retrying instead of crashing the process.
                await self._send_telemetry(command_result=None)

                # Long-polling on commands can hold the request open up to 25s,
                # so command and telemetry loops have to run in parallel — a
                # single sequential loop would either starve telemetry (if it
                # waits for commands) or burn cycles (if it polls).
                command_task = asyncio.create_task(self._command_loop())
                telemetry_task = asyncio.create_task(self._telemetry_loop())

                done, pending = await asyncio.wait(
                    {command_task, telemetry_task},
                    return_when=asyncio.FIRST_EXCEPTION,
                )

                for task in pending:
                    task.cancel()
                for task in pending:
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass
                # Surface any exception from a finished task.
                for task in done:
                    task.result()
        finally:
            await self._adapter.shutdown()
            logger.info("Camera node runtime stopped")

    async def _command_loop(self) -> None:
        while self._running:
            try:
                commands = await self._api_client.get_pending_commands(
                    camera_ip=self._settings.camera_ip,
                    node_secret=self._settings.node_secret,
                    limit=self._settings.command_batch_limit,
                    long_poll_ms=self._settings.long_poll_ms,
                    request_timeout_sec=self._settings.long_poll_request_timeout_sec,
                )
            except Pi5ApiError as error:
                logger.warning(
                    "Failed to poll commands: %s (code=%s, status=%s)",
                    error,
                    error.error_code,
                    error.http_status,
                )
                # Back off only when the Pi 5 is unreachable / errored. On
                # success (including a long-poll timeout returning an empty
                # list) we re-issue immediately so a freshly enqueued command
                # gets picked up with sub-second latency.
                await self._sleep(self._settings.poll_error_backoff_ms)
                continue

            if commands:
                actions = ", ".join(f"{c.action}/{c.command_id[:8]}" for c in commands)
                logger.info("Command long-poll returned %d command(s): %s", len(commands), actions)
            else:
                logger.debug("Command long-poll returned no commands (idle timeout)")

            for command in commands:
                result = await self._executor.execute(command)
                await self._send_telemetry(command_result=result)

            await self._sleep(self._settings.poll_interval_ms)

    async def _telemetry_loop(self) -> None:
        # Heartbeat-only telemetry. Command-result telemetry is sent inline
        # from the command loop right after execute().
        interval_sec = max(1.0, self._settings.telemetry_interval_sec)
        while self._running:
            await asyncio.sleep(interval_sec)
            if not self._running:
                return
            if not self._telemetry_due():
                continue
            await self._send_telemetry(command_result=None)

    async def _send_telemetry(self, command_result: CommandResult | None) -> None:
        state = await self._adapter.get_state()

        # Keep CPU temperature as a local fallback source if adapter does not set it.
        if state.temperature_c is None:
            state.temperature_c = read_cpu_temperature_c(self._settings.cpu_temp_path)

        payload = to_ingest_payload(
            camera_ip=self._settings.camera_ip,
            node_secret=self._settings.node_secret,
            state=state,
            command_result=command_result,
        )

        try:
            await self._api_client.ingest_telemetry(payload)
            self._last_telemetry_at = time.monotonic()
            logger.info(
                "Telemetry sent isOnline=%s mode=%s measuredFps=%s lastFrameAgeMs=%s temperatureC=%s cmdResult=%s",
                state.is_online,
                state.mode,
                state.measured_fps,
                state.last_frame_age_ms,
                state.temperature_c,
                f"{command_result.action}/{command_result.result}" if command_result else "-",
            )
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

    async def _sleep(self, duration_ms: int) -> None:
        if duration_ms <= 0:
            return
        await asyncio.sleep(duration_ms / 1000.0)
