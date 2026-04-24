from __future__ import annotations

import asyncio
import logging
import re
import shlex
import time

logger = logging.getLogger(__name__)


# V1 is locked to 1080p; fps + bitrate come from Pi 5 per-camera config.
FRAME_WIDTH = 1920
FRAME_HEIGHT = 1080

# ffmpeg prints stats to stderr like:
#   frame=  123 fps= 30 q=-1.0 size=...
# Default cadence is ~every 500ms. We parse both the cumulative frame count and
# the instantaneous fps to drive Pi 5 telemetry.
_FFMPEG_STATS_RE = re.compile(r"frame=\s*(\d+)\s+fps=\s*([\d.]+)")


class VideoPublisher:
    """
    Manages a single rpicam-vid -> ffmpeg -> RTP pipeline per camera node.

    Target: H.264 RTP over UDP to the Pi 5 ingest port. The Pi Zero 2W's hardware H.264
    encoder does the heavy lifting. ffmpeg is used only for RTP packetization since
    rpicam-vid does not emit RTP directly.
    """

    def __init__(self) -> None:
        self._process: asyncio.subprocess.Process | None = None
        self._target_host: str | None = None
        self._target_port: int | None = None
        self._target_fps: int | None = None
        self._target_bitrate_bps: int | None = None
        self._measured_fps: float | None = None
        self._last_frame_at: float | None = None
        self._last_frame_count: int = 0

    async def start(
        self,
        *,
        rtp_host: str,
        rtp_port: int,
        target_fps: int,
        bitrate_bps: int,
    ) -> None:
        if self._process is not None and self._process.returncode is None:
            if (
                self._target_host == rtp_host
                and self._target_port == rtp_port
                and self._target_fps == target_fps
                and self._target_bitrate_bps == bitrate_bps
            ):
                logger.info("VideoPublisher already streaming to %s:%s", rtp_host, rtp_port)
                return
            logger.info(
                "VideoPublisher restarting stream to %s:%s (fps=%s bitrate=%s)",
                rtp_host,
                rtp_port,
                target_fps,
                bitrate_bps,
            )
            await self.stop()

        cmd = self._build_pipeline_command(
            rtp_host=rtp_host,
            rtp_port=rtp_port,
            target_fps=target_fps,
            bitrate_bps=bitrate_bps,
        )
        logger.info("Starting video stream: %s", cmd)

        self._process = await asyncio.create_subprocess_shell(
            cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        self._target_host = rtp_host
        self._target_port = rtp_port
        self._target_fps = target_fps
        self._target_bitrate_bps = bitrate_bps

        # Drain stderr in the background so the pipe does not fill and deadlock the pipeline.
        asyncio.create_task(self._drain_stderr(self._process))

    async def stop(self) -> None:
        if self._process is None:
            return

        process = self._process
        self._process = None
        self._target_host = None
        self._target_port = None
        self._target_fps = None
        self._target_bitrate_bps = None
        self._measured_fps = None
        self._last_frame_at = None
        self._last_frame_count = 0

        if process.returncode is not None:
            return

        try:
            process.terminate()
        except ProcessLookupError:
            return

        try:
            await asyncio.wait_for(process.wait(), timeout=3.0)
        except asyncio.TimeoutError:
            try:
                process.kill()
            except ProcessLookupError:
                return
            await process.wait()

    def is_running(self) -> bool:
        return self._process is not None and self._process.returncode is None

    def get_stats(self) -> tuple[float | None, int | None]:
        """
        Returns (measured_fps, last_frame_age_ms). Either value is None when the
        pipeline is idle or ffmpeg has not produced a stats line yet.
        """
        if not self.is_running() or self._last_frame_at is None:
            return None, None

        age_ms = int(max(0.0, (time.monotonic() - self._last_frame_at) * 1000))
        return self._measured_fps, age_ms

    @staticmethod
    def _build_pipeline_command(
        *,
        rtp_host: str,
        rtp_port: int,
        target_fps: int,
        bitrate_bps: int,
    ) -> str:
        # rpicam-vid drives the hardware encoder; ffmpeg handles RTP packetization only.
        # Keyframe every ~1s for snappy WebRTC startup.
        keyframe_interval = max(1, target_fps)

        rpicam_args = [
            "rpicam-vid",
            "-n",                                   # no preview
            "-t", "0",                              # run forever
            "--width", str(FRAME_WIDTH),
            "--height", str(FRAME_HEIGHT),
            "--framerate", str(target_fps),
            "--bitrate", str(bitrate_bps),
            "--codec", "h264",
            "--inline",                             # inline SPS/PPS so receiver can join mid-stream
            "--intra", str(keyframe_interval),
            "--profile", "baseline",
            "--level", "4.2",
            "-o", "-",
        ]

        rtp_target = f"rtp://{rtp_host}:{rtp_port}?pkt_size=1200"
        ffmpeg_args = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel", "warning",
            "-fflags", "+genpts",
            "-f", "h264",
            "-i", "pipe:0",
            "-c:v", "copy",
            "-f", "rtp",
            rtp_target,
        ]

        return (
            f"{shlex.join(rpicam_args)} | {shlex.join(ffmpeg_args)}"
        )

    async def _drain_stderr(self, process: asyncio.subprocess.Process) -> None:
        if process.stderr is None:
            return

        while True:
            # ffmpeg writes stats with \r (carriage return) between updates rather
            # than \n, so readline() would block until the process exits. readuntil
            # on \r keeps us responsive to the ~500ms stats cadence.
            try:
                chunk = await process.stderr.readuntil(b"\r")
            except asyncio.IncompleteReadError as error:
                chunk = error.partial
                if not chunk:
                    break
            except asyncio.LimitOverrunError:
                # Oversized line; skip and keep reading.
                continue

            text = chunk.decode(errors="replace").rstrip()
            if not text:
                continue

            self._consume_stderr_line(text)

    def _consume_stderr_line(self, text: str) -> None:
        match = _FFMPEG_STATS_RE.search(text)
        if match is None:
            logger.debug("video pipeline: %s", text)
            return

        frame_count = int(match.group(1))
        try:
            fps_value = float(match.group(2))
        except ValueError:
            return

        if frame_count > self._last_frame_count:
            self._last_frame_at = time.monotonic()
            self._last_frame_count = frame_count

        self._measured_fps = fps_value
