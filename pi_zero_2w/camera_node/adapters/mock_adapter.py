from __future__ import annotations

import asyncio

import logging

from camera_node.adapters.base import HardwareAdapter
from camera_node.models import CameraState


logger = logging.getLogger(__name__)


def _clamp(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, value))


class MockHardwareAdapter(HardwareAdapter):
    """In-memory adapter for development without GPIO/camera hardware."""

    def __init__(self) -> None:
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
            # MOTION DETECTION LOGIC (start) — paused; left as False literal
            motion_detected=False,
            # MOTION DETECTION LOGIC (end)
            recording=False,
            zoom_level=50,
        )
        self._talkback_enabled = False

    async def startup(self) -> None:
        await asyncio.sleep(0)

    async def shutdown(self) -> None:
        await asyncio.sleep(0)

    async def get_state(self) -> CameraState:
        await asyncio.sleep(0)
        return CameraState(
            is_online=self._state.is_online,
            mode=self._state.mode,
            ir_mode=self._state.ir_mode,
            ir_enabled=self._state.ir_enabled,
            ir_strength=self._state.ir_strength,
            ir_active_strength=self._state.ir_active_strength,
            pan=self._state.pan,
            tilt=self._state.tilt,
            temperature_c=self._state.temperature_c,
            # MOTION DETECTION LOGIC (start) — paused; left as False literal
            motion_detected=False,
            # MOTION DETECTION LOGIC (end)
            recording=self._state.recording,
            zoom_level=self._state.zoom_level,
        )

    async def pan(self, delta: int) -> None:
        await asyncio.sleep(0)
        self._state.pan = _clamp(self._state.pan + delta, -180, 180)

    async def tilt(self, delta: int) -> None:
        await asyncio.sleep(0)
        self._state.tilt = _clamp(self._state.tilt + delta, -90, 90)

    async def set_ir_mode(self, mode: str, *, strength: int | None = None) -> None:
        await asyncio.sleep(0)
        self._state.ir_mode = mode
        if mode == "on":
            if strength is not None:
                self._state.ir_strength = _clamp(strength, 0, 100)
            self._state.ir_active_strength = self._state.ir_strength
            self._state.ir_enabled = self._state.ir_strength > 0
        elif mode == "off":
            self._state.ir_active_strength = 0
            self._state.ir_enabled = False
        elif mode == "auto":
            # Mock can't read lux, so fake mid-level so the UI has something to show.
            self._state.ir_active_strength = 50
            self._state.ir_enabled = True

    async def set_ir_strength(self, strength: int, *, source: str) -> None:
        await asyncio.sleep(0)
        clamped = _clamp(strength, 0, 100)
        is_system = source.startswith("system:")
        if self._state.ir_mode == "on":
            if is_system:
                # Mirror the rpi adapter: don't let auto-controller commands
                # affect the LED while in manual ON mode.
                return
            self._state.ir_strength = clamped
            self._state.ir_active_strength = clamped
            self._state.ir_enabled = clamped > 0
            return
        if self._state.ir_mode == "auto":
            if not is_system:
                return
            self._state.ir_active_strength = clamped
            self._state.ir_enabled = clamped > 0
            return
        # mode == "off": ignore stray strength commands

    async def set_recording(self, recording: bool) -> None:
        await asyncio.sleep(0)
        self._state.recording = recording
        self._state.mode = "record" if recording else "live"

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
        await asyncio.sleep(0)
        logger.info(
            "MockHardwareAdapter: pretending to start RTP stream to %s:%s (fps=%s bitrate=%s bps width=%s height=%s)",
            rtp_host,
            rtp_port,
            target_fps,
            bitrate_bps,
            width,
            height,
        )

    async def stop_video_stream(self) -> None:
        await asyncio.sleep(0)
        logger.info("MockHardwareAdapter: pretending to stop RTP stream")

    async def set_zoom(self, level: int) -> None:
        await asyncio.sleep(0)
        try:
            new_level = _clamp(int(level), 1, 100)
            old_level = self._state.zoom_level
            self._state.zoom_level = new_level
            print(f"[adapter] set_zoom level={old_level} -> {new_level}")
        except Exception as error:  # noqa: BLE001
            print(f"[adapter] set_zoom failed: {error}")

    async def set_talkback(self, enabled: bool) -> None:
        await asyncio.sleep(0)
        try:
            self._talkback_enabled = bool(enabled)
            print(f"[adapter] set_talkback enabled={self._talkback_enabled}")
        except Exception as error:  # noqa: BLE001
            print(f"[adapter] set_talkback failed: {error}")
