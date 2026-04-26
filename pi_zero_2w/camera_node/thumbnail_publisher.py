from __future__ import annotations

import asyncio
import base64
import logging
from datetime import datetime, timezone

from camera_node.api_client import Pi5ApiClient, Pi5ApiError


logger = logging.getLogger(__name__)


THUMBNAIL_INTERVAL_SEC = 30.0
THUMBNAIL_CAPTURE_TIMEOUT_SEC = 5.0
THUMBNAIL_WIDTH = 1280
THUMBNAIL_HEIGHT = 720
THUMBNAIL_QUALITY = 90
RPICAM_TIMEOUT_MS = 200


class ThumbnailPublisher:
    """
    Captures a JPEG every 30s with rpicam-jpeg and POSTs it to the Pi 5.

    Always attempts capture. When the video pipeline is active rpicam-jpeg will
    fail to grab the sensor; in that case the Pi 5 takes over thumbnail
    extraction by tapping the existing RTP stream (cameraThumbnailExtractor on
    the server). This loop covers the idle case where no one is watching.
    """

    def __init__(
        self,
        *,
        api_client: Pi5ApiClient,
        camera_ip: str,
        node_secret: str,
    ) -> None:
        self._api_client = api_client
        self._camera_ip = camera_ip
        self._node_secret = node_secret
        self._cached_camera_id: str | None = None
        self._running = True
        # Tracks whether the last capture attempt failed because the sensor is
        # busy (rpicam-vid is streaming). The Pi 5 takes over thumbnail
        # extraction via cameraThumbnailExtractor in that case, so per-attempt
        # failure logs are pure noise — we log once on entry and once on exit.
        self._sensor_busy_streak = False

    def remember_camera_id(self, camera_id: str | None) -> None:
        # Caller (runtime) feeds in the cameraId observed on the most recent
        # command so the upload payload can carry it when available.
        if camera_id:
            self._cached_camera_id = camera_id

    def request_stop(self) -> None:
        self._running = False

    async def run(self) -> None:
        # Fire one immediate capture so the dashboard / admin pages have a
        # photo within seconds of the Pi Zero booting, instead of waiting a
        # full 30s for the first loop tick.
        await self._capture_and_publish()

        while self._running:
            try:
                await asyncio.sleep(THUMBNAIL_INTERVAL_SEC)
            except asyncio.CancelledError:
                return

            if not self._running:
                return

            await self._capture_and_publish()

    async def _capture_and_publish(self) -> None:
        jpeg_bytes = await self._capture_jpeg()
        if jpeg_bytes is None:
            return
        await self._publish(jpeg_bytes)

    async def _capture_jpeg(self) -> bytes | None:
        try:
            process = await asyncio.create_subprocess_exec(
                "rpicam-jpeg",
                "--width", str(THUMBNAIL_WIDTH),
                "--height", str(THUMBNAIL_HEIGHT),
                "--quality", str(THUMBNAIL_QUALITY),
                "--timeout", str(RPICAM_TIMEOUT_MS),
                "--output", "-",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except FileNotFoundError:
            print("[thumbnail] capture failed: rpicam-jpeg not on PATH")
            return None
        except Exception as error:  # noqa: BLE001
            print(f"[thumbnail] capture failed: spawn error {error}")
            return None

        try:
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=THUMBNAIL_CAPTURE_TIMEOUT_SEC,
            )
        except asyncio.TimeoutError:
            try:
                process.kill()
            except ProcessLookupError:
                pass
            await process.wait()
            print(f"[thumbnail] capture failed: timeout after {THUMBNAIL_CAPTURE_TIMEOUT_SEC}s")
            return None
        except asyncio.CancelledError:
            try:
                process.kill()
            except ProcessLookupError:
                pass
            raise

        if process.returncode != 0:
            stderr_text = (stderr or b"").decode(errors="replace")
            stderr_tail = stderr_text.strip().splitlines()
            detail = stderr_tail[-1] if stderr_tail else f"exit={process.returncode}"
            self._report_capture_failure(detail, stderr_text)
            return None

        if not stdout:
            self._report_capture_failure("empty stdout", "")
            return None

        # Sanity check: JPEG magic bytes
        if not stdout.startswith(b"\xff\xd8\xff"):
            self._report_capture_failure("stdout is not JPEG", "")
            return None

        if self._sensor_busy_streak:
            print("[thumbnail] sensor reclaimed; resuming local captures")
            self._sensor_busy_streak = False

        return stdout

    def _report_capture_failure(self, detail: str, stderr_text: str) -> None:
        # When rpicam-vid is streaming the sensor is locked; rpicam-jpeg fails
        # with "Device or resource busy" / "Failed to acquire camera". The Pi
        # 5 already extracts thumbnails from the RTP stream in this case, so
        # we suppress per-attempt logs and emit one transition line instead.
        haystack = f"{detail}\n{stderr_text}".lower()
        sensor_busy = (
            "device or resource busy" in haystack
            or "failed to acquire camera" in haystack
            or "camera in use" in haystack
        )

        if sensor_busy:
            if not self._sensor_busy_streak:
                print("[thumbnail] sensor busy (video stream active); Pi 5 will extract from RTP")
                self._sensor_busy_streak = True
            return

        # Real failure (rpicam-jpeg missing, timeout, corrupt output, etc.) —
        # always log so it shows up in journalctl.
        self._sensor_busy_streak = False
        print(f"[thumbnail] capture failed: {detail}")

    async def _publish(self, jpeg_bytes: bytes) -> None:
        captured_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        encoded = base64.b64encode(jpeg_bytes).decode("ascii")

        try:
            await self._api_client.upload_thumbnail(
                camera_ip=self._camera_ip,
                node_secret=self._node_secret,
                captured_at_iso=captured_at,
                jpeg_base64=encoded,
                camera_id=self._cached_camera_id,
            )
        except Pi5ApiError as error:
            logger.warning(
                "Failed to upload thumbnail: %s (code=%s, status=%s)",
                error,
                error.error_code,
                error.http_status,
            )
            return
        except asyncio.CancelledError:
            raise
        except Exception as error:  # noqa: BLE001
            logger.warning("Unexpected error uploading thumbnail: %s", error)
            return

        print(
            f"[thumbnail] published cameraId={self._cached_camera_id or '-'} "
            f"bytes={len(jpeg_bytes)}"
        )
