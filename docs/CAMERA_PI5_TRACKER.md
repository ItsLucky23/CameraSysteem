# Camera Pi5 Tracker

Last updated: 2026-04-25

## Purpose

This file tracks:
- what has been implemented on the Pi5 side,
- what still needs to be done,
- which setup actions must be done manually by you.

## Manual Actions (User)

1. Set real secrets in .env.local:
   - CAMERA_NODE_SHARED_SECRET
2. Apply Prisma changes after pulling this branch:
   - npm run prisma:generate
   - npm run prisma:db:push
3. Seed/create initial cameras in the database (Camera records).
4. Grant initial access in the database (CameraAccess) or via admin UI once users/cameras exist.
5. Start one or more Pi Zero camera nodes with the same CAMERA_NODE_SHARED_SECRET.
6. On each Pi Zero, copy and fill:
  - pi_zero_2w/.env.example -> pi_zero_2w/.env
  - set PI5_BASE_URL, CAMERA_IP, NODE_SECRET
7. On each Pi Zero, run the node from a dedicated venv only:
  - python3 -m venv .venv
  - source .venv/bin/activate
  - pip install -r requirements.txt
  - ./.venv/bin/python run.py

## Implemented (Pi5)

### Backend

- Prisma camera domain models/enums:
  - Camera (now includes `targetFps Int @default(15)` and `quality QUALITY @default(medium)`)
  - CameraAccess
  - CameraCommand
  - CameraEvent
  - CameraStateSnapshot
- Camera APIs:
  - api/cameras/getCameraList/v1
  - api/cameras/getCameraState/v1
  - api/cameras/getCameraPreviewSession/v1
  - api/cameras/executeCameraCommand/v1
  - api/cameras/setIRMode/v1
  - api/cameras/setRecordingMode/v1
  - api/cameras/getPendingNodeCommands/v1 — long-poll: server holds the request open up to `waitMs` (default 25s) via Redis pub/sub on the existing `camera-node:commands` channel, replacing the prior 750ms Pi-Zero polling loop
  - api/cameras/ingestNodeTelemetry/v1 — now broadcasts `measuredFps` + `lastFrameAgeMs` (ephemeral; not persisted)
- WebRTC offer API (npm server local bridge):
  - api/cameras/webrtc/offer/v1
  - validates preview token + camera access
  - builds SDP answer in-process on Pi5/npm server
  - forwards Pi Zero WebRTC video (and audio, when enabled) into the browser peer connection
- Admin camera access APIs:
  - api/admin/camera-access/getUserCameraAccessMatrix/v1
  - api/admin/camera-access/updateCameraAccess/v1
- Sync contracts:
  - sync/cameras/cameraStateUpdated/v1
  - sync/cameras/cameraCommandResult/v1
  - sync/admin/camera-access/cameraAccessUpdated/v1
  - sync/admin/camera-access/userForcedLeaveCameraRoom/v1
- Pi5 node bridge service:
  - Redis queue + pub/sub command dispatch in server/functions/cameraNode.ts
  - `waitForCommandSignal({ cameraIp, timeoutMs })` parks per-cameraIp resolvers backed by a single shared Redis subscriber (`server/functions/redis.ts` exports `redisSubscriber`)
- Stream orchestration:
  - `server/utils/cameraStreamOrchestrator.ts` activates/deactivates Pi-Zero pipelines based on connected sockets
  - `fetchCameraStreamConfig` reads `targetFps` + `quality` from the Camera document on every activation and warns when fields are missing (legacy MongoDB docs)
  - quality -> bitrate mapping: `low=1Mbps`, `medium=2Mbps`, `high=4Mbps`
  - 30s grace window before tearing down a Pi-Zero pipeline when the last viewer leaves
  - 4s reconciler that detects >20s of zero RTP and re-issues `stopVideoStream` + `startVideoStream` without dropping the WebRTC peers
  - On `activateCamera` short-circuit (already active), force-kicks the Pi Zero if ingest has been silent >20s — covers the "Pi Zero restarted while a viewer was on the page" recovery case
