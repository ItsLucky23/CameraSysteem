# Camera Platform Implementation Spec: Prisma Schema + API Contracts

## 1. Purpose
This document defines the implementation contract for the camera platform V1 backend:
- Prisma schema proposal
- API contract per endpoint
- Sync contract for realtime fanout
- Auth, permission, locking, and error rules

This spec follows LuckyStack-v2 conventions:
- File-based API and sync routing
- `status: 'success' | 'error'` response contract
- Auth guards via `export const auth`
- Versioned files (`_v1.ts`)
- Video transport via WebRTC, not Socket.io

## 2. Transport Boundary
- Video preview path: Pi5 to browser via WebRTC only.
- Socket path: command/control, state sync, access updates, locks, and presence.
- Socket.io must never carry raw video frames.

## 3. Prisma Schema Proposal (V1)

## 3.1 Existing Model Reuse
The current `User` model already contains:
- `id`
- `admin`
- identity/provider fields

We keep this and add camera domain models.

## 3.2 Proposed Models
Use this as a schema draft and adjust to your final provider strategy.

```prisma
model Camera {
  id                String                 @id @default(uuid()) @map("_id")
  slug              String                 @unique
  name              String
  streamKey         String                 @unique
  streamUrl         String
  nodeId            String
  isOnline          Boolean                @default(false)
  mode              CAMERA_MODE            @default(idle)
  irMode            IR_MODE                @default(auto)
  irEnabled         Boolean                @default(false)
  pan               Int                    @default(0)
  tilt              Int                    @default(0)
  temperatureC      Float?
  lastSeenAt        DateTime?
  createdAt         DateTime               @default(now())
  updatedAt         DateTime               @updatedAt

  accessRules       CameraAccess[]
  commands          CameraCommand[]
  events            CameraEvent[]
  snapshots         CameraStateSnapshot[]

  @@map("cameras")
  @@index([nodeId])
  @@index([isOnline, updatedAt])
}

model CameraAccess {
  id                String                 @id @default(uuid()) @map("_id")
  cameraId           String
  userId             String
  canPreview         Boolean                @default(true)
  canControl         Boolean                @default(false)
  grantedByUserId    String?
  createdAt          DateTime               @default(now())
  updatedAt          DateTime               @updatedAt

  camera             Camera                 @relation(fields: [cameraId], references: [id], onDelete: Cascade)
  user               User                   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("camera_access")
  @@unique([cameraId, userId])
  @@index([userId])
  @@index([cameraId])
}

model CameraCommand {
  id                String                 @id @default(uuid()) @map("_id")
  commandId          String                 @unique
  cameraId           String
  userId             String
  action             CAMERA_ACTION
  payloadJson        String
  status             COMMAND_STATUS         @default(pending)
  rejectedReason     String?
  cooldownMs         Int?
  createdAt          DateTime               @default(now())
  resolvedAt         DateTime?

  camera             Camera                 @relation(fields: [cameraId], references: [id], onDelete: Cascade)
  user               User                   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("camera_commands")
  @@index([cameraId, createdAt])
  @@index([userId, createdAt])
  @@index([status, createdAt])
}

model CameraEvent {
  id                String                 @id @default(uuid()) @map("_id")
  cameraId           String
  type               CAMERA_EVENT_TYPE
  severity           EVENT_SEVERITY         @default(info)
  messageCode        String
  metadataJson       String?
  createdAt          DateTime               @default(now())

  camera             Camera                 @relation(fields: [cameraId], references: [id], onDelete: Cascade)

  @@map("camera_events")
  @@index([cameraId, createdAt])
  @@index([type, createdAt])
}

model CameraStateSnapshot {
  id                String                 @id @default(uuid()) @map("_id")
  cameraId           String
  isOnline           Boolean
  mode               CAMERA_MODE
  irMode             IR_MODE
  irEnabled          Boolean
  pan                Int
  tilt               Int
  temperatureC       Float?
  motionDetected     Boolean               @default(false)
  recording          Boolean               @default(false)
  createdAt          DateTime              @default(now())

  camera             Camera                @relation(fields: [cameraId], references: [id], onDelete: Cascade)

  @@map("camera_state_snapshots")
  @@index([cameraId, createdAt])
}

enum CAMERA_MODE {
  off
  idle
  live
  record
}

enum IR_MODE {
  off
  on
  auto
}

enum CAMERA_ACTION {
  panLeft
  panRight
  tiltUp
  tiltDown
  irOn
  irOff
  recordStart
  recordStop
}

enum COMMAND_STATUS {
  pending
  accepted
  rejected
  executed
  failed
}

enum CAMERA_EVENT_TYPE {
  motion
  thermal
  connection
  recording
  command
  access
}

enum EVENT_SEVERITY {
  info
  warning
  critical
}
```

