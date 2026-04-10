from __future__ import annotations

import asyncio
import logging
import signal

from camera_node.adapters import MockHardwareAdapter, RaspberryPiHardwareAdapter
from camera_node.api_client import Pi5ApiClient
from camera_node.command_executor import CommandExecutor
from camera_node.config import NodeSettings, load_settings
from camera_node.logging_utils import configure_logging
from camera_node.runtime import CameraNodeRuntime


logger = logging.getLogger(__name__)


def build_adapter(settings: NodeSettings):
    if settings.adapter == "mock":
        return MockHardwareAdapter()

    if settings.adapter in {"rpi", "raspberry", "raspberry_pi"}:
        return RaspberryPiHardwareAdapter(
            ir_gpio_pin=settings.ir_gpio_pin,
            pan_servo_gpio_pin=settings.pan_servo_gpio_pin,
            tilt_servo_gpio_pin=settings.tilt_servo_gpio_pin,
            recording_start_command=settings.recording_start_command,
            recording_stop_command=settings.recording_stop_command,
        )

    raise ValueError(f"Unknown HARDWARE_ADAPTER value: {settings.adapter}")


async def async_main() -> None:
    settings = load_settings()
    configure_logging(settings.log_level)

    adapter = build_adapter(settings)

    api_client = Pi5ApiClient(
        base_url=settings.pi5_base_url,
        timeout_sec=settings.http_timeout_sec,
        verify_tls=settings.verify_tls,
    )

    executor = CommandExecutor(adapter, ptz_step=settings.ptz_step)

    runtime = CameraNodeRuntime(
        settings=settings,
        api_client=api_client,
        adapter=adapter,
        executor=executor,
    )

    loop = asyncio.get_running_loop()

    def _request_stop() -> None:
        logger.info("Stop signal received")
        runtime.request_stop()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _request_stop)
        except NotImplementedError:
            # add_signal_handler is not available on some platforms.
            pass

    await runtime.run()


if __name__ == "__main__":
    asyncio.run(async_main())
