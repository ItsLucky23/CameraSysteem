from __future__ import annotations

import asyncio

from camera_node.adapters.base import HardwareAdapter
from camera_node.models import CameraState


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
            pan=0,
            tilt=0,
            temperature_c=None,
            motion_detected=False,
            recording=False,
        )

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
            pan=self._state.pan,
            tilt=self._state.tilt,
            temperature_c=self._state.temperature_c,
            motion_detected=self._state.motion_detected,
            recording=self._state.recording,
        )

    async def pan(self, delta: int) -> None:
        await asyncio.sleep(0)
        self._state.pan = _clamp(self._state.pan + delta, -180, 180)

    async def tilt(self, delta: int) -> None:
        await asyncio.sleep(0)
        self._state.tilt = _clamp(self._state.tilt + delta, -90, 90)

    async def set_ir_mode(self, mode: str) -> None:
        await asyncio.sleep(0)
        self._state.ir_mode = mode
        if mode == "on":
            self._state.ir_enabled = True
        elif mode == "off":
            self._state.ir_enabled = False

    async def set_recording(self, recording: bool) -> None:
        await asyncio.sleep(0)
        self._state.recording = recording
        self._state.mode = "record" if recording else "live"
