from __future__ import annotations

import asyncio
import base64
import logging
from datetime import datetime, timezone
from typing import Callable

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
    Skips capture while the video pipeline is active because rpicam-vid and
    rpicam-jpeg cannot share the sensor.
    """

    def __init__(
        self,
        *,
        api_client: Pi5ApiClient,
        is_video_active: Callable[[], bool],
        camera_ip: str,
        node_secret: str,
    ) -> None:
        self._api_client = api_client
        self._is_video_active = is_video_active
        self._camera_ip = camera_ip
        self._node_secret = node_secret
        self._cached_camera_id: str | None = None
        self._running = True

    def remember_camera_id(self, camera_id: str | None) -> None:
        # Caller (runtime) feeds in the cameraId observed on the most recent
        # command so the upload payload can carry it when available.
        if camera_id:
            self._cached_camera_id = camera_id

    def request_stop(self) -> None:
        self._running = False

    async def run(self) -> None:
        while self._running:
            try:
                await asyncio.sleep(THUMBNAIL_INTERVAL_SEC)
            except asyncio.CancelledError:
                return

            if not self._running:
                return

            try:
                video_active = self._is_video_active()
            except Exception as error:  # noqa: BLE001
                # If the probe itself fails, treat as inactive so we still try
                # to capture rather than skipping forever.
                logger.warning("Video-active probe raised: %s", error)
                video_active = False

            if video_active:
                print("[thumbnail] skipped (video stream active)")
                continue

            jpeg_bytes = await self._capture_jpeg()
            if jpeg_bytes is None:
                continue

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
            stderr_tail = (stderr or b"").decode(errors="replace").strip().splitlines()
            detail = stderr_tail[-1] if stderr_tail else f"exit={process.returncode}"
            print(f"[thumbnail] capture failed: {detail}")
            return None

        if not stdout:
            print("[thumbnail] capture failed: empty stdout")
            return None

        # Sanity check: JPEG magic bytes
        if not stdout.startswith(b"\xff\xd8\xff"):
            print("[thumbnail] capture failed: stdout is not JPEG")
            return None

        return stdout

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