## 3.3 Locking Store (Redis, not Prisma)
Do not persist short command locks in Prisma.
Use Redis keys with TTL:
- `lock:camera:{cameraId}:action:{action}`

Recommended lock value payload:
```json
{
  "lockedByUserId": "user-123",
  "commandId": "cmd-abc",
  "lockUntil": 1760000000000
}
```

## 4. API Endpoint Contracts (V1)

## 4.1 Route Layout
Recommended file structure:
- `src/cameras/_api/getCameraList_v1.ts`
- `src/cameras/_api/getCameraState_v1.ts`
- `src/cameras/_api/getCameraPreviewSession_v1.ts`
- `src/cameras/_api/executeCameraCommand_v1.ts`
- `src/cameras/_api/setIRMode_v1.ts`
- `src/cameras/_api/setRecordingMode_v1.ts`
- `src/admin/camera-access/_api/getUserCameraAccessMatrix_v1.ts`
- `src/admin/camera-access/_api/updateCameraAccess_v1.ts`

All endpoints:
- require `auth.login = true`
- return strict success/error contract
- use localized `errorCode`

## 4.2 Shared Error Contract
All API handlers should return:

```ts
{ status: 'success', ...payload }
```
or
```ts
{
  status: 'error',
  errorCode: string,
  errorParams?: { key: string; value: string | number | boolean }[],
  httpStatus?: number
}
```

Common error codes:
- `camera.notFound`
- `camera.accessDenied`
- `camera.controlDenied`
- `camera.invalidInput`
- `camera.locked`
- `camera.commandFailed`
- `camera.streamUnavailable`
- `camera.adminOnly`
- `camera.rateLimited`

## 4.3 getCameraList
- Name/version: `cameras/getCameraList` `v1`
- File: `src/cameras/_api/getCameraList_v1.ts`
- Auth: login required
- Rate limit: 120/min

Request data:
```ts
{}
```

Success response:
```ts
{
  status: 'success',
  cameras: {
    id: string;
    slug: string;
    name: string;
    isOnline: boolean;
    mode: 'off' | 'idle' | 'live' | 'record';
    irMode: 'off' | 'on' | 'auto';
    canPreview: boolean;
    canControl: boolean;
    lastSeenAt: string | null;
  }[];
}
```

Rules:
- Return only cameras user can preview.
- Do not leak non-authorized camera metadata.

## 4.4 getCameraState
- Name/version: `cameras/getCameraState` `v1`
- File: `src/cameras/_api/getCameraState_v1.ts`
- Auth: login required
- Rate limit: 180/min

Request data:
```ts
{
  cameraId: string;
}
```

Success response:
```ts
{
  status: 'success',
  camera: {
    id: string;
    isOnline: boolean;
    mode: 'off' | 'idle' | 'live' | 'record';
    irMode: 'off' | 'on' | 'auto';
    irEnabled: boolean;
    pan: number;
    tilt: number;
    temperatureC: number | null;
    recording: boolean;
    motionDetected: boolean;
    updatedAt: string;
  };
}
```

Rules:
- Requires preview permission.

