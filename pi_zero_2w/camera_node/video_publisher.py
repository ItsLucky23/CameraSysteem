from __future__ import annotations

import asyncio
import logging
import shlex
import time

logger = logging.getLogger(__name__)


# V1 is locked to 1080p; fps + bitrate come from Pi 5 per-camera config.
FRAME_WIDTH = 1920
FRAME_HEIGHT = 1080


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
        else:
            # If a previous Python run exited without cleanup, rpicam-vid / ffmpeg
            # can still be holding the camera device as orphan processes (PPID=1).
            # A fresh rpicam-vid then fails with "Camera is already in use" and the
            # drain task exits with 0 progress lines. Sweep them before spawning.
            await self._kill_orphan_pipelines()

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
    async def _kill_orphan_pipelines() -> None:
        # Scoped to the two binaries we spawn. `pkill -f` matches the full command
        # line. Never blocks startup on failure — this is best-effort self-heal.
        patterns = ("rpicam-vid", "ffmpeg.*rtp")
        for pattern in patterns:
            try:
                process = await asyncio.create_subprocess_exec(
                    "pkill",
                    "-f",
                    pattern,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                return_code = await process.wait()
                if return_code == 0:
                    logger.info("VideoPublisher killed orphan process matching '%s'", pattern)
            except FileNotFoundError:
                return
            except Exception as error:  # noqa: BLE001
                logger.warning("VideoPublisher orphan sweep failed for '%s': %s", pattern, error)
                return

        # Let the kernel release the camera device before the next rpicam-vid binds it.
        await asyncio.sleep(0.3)

    @staticmethod
    def _build_pipeline_command(
        *,
        rtp_host: str,
        rtp_port: int,
        target_fps: int,
        bitrate_bps: int,
    ) -> str:
        # rpicam-vid drives the hardware encoder; ffmpeg handles RTP packetization only.
        # target_fps == 0 means uncapped: omit --framerate so the sensor runs at its
        # native max rate. Keyframe interval falls back to 30 (one keyframe per
        # second at 30fps; close enough for WebRTC).
        uncapped = target_fps <= 0
        keyframe_interval = 30 if uncapped else max(1, target_fps)

        rpicam_args = [
            "rpicam-vid",
            "-n",                                   # no preview
            "-t", "0",                              # run forever
            "--width", str(FRAME_WIDTH),
            "--height", str(FRAME_HEIGHT),
        ]
        if not uncapped:
            rpicam_args.extend(["--framerate", str(target_fps)])
        rpicam_args.extend([
            "--bitrate", str(bitrate_bps),
            "--codec", "h264",
            "--inline",                             # inline SPS/PPS so receiver can join mid-stream
            "--intra", str(keyframe_interval),
            "--profile", "baseline",
            "--level", "4.2",
            "-o", "-",
        ])

        rtp_target = f"rtp://{rtp_host}:{rtp_port}?pkt_size=1200"
        # stdbuf -eL forces ffmpeg's stderr to be line-buffered. Without this,
        # libc block-buffers stderr when it isn't a tty, so progress lines and
        # error messages pile up for tens of seconds before the drain task sees
        # them — making it impossible to diagnose why the pipeline stops in
        # real time.
        ffmpeg_args = [
            "stdbuf", "-eL",
            "ffmpeg",
            "-hide_banner",
            "-loglevel", "warning",
            "-progress", "pipe:2",               # stream frame=/fps= lines to stderr for telemetry
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

        # ffmpeg's default stats line goes to stderr but is silenced by
        # -loglevel warning. We use -progress pipe:2 in the pipeline instead,
        # which emits newline-terminated key=value lines regardless of log
        # level. readline() handles both those and regular stderr warnings.
        # We also count incoming lines so the caller can confirm the drain is
        # alive when FPS telemetry is suspiciously null.
        lines_seen = 0
        progress_lines_seen = 0

        while True:
            try:
                line = await process.stderr.readline()
            except asyncio.IncompleteReadError:
                break
            except asyncio.LimitOverrunError:
                # rpicam-vid occasionally writes oversized non-terminated chunks on startup.
                # Drop the oversized buffer and keep reading so the drain task stays alive.
                process.stderr._buffer.clear()  # type: ignore[attr-defined]
                continue

            if not line:
                break

            text = line.decode(errors="replace").rstrip()
            if not text:
                continue

            lines_seen += 1
            is_progress = "=" in text and text.split("=", 1)[0].strip() in {
                "frame", "fps", "bitrate", "total_size", "out_time_us",
                "out_time", "dup_frames", "drop_frames", "speed", "progress",
            }
            if is_progress:
                progress_lines_seen += 1
                if progress_lines_seen == 1:
                    logger.info(
                        "VideoPublisher received first ffmpeg progress line after %s stderr lines: %s",
                        lines_seen,
                        text,
                    )

            self._consume_stderr_line(text)

        # Surface the exit code so we can tell the difference between SIGTERM
        # (intentional stop), 0 (clean shutdown), and non-zero (crash).
        return_code = process.returncode
        logger.info(
            "VideoPublisher stderr drain ended: lines_seen=%s progress_lines=%s returncode=%s",
            lines_seen,
            progress_lines_seen,
            return_code,
        )

    def _consume_stderr_line(self, text: str) -> None:
        # Progress lines look like "frame=123", "fps=30.00", "progress=continue".
        if "=" not in text:
            # Non key=value lines are warnings/errors from rpicam-vid or ffmpeg.
            # Logged at INFO so the cause of pipeline death (camera busy, V4L2
            # error, RTP send failure, etc.) is visible without re-deploying
            # at DEBUG level.
            logger.info("video pipeline: %s", text)
            return

        key, _, value = text.partition("=")
        key = key.strip()
        value = value.strip()

        if key == "frame":
            try:
                frame_count = int(value)
            except ValueError:
                return
            if frame_count > self._last_frame_count:
                self._last_frame_at = time.monotonic()
                self._last_frame_count = frame_count
            return

        if key == "fps":
            try:
                self._measured_fps = float(value)
            except ValueError:
                return
            return

        # Other key=value progress fields (bitrate=, total_size=, ...) are noisy
        # but useful when diagnosing — leave at debug.
        logger.debug("video pipeline: %s", text)
