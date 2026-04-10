from __future__ import annotations

from abc import ABC, abstractmethod

from camera_node.models import CameraState


class HardwareAdapter(ABC):
    @abstractmethod
    async def startup(self) -> None:
        """Initialize hardware resources."""

    @abstractmethod
    async def shutdown(self) -> None:
        """Release hardware resources."""

    @abstractmethod
    async def get_state(self) -> CameraState:
        """Read current camera node state."""

    @abstractmethod
    async def pan(self, delta: int) -> None:
        """Move camera pan axis by delta."""

    @abstractmethod
    async def tilt(self, delta: int) -> None:
        """Move camera tilt axis by delta."""

    @abstractmethod
    async def set_ir_mode(self, mode: str) -> None:
        """Set infrared mode to off/on/auto."""

    @abstractmethod
    async def set_recording(self, recording: bool) -> None:
        """Start or stop recording pipeline."""
