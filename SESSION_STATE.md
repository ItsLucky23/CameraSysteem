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

### 2.6 Parallel-lanes session (boot probes, thumbnails, capabilities, recordings)

Four AI agents shipped in parallel against `PARALLEL_WORK_PLAN.md`. Lane scopes and outcomes:

- **AI 1 — Pi Zero (Python).** Hardware-probe boot banner (camera / IR / pan-tilt / mic / speaker / motion / temperature), `CapabilityReport` dataclass that telemetry now sends every tick. New adapter methods `set_zoom` / `set_talkback` (stubs that print and store state). Telemetry payload extended with `zoomLevel` and `capabilities`. New `thumbnail_publisher.py` task that runs `rpicam-jpeg` every 30s when the video pipeline is idle (skips while streaming since rpicam-vid + rpicam-jpeg can't share the sensor) and POSTs base64 JPEGs to Pi 5.
- **AI 2 — Pi 5 server (TypeScript).** `runBootProbe` banner (redis / prisma / orchestrator / bridge / offline-watcher / pi-zero count), `cameraOfflineWatcher.ts` 5s sweep flips `isOnline=false` after 15s of telemetry silence, `cameraThumbnailStore.ts` + `cameraCapabilityStore.ts` in-memory `globalThis` singletons. New `cameras/uploadThumbnail/v1` and `cameras/getThumbnail/v1` APIs. New `cameras/thumbnailUpdated/v1` server-only sync. `cameraStateUpdated/v1` patch schema gained `zoomLevel` and `capabilities`. Both syncs broadcast to **two** rooms: per-camera (`camera-{id}`) and the new global `cameras-overview` room. `executeCameraCommand` action union extended with `zoomIn`, `zoomOut`, `talkbackOn`, `talkbackOff`. `[action]` / `[telemetry]` / `[capabilities]` / `[thumbnail]` / `[offline-watcher]` log lines added across the API surface — `[capabilities]` only fires on first-seen-after-boot or when the bitset actually changes.
- **AI 3 — Frontend (React).** Cameras page zoom slider became display-only with flanking icon buttons that call `zoomIn` / `zoomOut`; mic toggle additionally fires `talkbackOn` / `talkbackOff`; capability gating across IR / pan-tilt / zoom / talkback / system-audio controls (default `true` when missing so a Pi Zero pre-first-tick doesn't lock the user out). Dashboard + admin join the `cameras-overview` room and subscribe to `cameraStateUpdated/v1` and `thumbnailUpdated/v1` so tiles update live and render real JPEG thumbnails (with initial seeds from each loader's response).
- **AI 4 — Recordings.** New `Recording` Prisma model + `RecordingStopReason` enum. New `cameraRecordingManager.ts` runs a passthrough muxer: subscribes to RTP via additive `cameraWebrtcBridge.subscribeRtp`, forwards packets to a UDP loopback port, runs `ffmpeg -c copy -f mp4` against an SDP file, writes mp4 under `./recordings/{cameraId}/{YYYY-MM-DD}/{HH-mm-ss-uuid}.mp4`. Auto-stop on 1h, no-RTP-60s, ffmpeg exit, server shutdown, or camera offline. New `cameras/recording/{start,stop,getList}/v1` APIs. New `cameras/recordingStatus/v1` server-only sync. New `/recordings` page (template `home`) lists per-camera with active-recording badge + Play that opens an inline `<video>` against `GET /recordings/stream/:recordingId` (Range-aware HTTP route mounted in `server.ts`). SIGINT/SIGTERM hook flushes in-progress mp4s. Locale strings shipped in nl/en/de/fr.

### 2.7 Cross-lane wiring fixes

The four lanes shipped clean inside their fences but left these gaps that this integration pass closed:

- `uploadThumbnail/v1` now resolves `cameraId` from `cameraIp` when missing (mirroring `ingestNodeTelemetry`). Without this, the Pi Zero's first thumbnail after boot — fired before any command had been observed — would be rejected with `camera.invalidInput`.
- `cameraOfflineWatcher` now calls `cameraRecordingManager.notifyCameraOffline(cameraId)` directly when it flips a camera offline. AI 4's previous workaround (a 5s DB poll inside the manager) is gone.
- Cameras page, dashboard, and admin all subscribe to `cameras/recordingStatus/v1` now. Recording state on the cameras page is sourced from the muxer's `startedAt` (authoritative), not from the Pi Zero `mode === 'record'` telemetry hint (which is no longer set since `setRecordingMode_v1` no longer enqueues a Pi Zero command). Dashboard + admin tiles also derive `isRecording` from the same sync. The admin view-model now carries `isRecording` for future use even if the current admin tile doesn't render it.
- `cameraStreamOrchestrator.addRecordingReservation` is now a pure flag flip. The proactive activation (cancel pending grace timer + DB IP lookup + activate) moved into a new exported `ensureCameraActive(cameraId)` that the recording manager calls right after `addRecordingReservation`. Matches the original plan's "two methods + one OR-condition, nothing else" boundary.
- Dashboard + admin no longer call `getDeterministicUptimeMs` when `lastSeenAt` is null. They render `--` instead. The function is removed from both files (no other consumers).
- `pi_zero_2w/PI5_API_CONTRACT.md` documents the new `uploadThumbnail/v1` endpoint plus `zoomLevel` / `capabilities` on telemetry, and lists the full action set including the new stubs.

---

## 3. Current state of play

### 3.1 What the user most recently reported (2026-04-25)

- FPS counter on cameras page works; live admin updates take effect.
- Pi Zero <-> Pi 5 command path is push (long-poll over Redis pub/sub), not 750ms HTTP polling.
- Two follow-up items raised:
  1. Camera stream sometimes appears to ignore the admin-configured target fps / quality on initial activation.
  2. Stream sometimes goes silent for ~20s and recovers on its own (Pi 5 logs slow but don't stop).

### 3.2 Diagnostics added for those items

- `cameraStreamOrchestrator.fetchCameraStreamConfig` now logs `[cam <id>] DB stream config -> targetFps=N quality=Q bitrateBps=M` on every read, and warns when a Mongo doc is missing the field. Cross-check against the Pi Zero `Effective stream params: target_fps=... bitrate_bps=...` log to confirm what reached rpicam-vid.
- Pi Zero `VideoPublisher` runs an asyncio stall watchdog that logs WARN when frame production goes silent for >1s (re-warn-throttled to once per 5s). This catches the "partial stall" symptom — RTP rate drops below target for 20s but doesn't hit zero, so the Pi 5 reconciler (zero-RTP threshold = 20s) won't kick.
- Pi 5 reconciler still handles total-stop recovery; partial-stall recovery is intentionally left as logging-only until the cause is identified.

### 3.3 Verification path

Expected log sequence on Pi 5 (within ~10s of opening the cameras page after a clean restart):

```
SocketIO server initialized
[cam <id>] socket connected (id=<sid>, total=1, wasEmpty=true)
[cam <id>] activateCamera (ip=...)
[cam <id>] DB stream config -> targetFps=N quality=Q bitrateBps=M
[cam <id>] enqueueCommand action=startVideoStream commandId=... pubReceivers=N
[node <ip>] long-poll wake (publish=true) returned 1 command(s): startVideoStream/...
cameraWebrtcBridge[<id>] first RTP packet received on port <p> (size=...)
[cam <id>] telemetry received ip=... measuredFps=...
[cam <id>] sync emit sync/cameras/cameraStateUpdated/v1 -> camera-<id> (members=1)
```

Expected Pi Zero log:

```
Command long-poll returned 1 command(s): startVideoStream/...
Executing command ... (startVideoStream)
Effective stream params: target_fps=N (uncapped=False) bitrate_bps=M rtp=...:...
Starting video stream: rpicam-vid -n -t 0 --width 1920 --height 1080 --framerate N --bitrate M ...
VideoPublisher received first ffmpeg progress line after K stderr lines: frame=...
Telemetry sent isOnline=True mode=live measuredFps=... lastFrameAgeMs=... temperatureC=...
```

If `[cam <id>] DB stream config missing fields — using fallback` appears, the camera doc in MongoDB never received `targetFps`/`quality` after the schema change. Fix: open admin and re-save the camera so the document gets the fields persisted.

If `VideoPublisher stall watchdog: no new frame for ...ms` fires repeatedly, the rpicam-vid pipeline itself is dropping below target fps — investigate Pi Zero side (libcamera AE/AGC settling, sensor mode switch, memory pressure). Pi 5 isn't at fault.

### 3.5 Pi-Zero-to-Pi-5 transport (long-poll push)

- Pi Zero polls `POST /api/cameras/getPendingNodeCommands/v1 { cameraIp, nodeSecret, limit, waitMs }`. Pi 5 LPOPs the per-cameraIp queue first; if empty, it waits up to `waitMs` (capped at 25s) for a publish on the `camera-node:commands` Redis channel; then LPOPs again and returns.
- `enqueueCommand` does `RPUSH queue` + `PUBLISH channel`. The publish wakes any parked waiter for that cameraIp.
- A single shared `redisSubscriber` (`server/functions/redis.ts`) backs all waiters; the subscriber is initialized lazily on first `waitForCommandSignal` call.
- Pi Zero side (`runtime.py`): two parallel asyncio tasks — `_command_loop` (long-poll, immediate re-issue) and `_telemetry_loop` (5s heartbeat). On `Pi5ApiError` the command loop backs off `POLL_ERROR_BACKOFF_MS` (default 1500ms).
- Idle traffic per Pi Zero: ~2.4 command-poll requests/min (one every 25s) + 12 telemetry pushes/min (one every 5s).

### 3.6 Outstanding regen / restart steps the user still owes

Pi 5:
- `npx prisma generate` (Recording model)
- `npx prisma db push` (MongoDB applies the new collection)
- `npm run generateArtifacts` (picks up the new APIs / sync events / action union additions / patch fields)
- `mkdir -p ./recordings`
- Restart Pi 5

Each Pi Zero:
- `git pull`
- Restart `camera_node` service

---

## 4. What's next on the plan

### 4.1 Immediate (blocked on user verification)

- Confirm fps measurement appears end-to-end after Pi 5 restart
- Confirm admin fps change triggers orchestrator restart log + Pi Zero `Starting video stream` with the new `--framerate`
- If parser works but `measuredFps` still null: switch to `-stats` + default loglevel fallback
- If fps/quality still doesn't reach the Pi Zero encoder: surface where the DB write or the enqueue is being dropped (add more logging, not more "try a different thing")

### 4.2 Recording — landed

Shipped in section 2.6 (AI 4 lane) plus the cross-lane fixes in 2.7. End-to-end: existing record button on the cameras page → `setRecordingMode_v1` → `cameraRecordingManager.startRecording` → bridge RTP subscription → `ffmpeg -c copy` → mp4 on disk → Range-aware `/recordings/stream/:id` route → inline `<video>` on `/recordings`. Auto-stops on 1h expiry, server shutdown, ffmpeg exit, no-RTP-60s, or camera offline (notified by the offline watcher). Recording reservation force-keeps the Pi Zero stream active while a recording is in progress, even with no browser previewing.

Deferred to future sessions per the original plan: `extend` API + extensions counter, retention / auto-delete of old recordings, multi-stream concurrent recording per camera.

### 4.3 Pre-existing debt (not yet addressed)

- **`onCameraEnabledChanged` not fired on `createCamera`** — a freshly created camera won't activate until the next 0 -> 1 socket transition. Add the call to `createCamera_v1` similar to how `updateCamera_v1` does config-change.
- **Admin `disableFeed` toggle** — the button is in the UI but not wired to `camera.enabled` or to `onCameraEnabledChanged`.
- **Dead locale keys** from the pre-webrtc flow: `previewToken*`, `previewSessionCreateFailed`, `requestPreviewSession`. Drop them.
- **Missing locale keys** for new error codes from AI 4 lane: `recording.cameraNotFound`, `recording.startFailed`, `recording.stopFailed`, `recording.listFailed`, `recording.streamFailed`, `recording.invalidId`, `recording.notFound`, `recording.fileMissing`. They render as the key string until added.
- **Missing locale keys** for the new admin fields: `adminCameraManager.qualityLow`, `qualityMedium`, `qualityHigh`, `targetFps`, `quality` — not drafted in nl/en/de/fr. User should either draft them or ask for a default.
- **Placeholder thumbnail URLs** — dashboard + admin still keep the four hardcoded `lh3.googleusercontent` URLs as a fallback during the first ~30s before a real Pi Zero thumbnail arrives. Once thumbnails are reliable end-to-end, do a single grep + delete pass.
- **Debug logging**: once the fps path and the new thumbnail / recording paths are verified end-to-end, remove:
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
