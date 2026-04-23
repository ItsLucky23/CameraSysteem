# Camera Pi5 Tracker

Last updated: 2026-04-23

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
  - Camera
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
  - api/cameras/getPendingNodeCommands/v1
  - api/cameras/ingestNodeTelemetry/v1
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

## Next Phase (Pi Zero)

1. Implemented initial Pi Zero 2W runtime package in `pi_zero_2w/`:
  - Python worker loop with command polling and telemetry ingest
  - command executor for PTZ/IR/record actions
  - adapters: mock + Raspberry Pi hardware hooks
  - deployment instructions, env template, and systemd service template
  - PTZ motor model selected: Micro Servo 9g (SG90)
2. Remaining:
  - build the real video capture + WebRTC transport on the Pi Zero (architecture pending — see discussion; MJPEG test path has been removed)
  - set and validate per-device GPIO pin mapping for SG90 pan/tilt servos
  - add persistent health/watchdog metrics if required by ops