## 4.5 getCameraPreviewSession
- Name/version: `cameras/getCameraPreviewSession` `v1`
- File: `src/cameras/_api/getCameraPreviewSession_v1.ts`
- Auth: login required
- Rate limit: 60/min

Request data:
```ts
{
  cameraId: string;
}
```

Success response:
```ts
{
  status: 'success',
  transport: 'webrtc';
  cameraId: string;
  streamKey: string;
  signaling: {
    offerUrl: string;
    iceServers: { urls: string; username?: string; credential?: string }[];
    token: string;
    expiresAt: string;
  };
}
```

Rules:
- Requires preview permission.
- Must return WebRTC signaling/session data only.
- Must not return Socket.io stream channel details.

## 4.6 executeCameraCommand
- Name/version: `cameras/executeCameraCommand` `v1`
- File: `src/cameras/_api/executeCameraCommand_v1.ts`
- Auth: login required
- Rate limit: 90/min

Request data:
```ts
{
  cameraId: string;
  commandId: string;
  action:
    | 'panLeft'
    | 'panRight'
    | 'tiltUp'
    | 'tiltDown'
    | 'irOn'
    | 'irOff'
    | 'recordStart'
    | 'recordStop';
  payload?: Record<string, string | number | boolean>;
}
```

Success response (accepted):
```ts
{
  status: 'success',
  command: {
    commandId: string;
    cameraId: string;
    action: string;
    status: 'accepted' | 'executed';
    lockUntil: string;
  };
}
```

Error response (locked):
```ts
{
  status: 'error',
  errorCode: 'camera.locked',
  errorParams: [{ key: 'seconds', value: number }],
  httpStatus: 409
}
```

Rules:
- Requires control permission.
- Validate idempotency by `commandId`.
- Acquire Redis lock per camera/action with TTL (default 3000ms).
- Emit sync event after accept/reject.

## 4.7 setIRMode
- Name/version: `cameras/setIRMode` `v1`
- File: `src/cameras/_api/setIRMode_v1.ts`
- Auth: login required
- Rate limit: 60/min

Request data:
```ts
{
  cameraId: string;
  irMode: 'off' | 'on' | 'auto';
}
```

Success response:
```ts
{
  status: 'success',
  cameraId: string,
  irMode: 'off' | 'on' | 'auto';
}
```

Rules:
- Requires control permission.
- Update DB state, dispatch device command, sync room.

## 4.8 setRecordingMode
- Name/version: `cameras/setRecordingMode` `v1`
- File: `src/cameras/_api/setRecordingMode_v1.ts`
- Auth: login required
- Rate limit: 60/min

Request data:
```ts
{
  cameraId: string;
  recording: boolean;
}
```

Success response:
```ts
{
  status: 'success',
  cameraId: string,
  recording: boolean;
}
```

Rules:
- Requires control permission.
- Enforce thermal/safety checks before start.

## 4.9 getUserCameraAccessMatrix (admin)
- Name/version: `admin/camera-access/getUserCameraAccessMatrix` `v1`
- File: `src/admin/camera-access/_api/getUserCameraAccessMatrix_v1.ts`
- Auth: login required + admin check
- Rate limit: 30/min

Request data:
```ts
{
  userIds?: string[];
  cameraIds?: string[];
}
```

Success response:
```ts
{
  status: 'success',
  users: { id: string; name: string; email: string }[];
  cameras: { id: string; name: string }[];
  matrix: {
    userId: string;
    cameraId: string;
    canPreview: boolean;
    canControl: boolean;
  }[];
}
```

Rules:
- Admin only.

## 4.10 updateCameraAccess (admin)
- Name/version: `admin/camera-access/updateCameraAccess` `v1`
- File: `src/admin/camera-access/_api/updateCameraAccess_v1.ts`
- Auth: login required + admin check
- Rate limit: 30/min

Request data:
```ts
{
  userId: string;
  cameraId: string;
  canPreview: boolean;
  canControl: boolean;
}
```

