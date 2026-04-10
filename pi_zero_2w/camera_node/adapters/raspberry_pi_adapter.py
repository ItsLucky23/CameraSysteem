from __future__ import annotations

import asyncio
import contextlib
import logging

from camera_node.adapters.base import HardwareAdapter
from camera_node.models import CameraState


logger = logging.getLogger(__name__)


def _clamp(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, value))


class RaspberryPiHardwareAdapter(HardwareAdapter):
    """
    Raspberry Pi hardware adapter.

    This adapter keeps pan/tilt as software state by default and can drive:
    - IR LED via gpiozero OutputDevice (optional)
    - recording commands via configured shell commands (optional)
    """

    def __init__(
        self,
        *,
        ir_gpio_pin: int | None,
        pan_servo_gpio_pin: int | None,
        tilt_servo_gpio_pin: int | None,
        recording_start_command: str | None,
        recording_stop_command: str | None,
    ) -> None:
        self._ir_gpio_pin = ir_gpio_pin
        self._pan_servo_gpio_pin = pan_servo_gpio_pin
        self._tilt_servo_gpio_pin = tilt_servo_gpio_pin
        self._recording_start_command = recording_start_command
        self._recording_stop_command = recording_stop_command

        self._ir_device = None
        self._pan_servo = None
        self._tilt_servo = None
        self._recording_process: asyncio.subprocess.Process | None = None

        self._state = CameraState(
            is_online=True,
            mode="live",
            ir_mode="auto",
            ir_enabled=False,
            pan=0,
            tilt=0,
            temperature_c=None,
            motion_detected=False,
            recording=False,
        )

    async def startup(self) -> None:
        try:
            from gpiozero import AngularServo, OutputDevice  # type: ignore
        except Exception as error:  # noqa: BLE001
            logger.warning("Failed to import gpiozero drivers: %s", error)
            return

        if self._ir_gpio_pin is not None:
            try:
                self._ir_device = OutputDevice(self._ir_gpio_pin, active_high=True, initial_value=False)
                logger.info("IR device initialized on GPIO %s", self._ir_gpio_pin)
            except Exception as error:  # noqa: BLE001
                logger.warning("Failed to initialize IR GPIO device: %s", error)
                self._ir_device = None

        if self._pan_servo_gpio_pin is not None:
            try:
                self._pan_servo = AngularServo(
                    self._pan_servo_gpio_pin,
                    min_angle=-90,
                    max_angle=90,
                    initial_angle=0,
                )
                logger.info("Pan SG90 servo initialized on GPIO %s", self._pan_servo_gpio_pin)
            except Exception as error:  # noqa: BLE001
                logger.warning("Failed to initialize pan SG90 servo: %s", error)
                self._pan_servo = None

        if self._tilt_servo_gpio_pin is not None:
            try:
                self._tilt_servo = AngularServo(
                    self._tilt_servo_gpio_pin,
                    min_angle=-90,
                    max_angle=90,
                    initial_angle=0,
                )
                logger.info("Tilt SG90 servo initialized on GPIO %s", self._tilt_servo_gpio_pin)
            except Exception as error:  # noqa: BLE001
                logger.warning("Failed to initialize tilt SG90 servo: %s", error)
                self._tilt_servo = None

    async def shutdown(self) -> None:
        await self._stop_recording_process()

        self._close_servo(self._pan_servo)
        self._close_servo(self._tilt_servo)
        self._pan_servo = None
        self._tilt_servo = None

        if self._ir_device is not None:
            with contextlib.suppress(Exception):
                self._ir_device.off()
            with contextlib.suppress(Exception):
                self._ir_device.close()
            self._ir_device = None

    async def get_state(self) -> CameraState:
        return CameraState(
            is_online=self._state.is_online,
            mode=self._state.mode,
            ir_mode=self._state.ir_mode,
            ir_enabled=self._state.ir_enabled,
            pan=self._state.pan,
            tilt=self._state.tilt,
            temperature_c=self._state.temperature_c,
            motion_detected=self._state.motion_detected,
            recording=self._state.recording,
        )

    async def pan(self, delta: int) -> None:
        pan_min = -90 if self._pan_servo is not None else -180
        pan_max = 90 if self._pan_servo is not None else 180
        self._state.pan = _clamp(self._state.pan + delta, pan_min, pan_max)
        self._set_servo_angle(self._pan_servo, self._state.pan)

    async def tilt(self, delta: int) -> None:
        self._state.tilt = _clamp(self._state.tilt + delta, -90, 90)
        self._set_servo_angle(self._tilt_servo, self._state.tilt)

    async def set_ir_mode(self, mode: str) -> None:
        self._state.ir_mode = mode

        if mode == "on":
            self._state.ir_enabled = True
            if self._ir_device is not None:
                self._ir_device.on()
            return

        if mode == "off":
            self._state.ir_enabled = False
            if self._ir_device is not None:
                self._ir_device.off()
            return

        # auto mode keeps the currently resolved IR state unchanged.

    async def set_recording(self, recording: bool) -> None:
        if recording:
            await self._start_recording_process()
            self._state.recording = True
            self._state.mode = "record"
            return

        await self._stop_recording_process()
        self._state.recording = False
        self._state.mode = "live"

    async def _start_recording_process(self) -> None:
        if self._recording_process and self._recording_process.returncode is None:
            return

        if not self._recording_start_command:
            logger.info("No recording start command configured; keeping software recording state only")
            return

        self._recording_process = await asyncio.create_subprocess_shell(self._recording_start_command)
        logger.info("Recording start command launched")

    async def _stop_recording_process(self) -> None:
        if self._recording_stop_command:
            stop_process = await asyncio.create_subprocess_shell(self._recording_stop_command)
            await stop_process.wait()

        if self._recording_process and self._recording_process.returncode is None:
            self._recording_process.terminate()
            with contextlib.suppress(ProcessLookupError):
                await self._recording_process.wait()

        self._recording_process = None

    @staticmethod
    def _set_servo_angle(servo: object | None, angle: int) -> None:
        if servo is None:
            return

        with contextlib.suppress(Exception):
            servo.angle = angle  # type: ignore[attr-defined]

    @staticmethod
    def _close_servo(servo: object | None) -> None:
        if servo is None:
            return

        with contextlib.suppress(Exception):
            servo.detach()  # type: ignore[attr-defined]
        with contextlib.suppress(Exception):
            servo.close()  # type: ignore[attr-defined]