- Socket reliability:
  - `ioInstance` lives on `globalThis` so HMR / split-bundle module copies all see the same Socket.io server
  - `io.on('connection')` rejoins every room recorded in `session.roomCodes` so reconnects don't silently lose `camera-<id>` membership
- Preview session hardening:
  - Redis-stored short-lived preview tokens
- Locale updates:
  - camera errors + camera/admin frontend strings in en/nl/de/fr

### Frontend (Simple)

- Camera operator page:
  - /cameras
  - camera list, state panel, command buttons, preview-session creation, last command result
  - in-browser WebRTC preview playback (create session + start/stop stream)
  - /cameras monitor flow is WebRTC-only; MJPEG has been removed from the codebase
  - live sync subscriptions for state updates and command results
- Admin access matrix page:
  - /admin/camera-access
  - per-user/per-camera toggles for preview and control permissions
  - live sync subscription for access updates
- Admin landing page links to camera tools.
- Middleware guards added:
  - /cameras requires login
  - /admin/camera-access requires admin

## Remaining (Pi5)

1. Finish the Pi5 side of the full WebRTC transport change (signaling flow + bridge wiring for the new Pi Zero transport — see Next Phase below).
2. Add camera command/audit timeline UI using CameraCommand and CameraEvent history.
3. Add pagination/filtering for large access matrices.
4. Add rate-limit and lock visibility indicators in UI (cooldown/locked feedback).

## Latest Validation

- Frontend lint (`npm run lint`) currently passes with zero errors after cache reset.

## Pi Zero Implementation

1. Pi Zero 2W runtime package in `pi_zero_2w/`:
  - command executor for PTZ/IR/record + `startVideoStream` / `stopVideoStream`
  - adapters: mock + Raspberry Pi hardware hooks (SG90 pan/tilt + GPIO IR)
  - deployment instructions, env template, and systemd service template
2. Runtime architecture (April 2026):
  - `_command_loop` and `_telemetry_loop` run as parallel asyncio tasks
  - `get_pending_commands` long-polls Pi 5 with `waitMs=25000` and a per-call aiohttp timeout of 35s; on response (commands or empty) re-issues immediately. `POLL_INTERVAL_MS=0` by default; `POLL_ERROR_BACKOFF_MS=1500` only fires on Pi5ApiError
  - `_telemetry_loop` heartbeats every `TELEMETRY_INTERVAL_SEC` (default 5s); command-result telemetry is sent inline by the command loop right after execute
3. Video pipeline (`video_publisher.py`):
  - `rpicam-vid -> ffmpeg -> RTP/UDP` to Pi 5 ingest port
  - `target_fps == 0` (or any negative) means uncapped: `--framerate` flag is omitted so the sensor runs at native max
  - quality is encoded as `--bitrate <bps>` derived from the Pi 5 mapping
  - ffmpeg runs with `stdbuf -eL` for line-buffered stderr and `-progress pipe:2` for parseable telemetry
  - Stall watchdog logs WARN every time frame production goes silent for >1s (rate-limited to one warn per 5s)
  - Orphan-process sweep (`pkill -f rpicam-vid`, `pkill -f 'ffmpeg.*rtp'`) runs before each fresh `start()` in case a previous Python run exited without cleanup and left children reparented to PID 1
4. Stream config flow:
  - Pi 5 `enqueueCommand startVideoStream payload={ rtpHost, rtpPort, targetFps, bitrateBps }`
  - Pi Zero `_validate_start_video_stream` accepts targetFps in `[0, 60]` and bitrateBps in `[100k, 20M]`
5. Remaining:
  - validate per-device GPIO pin mapping for SG90 pan/tilt servos in production
  - persistent health/watchdog metrics if required by ops
  - drop the temporary INFO log on idle long-poll completion back to DEBUG once verified in production
