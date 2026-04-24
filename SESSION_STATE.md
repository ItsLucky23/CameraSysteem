# Session state

Snapshot of where the camera system work stands. Read this first if you're coming back cold or handing the context to another collaborator.

---

## 1. What the system does (current picture)

```
Pi Zero 2W (camera_node)
  rpicam-vid  -->  ffmpeg (RTP packetizer)  -->  UDP/H.264 to Pi 5
                                                      |
Pi 5 (LuckyStack server)                              v
  cameraWebrtcBridge: 1 UDP ingest socket per active camera
       parses RTP, fans out to N werift RTCPeerConnections (one per browser)
       tracks lastPacketAt, exposes peers by peerId
  cameraStreamOrchestrator: owns "which cameras should be streaming"
       drives Pi Zero start/stop via Redis command queue
  ingestNodeTelemetry: receives Pi Zero state + stats, broadcasts via sync
                                                      |
Browser                                               v
  cameras/page.tsx: WebRTC preview + real-time state + FPS / quality badges
  admin/page.tsx: per-camera fps + quality configuration
```

Authorization stays on the existing `CameraAccess` model (per-user `canPreview` / `canControl` with admin override).

---

## 2. What we've shipped this session

### 2.1 Infrastructure from the previous session (carried over)

- Library swap: `@roamhq/wrtc` -> `werift-webrtc` (pure TS, no native build)
- H.264 RTP passthrough via werift `MediaStreamTrack.writeRtp(RtpPacket)` (no decode/re-encode on Pi 5)
- Pi 5 still owns orchestration, signaling, ingest, fan-out. No role loss from the ffmpeg removal.
- SDP `\r\n` terminator fix for Chrome's parser
- React `previewStartingRef` guard against StrictMode double-invocation
- `globalThis` singleton for `cameraWebrtcBridge` so dev hot-reload doesn't split the ingest registry

### 2.2 Per-camera stream configuration (step 1)

Changed:
- `prisma/schema.prisma` — `Camera.targetFps Int @default(15)`, `Camera.quality QUALITY @default(medium)`, `QUALITY` enum (low/medium/high)
- `src/admin/_api/createCamera_v1.ts`, `updateCamera_v1.ts`, `getCameraCatalog_v1.ts` — accept + persist + return the new fields; validate fps in 1..60 and quality in the enum set
- `src/admin/page.tsx` — FPS number input + quality `Dropdown.tsx`, form state extended, reset/openEdit/openCreate paths all updated
- `server/utils/cameraStreamOrchestrator.ts` — reads per-camera config from DB on activation, maps `quality` -> bitrate bps (`low=1M`, `medium=2M`, `high=4M`), includes `targetFps` + `bitrateBps` in the `startVideoStream` command payload, exports `onCameraStreamConfigChanged` for admin-initiated restart
- `pi_zero_2w/camera_node/command_executor.py` — validates `targetFps` + `bitrateBps` in the `startVideoStream` payload
- `pi_zero_2w/camera_node/adapters/base.py`, `raspberry_pi_adapter.py`, `mock_adapter.py` — signature gained `target_fps` + `bitrate_bps`
- `pi_zero_2w/camera_node/video_publisher.py` — removed hardcoded `FRAME_RATE = 45`; `rpicam-vid --framerate` + `--bitrate` are now parameters; intra interval tracks fps (1 keyframe / sec)

Result: the Pi Zero H.264 encoder runs at whatever the admin configures. No Pi 5 throttling. Changes to fps/quality while a stream is active trigger a stop+start so the new encoder params take effect.

### 2.3 Live telemetry end-to-end (step 2)

Changed:
- `pi_zero_2w/camera_node/models.py` — `CameraState.measured_fps` + `last_frame_age_ms` (both `None` when pipeline idle)
- `pi_zero_2w/camera_node/video_publisher.py` — ffmpeg runs with `-progress pipe:2` so it emits `\n`-terminated `key=value` lines regardless of loglevel; parser reads `frame=N` and `fps=X.X`; exposes `get_stats()`; drain loop survives `LimitOverrunError` on oversized rpicam-vid startup lines; logs a one-shot INFO on first progress line + final INFO on drain exit
- `pi_zero_2w/camera_node/adapters/raspberry_pi_adapter.py` — `get_state` pulls stats from VideoPublisher and puts them in `CameraState`
- `pi_zero_2w/camera_node/telemetry.py` — ingest payload carries `measuredFps` + `lastFrameAgeMs`
- `src/cameras/_api/ingestNodeTelemetry_v1.ts` — validates + broadcasts the new fields via `sync/cameras/cameraStateUpdated/v1`; fields are **ephemeral** (not persisted to DB)
- `src/cameras/_sync/cameraStateUpdated_server_v1.ts` — patch schema extended
- `src/cameras/_api/getCameraList_v1.ts` — returns `targetFps` + `quality` per camera so the page can show the admin-configured quality
- `src/cameras/_api/getCameraState_v1.ts` — returns initial `measuredFps: null, lastFrameAgeMs: null` (filled by first telemetry tick)
- `src/cameras/page.tsx` — `CameraListItem` + `CameraState` extended; sync callback applies the new fields; `qualityLabel` renders `selectedCamera.quality.toUpperCase()` (static, from DB); `fpsLabel` renders the real measured fps from telemetry or `—` when null. No more fake `1080P` / `45FPS`.

