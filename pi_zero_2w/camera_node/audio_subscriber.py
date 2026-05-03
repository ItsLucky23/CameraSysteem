from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import shlex
import tempfile
import time

from camera_node.log_flags import is_log_enabled

logger = logging.getLogger(__name__)


SAMPLE_RATE = 48000
CHANNELS = 1


class AudioSubscriber:
    """
    Receives Opus RTP from the Pi 5 on a local UDP port and pipes the decoded
    PCM into aplay on the I2S amplifier.

    ffmpeg requires an SDP file describing the incoming stream so it can demux
    RTP without an out-of-band negotiation. We write a tiny throwaway SDP into
    /tmp on each start() and remove it on stop().
    """

    def __init__(self) -> None:
        self._process: asyncio.subprocess.Process | None = None
        self._local_port: int | None = None
        self._output_device: str | None = None
        self._sdp_path: str | None = None
        self._packets_in: int = 0
        self._last_packet_at: float | None = None
        self._self_heal_task: asyncio.Task[None] | None = None
        self._self_heal_in_progress: bool = False
        self._self_heal_attempts: list[float] = []
        self._self_heal_giving_up_logged: bool = False

    async def start(
        self,
        *,
        local_port: int,
        output_device: str,
    ) -> None:
        if self._process is not None and self._process.returncode is None:
            if self._local_port == local_port and self._output_device == output_device:
                logger.info("AudioSubscriber already listening on port %s", local_port)
                return
            logger.info(
                "AudioSubscriber restarting (port=%s device=%s)",
                local_port, output_device,
            )
            await self.stop()

        sdp_path = self._write_sdp(local_port=local_port)
        self._sdp_path = sdp_path
        cmd = self._build_pipeline_command(
            sdp_path=sdp_path,
            output_device=output_device,
        )

        logger.info(
            "[audio-subscriber] start localPort=%s device=%s",
            local_port, output_device,
        )
        if is_log_enabled("audioPipeline"):
            logger.info("[audioPipeline] spawn: %s", cmd)

        self._process = await asyncio.create_subprocess_shell(
            cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        self._local_port = local_port
        self._output_device = output_device
        self._packets_in = 0
        self._last_packet_at = None
        self._self_heal_attempts = []
        self._self_heal_giving_up_logged = False

        asyncio.create_task(self._drain_stderr(self._process))

    async def stop(self) -> None:
        if self._process is None:
            self._cleanup_sdp()
            return

        process = self._process
        self._process = None
        self._local_port = None
        self._output_device = None

        if process.returncode is None:
            try:
                process.terminate()
                await asyncio.wait_for(process.wait(), timeout=1.0)
            except (ProcessLookupError, asyncio.TimeoutError):
                with contextlib.suppress(ProcessLookupError):
                    process.kill()
                    await process.wait()

        self._cleanup_sdp()

    def is_running(self) -> bool:
        return self._process is not None and self._process.returncode is None

    def get_stats(self) -> tuple[int | None, float | None]:
        if not self.is_running() or self._last_packet_at is None:
            return self._packets_in if self._packets_in else None, None
        age_ms = max(0.0, (time.monotonic() - self._last_packet_at) * 1000)
        return self._packets_in, age_ms

    def _cleanup_sdp(self) -> None:
        if self._sdp_path is None:
            return
        with contextlib.suppress(OSError):
            os.unlink(self._sdp_path)
        self._sdp_path = None

    @staticmethod
    def _write_sdp(*, local_port: int) -> str:
        # Minimal SDP describing the incoming RTP/Opus stream. Payload type 111
        # matches the publisher and werift's Opus default.
        sdp_text = (
            "v=0\r\n"
            "o=- 0 0 IN IP4 127.0.0.1\r\n"
            "s=Camera Audio Downlink\r\n"
            "c=IN IP4 0.0.0.0\r\n"
            "t=0 0\r\n"
            f"m=audio {local_port} RTP/AVP 111\r\n"
            f"a=rtpmap:111 opus/{SAMPLE_RATE}/2\r\n"
            "a=fmtp:111 minptime=10;useinbandfec=1\r\n"
        )
        fd, path = tempfile.mkstemp(prefix="audio-subscriber-", suffix=".sdp")
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(sdp_text)
        return path

    @staticmethod
    def _build_pipeline_command(
        *,
        sdp_path: str,
        output_device: str,
    ) -> str:
        ffmpeg_args = [
            "stdbuf", "-eL",
            "ffmpeg",
            "-hide_banner",
            "-loglevel", "warning",
            "-protocol_whitelist", "file,udp,rtp",
            "-f", "sdp",
            "-i", sdp_path,
            "-f", "s16le",
            "-ar", str(SAMPLE_RATE),
            "-ac", str(CHANNELS),
            "-",
        ]

        aplay_args = [
            "aplay",
            "-q",
            "-D", output_device,
            "-f", "S16_LE",
            "-r", str(SAMPLE_RATE),
            "-c", str(CHANNELS),
            "-t", "raw",
        ]

        return f"{shlex.join(ffmpeg_args)} | {shlex.join(aplay_args)}"

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
                logger.info("audio subscriber: %s", text)
            self._last_packet_at = time.monotonic()
            self._packets_in += 1

        return_code = process.returncode
        logger.info(
            "AudioSubscriber stderr drain ended: lines_seen=%s returncode=%s",
            lines_seen, return_code,
        )

        if (
            return_code is not None
            and return_code > 0
            and self._process is process
        ):
            self._trigger_self_heal(reason=f"audio subscriber exited returncode={return_code}")

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
                    "AudioSubscriber self-heal: giving up after %d attempts in 60s.",
                    len(self._self_heal_attempts),
                )
                self._self_heal_giving_up_logged = True
            return
        self._self_heal_attempts.append(now)

        logger.warning(
            "AudioSubscriber self-heal: %s — restarting (attempt %d/5)",
            reason, len(self._self_heal_attempts),
        )
        self._self_heal_task = asyncio.create_task(self._restart_pipeline())

    async def _restart_pipeline(self) -> None:
        if self._self_heal_in_progress:
            return
        self._self_heal_in_progress = True
        try:
            cached_port = self._local_port
            cached_device = self._output_device
            if cached_port is None or cached_device is None:
                return
            await self.stop()
            await asyncio.sleep(0.3)
            await self.start(local_port=cached_port, output_device=cached_device)
            logger.info("AudioSubscriber self-heal restart completed")
        except asyncio.CancelledError:
            raise
        except Exception as error:  # noqa: BLE001
            logger.warning("AudioSubscriber self-heal restart failed: %s", error)
        finally:
            self._self_heal_in_progress = False
