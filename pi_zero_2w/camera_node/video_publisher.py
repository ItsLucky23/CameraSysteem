from __future__ import annotations

import asyncio
import logging
import shlex

logger = logging.getLogger(__name__)


# V1 is locked to 1080p at 45fps. Pi 5 ingest reads raw I420 with these exact dimensions.
FRAME_WIDTH = 1920
FRAME_HEIGHT = 1080
FRAME_RATE = 45
KEYFRAME_INTERVAL_FRAMES = FRAME_RATE  # ~1 keyframe per second for snappy startup


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

    async def start(self, *, rtp_host: str, rtp_port: int) -> None:
        if self._process is not None and self._process.returncode is None:
            if self._target_host == rtp_host and self._target_port == rtp_port:
                logger.info("VideoPublisher already streaming to %s:%s", rtp_host, rtp_port)
                return
            logger.info("VideoPublisher retargeting stream to %s:%s", rtp_host, rtp_port)
            await self.stop()

        cmd = self._build_pipeline_command(rtp_host=rtp_host, rtp_port=rtp_port)
        logger.info("Starting video stream: %s", cmd)

        self._process = await asyncio.create_subprocess_shell(
            cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        self._target_host = rtp_host
        self._target_port = rtp_port

        # Drain stderr in the background so the pipe does not fill and deadlock the pipeline.
        asyncio.create_task(self._drain_stderr(self._process))

    async def stop(self) -> None:
        if self._process is None:
            return

        process = self._process
        self._process = None
        self._target_host = None
        self._target_port = None

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

    @staticmethod
    def _build_pipeline_command(*, rtp_host: str, rtp_port: int) -> str:
        # rpicam-vid drives the hardware encoder; ffmpeg handles RTP packetization only.
        rpicam_args = [
            "rpicam-vid",
            "-n",                                   # no preview
            "-t", "0",                              # run forever
            "--width", str(FRAME_WIDTH),
            "--height", str(FRAME_HEIGHT),
            "--framerate", str(FRAME_RATE),
            "--codec", "h264",
            "--inline",                             # inline SPS/PPS so receiver can join mid-stream
            "--intra", str(KEYFRAME_INTERVAL_FRAMES),
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

    @staticmethod
    async def _drain_stderr(process: asyncio.subprocess.Process) -> None:
        if process.stderr is None:
            return

        while True:
            line = await process.stderr.readline()
            if not line:
                break
            text = line.decode(errors="replace").rstrip()
            if text:
                logger.debug("video pipeline: %s", text)