Cadence: Pi Zero sends on-change + heartbeat (default `TELEMETRY_INTERVAL_SEC=5`). Pi 5 broadcasts to the per-camera sync room (`camera-<cameraId>`).

### 2.4 Robustness fixes

- **Pi Zero crash on Pi 5 unreachable** (`pi_zero_2w/camera_node/api_client.py`): `_post` now wraps `asyncio.TimeoutError`, `aiohttp.ClientError`, `OSError` as `Pi5ApiError`. The runtime's existing handler logs the warning, sleeps the poll interval, and retries. Pi 5 can be down indefinitely — Pi Zero keeps knocking instead of crashing the process.

- **Peer stacking on in-page navigation** (`server/utils/cameraWebrtcBridge.ts`, `src/cameras/webrtc/_api/offer_v1.ts`, `close_v1.ts`, `src/cameras/page.tsx`):
  - Each peer now carries a server-side `peerId` (UUID)
  - Offer endpoint returns the `peerId`
  - New API `cameras/webrtc/close/v1` closes a specific peer
  - Client stores `peerId` + `cameraId` in refs; `stopPreviewConnection` fires the close API
  - Also handles the race where the PC is torn down while the offer is in flight
  - Fallback: stale-peer reaper (sweeps every 5s, reaps peers that never reached `connected` after 15s or have been `disconnected` for >10s)

- **Orchestrator state loss on HMR** (`server/utils/cameraStreamOrchestrator.ts`): `connectedSocketIds`, `activatedCameraIds`, `cameraIpById`, and the reconcile timer handle all live on `globalThis` now. Dev hot-reload used to silently split state between module versions — the exact cause of "admin-save-fps logs nothing" symptoms.

