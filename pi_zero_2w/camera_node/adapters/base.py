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
        """Move camera pan axis by delta. Positional servos only."""

    @abstractmethod
    async def tilt(self, delta: int) -> None:
        """Move camera tilt axis by delta. Positional servos only."""

    @abstractmethod
    async def start_pan_continuous(self, *, direction: str) -> None:
        """Start spinning the pan servo continuously.

        direction: 'left' or 'right'. Used with continuous-rotation servos
        where pulse width selects speed + direction (not absolute angle).
        Pair with stop_pan_continuous() to stop.
        """

    @abstractmethod
    async def stop_pan_continuous(self) -> None:
        """Stop the continuous-rotation pan servo (1.5ms neutral pulse)."""

    @abstractmethod
    async def set_ir_mode(self, mode: str, *, strength: int | None = None) -> None:
        """Set infrared mode to off/on/auto.

        strength (0..100) only applies when mode == "on". 'auto' lets the
        lux-driven controller pick the level itself; 'off' ignores it.
        """

    @abstractmethod
    async def set_ir_strength(self, strength: int, *, source: str) -> None:
        """Live PWM-only adjustment without changing mode.

        source distinguishes user slider drags from Pi 5 auto-controller
        commands so the adapter can reject system-driven strength when the
        user is in 'on' mode (and vice versa). Pass 'user' for slider drags,
        'system:ir-auto' for the Pi 5 auto controller.
        """

    @abstractmethod
    async def set_recording(self, recording: bool) -> None:
        """Start or stop recording pipeline."""

    @abstractmethod
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
        """Start sending H.264 RTP to the Pi 5 ingest endpoint.

        width/height default to the adapter's own fallback when None — used by
        legacy command payloads that don't carry resolution.
        """

    @abstractmethod
    async def stop_video_stream(self) -> None:
        """Stop the H.264 RTP stream to Pi 5."""

    @abstractmethod
    async def set_zoom(self, level: int) -> None:
        """Set zoom level (1..100). Stub until real zoom hardware exists."""

    @abstractmethod
    async def set_talkback(self, enabled: bool) -> None:
        """Toggle two-way audio. Stub until speaker hardware exists."""
