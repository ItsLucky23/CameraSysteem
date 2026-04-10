# Pi5 API Contract For Pi Zero Node

This document describes the exact HTTP payloads used by `pi_zero_2w`.

## 1) Poll pending commands

Endpoint:

- `POST /api/cameras/getPendingNodeCommands/v1`

Request body:

```json
{
  "data": {
    "nodeId": "pi-zero-2w-cam01",
    "nodeSecret": "<shared-secret>",
    "limit": 20
  }
}
```

Success response shape:

```json
{
  "status": "success",
  "nodeId": "pi-zero-2w-cam01",
  "channel": "camera-node:commands",
  "commands": [
    {
      "commandId": "cmd-123",
      "cameraId": "camera-1",
      "nodeId": "pi-zero-2w-cam01",
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

## 2) Ingest telemetry and command result

Endpoint:

- `POST /api/cameras/ingestNodeTelemetry/v1`

Request body:

```json
{
  "data": {
    "nodeId": "pi-zero-2w-cam01",
    "nodeSecret": "<shared-secret>",
    "cameraId": "camera-1",
    "isOnline": true,
    "mode": "live",
    "irMode": "auto",
    "irEnabled": false,
    "pan": 0,
    "tilt": 0,
    "temperatureC": 47.2,
    "motionDetected": false,
    "recording": false,
    "commandResult": {
      "commandId": "cmd-123",
      "action": "panLeft",
      "result": "executed",
      "reasonCode": "camera.commandFailed"
    }
  }
}
```

`commandResult` is optional and normally sent after executing a command.

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

## 3) Authentication model

These two APIs are public at route-level (`login: false`) but secured via shared secret:

- `nodeSecret` must equal Pi5 `CAMERA_NODE_SHARED_SECRET`
- `nodeId` must match the target camera's `nodeId`

## 4) Rate limits on Pi5

Current route limits:

- `getPendingNodeCommands`: 240 req/min
- `ingestNodeTelemetry`: 480 req/min

Tune `POLL_INTERVAL_MS` and `TELEMETRY_INTERVAL_SEC` to stay within limits.
