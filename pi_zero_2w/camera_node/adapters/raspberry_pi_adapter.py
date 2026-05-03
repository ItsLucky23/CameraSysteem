from __future__ import annotations

import asyncio
import contextlib
import logging
# MOTION DETECTION LOGIC (start) — datetime/timezone were only used by motion callbacks
# from datetime import datetime, timezone
# MOTION DETECTION LOGIC (end)

from camera_node.adapters.base import HardwareAdapter
from camera_node.log_flags import is_log_enabled
from camera_node.models import CameraState
from camera_node.video_publisher import VideoPublisher


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
        # MOTION DETECTION LOGIC (start)
        # motion_gpio_pin: int | None,
        # MOTION DETECTION LOGIC (end)
        recording_start_command: str | None,
        recording_stop_command: str | None,
    ) -> None:
        self._ir_gpio_pin = ir_gpio_pin
        self._pan_servo_gpio_pin = pan_servo_gpio_pin
        self._tilt_servo_gpio_pin = tilt_servo_gpio_pin
        # MOTION DETECTION LOGIC (start)
        # self._motion_gpio_pin = motion_gpio_pin
        # MOTION DETECTION LOGIC (end)
        self._recording_start_command = recording_start_command
        self._recording_stop_command = recording_stop_command

        self._ir_device = None
        self._pan_servo = None
        self._tilt_servo = None
        # MOTION DETECTION LOGIC (start)
        # self._motion_sensor = None
        # MOTION DETECTION LOGIC (end)
        self._recording_process: asyncio.subprocess.Process | None = None
        self._video_publisher = VideoPublisher()
        self._talkback_enabled = False

        # IR PWM state. _ir_strength is the persisted user-set value (used in
        # 'on' mode). _ir_active_strength reflects what the LED is actually
        # being driven at right now — equals _ir_strength in 'on' mode, the
        # last value pushed by the Pi 5 auto controller in 'auto', and 0 when
        # off. Auto-mode decisions are made on the Pi 5 (cameraIRController)
        # by analyzing thumbnail brightness; the Pi Zero just receives
        # irSetStrength commands and applies them.
        self._ir_strength: int = 100
        self._ir_active_strength: int = 0

        self._state = CameraState(
            is_online=True,
            mode="live",
            ir_mode="auto",
            ir_enabled=False,
            ir_strength=100,
            ir_active_strength=0,
            pan=0,
            tilt=0,
            temperature_c=None,
            # MOTION DETECTION LOGIC (start) — paused; left as False/None literals
            motion_detected=False,
            last_motion_at=None,
            # MOTION DETECTION LOGIC (end)
            recording=False,
            zoom_level=50,
        )

    async def startup(self) -> None:
        try:
            from gpiozero import AngularServo, PWMOutputDevice  # type: ignore
        except Exception as error:  # noqa: BLE001
            logger.warning("Failed to import gpiozero drivers: %s", error)
            return

        if self._ir_gpio_pin is not None:
            try:
                # 200 Hz: above human flicker, well below MOSFET switching limit
                # and IR LED recovery time. Software PWM via lgpio works on
                # the Pi Zero 2W without pigpio.
                self._ir_device = PWMOutputDevice(
                    self._ir_gpio_pin,
                    frequency=200,
                    initial_value=0.0,
                )
                logger.info("IR device initialized on GPIO %s (PWM @ 200 Hz)", self._ir_gpio_pin)
            except Exception as error:  # noqa: BLE001
                logger.warning("Failed to initialize IR GPIO device: %s", error)
                self._ir_device = None


        # SG90 spec: 0.5ms (-90°) to 2.5ms (+90°), 20ms frame (50Hz). gpiozero's
        # defaults (1ms/2ms) only sweep half the SG90's physical range, which
        # makes it look like the servo is "stuck" because button clicks at
        # PTZ_STEP=5° produce barely-perceptible motion AND the servo can't
        # reach its end-stops. Use SG90-correct widths so a full -90..+90
        # sweep actually corresponds to the full mechanical range.
        sg90_min_pw = 0.5 / 1000
        sg90_max_pw = 2.5 / 1000
        sg90_frame = 20 / 1000

        if self._pan_servo_gpio_pin is not None:
            try:
                self._pan_servo = AngularServo(
                    self._pan_servo_gpio_pin,
                    min_angle=-90,
                    max_angle=90,
                    initial_angle=0,
                    min_pulse_width=sg90_min_pw,
                    max_pulse_width=sg90_max_pw,
                    frame_width=sg90_frame,
                )
                logger.info("Pan SG90 servo initialized on GPIO %s (pulse %s-%sms @ %sHz)",
                            self._pan_servo_gpio_pin,
                            sg90_min_pw * 1000, sg90_max_pw * 1000, 1 / sg90_frame)
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
                    min_pulse_width=sg90_min_pw,
                    max_pulse_width=sg90_max_pw,
                    frame_width=sg90_frame,
                )
                logger.info("Tilt SG90 servo initialized on GPIO %s (pulse %s-%sms @ %sHz)",
                            self._tilt_servo_gpio_pin,
                            sg90_min_pw * 1000, sg90_max_pw * 1000, 1 / sg90_frame)
            except Exception as error:  # noqa: BLE001
                logger.warning("Failed to initialize tilt SG90 servo: %s", error)
                self._tilt_servo = None

        # MOTION DETECTION LOGIC (start)
        # if self._motion_gpio_pin is not None:
        #     try:
        #         from gpiozero import MotionSensor  # type: ignore
        #         self._motion_sensor = MotionSensor(self._motion_gpio_pin)
        #         # gpiozero invokes these from a background thread; we only
        #         # mutate plain Python attributes so no asyncio handoff needed.
        #         self._motion_sensor.when_motion = self._on_motion_detected
        #         self._motion_sensor.when_no_motion = self._on_motion_cleared
        #         # Seed initial state in case the sensor is already triggered.
        #         self._state.motion_detected = bool(self._motion_sensor.motion_detected)
        #         logger.info("PIR motion sensor initialized on GPIO %s", self._motion_gpio_pin)
        #     except Exception as error:  # noqa: BLE001
        #         logger.warning("Failed to initialize PIR motion sensor: %s", error)
        #         self._motion_sensor = None
        # MOTION DETECTION LOGIC (end)

    # MOTION DETECTION LOGIC (start)
    # def _on_motion_detected(self) -> None:
    #     self._state.motion_detected = True
    #     self._state.last_motion_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    #     logger.info("Motion detected on GPIO %s", self._motion_gpio_pin)
    #
    # def _on_motion_cleared(self) -> None:
    #     self._state.motion_detected = False
    # MOTION DETECTION LOGIC (end)

    async def shutdown(self) -> None:
        await self._video_publisher.stop()
        await self._stop_recording_process()

        self._close_servo(self._pan_servo)
        self._close_servo(self._tilt_servo)
        self._pan_servo = None
        self._tilt_servo = None

        if self._ir_device is not None:
            with contextlib.suppress(Exception):
                self._ir_device.value = 0.0  # type: ignore[attr-defined]
            with contextlib.suppress(Exception):
                self._ir_device.close()
            self._ir_device = None

        # MOTION DETECTION LOGIC (start)
        # if self._motion_sensor is not None:
        #     with contextlib.suppress(Exception):
        #         self._motion_sensor.when_motion = None
        #     with contextlib.suppress(Exception):
        #         self._motion_sensor.when_no_motion = None
        #     with contextlib.suppress(Exception):
        #         self._motion_sensor.close()
        #     self._motion_sensor = None
        # MOTION DETECTION LOGIC (end)

    async def get_state(self) -> CameraState:
        measured_fps, last_frame_age_ms = self._video_publisher.get_stats()
        return CameraState(
            is_online=self._state.is_online,
            mode=self._state.mode,
            ir_mode=self._state.ir_mode,
            ir_enabled=self._state.ir_enabled,
            ir_strength=self._ir_strength,
            ir_active_strength=self._ir_active_strength,
            pan=self._state.pan,
            tilt=self._state.tilt,
            temperature_c=self._state.temperature_c,
            # MOTION DETECTION LOGIC (start) — paused; carry False/None literals
            motion_detected=False,
            last_motion_at=None,
            # MOTION DETECTION LOGIC (end)
            recording=self._state.recording,
            measured_fps=measured_fps,
            last_frame_age_ms=last_frame_age_ms,
            zoom_level=self._state.zoom_level,
        )

    async def pan(self, delta: int) -> None:
        pan_min = -90 if self._pan_servo is not None else -180
        pan_max = 90 if self._pan_servo is not None else 180
        previous = self._state.pan
        self._state.pan = _clamp(self._state.pan + delta, pan_min, pan_max)
        # Always log pan/tilt. They're rare (hold-to-move tops out at 5Hz) and
        # we need to see whether the command actually reached the adapter when
        # diagnosing dead servo buttons.
        logger.info("[ptz] pan delta=%s previous=%s new=%s servo_attached=%s",
                    delta, previous, self._state.pan, self._pan_servo is not None)
        self._set_servo_angle(self._pan_servo, self._state.pan)

    async def tilt(self, delta: int) -> None:
        previous = self._state.tilt
        self._state.tilt = _clamp(self._state.tilt + delta, -90, 90)
        logger.info("[ptz] tilt delta=%s previous=%s new=%s servo_attached=%s",
                    delta, previous, self._state.tilt, self._tilt_servo is not None)
        self._set_servo_angle(self._tilt_servo, self._state.tilt)

    async def set_ir_mode(self, mode: str, *, strength: int | None = None) -> None:
        previous_mode = self._state.ir_mode
        self._state.ir_mode = mode
        if is_log_enabled("ir") and previous_mode != mode:
            logger.info("[ir] mode change %s -> %s (strength_arg=%s)", previous_mode, mode, strength)

        # HARDWARE IR SENSOR DELEGATION (start)
        # The IR ring's onboard CdS photoresistor handles auto on/off in
        # hardware. We just supply full power for "on"/"auto" (the ring's
        # sensor decides the actual brightness) and zero for "off".
        # 'auto' is treated as 'on' so legacy DB rows still light the ring.
        # The strength arg is ignored on purpose — the ring decides.
        if mode == "on" or mode == "auto":
            self._apply_ir_pwm(100)
            self._state.ir_enabled = True
            return
        if mode == "off":
            self._apply_ir_pwm(0)
            self._state.ir_enabled = False
            return
        # HARDWARE IR SENSOR DELEGATION (end)

        # Original software-driven behavior preserved below for easy revert:
        # if mode == "on":
        #     if strength is not None:
        #         self._ir_strength = _clamp(strength, 0, 100)
        #         self._state.ir_strength = self._ir_strength
        #     self._apply_ir_pwm(self._ir_strength)
        #     self._state.ir_enabled = self._ir_strength > 0
        #     return
        #
        # if mode == "off":
        #     self._apply_ir_pwm(0)
        #     self._state.ir_enabled = False
        #     return
        #
        # if mode == "auto":
        #     # Auto decisions are made on the Pi 5 (cameraIRController). Until
        #     # the next irSetStrength arrives, keep whatever the LED was last
        #     # at so the user doesn't see a flash to 0 then back up.
        #     if is_log_enabled("ir"):
        #         logger.info("[ir] mode=auto — awaiting Pi 5 irSetStrength (current=%s)", self._ir_active_strength)
        #     return

    async def set_ir_strength(self, strength: int, *, source: str) -> None:
        # HARDWARE IR SENSOR DELEGATION (start)
        # Brightness is governed entirely by the ring's onboard CdS sensor,
        # so we no-op all incoming strength commands. Defensive belt: nothing
        # upstream should be enqueuing irSetStrength anymore (Pi 5 controller
        # is silenced), but if something slips through we stay quiet.
        if is_log_enabled("ir"):
            logger.info(
                "[ir] set_ir_strength delegated to ring CdS sensor — no-op (input=%s source=%s)",
                strength, source,
            )
        return
        # HARDWARE IR SENSOR DELEGATION (end)

        # Original software-driven behavior preserved below for easy revert:
        # clamped = _clamp(strength, 0, 100)
        # is_system = source.startswith("system:")
        # if is_log_enabled("ir"):
        #     logger.info(
        #         "[ir] set_ir_strength input=%s clamped=%s mode=%s source=%s",
        #         strength, clamped, self._state.ir_mode, source,
        #     )
        # if self._state.ir_mode == "on":
        #     if is_system:
        #         # Auto-controller command arrived while user is in manual ON
        #         # mode — likely a stale enqueue from before the mode flip,
        #         # OR a controller firing despite the gate. Either way we must
        #         # NOT apply it, otherwise the LED brightness drifts based on
        #         # scene luminance even though the user picked a fixed value.
        #         if is_log_enabled("ir"):
        #             logger.info("[ir] set_ir_strength ignored — mode=on but source=system")
        #         return
        #     # User slider drag: this is the operator's persisted manual value.
        #     self._ir_strength = clamped
        #     self._state.ir_strength = self._ir_strength
        #     self._apply_ir_pwm(clamped)
        #     self._state.ir_enabled = clamped > 0
        #     return
        # if self._state.ir_mode == "auto":
        #     if not is_system:
        #         # User slider drag arrived while in auto mode — the slider
        #         # is meant to be disabled in the UI when in auto, so this
        #         # is either a race or a stale command. Don't let it hijack
        #         # the auto controller's value.
        #         if is_log_enabled("ir"):
        #             logger.info("[ir] set_ir_strength ignored — mode=auto but source=user")
        #         return
        #     # Pi 5 auto controller drove this — apply to the LED but do NOT
        #     # touch self._ir_strength (that holds the operator's last manual
        #     # value, restored when the user flips Auto -> On).
        #     self._apply_ir_pwm(clamped)
        #     self._state.ir_enabled = clamped > 0
        #     return
        # # mode == "off": user explicitly disabled IR; ignore stray strength
        # # commands so an in-flight auto-IR write can't relight the LED.
        # if is_log_enabled("ir"):
        #     logger.info("[ir] set_ir_strength ignored — mode=off")

    def _apply_ir_pwm(self, strength: int) -> None:
        clamped = _clamp(strength, 0, 100)
        previous = self._ir_active_strength
        self._ir_active_strength = clamped
        self._state.ir_active_strength = clamped
        if is_log_enabled("ir") and previous != clamped:
            logger.info("[ir] PWM duty cycle %s%% -> %s%% (mode=%s)", previous, clamped, self._state.ir_mode)
        if self._ir_device is None:
            return
        with contextlib.suppress(Exception):
            self._ir_device.value = clamped / 100.0  # type: ignore[attr-defined]

    async def set_recording(self, recording: bool) -> None:
        if recording:
            await self._start_recording_process()
            self._state.recording = True
            self._state.mode = "record"
            return

        await self._stop_recording_process()
        self._state.recording = False
        self._state.mode = "live"

    async def start_video_stream(
        self,
        *,
        rtp_host: str,
        rtp_port: int,
        target_fps: int,
        bitrate_bps: int,
        width: int | None = None,
        height: int | None = None,
    ) -> None:
        await self._video_publisher.start(
            rtp_host=rtp_host,
            rtp_port=rtp_port,
            target_fps=target_fps,
            bitrate_bps=bitrate_bps,
            width=width,
            height=height,
        )

    async def stop_video_stream(self) -> None:
        await self._video_publisher.stop()

    async def set_zoom(self, level: int) -> None:
        try:
            new_level = _clamp(int(level), 1, 100)
            old_level = self._state.zoom_level
            self._state.zoom_level = new_level
            print(f"[adapter] set_zoom level={old_level} -> {new_level}")
        except Exception as error:  # noqa: BLE001
            print(f"[adapter] set_zoom failed: {error}")

    async def set_talkback(self, enabled: bool) -> None:
        try:
            self._talkback_enabled = bool(enabled)
            print(f"[adapter] set_talkback enabled={self._talkback_enabled}")
        except Exception as error:  # noqa: BLE001
            print(f"[adapter] set_talkback failed: {error}")

    async def _start_recording_process(self) -> None:
        if self._recording_process and self._recording_process.returncode is None:
            if is_log_enabled("recording"):
                logger.info("[recording] start requested but process already running pid=%s", self._recording_process.pid)
            return

        if not self._recording_start_command:
            logger.info("No recording start command configured; keeping software recording state only")
            return

        self._recording_process = await asyncio.create_subprocess_shell(self._recording_start_command)
        logger.info("Recording start command launched")
        if is_log_enabled("recording"):
            logger.info("[recording] spawn pid=%s cmd=%r", self._recording_process.pid, self._recording_start_command)

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
