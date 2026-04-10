# Camera Pi5 Tracker

Last updated: 2026-04-10

## Purpose

This file tracks:
- what has been implemented on the Pi5 side,
- what still needs to be done,
- which setup actions must be done manually by you.

## Manual Actions (User)

1. Set real secrets in .env.local:
   - CAMERA_NODE_SHARED_SECRET
2. Set the signaling URL in .env.local:
   - CAMERA_WEBRTC_SIGNALING_URL
   - Example: http://localhost:8090
3. Apply Prisma changes after pulling this branch:
   - npm run prisma:generate
   - npm run prisma:db:push
4. Seed/create initial cameras in the database (Camera records).
5. Grant initial access in the database (CameraAccess) or via admin UI once users/cameras exist.
6. Run a WebRTC signaling service that accepts offer proxy calls at:
   - POST {CAMERA_WEBRTC_SIGNALING_URL}/offer
7. Start one or more Pi Zero camera nodes with the same CAMERA_NODE_SHARED_SECRET.
8. On each Pi Zero, copy and fill:
  - pi_zero_2w/.env.example -> pi_zero_2w/.env
  - set PI5_BASE_URL, NODE_ID, CAMERA_ID, NODE_SECRET
9. On each Pi Zero, run the node from a dedicated venv only:
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
- WebRTC offer proxy API:
  - api/cameras/webrtc/offer/v1
  - validates preview token + camera access
  - proxies offer to CAMERA_WEBRTC_SIGNALING_URL
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

1. Add camera command/audit timeline UI using CameraCommand and CameraEvent history.
2. Add pagination/filtering for large access matrices.
3. Add rate-limit and lock visibility indicators in UI (cooldown/locked feedback).
4. Add operational docs for signaling service contract and deployment topology.

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
  - integrate real camera capture/stream pipeline with signaling server
  - set and validate per-device GPIO pin mapping for SG90 pan/tilt servos
  - add persistent health/watchdog metrics if required by ops
