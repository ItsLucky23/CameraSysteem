# Pi5 API Contract For Pi Zero Node

This document describes the exact HTTP payloads used by `pi_zero_2w`.

## 1) Poll pending commands

Endpoint:

- `POST /api/cameras/getPendingNodeCommands/v1`

Request body:

```json
{
  "cameraIp": "192.168.1.42",
  "nodeSecret": "<shared-secret>",
  "limit": 20
}
```

Success response shape:

```json
{
  "status": "success",
  "cameraIp": "192.168.1.42",
  "channel": "camera-node:commands",
  "commands": [
    {
      "commandId": "cmd-123",
      "cameraId": "camera-1",
      "cameraIp": "192.168.1.42",
      "action": "panLeft",
      "payload": {},
      "requestedByUserId": "user-1",
      "requestedAt": "2026-04-10T12:00:00.000Z"
    }
  ]
}
```

Error codes used by Pi5:

- `camera.invalidInput`
- `camera.nodeSecretMissing`
- `camera.nodeUnauthorized`
- `camera.nodeQueueFailed`

Command actions accepted by Pi5 (`action` field):

- Camera lifecycle: `startVideoStream`, `stopVideoStream`
- IR LED: `setIRMode`
- Pan/tilt: `panLeft`, `panRight`, `tiltUp`, `tiltDown`, `home`
- Recording: `setRecording`
- Stub actions (Pi Zero logs only — no hardware yet): `zoomIn`, `zoomOut`, `talkbackOn`, `talkbackOff`

`startVideoStream` payload includes `rtpHost`, `rtpPort`, `targetFps` (1..60), and `bitrateBps` (mapped from `Camera.quality`: low=1Mbps, medium=2Mbps, high=4Mbps).

## 2) Ingest telemetry and command result

Endpoint:

- `POST /api/cameras/ingestNodeTelemetry/v1`

Request body:

```json
{
  "cameraIp": "192.168.1.42",
  "nodeSecret": "<shared-secret>",
  "isOnline": true,
  "mode": "live",
  "irMode": "auto",
  "irEnabled": false,
  "pan": 0,
  "tilt": 0,
  "temperatureC": 47.2,
  "motionDetected": false,
  "recording": false,
  "measuredFps": 14.9,
  "lastFrameAgeMs": 67,
  "zoomLevel": 50,
  "capabilities": {
    "hasCamera": true,
    "hasIR": true,
    "hasPanTilt": true,
    "hasMicrophone": false,
    "hasSpeaker": false,
    "hasMotion": false,
    "hasZoom": false,
    "hasTemperature": true
  },
  "commandResult": {
    "commandId": "cmd-123",
    "action": "panLeft",
    "result": "executed",
    "reasonCode": "camera.commandFailed"
  }
}
```

`commandResult` is optional and normally sent after executing a command. `measuredFps`, `lastFrameAgeMs`, `zoomLevel`, and `capabilities` are also optional — older Pi Zeros without those fields are accepted unchanged.

`capabilities` is the boot-probe result. The Pi 5 keeps it in memory keyed by cameraId, broadcasts it via `cameras/cameraStateUpdated/v1`, and uses it to gray out controls for hardware the camera does not have. Pi Zeros send the report on every tick so Pi 5 self-heals after a restart.

Accepted values:

- `mode`: `off | idle | live | record`
- `irMode`: `off | on | auto`
- `commandResult.result`: `executed | failed | rejected`

Common Pi5 errors:

- `camera.invalidInput`
- `camera.nodeSecretMissing`
- `camera.nodeUnauthorized`
- `camera.notFound`
- `camera.unexpectedError`

## 3) Upload thumbnail

Endpoint:

- `POST /api/cameras/uploadThumbnail/v1`

The Pi Zero captures a 1280x720 JPEG via `rpicam-jpeg` every 30s while the video pipeline is idle (rpicam-vid and rpicam-jpeg can't share the sensor — captures are skipped while a stream is active) and POSTs it to the Pi 5. Pi 5 holds the latest JPEG per camera in memory, broadcasts a `cameras/thumbnailUpdated/v1` sync event to both `camera-{id}` and `cameras-overview` rooms, and returns it on initial load via `getCameraList/v1` and `admin/getCameraCatalog/v1`.

Request body:

```json
{
  "cameraIp": "192.168.1.42",
  "nodeSecret": "<shared-secret>",
  "capturedAt": "2026-04-25T12:34:56.000Z",
  "jpegBase64": "<base64-encoded JPEG>",
  "cameraId": "<optional, included when known>"
}
```

`cameraId` is optional. If absent, Pi 5 resolves the target camera by `cameraIp` (same fallback as `ingestNodeTelemetry`). The Pi Zero only learns its `cameraId` after observing it in a command, so on a fresh boot the first thumbnail can land before any command — the IP fallback handles that case.

Validation enforced by Pi 5:

- `jpegBase64` length ≤ 800,000 chars (~600KB raw)
- decoded payload starts with JPEG magic bytes `FF D8 FF`
- `capturedAt` parses to a valid Date

Common Pi5 errors:

- `camera.invalidInput`
- `camera.nodeSecretMissing`
- `camera.nodeUnauthorized`
- `camera.notFound`
- `camera.unexpectedError`

## 4) Authentication model

These three APIs are public at route-level (`login: false`) but secured via shared secret:

- `nodeSecret` must equal Pi5 `CAMERA_NODE_SHARED_SECRET`
- `cameraIp` resolves the target camera using `Camera.ip` (or `cameraId` when provided to `uploadThumbnail`)

## 5) Rate limits on Pi5

Current route limits:

- `getPendingNodeCommands`: 240 req/min
- `ingestNodeTelemetry`: 480 req/min
- `uploadThumbnail`: 240 req/min

Tune `POLL_INTERVAL_MS`, `TELEMETRY_INTERVAL_SEC`, and `THUMBNAIL_INTERVAL_SEC` to stay within limits.