- **Pi Zero reboot self-heal** (`server/utils/cameraWebrtcBridge.ts`, `server/utils/cameraStreamOrchestrator.ts`):
  - Ingest stamps `lastPacketAt` on every received RTP packet, exposed via `getCameraIngestLastPacketAt`
  - Orchestrator runs a 4s reconciler. If an activated camera has had no RTP for >8s, it re-issues `stopVideoStream` + `startVideoStream`. Covers Pi Zero reboot, ffmpeg crash, network blip — without needing to bounce the Pi 5.
  - Startup grace: `lastPacketAt === null` (fresh ingest, Pi Zero hasn't produced frames yet) is treated as healthy, not stale.

### 2.5 Feedback captured in memory

- `memory/feedback_deployment_instructions.md` — at the end of any code-change turn, explicitly list `git pull` / `prisma:*` / `generateArtifacts` / restart instructions per machine. User does not want to reconstruct this each time.

---

## 3. Current state of play

### 3.1 What the user most recently reported

- Peer stacking on repeated cameras-page navigation: fixed.
- FPS counter in the cameras page is still `—`; admin fps changes don't seem to propagate to the Pi Zero; Pi Zero has no new logs after startup.

### 3.2 Leading hypothesis for "no Pi Zero logs"

When the user pulled + restarted the Pi Zero without restarting the Pi 5, the orchestrator's `activatedCameraIds` still contained the camera. Next cameras-page visit short-circuited (`already active`) and the Pi Zero never got told to start. The reconciler added in the last turn is the intended fix — it detects the stall and re-issues `startVideoStream` automatically.

### 3.3 Verification path after next Pi 5 restart

Expected log sequence on Pi 5 (within ~10s of opening the cameras page):

```
cameraStreamOrchestrator: activateCamera <id> (ip=...)
cameraStreamOrchestrator: stream config for <id> -> targetFps=N bitrateBps=M
cameraStreamOrchestrator: enqueue startVideoStream for <id> payload={...}
cameraWebrtcBridge[<id>] first RTP packet received on port <p> (size=...)
```

If RTP never arrives, expected follow-up ~8s later:

```
cameraStreamOrchestrator: stream stalled for <id> (>8000ms with no RTP) — re-issuing startVideoStream
```

Expected Pi Zero log:

```
Executing command ... (startVideoStream)
Starting video stream: rpicam-vid ... --framerate N --bitrate M ...
VideoPublisher received first ffmpeg progress line after K stderr lines: frame=...
```

If the "first ffmpeg progress line" log never appears even though rpicam-vid was started, the `-progress pipe:2` plumbing is the problem and we fall back to `-stats` without `-loglevel warning`. If it does appear but `measuredFps` stays null in telemetry, the parser is the problem.

### 3.4 Outstanding regen / restart steps the user still owes

Nothing in the last turn requires a Pi Zero pull. On Pi 5:
- `npm run generateArtifacts` — picks up the new `cameras/webrtc/close/v1` API and the updated `offer_v1` response shape (if not done since step 2.4 landed)
- Restart Pi 5

---

## 4. What's next on the plan

### 4.1 Immediate (blocked on user verification)

- Confirm fps measurement appears end-to-end after Pi 5 restart
- Confirm admin fps change triggers orchestrator restart log + Pi Zero `Starting video stream` with the new `--framerate`
- If parser works but `measuredFps` still null: switch to `-stats` + default loglevel fallback
- If fps/quality still doesn't reach the Pi Zero encoder: surface where the DB write or the enqueue is being dropped (add more logging, not more "try a different thing")

### 4.2 Recording (step 3+4 of the originally proposed plan)

Agreed design:
- Pi 5 is the recorder (passthrough-mux the already-parsed RTP into fMP4 via `ffmpeg -c copy`). No re-encode, no second RTP listener — tap the existing werift RTP stream or the ingest socket.
- DB model `Recording { id, cameraId, startedAt, expiresAt, stoppedAt?, filePath, startedByUserId, extensions, stopReason? }`
- Invariant: at most one in-progress recording per camera (`stoppedAt IS NULL`)
- Config: `recording.maxHours = 12`, `recording.baseDir = './recordings'`
- Storage layout: `./recordings/{cameraId}/{YYYY-MM-DD}/{HH-mm-ss}.mp4`
- APIs under `src/cameras/_api/recording/`: `start_v1`, `extend_v1`, `stop_v1`
- Auth: `canControlCamera({ isAdmin, access })` (any user with control permission on the camera)
- Extend button name: "Extend recording" (sets `expiresAt = now + maxHours`, `extensions++`)
- Auto-stop on: `expiresAt` reached, camera offline >60s, server graceful shutdown
- Sync event `sync/cameras/recordingStatus/v1` broadcasts `{ id, startedAt, expiresAt, extensions, startedByUserId } | null`
- UI computes remaining time client-side from `expiresAt - now`

Build order:
1. Muxer prototype (single camera, no timer, debug button) — prove the fMP4 plays back
2. Recording DB model + APIs + auto-stop timer
3. UI button + remaining-time display in the cameras page
4. Cleanup paths (offline / shutdown / expired)

### 4.3 Pre-existing debt (not yet addressed)

- **`onCameraEnabledChanged` not fired on `createCamera`** — a freshly created camera won't activate until the next 0 -> 1 socket transition. Add the call to `createCamera_v1` similar to how `updateCamera_v1` does config-change.
- **Admin `disableFeed` toggle** — the button is in the UI but not wired to `camera.enabled` or to `onCameraEnabledChanged`.
- **Dead locale keys** from the pre-webrtc flow: `previewToken*`, `previewSessionCreateFailed`, `requestPreviewSession`. Drop them.
- **Missing locale keys** for the new admin fields: `adminCameraManager.qualityLow`, `qualityMedium`, `qualityHigh`, `targetFps`, `quality` — not drafted in nl/en/de/fr. User should either draft them or ask for a default.
- **`pi_zero_2w/PI5_API_CONTRACT.md`** needs `startVideoStream` (now with `rtpHost` + `rtpPort` + `targetFps` + `bitrateBps`) and `stopVideoStream` documented.
- **Debug logging**: once the fps path is verified end-to-end, remove:
  - `[preview]` console.logs in `cameras/page.tsx`
  - `packetsReceived` / `packetsForwarded` counters in `cameraWebrtcBridge.ts`
  - `activateCamera` / `enqueue startVideoStream` verbose logs in `cameraStreamOrchestrator.ts`
  - `VideoPublisher received first ffmpeg progress line ...` INFO log in `video_publisher.py`

### 4.4 Open questions for the user

- Whether to display `lastFrameAgeMs` as a "STALLED" badge on the camera tile (threshold idea: >2000ms shows red "STALLED")
- Whether recordings need a retention policy (auto-delete after N days) or manual cleanup is fine for V1
- Whether the monitor nav item needs its own dedicated page or whether `src/cameras/page.tsx` is the final home
- Final storage location: currently `./recordings` relative to cwd; should this be absolute / configurable via env?

---

## 5. Known quirks and non-obvious decisions

- **Quality is a config knob, not a live stat.** It's read from DB and rendered on the cameras page as a static label. `measuredFps` is the only stream-health value that flows live.
- **`measuredFps` / `lastFrameAgeMs` are ephemeral**, never written to DB or `CameraStateSnapshot`. First telemetry tick after page open fills them in; null means either the pipeline isn't streaming or ffmpeg hasn't produced a progress line yet.
- **Restart on config change** only fires when the camera is currently active (`activatedCameraIds.has(id)`). If no one is watching, the change takes effect on the next activation — that's correct, not a bug.
- **MongoDB + Prisma**: pre-existing Camera documents won't have `targetFps` / `quality` fields until they're next updated. `fetchCameraStreamConfig` falls back to `15` / `medium` for those cases so the Pi Zero still starts.
- **Pi 5 reboot side note**: `broadcastStreamStopOnBoot` tells any straggler Pi Zeros to stop when Pi 5 starts. That's separate from the reconciler (which handles Pi Zero reboot). Both exist because they cover different loss-of-state directions.
