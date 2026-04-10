from __future__ import annotations

import logging
from typing import Any

import aiohttp

from camera_node.models import CameraCommand


logger = logging.getLogger(__name__)


class Pi5ApiError(RuntimeError):
    def __init__(self, message: str, *, error_code: str | None = None, http_status: int | None = None) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.http_status = http_status


class Pi5ApiClient:
    def __init__(
        self,
        *,
        base_url: str,
        timeout_sec: float,
        verify_tls: bool,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout_sec = timeout_sec
        self._verify_tls = verify_tls
        self._session: aiohttp.ClientSession | None = None

    async def __aenter__(self) -> "Pi5ApiClient":
        timeout = aiohttp.ClientTimeout(total=self._timeout_sec)
        connector = aiohttp.TCPConnector(ssl=self._verify_tls)
        self._session = aiohttp.ClientSession(timeout=timeout, connector=connector)
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        if self._session:
            await self._session.close()
            self._session = None

    async def get_pending_commands(
        self,
        *,
        node_id: str,
        node_secret: str,
        limit: int,
    ) -> list[CameraCommand]:
        response = await self._post(
            endpoint="/api/cameras/getPendingNodeCommands/v1",
            data={
                "nodeId": node_id,
                "nodeSecret": node_secret,
                "limit": limit,
            },
        )

        commands_raw = response.get("commands")
        if not isinstance(commands_raw, list):
            raise Pi5ApiError("Invalid commands payload from Pi5", error_code="camera.invalidInput")

        commands: list[CameraCommand] = []
        for item in commands_raw:
            if not isinstance(item, dict):
                continue

            command = CameraCommand.from_api(item)
            if command.command_id and command.action:
                commands.append(command)

        return commands

    async def ingest_telemetry(self, payload: dict[str, Any]) -> None:
        await self._post(
            endpoint="/api/cameras/ingestNodeTelemetry/v1",
            data=payload,
        )

    async def _post(self, *, endpoint: str, data: dict[str, Any]) -> dict[str, Any]:
        if not self._session:
            raise Pi5ApiError("Pi5 API client session is not open")

        url = f"{self._base_url}{endpoint}"

        async with self._session.post(url, json={"data": data}) as response:
            status_code = response.status
            try:
                body = await response.json(content_type=None)
            except Exception as error:  # noqa: BLE001
                raise Pi5ApiError(f"Pi5 returned non-JSON response ({status_code}): {error}") from error

            if not isinstance(body, dict):
                raise Pi5ApiError(f"Pi5 returned invalid response type ({status_code})")

            if body.get("status") == "error":
                error_code = body.get("errorCode") if isinstance(body.get("errorCode"), str) else None
                message = error_code or "Pi5 API error"
                raise Pi5ApiError(message, error_code=error_code, http_status=status_code)

            if body.get("status") != "success":
                raise Pi5ApiError(f"Pi5 returned unknown status ({status_code})")

            logger.debug("Pi5 API success: %s", endpoint)
            return body
