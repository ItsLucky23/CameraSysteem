from __future__ import annotations

import asyncio
import contextlib
import logging
import socket
import time

from camera_node.adapters.base import HardwareAdapter
from camera_node.api_client import Pi5ApiClient, Pi5ApiError
from camera_node.boot_probe import CapabilityReport, run_hardware_probe
from camera_node.command_executor import CommandExecutor
from camera_node.config import NodeSettings
from camera_node.models import CommandResult
from camera_node.telemetry import read_cpu_temperature_c, to_ingest_payload
from camera_node.thumbnail_publisher import ThumbnailPublisher


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
        self._capabilities: CapabilityReport | None = None
        self._thumbnail_publisher: ThumbnailPublisher | None = None

    def request_stop(self) -> None:
        self._running = False
        if self._thumbnail_publisher is not None:
            self._thumbnail_publisher.request_stop()

    async def run(self) -> None:
        logger.info("Starting camera node runtime for camera IP %s", self._settings.camera_ip)

        # Boot probe runs BEFORE adapter.startup(). The probe creates throw-away
        # gpiozero devices on the configured pins to test them and closes them
        # immediately. If we ran adapter.startup() first, the adapter would
        # already own GPIO 18 (IR LED) and the probe's _probe_ir would falsely
        # report FAIL "pin GPIO18 is already in use".
        try:
            self._capabilities = run_hardware_probe(
                self._adapter,
                camera_id=self._settings.camera_ip,
                hostname=socket.gethostname(),
            )
        except Exception as error:  # noqa: BLE001
            logger.warning("Boot probe raised unexpectedly: %s", error)
            self._capabilities = None

        await self._adapter.startup()

        # Hands-free wiring confirmation: blink the IR LED twice when
        # IR_BOOT_SELF_TEST=true so the installer can verify the MOSFET +
        # ring without needing to load the cameras page.
        if self._settings.ir_boot_self_test:
            ir_device = getattr(self._adapter, "_ir_device", None)
            if ir_device is not None:
                logger.info("[ir-self-test] flashing IR LED")
                for _ in range(2):
                    with contextlib.suppress(Exception):
                        ir_device.on()
                    await asyncio.sleep(0.5)
                    with contextlib.suppress(Exception):
                        ir_device.off()
                    await asyncio.sleep(0.25)
            else:
                logger.warning("[ir-self-test] flag set but adapter has no _ir_device — skipping")

        try:
            async with self._api_client:
                # Best-effort first ping; if Pi 5 is down we still enter the loop
                # and keep retrying instead of crashing the process.
                await self._send_telemetry(command_result=None)

                self._thumbnail_publisher = ThumbnailPublisher(
                    api_client=self._api_client,
                    camera_ip=self._settings.camera_ip,
                    node_secret=self._settings.node_secret,
                )

                # Long-polling on commands can hold the request open up to 25s,
                # so command and telemetry loops have to run in parallel — a
                # single sequential loop would either starve telemetry (if it
                # waits for commands) or burn cycles (if it polls).
                command_task = asyncio.create_task(self._command_loop())
                telemetry_task = asyncio.create_task(self._telemetry_loop())
                thumbnail_task = asyncio.create_task(self._thumbnail_publisher.run())

                done, pending = await asyncio.wait(
                    {command_task, telemetry_task, thumbnail_task},
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
                # Temporarily INFO so we can confirm the long-poll is actually
                # cycling end-to-end. Drop back to DEBUG once verified.
                logger.info("Command long-poll returned no commands (idle timeout)")

            for command in commands:
                # Cache the cameraId observed on commands so the thumbnail
                # upload can carry it. Pi Zero config only knows cameraIp.
                if self._thumbnail_publisher is not None and command.camera_id:
                    self._thumbnail_publisher.remember_camera_id(command.camera_id)

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
            capabilities=self._capabilities,
        )

        try:
            await self._api_client.ingest_telemetry(payload)
            self._last_telemetry_at = time.monotonic()
            logger.info(
                "Telemetry sent isOnline=%s mode=%s measuredFps=%s lastFrameAgeMs=%s temperatureC=%s zoomLevel=%s cmdResult=%s",
                state.is_online,
                state.mode,
                state.measured_fps,
                state.last_frame_age_ms,
                state.temperature_c,
                state.zoom_level,
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