Success response:
```ts
{
  status: 'success',
  access: {
    userId: string;
    cameraId: string;
    canPreview: boolean;
    canControl: boolean;
    updatedAt: string;
  };
}
```

Rules:
- Admin only.
- If permission revoked while user is viewing, trigger forced leave sync for that camera room.

## 5. Sync Contracts (V1)

## 5.1 Route Layout
- `src/cameras/_sync/cameraStateUpdated_server_v1.ts`
- `src/cameras/_sync/cameraStateUpdated_client_v1.ts`
- `src/cameras/_sync/cameraCommandResult_server_v1.ts`
- `src/cameras/_sync/cameraCommandResult_client_v1.ts`
- `src/admin/camera-access/_sync/cameraAccessUpdated_server_v1.ts`
- `src/admin/camera-access/_sync/cameraAccessUpdated_client_v1.ts`

Room convention:
- `camera-{cameraId}`

## 5.2 cameraStateUpdated
Purpose:
- Broadcast normalized camera state delta to all authorized viewers in room.

Server output:
```ts
{
  status: 'success',
  cameraId: string,
  patch: {
    isOnline?: boolean;
    mode?: 'off' | 'idle' | 'live' | 'record';
    irMode?: 'off' | 'on' | 'auto';
    irEnabled?: boolean;
    pan?: number;
    tilt?: number;
    temperatureC?: number | null;
    motionDetected?: boolean;
    recording?: boolean;
  },
  at: string
}
```

## 5.3 cameraCommandResult
Purpose:
- Broadcast command acceptance/rejection/execution result.

Server output:
```ts
{
  status: 'success',
  cameraId: string,
  commandId: string,
  action: string,
  result: 'accepted' | 'rejected' | 'executed' | 'failed',
  cooldownUntil?: string,
  reasonCode?: string
}
```

## 5.4 cameraAccessUpdated
Purpose:
- Notify affected user sessions about permission changes.

Server output:
```ts
{
  status: 'success',
  userId: string,
  cameraId: string,
  canPreview: boolean,
  canControl: boolean,
  updatedAt: string
}
```

Client-stage rule:
- Deliver only to sockets belonging to target user and optionally to admins in access dashboard room.

## 6. Auth Policy by Endpoint

User-level endpoints:
- `cameras/getCameraList`
- `cameras/getCameraState`
- `cameras/getCameraPreviewSession`
- `cameras/executeCameraCommand`
- `cameras/setIRMode`
- `cameras/setRecordingMode`

Auth:
```ts
export const auth = {
  login: true,
  additional: []
};
```

Admin endpoints:
- `admin/camera-access/getUserCameraAccessMatrix`
- `admin/camera-access/updateCameraAccess`

Auth:
```ts
export const auth = {
  login: true,
  additional: [{ key: 'admin', value: true }]
};
```

## 7. Rate Limit Baseline
Suggested per-route values (requests/min):
- getCameraList: 120
- getCameraState: 180
- getCameraPreviewSession: 60
- executeCameraCommand: 90
- setIRMode: 60
- setRecordingMode: 60
- admin matrix + update: 30

Global IP fallback remains from `config.rateLimiting`.

## 8. Implementation Checklist
1. Add Prisma models and enums.
2. Generate Prisma client.
3. Add camera page API files with typed `ApiParams`.
4. Add admin access API files.
5. Add sync routes for state/command/access updates.
6. Integrate Redis command lock helper.
7. Wire WebRTC session endpoint and tokenization.
8. Add i18n keys for all `errorCode` values.
9. Validate that unauthorized users cannot get preview session data.
10. Validate race-condition behavior with parallel command attempts.

## 9. Non-Functional Requirements
- Never send video frames through Socket.io.
- Keep all camera command mutations server-authoritative.
- Ensure permission checks happen before room join and before every command.
- Maintain audit trail through `CameraCommand` and `CameraEvent`.
