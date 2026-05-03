from __future__ import annotations

import asyncio
import contextlib
import logging
import shlex
import time

from camera_node.log_flags import is_log_enabled

logger = logging.getLogger(__name__)


# Sample rate / channel layout the rest of the audio pipeline (Opus encoder,
# Pi 5 ingest, browser <audio>) is locked to. Opus prefers 48k mono for speech.
SAMPLE_RATE = 48000
CHANNELS = 1


class AudioPublisher:
    """
    Manages a single arecord -> ffmpeg -> Opus RTP pipeline per camera node.

    Mirrors VideoPublisher: arecord captures S16_LE PCM from the I2S mic, ffmpeg
    encodes Opus and packetizes into RTP. Self-heals on subprocess exit so a
    transient ALSA/CPU hiccup doesn't leave the camera silent until the Pi 5
    reconciler kicks the stream.
    """

    def __init__(self) -> None:
        self._process: asyncio.subprocess.Process | None = None
        self._target_host: str | None = None
        self._target_port: int | None = None
        self._input_device: str | None = None
        self._bitrate_bps: int | None = None
        self._packets_out: int = 0
        self._last_packet_at: float | None = None
        self._self_heal_task: asyncio.Task[None] | None = None
        self._self_heal_in_progress: bool = False
        self._self_heal_attempts: list[float] = []
        self._self_heal_giving_up_logged: bool = False

    async def start(
        self,
        *,
        rtp_host: str,
        rtp_port: int,
        input_device: str,
        bitrate_bps: int,
    ) -> None:
        if self._process is not None and self._process.returncode is None:
            if (
                self._target_host == rtp_host
                and self._target_port == rtp_port
                and self._input_device == input_device
                and self._bitrate_bps == bitrate_bps
            ):
                logger.info("AudioPublisher already streaming to %s:%s", rtp_host, rtp_port)
                return
            logger.info(
                "AudioPublisher restarting (host=%s port=%s device=%s bitrate=%s)",
                rtp_host, rtp_port, input_device, bitrate_bps,
            )
            await self.stop()

        cmd = self._build_pipeline_command(
            rtp_host=rtp_host,
            rtp_port=rtp_port,
            input_device=input_device,
            bitrate_bps=bitrate_bps,
        )

        logger.info(
            "[audio-publisher] start rtpHost=%s rtpPort=%s device=%s bitrate=%s",
            rtp_host, rtp_port, input_device, bitrate_bps,
        )
        if is_log_enabled("audioPipeline"):
            logger.info("[audioPipeline] spawn: %s", cmd)

        self._process = await asyncio.create_subprocess_shell(
            cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        self._target_host = rtp_host
        self._target_port = rtp_port
        self._input_device = input_device
        self._bitrate_bps = bitrate_bps
        self._packets_out = 0
        self._last_packet_at = None
        self._self_heal_attempts = []
        self._self_heal_giving_up_logged = False

        asyncio.create_task(self._drain_stderr(self._process))

    async def stop(self) -> None:
        if self._process is None:
            return

        process = self._process
        self._process = None
        self._target_host = None
        self._target_port = None
        self._input_device = None
        self._bitrate_bps = None

        if process.returncode is not None:
            return

        try:
            process.terminate()
        except ProcessLookupError:
            return

        try:
            await asyncio.wait_for(process.wait(), timeout=1.0)
        except asyncio.TimeoutError:
            try:
                process.kill()
            except ProcessLookupError:
                return
            await process.wait()

    def is_running(self) -> bool:
        return self._process is not None and self._process.returncode is None

    def get_stats(self) -> tuple[int | None, float | None]:
        """Returns (packets_out, last_packet_age_ms). None when idle."""
        if not self.is_running() or self._last_packet_at is None:
            return self._packets_out if self._packets_out else None, None
        age_ms = max(0.0, (time.monotonic() - self._last_packet_at) * 1000)
        return self._packets_out, age_ms

    @staticmethod
    def _build_pipeline_command(
        *,
        rtp_host: str,
        rtp_port: int,
        input_device: str,
        bitrate_bps: int,
    ) -> str:
        # arecord captures PCM S16 from the I2S mic; ffmpeg encodes Opus and
        # packetizes RTP. Payload type 111 matches the werift Opus default; the
        # Pi 5 ingest writes packets straight into the WebRTC track without
        # rewriting headers, so the PT must match end-to-end.
        arecord_args = [
            "arecord",
            "-q",                              # quiet (no headers in stdout)
            "-D", input_device,
            "-f", "S16_LE",
            "-r", str(SAMPLE_RATE),
            "-c", str(CHANNELS),
            "-t", "raw",
            "-",
        ]

        rtp_target = f"rtp://{rtp_host}:{rtp_port}?pkt_size=1200"
        ffmpeg_args = [
            "stdbuf", "-eL",
            "ffmpeg",
            "-hide_banner",
            "-loglevel", "warning",
            "-f", "s16le",
            "-ar", str(SAMPLE_RATE),
            "-ac", str(CHANNELS),
            "-i", "pipe:0",
            "-c:a", "libopus",
            "-b:a", str(bitrate_bps),
            "-application", "voip",
            "-vbr", "on",
            "-frame_duration", "20",
            "-payload_type", "111",
            "-f", "rtp",
            rtp_target,
        ]

        return f"{shlex.join(arecord_args)} | {shlex.join(ffmpeg_args)}"

    async def _drain_stderr(self, process: asyncio.subprocess.Process) -> None:
        if process.stderr is None:
            return

        lines_seen = 0
        while True:
            try:
                line = await process.stderr.readline()
            except asyncio.IncompleteReadError:
                break
            except asyncio.LimitOverrunError:
                with contextlib.suppress(AttributeError):
                    process.stderr._buffer.clear()  # type: ignore[attr-defined]
                continue

            if not line:
                break

            text = line.decode(errors="replace").rstrip()
            if not text:
                continue

            lines_seen += 1
            if is_log_enabled("audioPipeline"):
                logger.info("[audioPipeline] %s", text)
            else:
                logger.info("audio pipeline: %s", text)

            # ffmpeg emits "size=" / "time=" progress lines; treat any line as
            # evidence the pipeline is alive so the stats clock advances.
            self._last_packet_at = time.monotonic()
            self._packets_out += 1

        return_code = process.returncode
        logger.info(
            "AudioPublisher stderr drain ended: lines_seen=%s returncode=%s",
            lines_seen, return_code,
        )

        # Self-heal on positive exit (ALSA device busy, ffmpeg crash). Negative
        # codes mean we sent SIGTERM intentionally — don't restart.
        if (
            return_code is not None
            and return_code > 0
            and self._process is process
        ):
            self._trigger_self_heal(reason=f"audio pipeline exited returncode={return_code}")

    def _trigger_self_heal(self, reason: str) -> None:
        if self._self_heal_in_progress:
            return
        if self._self_heal_task is not None and not self._self_heal_task.done():
            return

        now = time.monotonic()
        self._self_heal_attempts = [t for t in self._self_heal_attempts if now - t < 60.0]
        if len(self._self_heal_attempts) >= 5:
            if not self._self_heal_giving_up_logged:
                logger.warning(
                    "AudioPublisher self-heal: giving up after %d attempts in 60s — "
                    "likely ALSA device gone or wiring issue. Pi 5 reconciler will retry.",
                    len(self._self_heal_attempts),
                )
                self._self_heal_giving_up_logged = True
            return
        self._self_heal_attempts.append(now)

        logger.warning(
            "AudioPublisher self-heal: %s — restarting (attempt %d/5)",
            reason, len(self._self_heal_attempts),
        )
        self._self_heal_task = asyncio.create_task(self._restart_pipeline())

    async def _restart_pipeline(self) -> None:
        if self._self_heal_in_progress:
            return
        self._self_heal_in_progress = True
        try:
            cached_host = self._target_host
            cached_port = self._target_port
            cached_device = self._input_device
            cached_bitrate = self._bitrate_bps
            if (
                cached_host is None
                or cached_port is None
                or cached_device is None
                or cached_bitrate is None
            ):
                return
            await self.stop()
            await asyncio.sleep(0.3)
            await self.start(
                rtp_host=cached_host,
                rtp_port=cached_port,
                input_device=cached_device,
                bitrate_bps=cached_bitrate,
            )
            logger.info("AudioPublisher self-heal restart completed")
        except asyncio.CancelledError:
            raise
        except Exception as error:  # noqa: BLE001
            logger.warning("AudioPublisher self-heal restart failed: %s", error)
        finally:
            self._self_heal_in_progress = False
