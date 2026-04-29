from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import time
# MOTION DETECTION LOGIC (start) — datetime/timezone were only used by motion callbacks
# from datetime import datetime, timezone
# MOTION DETECTION LOGIC (end)

from camera_node.adapters.base import HardwareAdapter
from camera_node.models import CameraState
from camera_node.video_publisher import VideoPublisher


logger = logging.getLogger(__name__)


# Lux thresholds drive the auto IR controller. Below LUX_FULL the LED runs at
# 100% strength; above LUX_OFF it shuts off. Values in between map linearly.
LUX_FULL = 5.0
LUX_OFF = 30.0
LUX_SAMPLE_INTERVAL_S = 5.0
LUX_STALE_AFTER_S = 30.0
LUX_EWMA_ALPHA = 0.4
# Hysteresis: require this many consecutive 0-strength targets before the LED
# actually switches off in auto mode. Prevents flicker when lux hovers around
# LUX_OFF (e.g., a passing flashlight).
AUTO_OFF_STREAK_THRESHOLD = 2


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
        # auto controller's pick in 'auto', and 0 when off.
        self._ir_strength: int = 100
        self._ir_active_strength: int = 0
        self._ir_lux_target_strength: int = 0
        self._ir_off_streak: int = 0
        self._lux_smoothed: float | None = None
        self._lux_sampler_task: asyncio.Task[None] | None = None

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

        # Lux sampler runs continuously regardless of mode — auto needs it,
        # and keeping it warm means switching to auto reacts on the next tick.
        if self._lux_sampler_task is None or self._lux_sampler_task.done():
            self._lux_sampler_task = asyncio.create_task(
                self._lux_sampler_loop(),
                name="ir-lux-sampler",
            )

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

        if self._lux_sampler_task is not None:
            self._lux_sampler_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._lux_sampler_task
            self._lux_sampler_task = None

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
        self._state.pan = _clamp(self._state.pan + delta, pan_min, pan_max)
        self._set_servo_angle(self._pan_servo, self._state.pan)

    async def tilt(self, delta: int) -> None:
        self._state.tilt = _clamp(self._state.tilt + delta, -90, 90)
        self._set_servo_angle(self._tilt_servo, self._state.tilt)

    async def set_ir_mode(self, mode: str, *, strength: int | None = None) -> None:
        self._state.ir_mode = mode

        if mode == "on":
            if strength is not None:
                self._ir_strength = _clamp(strength, 0, 100)
                self._state.ir_strength = self._ir_strength
            self._apply_ir_pwm(self._ir_strength)
            self._state.ir_enabled = self._ir_strength > 0
            return

        if mode == "off":
            self._apply_ir_pwm(0)
            self._state.ir_enabled = False
            return

        if mode == "auto":
            # Reset hysteresis so the controller picks fresh on the next sample.
            self._ir_off_streak = 0
            # Apply current lux-derived target immediately for snappy feedback;
            # the sampler loop refines it within LUX_SAMPLE_INTERVAL_S.
            self._apply_ir_pwm(self._ir_lux_target_strength)
            self._state.ir_enabled = self._ir_lux_target_strength > 0
            return

    async def set_ir_strength(self, strength: int) -> None:
        self._ir_strength = _clamp(strength, 0, 100)
        self._state.ir_strength = self._ir_strength
        # Only takes effect immediately in 'on' mode. In 'auto' the persisted
        # value is updated for the next 'on' switch but the LED keeps tracking
        # the lux-derived target; in 'off' nothing happens.
        if self._state.ir_mode == "on":
            self._apply_ir_pwm(self._ir_strength)
            self._state.ir_enabled = self._ir_strength > 0

    def _apply_ir_pwm(self, strength: int) -> None:
        clamped = _clamp(strength, 0, 100)
        self._ir_active_strength = clamped
        self._state.ir_active_strength = clamped
        if self._ir_device is None:
            return
        with contextlib.suppress(Exception):
            self._ir_device.value = clamped / 100.0  # type: ignore[attr-defined]

    async def _lux_sampler_loop(self) -> None:
        # Reads rpicam-vid's per-frame metadata file. The video publisher
        # opens it with --metadata; if the stream is not running the file is
        # missing or stale and the controller falls back to no-lux behavior.
        metadata_path = VideoPublisher.metadata_file_path()
        diagnosed_once = False
        try:
            while True:
                await asyncio.sleep(LUX_SAMPLE_INTERVAL_S)
                lux = self._read_latest_lux(metadata_path)
                if lux is None and not diagnosed_once:
                    # First miss diagnostics: the user usually wants to know
                    # whether rpicam-vid is writing the file at all and what
                    # the schema looks like. Logged once to avoid spamming.
                    self._log_lux_diagnostics(metadata_path)
                    diagnosed_once = True
                if lux is None:
                    self._lux_smoothed = None
                else:
                    if self._lux_smoothed is None:
                        self._lux_smoothed = lux
                    else:
                        self._lux_smoothed = (
                            LUX_EWMA_ALPHA * lux + (1.0 - LUX_EWMA_ALPHA) * self._lux_smoothed
                        )
                # Always log a summary line so the user can tail journalctl and
                # confirm the auto controller is alive and what it's seeing.
                logger.info(
                    "[ir-auto] lux=%s smoothed=%s mode=%s target=%s active=%s",
                    f"{lux:.1f}" if lux is not None else "—",
                    f"{self._lux_smoothed:.1f}" if self._lux_smoothed is not None else "—",
                    self._state.ir_mode,
                    self._ir_lux_target_strength,
                    self._ir_active_strength,
                )
                self._evaluate_auto_ir()
        except asyncio.CancelledError:
            raise
        except Exception as error:  # noqa: BLE001
            logger.exception("Lux sampler loop crashed: %s", error)

    @staticmethod
    def _log_lux_diagnostics(metadata_path: str) -> None:
        try:
            stat = os.stat(metadata_path)
        except FileNotFoundError:
            logger.warning(
                "[ir-auto] metadata file missing at %s — rpicam-vid may not support --metadata "
                "or the stream is not running. Check `rpicam-vid --help | grep metadata`.",
                metadata_path,
            )
            return
        except OSError as error:
            logger.warning("[ir-auto] cannot stat metadata file %s: %s", metadata_path, error)
            return

        try:
            with open(metadata_path, "r", encoding="utf-8") as handle:
                head = handle.read(2048)
        except OSError as error:
            logger.warning("[ir-auto] cannot read metadata file %s: %s", metadata_path, error)
            return

        logger.warning(
            "[ir-auto] no Lux parsed from metadata file. size=%s mtime_age=%.1fs head=%r",
            stat.st_size,
            time.time() - stat.st_mtime,
            head[:512],
        )

    @staticmethod
    def _read_latest_lux(metadata_path: str) -> float | None:
        # rpicam-vid appends one JSON object per frame to this file. We read
        # only the tail end (last 8 KB) and parse the most recent complete
        # object. Truncate the file after a successful read so it doesn't grow
        # unbounded over a long recording.
        try:
            stat = os.stat(metadata_path)
        except FileNotFoundError:
            return None
        except OSError:
            return None

        if time.time() - stat.st_mtime > LUX_STALE_AFTER_S:
            return None
        if stat.st_size == 0:
            return None

        try:
            with open(metadata_path, "r", encoding="utf-8") as handle:
                seek_to = max(0, stat.st_size - 8192)
                handle.seek(seek_to)
                tail = handle.read()
        except OSError:
            return None

        # rpicam-vid emits objects newline-delimited or as a JSON array stream;
        # tolerate both by extracting the last balanced { ... } block.
        last_lux: float | None = None
        depth = 0
        start = -1
        for index, char in enumerate(tail):
            if char == "{":
                if depth == 0:
                    start = index
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0 and start >= 0:
                    chunk = tail[start:index + 1]
                    try:
                        obj = json.loads(chunk)
                    except json.JSONDecodeError:
                        start = -1
                        continue
                    if isinstance(obj, dict) and isinstance(obj.get("Lux"), (int, float)):
                        last_lux = float(obj["Lux"])
                    start = -1

        if last_lux is not None:
            with contextlib.suppress(OSError):
                # Truncate to keep the file bounded; we already extracted what we need.
                with open(metadata_path, "w", encoding="utf-8") as handle:
                    handle.truncate()

        return last_lux

    def _evaluate_auto_ir(self) -> None:
        if self._state.ir_mode != "auto":
            return

        lux = self._lux_smoothed
        if lux is None:
            target = 0
        elif lux <= LUX_FULL:
            target = 100
        elif lux >= LUX_OFF:
            target = 0
        else:
            ratio = (LUX_OFF - lux) / (LUX_OFF - LUX_FULL)
            target = round(ratio * 100)

        # Hysteresis only kicks in on the off transition. Other strength
        # changes apply immediately so the dimmer tracks ambient light smoothly.
        if target == 0 and self._ir_active_strength > 0:
            self._ir_off_streak += 1
            if self._ir_off_streak < AUTO_OFF_STREAK_THRESHOLD:
                return
        else:
            self._ir_off_streak = 0

        self._ir_lux_target_strength = target
        self._apply_ir_pwm(target)
        self._state.ir_enabled = target > 0

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
