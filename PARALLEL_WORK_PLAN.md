# Parallel Work Plan: Boot Probes + Action Logging + Stubbed Buttons + Thumbnails + Live Dashboard/Admin + Capability Graying

> Created 2026-04-25. Living document - update as work progresses.

This is a multi-session work plan. The work is split across **three parallel AI sessions** (`AI 1`, `AI 2`, `AI 3`). Each AI owns a separate slice of the codebase with no overlapping files, so they can run concurrently in three Claude Code chats without merge conflicts.

To kick off a session, paste this into a fresh Claude chat:

> Read `PARALLEL_WORK_PLAN.md`. You are AI N. Read your assigned files and the referenced context, then execute your steps.

Replace `N` with `1`, `2`, or `3`.

---

## 0. Mandatory pre-reading (every AI)

Before writing any code, every AI session must read:

1. `AI.md` - top-level rules: i18n via `useTranslator`, custom `tryCatch` (no raw try/catch), no emojis anywhere, no terminal commands without permission.
2. `.claude/CLAUDE.md` - styling rules, component priorities, color tokens, SOLID, JSX rules, generated-types policy.
3. `SESSION_STATE.md` - what's already shipped and what the parallel FPS-work session is touching. Critical to avoid stepping on the FPS path.

Reference for deeper architecture (read on demand, not blanket):

- `docs/ARCHITECTURE_API.md` - how API endpoints work
- `docs/ARCHITECTURE_SYNC.md` - how real-time sync events work
- `docs/ARCHITECTURE_ROUTING.md` - file-based routing
- `docs/ARCHITECTURE_SOCKET.md` - socket setup
- `pi_zero_2w/PI5_API_CONTRACT.md` - Pi Zero <-> Pi 5 API contract
- `prisma/schema.prisma` - database schema (current)

---

## 1. Mission

Five deliverables, in priority order:

1. **Boot-time hardware probe and service probe** (Pi Zero + Pi 5) - on startup, log a banner showing the detection result for every configured hardware component or service. Non-fatal: missing hardware logs FAIL but never crashes the process.
2. **Action logging** - every UI-driven backend event gets a Pi 5 log line. Visual structure: blank line before each event, single-line section dividers around significant transitions.
3. **Stubbed buttons** - wire the unwired UI buttons (zoom step-based, talkback mic) through the existing command queue so they log on the Pi Zero even though no hardware exists yet. Existing FPS / quality / IR / PTZ / record paths are NOT in scope; do not touch them.
4. **Thumbnails** - Pi Zero captures a 1280x720 JPEG every 30s (skipped while video stream is active), POSTs to Pi 5; Pi 5 holds it in memory and broadcasts via sync; dashboard and admin pages render it as a real `<img>`.
5. **Real-time dashboard / admin values** - dashboard and admin pages subscribe to the existing `cameraStateUpdated/v1` sync (plus the new `thumbnailUpdated/v1`) so `isOnline`, `mode`, `recording`, `temperatureC`, `measuredFps`, `zoomLevel` update live without a refresh.
6. **Capability graying** - the Pi Zero's boot probe results flow to Pi 5 (in every telemetry tick), are stored in memory per camera, and reach the frontend. The cameras page disables / grays out controls for hardware the camera does not have (no IR LED -> IR buttons grayed; no servos -> pan/tilt grayed; no microphone -> system audio grayed; no speaker -> talkback grayed; etc.).

Plus a small standalone task: **offline watcher** that flips `isOnline=false` after 15s of telemetry silence.

---

## 2. Locked design decisions

These are the answers from the planning conversation. Do not re-litigate them.

| Topic | Decision |
|---|---|
| Temperature source | CPU thermal_zone0 (already wired) |
| Action logging route | Existing command queue (no new log-only API) |
| Microphone direction | Two-way audio is the long-term goal. Stub names: `talkbackOn` / `talkbackOff` (browser -> camera speaker). Frontend "system audio" button stays purely client-side (controls `<video>` mute). |
| `src/camera/[id]/page.tsx` | Legacy. Don't touch, don't delete. |
| Offline threshold | Hardcoded 15000 ms in the watcher file. Not configurable. |
| Zoom semantics | Step-based: `zoomIn` / `zoomOut`, step = 10, range 1..100, Pi Zero owns state and reports `zoomLevel` via telemetry. Slider in UI becomes display-only. |
| Mic/speaker probe | Always run (`arecord -l` / `aplay -l`). Always log. FAIL is acceptable when no hardware. |
| Crash policy | Never crash on missing hardware. Probe failures and adapter init failures log and continue. |
| Audit / persistence | None for now. `print` on Pi Zero, `console.log` on Pi 5. Removable later by greppable prefix. |
| Database schema | No schema changes. `zoomLevel` is ephemeral like `measuredFps`. |
| Locale keys | No new UI text - no translation work. |
| Action union extension | Extend `cameras/executeCameraCommand` action type with `zoomIn`, `zoomOut`, `talkbackOn`, `talkbackOff`. |
| Thumbnail capture | Pi Zero owns it. `rpicam-jpeg` every 30s. **Skip the cycle while video stream is active** (rpicam-vid + rpicam-jpeg cannot share the sensor). When video stops, thumbnail loop resumes. |
| Thumbnail dimensions | 1280x720 JPEG quality 90 (premium feel). Estimated ~150-250KB per frame. |
| Thumbnail transport | Pi Zero -> Pi 5: HTTP POST `cameras/uploadThumbnail/v1` with base64 in JSON. Pi 5 -> browser: sync event `cameras/thumbnailUpdated/v1` carries `{ cameraId, capturedAt, jpegBase64 }`. |
| Thumbnail storage | In-memory `Map<cameraId, { jpegBase64, capturedAt }>` on Pi 5 `globalThis`. No disk persistence. Lost on Pi 5 restart, regenerates within 30s. |
| Thumbnail initial load | `getCameraCatalog/v1` (admin) and the dashboard's camera-list response include the latest thumbnail (or null) so first paint has an image. |
| Sync room for overview | Single global room `cameras-overview`. `cameraStateUpdated/v1` and `thumbnailUpdated/v1` are broadcast to BOTH the existing per-camera room (`camera-{id}`) AND `cameras-overview`. Dashboard + admin join `cameras-overview` (one subscription, all cameras). Cameras page keeps its existing per-camera subscription. |
| Live values on dashboard/admin | Subscribe to `cameraStateUpdated/v1` via `cameras-overview` room. Live-update `isOnline`, `mode`, `recording`, `temperatureC`, `measuredFps`, `zoomLevel`. No polling. |
| Capability source of truth | Pi Zero boot probe. Same probe code AI 1 writes for the boot banner produces the capability booleans. The probe's structured result is reused for telemetry. |
| Capability fields | `hasCamera`, `hasIR`, `hasPanTilt`, `hasMicrophone`, `hasSpeaker`, `hasMotion`, `hasZoom`, `hasTemperature`. (Pan and tilt merged - they're usually paired. If only one servo is configured the field is still `false` since the UI's pan/tilt pad needs both.) |
| Capability transport | Included in every telemetry tick under `capabilities` key. Self-healing: if Pi 5 restarts, capabilities refill from the next telemetry tick within ~5s. |
| Capability storage on Pi 5 | In-memory `Map<cameraId, Capabilities>` on `globalThis`. No DB persistence. Empty map after Pi 5 restart, fills as telemetry arrives. |
| Capability initial-load | `getCameraList/v1` and `admin/getCameraCatalog/v1` include `capabilities` per camera (or null when the Pi Zero has not yet reported - renders as "all features available", safe default that doesn't lock the user out). |
| Capability frontend gating | Cameras page only. Each control combines capability with existing permission gate: `disabled={controlsDisabled || !camera.capabilities?.hasIR}` etc. Use existing tailwind `disabled:opacity-60` styling. Dashboard / admin do not gate; they're informational. |
| Capability stub-button policy | Even though `zoomIn`/`zoomOut`/`talkback*` are stubs that print and no-op, the buttons are gated by capability. If a camera has no zoom or no speaker, those buttons gray out. The stub still works if invoked directly, but UI prevents accidental use. |

---

## 3. Coordination rules

Every AI must follow these or the parallel plan breaks down.

1. **Stay in your lane.** Each AI has an exclusive file list in section 4. If you find you need to touch a file owned by another AI, stop and write a coordination note at the bottom of this file under "Cross-lane coordination" instead of editing the file.
2. **Don't touch FPS-related files** unless your section explicitly lists them. The FPS path (`measuredFps`, `targetFps`, `quality`, `bitrateBps`, video stream RTP wiring, `cameraStreamOrchestrator` reconcile loop, `video_publisher.py`) is a separate, in-flight session. You may **read** these files but do not edit them.
3. **Don't add emojis** anywhere - code, comments, log lines, banners. Use ASCII only.
4. **Don't run terminal commands** that mutate state. Tell the user what to run. Reading-only commands are fine.
5. **Do not run `npm run generateArtifacts`.** That is an integration step the user runs at the end.
6. **Do not run `prisma:*` commands.** Schema is unchanged.
7. **No new test files**, no new docs, no scratchpad markdown unless explicitly assigned.
8. **Use `tryCatch` everywhere on the server side** (`server/functions/helper`). Do not use raw `try/catch`. Python is exempt - normal `try/except` is fine.
9. **i18n is mandatory for any new UI text**, but this plan adds none. If you find yourself adding hardcoded strings, stop and reconsider.
10. **Branch strategy** is up to the user. AIs operate on the current branch. Each AI's file scope is disjoint, so concurrent edits on the same branch will not conflict.
11. **Run all your steps in one go.** Do not pause partway to ask clarifying questions unless you are genuinely blocked. The user may walk away during the run - they expect to come back to a finished lane and a final report. If a step is ambiguous, make the most reasonable call and document the call in your final report (see rule 13). Do not implement only some steps and stop.
12. **If you skip something, log it - do not silently drop it.** The user expects every step to be either completed OR explicitly listed in your final report with a reason. Acceptable reasons include: "I was concerned this overlapped with another AI's lane", "the existing code did not match what the plan described and I did not want to guess", "this required a schema change that the plan said to avoid", etc. Unacceptable: skipping silently.
13. **End-of-run final report.** When done (or as done as you are going to get), post a single message containing the following four sections, in order:
    - **Done** - one-sentence summary of what shipped.
    - **Skipped / not done** - bullet list of any plan steps you did not complete, each with the reason. If you completed everything, write "None.".
    - **What the user needs to test** - a short checklist tailored to your lane only. Reference the master verification checklist in section 6 by step number where possible.
    - **Questions and feedback** - any clarifying questions you have for the user, plus any suggestions you want to surface (better approaches, things the plan got wrong, refactor opportunities you noticed but did not act on, naming concerns, etc.). If none, write "None.".
14. **When done**, append a "Done" line to your section in section 7 of this file with a one-sentence summary.

---

## 4. The three lanes

Find your AI number below. Read **only** your section to do the work, plus the cross-lane contracts in section 4.4. The other two sections are for context, not for action.

### 4.1 AI 1 - Pi Zero (Python)

You own the entire `pi_zero_2w/camera_node/` directory.

#### File ownership

```
pi_zero_2w/camera_node/boot_probe.py             NEW
pi_zero_2w/camera_node/thumbnail_publisher.py    NEW
pi_zero_2w/camera_node/runtime.py                EDIT
pi_zero_2w/camera_node/command_executor.py       EDIT
pi_zero_2w/camera_node/models.py                 EDIT
pi_zero_2w/camera_node/telemetry.py              EDIT
pi_zero_2w/camera_node/api_client.py             EDIT (add upload_thumbnail method)
pi_zero_2w/camera_node/video_publisher.py        EDIT (additive only: is_active() helper)
pi_zero_2w/camera_node/adapters/base.py          EDIT
pi_zero_2w/camera_node/adapters/mock_adapter.py  EDIT
pi_zero_2w/camera_node/adapters/raspberry_pi_adapter.py  EDIT
```

Do not touch:
- `pi_zero_2w/camera_node/video_publisher.py` beyond the additive `is_active()` helper. The FPS work owns the rest of this file. Do NOT modify the rpicam-vid / ffmpeg / progress-parsing logic.
- `pi_zero_2w/camera_node/config.py` unless absolutely necessary; we are not adding env vars

#### Steps

**Step 1.1 - Add the boot probe module.**

Create `pi_zero_2w/camera_node/boot_probe.py`. It exposes one function: `run_hardware_probe(adapter, *, camera_id, hostname) -> None`. Probes each of the components listed below using best-effort detection, then prints a banner.

Probes to implement (each must NOT raise on failure - wrap in `try/except` and report):

| Probe | Detection method | Result line |
|---|---|---|
| camera (rpicam-vid) | `shutil.which("rpicam-vid")`; if found, also try `subprocess.run(["rpicam-still", "--timeout", "50", "-o", "/dev/null"], timeout=3)` and inspect returncode | `OK` / `FAIL` |
| ir led | If `ir_gpio_pin` configured: try the same `OutputDevice(pin, ...)` init the adapter does. If no pin: `SKIP not configured` |
| pan servo | Same pattern using `AngularServo` and `pan_servo_gpio_pin` |
| tilt servo | Same as pan |
| microphone | `subprocess.run(["arecord", "-l"], ...)` and parse stdout for "card N:" lines. If no cards: `FAIL no device found` |
| speaker | `subprocess.run(["aplay", "-l"], ...)` same |
| motion detection | Always `STUB not implemented` |
| temperature | Read `/sys/class/thermal/thermal_zone0/temp`; if readable: `OK CPU thermal_zone0 (fallback)` else `FAIL` |

Banner format (exact):

```


============================================================
  CAMERA NODE BOOT - HARDWARE PROBE
  cameraId=<id>  hostname=<host>
============================================================
  camera (rpicam-vid)        <STATUS>  <detail>
  ir led                     <STATUS>  <detail>
  pan servo                  <STATUS>  <detail>
  tilt servo                 <STATUS>  <detail>
  microphone                 <STATUS>  <detail>
  speaker                    <STATUS>  <detail>
  motion detection           STUB      not implemented
  temperature                <STATUS>  <detail>
============================================================


```

Use `print(...)` (not `logger.info`) for the banner so it lands on stdout regardless of log config. Two leading blank lines, two trailing blank lines.

The `run_hardware_probe` function should accept the constructed adapter so it can read `_ir_gpio_pin`, `_pan_servo_gpio_pin`, `_tilt_servo_gpio_pin` for the SKIP / configured branch (or accept those as separate params - your choice, keep it clean).

**Step 1.2 - Wire the probe into runtime startup.**

In `pi_zero_2w/camera_node/runtime.py`, after the adapter's `startup()` is awaited and before the main loop begins, call `run_hardware_probe(...)`. Pass camera_id and hostname (use `socket.gethostname()`).

**Step 1.3 - Extend the data model with `zoom_level`.**

In `pi_zero_2w/camera_node/models.py`, add `zoom_level: Optional[int] = None` to `CameraState`. This is ephemeral - never persisted. Default 50 (mid-range) once the adapter starts streaming, but `None` until adapter has produced state.

**Step 1.4 - Add adapter methods for zoom and talkback.**

In `pi_zero_2w/camera_node/adapters/base.py`, add abstract methods:
```python
async def set_zoom(self, level: int) -> None: ...
async def set_talkback(self, enabled: bool) -> None: ...
```

In `mock_adapter.py` and `raspberry_pi_adapter.py`, implement both as stubs:
- `set_zoom(level)`: clamp to 1..100, store on `self._state.zoom_level`, `print(f"[adapter] set_zoom level=<old> -> <new>")`. Never raise.
- `set_talkback(enabled)`: store on a new `self._talkback_enabled` field (does not need to flow to telemetry yet), `print(f"[adapter] set_talkback enabled={enabled}")`. Never raise.

In `raspberry_pi_adapter.py`, also initialize `self._state.zoom_level = 50` in `__init__` so first telemetry tick reports a value.

In `raspberry_pi_adapter.get_state`, include `zoom_level=self._state.zoom_level` in the returned `CameraState`.

**Step 1.5 - Wire new actions into the command executor.**

In `command_executor.py`, extend the `execute` dispatch:

```python
elif command.action == "zoomIn":
    new_level = min(100, (self._state_zoom() or 50) + 10)
    await self._adapter.set_zoom(new_level)
elif command.action == "zoomOut":
    new_level = max(1, (self._state_zoom() or 50) - 10)
    await self._adapter.set_zoom(new_level)
elif command.action == "talkbackOn":
    await self._adapter.set_talkback(True)
elif command.action == "talkbackOff":
    await self._adapter.set_talkback(False)
```

For the current zoom level, you can either: (a) ask the adapter via `await self._adapter.get_state()` (cleanest), or (b) cache the last-set level in the executor. Pick (a). Add a print at executor entry: `print(f"[executor] action={command.action} payload={command.payload}")`.

**Step 1.6 - Telemetry payload includes zoomLevel.**

In `telemetry.py`, add `zoomLevel` to the JSON payload alongside `measuredFps` and `lastFrameAgeMs`. Use the camelCase key `zoomLevel`. The Pi 5 expects this name (see section 4.4).

**Step 1.7 - Logging style polish.**

Throughout the Python code paths you touched, ensure prints have:
- A blank line before each `[executor] action=...` log
- The `[adapter] ...` print on the next line directly after the executor line (no blank line between them - they're a logical pair)
- No emojis

**Step 1.8 - Capability reporting.**

Refactor `boot_probe.run_hardware_probe(...)` so it returns a structured result in addition to printing the banner:

```python
@dataclass
class CapabilityReport:
    has_camera: bool
    has_ir: bool
    has_pan_tilt: bool       # True only if BOTH pan and tilt servos init successfully
    has_microphone: bool
    has_speaker: bool
    has_motion: bool         # always False for now (stub)
    has_zoom: bool           # always False for now (no real zoom hardware)
    has_temperature: bool    # True if /sys/class/thermal/thermal_zone0/temp readable
```

Each probe step in step 1.1 already determines a boolean - just collect them into the dataclass and return.

Store the report on the runtime so telemetry can read it. Either pass it through `Runtime.__init__` or stash on a module-level singleton - your call, keep it clean.

In `telemetry.py`, include the capability report under a `capabilities` key in every telemetry payload:

```python
"capabilities": {
    "hasCamera": report.has_camera,
    "hasIR": report.has_ir,
    "hasPanTilt": report.has_pan_tilt,
    "hasMicrophone": report.has_microphone,
    "hasSpeaker": report.has_speaker,
    "hasMotion": report.has_motion,
    "hasZoom": report.has_zoom,
    "hasTemperature": report.has_temperature,
}
```

Use camelCase keys in the JSON payload (the Pi 5 schema expects camelCase).

The probe runs once on startup. Capabilities don't change at runtime, but we send them every tick anyway for self-healing on Pi 5 restart. The overhead is ~80 bytes per telemetry tick - negligible.

**Step 1.9 - Thumbnail publisher.**

Create `pi_zero_2w/camera_node/thumbnail_publisher.py`. It runs as an asyncio task started from `runtime.py`. Loop:

1. Sleep 30s.
2. Check whether video stream is active. Read state from the adapter's `VideoPublisher` (use `video_publisher.is_active()` - if that helper does not exist, add a minimal `is_active()` to `VideoPublisher` that returns whether the rpicam-vid subprocess is currently running. **This is the only edit you make to `video_publisher.py` and it must be additive only.**)
3. If active: skip this cycle. Print `[thumbnail] skipped (video stream active)`.
4. If idle: run `rpicam-jpeg --width 1280 --height 720 --quality 90 --timeout 200 --output -` capturing stdout. Use `asyncio.create_subprocess_exec` with a 5s timeout. If subprocess fails or hits the timeout: print `[thumbnail] capture failed: <reason>` and skip.
5. Base64-encode the JPEG bytes. POST to Pi 5 endpoint `cameras/uploadThumbnail/v1` with payload `{ cameraId, capturedAt: ISO8601 string, jpegBase64 }`. Use the existing `api_client` upload pattern (extend it with an `upload_thumbnail` method if needed - same auth secret as telemetry).
6. Print `[thumbnail] published cameraId=<id> bytes=<jpeg-len>`.

If the POST fails (Pi 5 unreachable), wrap with the same `Pi5ApiError` handling that `api_client._post` already does - log a warning and retry next cycle. **Never crash the process.**

In `runtime.py`, start the thumbnail task alongside the existing telemetry task. Make sure shutdown cancels it cleanly.

**Done criteria for AI 1.**

- Pi Zero boots and prints the hardware probe banner.
- Boot succeeds with zero hardware attached (mock adapter on dev box).
- New `zoomIn` / `zoomOut` / `talkbackOn` / `talkbackOff` commands accepted and printed.
- Telemetry payload contains `zoomLevel: int | null`.
- Telemetry payload contains `capabilities` object with all 8 boolean fields.
- `boot_probe` returns a structured `CapabilityReport` reused by telemetry.
- Thumbnail publisher runs every 30s, skips while video active, POSTs JPEG when idle.
- `video_publisher.py` has only one additive change (`is_active()` helper), nothing else touched.
- No new dependencies, no schema changes, no env changes.

When done, append:
```
### AI 1 - Done
<one-sentence summary>
```
to the bottom of this file under section 7.

---

### 4.2 AI 2 - Pi 5 server (Node / TypeScript)

You own server-side wiring: boot probes, offline watcher, action logging, telemetry handling, and the new command actions on the API surface.

#### File ownership

```
server/utils/bootProbe.ts                      NEW
server/utils/cameraOfflineWatcher.ts           NEW
server/utils/cameraThumbnailStore.ts           NEW
server/utils/cameraCapabilityStore.ts          NEW
server/server.ts                               EDIT (boot wiring only)
src/cameras/_api/executeCameraCommand_v1.ts    EDIT (extend action union, [action] log)
src/cameras/_api/setIRMode_v1.ts               EDIT ([action] log)
src/cameras/_api/setRecordingMode_v1.ts        EDIT ([action] log)
src/cameras/_api/ingestNodeTelemetry_v1.ts     EDIT (zoomLevel + [telemetry] log + broadcast to cameras-overview room)
src/cameras/_api/webrtc/offer_v1.ts            EDIT ([action] log)
src/cameras/_api/webrtc/close_v1.ts            EDIT ([action] log)
src/cameras/_api/uploadThumbnail_v1.ts         NEW
src/cameras/_api/getThumbnail_v1.ts            NEW
src/cameras/_sync/cameraStateUpdated_server_v1.ts  EDIT (zoomLevel patch field + cameras-overview broadcast)
src/cameras/_sync/thumbnailUpdated_server_v1.ts    NEW
src/cameras/_api/getCameraList_v1.ts           EDIT (include latest thumbnail in response - this is a thumbnail-only edit, do NOT add action logging here)
src/admin/_api/getCameraCatalog_v1.ts          EDIT (include latest thumbnail in response - thumbnail-only edit)
src/admin/_api/createCamera_v1.ts              EDIT ([action] log)
src/admin/_api/updateCamera_v1.ts              EDIT ([action] log)
src/admin/_api/deleteCamera_v1.ts              EDIT ([action] log)
```

Do not touch:
- `server/utils/cameraStreamOrchestrator.ts` (FPS work owns the reconcile loop)
- `server/utils/cameraWebrtcBridge.ts` (FPS work owns RTP fan-out)
- `src/cameras/_api/getCameraList_v1.ts`, `getCameraState_v1.ts` (skip per the action-logging policy: list / state-fetch are noisy and excluded)
- `src/cameras/_api/getPendingNodeCommands_v1.ts` (Pi Zero polling - noisy, excluded)
- Any frontend files (AI 3's lane)

#### Steps

**Step 2.1 - Create `server/utils/bootProbe.ts`.**

Export `runBootProbe()` that:
- Confirms Redis connectivity (use `functions.redis` from server functions or call `.ping()` on the existing client)
- Confirms Prisma DB connectivity (a trivial `prisma.$queryRaw` or count call wrapped in `tryCatch`)
- Counts cameras configured (`prisma.camera.count({ where: { enabled: true } })`)
- Confirms the offline watcher is registered (set a module-level flag from the watcher file and check it)
- Prints the banner

Banner format (exact):

```


============================================================
  PI 5 CAMERA SUBSYSTEM BOOT
============================================================
  redis                      <STATUS>  <detail>
  prisma db connection       <STATUS>  <detail>
  cameraStreamOrchestrator   OK        loaded
  cameraWebrtcBridge         OK        loaded
  offline-watcher            OK        threshold=15000ms
  configured pi zeros        <N>       enabled
============================================================


```

Use `console.log` (not `logger.info`). Two blank lines top and bottom.

Each probe step in its own `tryCatch`. A failed Redis probe logs `FAIL <reason>` and continues - never throw out of `runBootProbe`.

**Step 2.2 - Create `server/utils/cameraOfflineWatcher.ts`.**

```typescript
const CAMERA_OFFLINE_TIMEOUT_MS = 15_000;
const CAMERA_OFFLINE_SWEEP_INTERVAL_MS = 5_000;
```

Export `startCameraOfflineWatcher()` that:
- Stores its `setInterval` handle on `globalThis` (HMR-safe, follow the same pattern as `cameraStreamOrchestrator`)
- Every 5s: queries cameras where `isOnline === true && lastSeenAt < now - 15000`
- For each stale camera: updates `isOnline=false` in DB, broadcasts via existing `sync/cameras/cameraStateUpdated/v1` with `{ isOnline: false }` patch
- Logs: `[offline-watcher] camera <id> went offline (last seen <ageS>s ago)` with one blank line before, single `-` divider

Do not change the schema. `lastSeenAt` already exists.

Use the existing sync send pattern - search for how `ingestNodeTelemetry_v1.ts` emits `cameraStateUpdated/v1` and match it.

**Step 2.3 - Wire boot probe + offline watcher into `server/server.ts`.**

After the existing camera subsystem boot (look for where `cameraStreamOrchestrator` is initialized), call:
1. `startCameraOfflineWatcher()`
2. `await runBootProbe()`

Do not refactor existing boot ordering - just append.

**Step 2.4 - Action logging in API endpoints.**

Add a `console.log` line to each of:
- `executeCameraCommand_v1.ts`
- `setIRMode_v1.ts`
- `setRecordingMode_v1.ts`
- `webrtc/offer_v1.ts`
- `webrtc/close_v1.ts`
- `admin/_api/createCamera_v1.ts`
- `admin/_api/updateCamera_v1.ts`
- `admin/_api/deleteCamera_v1.ts`

Format (exact):
```typescript
console.log('');
console.log(`[action] ${routeName} cameraId=${cameraId} userId=${user.id} ${extraKv}`);
```

The leading blank line provides visual grouping. `routeName` is the API route literal (e.g. `cameras/setIRMode`). `extraKv` is route-specific structured data, e.g. for `setIRMode`: `mode=${data.mode}`. For `executeCameraCommand`: `action=${data.action} payload=${JSON.stringify(data.payload ?? {})}`. Keep it parseable.

If the route doesn't have `cameraId` (e.g. createCamera), use `cameraId=<new-id>` post-creation or `cameraId=-` if pre-validation.

**Step 2.5 - Extend `executeCameraCommand_v1.ts` action union.**

Find the `data.action` validation. Add `zoomIn`, `zoomOut`, `talkbackOn`, `talkbackOff` to the allowed list. Update the TypeScript type accordingly.

If the existing action allowlist is enforced by Zod or a type union, extend both the runtime check and the type.

For `zoomIn` / `zoomOut`, the payload can be empty `{}`. For `talkbackOn` / `talkbackOff`, also empty.

The existing function `enqueueCommand` already handles arbitrary action strings - no changes needed in the queue layer.

**Step 2.6 - Telemetry ingest - add `zoomLevel`.**

In `ingestNodeTelemetry_v1.ts`:
- Add `zoomLevel` to the validation schema (number 1..100 or null, optional - older Pi Zeros without the update will not send it)
- Pass it through to the `cameraStateUpdated/v1` sync broadcast
- Do NOT persist to DB (ephemeral, like `measuredFps`)

Add the telemetry log:
```typescript
console.log('');
console.log(`[telemetry] ingest cameraId=${cameraId} online=${isOnline} fps=${measuredFps ?? '-'} temp=${temperatureC ?? '-'} zoom=${zoomLevel ?? '-'}`);
```

**Step 2.7 - Sync schema for `zoomLevel`.**

In `cameraStateUpdated_server_v1.ts`, extend the patch schema to allow `zoomLevel: number | null`. Match the existing pattern for `measuredFps`.

**Step 2.8 - Logging style polish.**

- Always one blank line BEFORE each `[action]` and `[telemetry]` line (use `console.log('')`)
- Section dividers (`console.log('-'.repeat(60))`) only for the offline-watcher transition log, top and bottom
- No emojis

**Step 2.9 - In-memory thumbnail store.**

Create `server/utils/cameraThumbnailStore.ts`. Pattern follows the orchestrator's `globalThis` HMR-safe pattern.

```typescript
type StoredThumbnail = { jpegBase64: string; capturedAt: Date };
const store: Map<string, StoredThumbnail> = (globalThis as any).__cameraThumbnailStore ??= new Map();
```

Export:
- `setThumbnail(cameraId: string, jpegBase64: string, capturedAt: Date): void`
- `getThumbnail(cameraId: string): StoredThumbnail | null`
- `getAllThumbnails(): Map<string, StoredThumbnail>`

No disk I/O. No retention policy. Memory-only.

**Step 2.10 - Upload endpoint.**

Create `src/cameras/_api/uploadThumbnail_v1.ts`. HTTP POST. Auth: shared-secret header (match the pattern `ingestNodeTelemetry_v1.ts` uses). Payload validation:

```typescript
interface UploadPayload {
  cameraId: string;
  capturedAt: string;       // ISO8601
  jpegBase64: string;       // max ~500KB encoded
}
```

Validation:
- `cameraId` exists in DB
- `jpegBase64` length <= 800_000 (covers ~600KB raw + base64 overhead, generous)
- `jpegBase64` decodes and starts with JPEG magic bytes `0xFF 0xD8 0xFF`. If not, reject with `camera.invalidInput`.
- `capturedAt` parses to a Date.

On success:
- Call `setThumbnail(cameraId, jpegBase64, capturedAt)`
- Broadcast sync `cameras/thumbnailUpdated/v1` with `{ cameraId, capturedAt, jpegBase64 }` to BOTH rooms: per-camera (`camera-${cameraId}`) AND the global `cameras-overview` room.
- Log `[thumbnail] received cameraId=<id> bytes=<base64-length>` (one blank line before)

**Step 2.11 - Get endpoint (initial fetch).**

Create `src/cameras/_api/getThumbnail_v1.ts`. Auth: standard logged-in. Returns the latest thumbnail for one camera as `{ jpegBase64, capturedAt } | null`. Used as a fallback if a client connects after the most recent broadcast.

**Step 2.12 - Sync schema for thumbnails.**

Create `src/cameras/_sync/thumbnailUpdated_server_v1.ts` only. No client file (per AI.md section 6, default to server-only). Schema:

```typescript
interface ServerOutput {
  status: 'success';
  cameraId: string;
  capturedAt: string;
  jpegBase64: string;
}
```

**Step 2.13 - cameras-overview room broadcasts.**

Both `cameraStateUpdated/v1` (existing) and `thumbnailUpdated/v1` (new) must broadcast to TWO rooms:
1. `camera-${cameraId}` (existing, used by cameras page)
2. `cameras-overview` (new, used by dashboard + admin)

In `ingestNodeTelemetry_v1.ts`, where it currently broadcasts state to `camera-${cameraId}`, add a second broadcast to `cameras-overview`.

In `uploadThumbnail_v1.ts`, broadcast to both rooms.

Joining the `cameras-overview` room from the client side is AI 3's responsibility (frontend joins via the sync subscription).

**Step 2.14 - Initial-load thumbnail injection.**

In `getCameraList_v1.ts` (cameras page) and `admin/_api/getCameraCatalog_v1.ts` (admin page), enrich each camera in the response with `thumbnail: { jpegBase64: string; capturedAt: string } | null`, sourced from `getThumbnail(cameraId)`.

These are thumbnail-only edits to those files. Do NOT add `[action]` logging to `getCameraList` or `getCameraCatalog` - they are list-fetch routes (excluded per the action-logging policy).

**Step 2.15 - Capability store.**

Create `server/utils/cameraCapabilityStore.ts` following the same `globalThis` HMR-safe pattern as `cameraThumbnailStore.ts`.

```typescript
export interface Capabilities {
  hasCamera: boolean;
  hasIR: boolean;
  hasPanTilt: boolean;
  hasMicrophone: boolean;
  hasSpeaker: boolean;
  hasMotion: boolean;
  hasZoom: boolean;
  hasTemperature: boolean;
}
```

Export `setCapabilities(cameraId, capabilities)`, `getCapabilities(cameraId): Capabilities | null`, `getAllCapabilities()`.

**Step 2.16 - Telemetry ingest stores capabilities.**

In `ingestNodeTelemetry_v1.ts`:
- Validate the new `capabilities` field (object with 8 boolean keys, all required).
- Call `setCapabilities(cameraId, capabilities)` on the store.
- Include `capabilities` in the `cameraStateUpdated/v1` sync broadcast patch (already broadcasting to both rooms per step 2.13).
- Update the `[telemetry]` log to NOT spam capabilities every tick (they don't change). Only log on the FIRST telemetry tick after Pi 5 startup, or when capabilities differ from the previous stored value. Format: `[capabilities] cameraId=<id> hasIR=true hasPanTilt=true ... ` on its own line, with a blank line before.

**Step 2.17 - Initial-load capability injection.**

In `getCameraList_v1.ts` and `admin/_api/getCameraCatalog_v1.ts`, also include `capabilities: Capabilities | null` per camera, sourced from `getCapabilities(cameraId)`. (Same files you edit for thumbnails - one round-trip.)

**Step 2.18 - Sync schema for capabilities.**

In `cameraStateUpdated_server_v1.ts`, extend the patch schema to allow `capabilities: Capabilities | null` (optional field on the patch object).

**Done criteria for AI 2.**

- Pi 5 server starts, prints both boot banners (yours + AI 1's, if AI 1 has shipped).
- Every UI-driven backend event prints an `[action]` line.
- Telemetry ingest prints `[telemetry]` per tick.
- Offline watcher flips a stale camera and logs.
- New action union accepts `zoomIn` / `zoomOut` / `talkbackOn` / `talkbackOff`.
- `cameraStateUpdated/v1` sync broadcasts include `zoomLevel` when present.
- Both `cameraStateUpdated/v1` and `thumbnailUpdated/v1` broadcast to both `camera-${id}` and `cameras-overview` rooms.
- `cameras/uploadThumbnail/v1` accepts JPEG uploads, stores in memory, broadcasts.
- `cameras/getThumbnail/v1` returns the latest stored thumbnail.
- `getCameraList/v1` and `admin/getCameraCatalog/v1` include the latest thumbnail and capabilities per camera in their response (or null).
- Capabilities flow through telemetry into the in-memory store and into the cameraStateUpdated sync patch.
- `[capabilities]` log line only emitted on first-seen or changed (no per-tick spam).

When done, append:
```
### AI 2 - Done
<one-sentence summary>
```
to section 7.

---

### 4.3 AI 3 - Frontend (React / TypeScript)

You own three frontend pages: cameras, dashboard, and admin (latter two for live-value subscriptions and thumbnail rendering only).

#### File ownership

```
src/cameras/page.tsx          EDIT
src/dashboard/page.tsx        EDIT
src/admin/page.tsx            EDIT (live values + thumbnails ONLY - see step list)
```

Do not touch:
- Any `_components/`, `_providers/`, `_functions/` (no shared component changes needed)
- Any sync or API definition files (AI 2 owns those)
- Locale files (no new strings - existing UI already has labels)
- Anywhere in `src/admin/page.tsx` related to camera CRUD form, FPS / quality / IR / record fields, or any field-edit flow (FPS work owns those). You ONLY add a sync subscription and swap the placeholder thumbnail for a real one.

#### Steps

**Step 3.1 - Convert zoom slider to display-only + flanking buttons.**

In `src/cameras/page.tsx`, find both the mobile (~line 1093-1106) and desktop (~line 1341-1354) zoom slider blocks.

Current layout:
```
[zoom_out icon]  [<input type="range">]  [zoom_in icon]
```

New layout:
```
[zoom_out button]  [<input type="range" disabled>]  [zoom_in button]
```

Changes:
- Wrap the `zoom_out` Icon in a `<button>` with `onClick={() => void sendCommand('zoomOut')}` and `disabled={controlsDisabled}`.
- Wrap the `zoom_in` Icon in a `<button>` with `onClick={() => void sendCommand('zoomIn')}` and `disabled={controlsDisabled}`.
- The `<input type="range">` becomes `disabled` and its `value` is bound to a state `cameraZoomLevel` (number, default 50) sourced from the cameraState sync feed. Remove the `onChange` handler that mutates local `zoomLevel`. The `setZoomLevel` local state can be removed entirely.

The slider stays in the DOM purely as a visual fill bar.

**Step 3.2 - Subscribe to `zoomLevel` from cameraState sync.**

The `cameraStateUpdated/v1` sync callback already updates the local `cameraState`. After AI 2's changes, `zoomLevel` will be present on incoming patches.

In the existing `upsertSyncEventCallback({ name: 'cameras/cameraStateUpdated', ...})` block, when applying the patch to local state, also propagate `zoomLevel` if present. Read it from the latest cameraState in the render path - do not duplicate state.

If your typed `serverOutput` from the generated map does not yet expose `zoomLevel`, that is because the user has not run `npm run generateArtifacts` yet. Write the code as if it does. Type errors will resolve after the user runs that command. Do NOT add `as any` or `unsafe*` casts (rule 16 in `.claude/CLAUDE.md`).

**Step 3.3 - Update `zoomLabel` to render server zoom.**

The existing `zoomLabel` (used in both mobile ~line 1090 and desktop ~line 1338) reads from local `zoomLevel`. Change it to read from `cameraState.zoomLevel ?? '-'` formatted as a percent (e.g. `50%`).

**Step 3.4 - Wire mic toggle to `talkbackOn` / `talkbackOff`.**

In both mic-toggle button blocks (mobile ~line 1172, desktop ~line 1404):
- Keep the existing local `setUplinkMicEnabled` toggle (controls the browser mic capture chain).
- Additionally call `sendCommand('talkbackOn')` when enabling, `sendCommand('talkbackOff')` when disabling.

The `getUserMedia`-based mic capture stays as-is (it provides the level meter UX). The new commands are purely the backend stub path.

**Step 3.5 - System audio toggle - browser console log.**

In both system-audio toggle blocks (mobile ~line 1145, desktop ~line 1388):
Add `console.log('[ui] system audio enabled=' + (!previous));` (or equivalent) inside the click handler. This is the only frontend-only `[ui]` log we need - per the user's request to log every website event.

**Step 3.6 - Action union in `sendCommand`.**

The local `CommandAction` type / signature in `page.tsx` (around line 387) needs `zoomIn`, `zoomOut`, `talkbackOn`, `talkbackOff` added so TypeScript accepts those arguments. Match the type AI 2 puts on the API side.

**Step 3.7 - Logging style polish.**

The few `console.log` calls you add (`[ui]`) get a blank line before:
```typescript
console.log('');
console.log(`[ui] system audio enabled=${enabled}`);
```

No emojis.

**Step 3.8 - Dashboard live values + thumbnails.**

In `src/dashboard/page.tsx`:

- Add a `useSyncEvents` subscription to `cameras/cameraStateUpdated/v1` joined to the `cameras-overview` room. On each event, merge the patch into the local cameras list state (find the camera by id, update its `isOnline`, `mode`, `recording` (or `mode === 'record'` derivation), `temperatureC`, `measuredFps`, `zoomLevel`).
- Add a second sync subscription to `cameras/thumbnailUpdated/v1` (same room). On each event, store `{ jpegBase64, capturedAt }` per camera id in a local Map state.
- For each camera tile, swap the existing placeholder thumbnail rendering for `<img src={`data:image/jpeg;base64,${jpegBase64}`} />`. If no thumbnail yet (first paint, no upload received), keep the existing placeholder.
- The initial `getCameraList/v1` (or whichever loader the dashboard uses) response now includes a `thumbnail` field per camera. Seed the Map with these on initial load.
- The recording / online / temperature pills derive their state from the live-updated camera object - they will animate without a refresh.

**Step 3.9 - Admin live values + thumbnails.**

In `src/admin/page.tsx`, ONLY:

- Add the same two sync subscriptions (`cameraStateUpdated/v1` + `thumbnailUpdated/v1`, room `cameras-overview`) at the top-level effect.
- Patch the local `cameraCatalog` state on each `cameraStateUpdated` event (live `isOnline`, etc.).
- Render the thumbnail per camera row.
- The initial `admin/getCameraCatalog/v1` response now includes a `thumbnail` field per camera. Seed it on initial load.

**Do not** touch the create/edit form, the FPS / quality fields, or any control that currently writes back to the camera. The FPS-work session owns those. If you find yourself near them, stop.

**Step 3.10 - Capability gating on cameras page.**

In `src/cameras/page.tsx`, the `selectedCamera` already has the new `capabilities` field after AI 2 lands.

Add capability gating to each control. Combine with the existing `controlsDisabled` (permission-based). Use `?? true` as the default-when-missing so a Pi Zero that hasn't reported yet does NOT lock the user out:

```typescript
const caps = selectedCamera?.capabilities;
const irDisabled       = controlsDisabled || !(caps?.hasIR ?? true);
const panTiltDisabled  = controlsDisabled || !(caps?.hasPanTilt ?? true);
const zoomDisabled     = controlsDisabled || !(caps?.hasZoom ?? true);
const talkbackDisabled = controlsDisabled || !(caps?.hasSpeaker ?? true);
const sysAudioDisabled = !(caps?.hasMicrophone ?? true);  // not gated by controlsDisabled - it's local mute
```

Wire each pre-computed flag into the `disabled` prop of the corresponding button(s):

- IR off / on / auto buttons (mobile + desktop) -> `disabled={irDisabled}`
- All four pan/tilt arrows (mobile + desktop) -> `disabled={panTiltDisabled}`
- The PTZ home (center) button -> not gated (it just refreshes state, no hardware)
- Zoom-in / zoom-out icon buttons (mobile + desktop) -> `disabled={zoomDisabled}`
- Talkback mic toggle (mobile + desktop) -> `disabled={talkbackDisabled}`
- System audio toggle (mobile + desktop) -> `disabled={sysAudioDisabled}`

Each disabled button must visually indicate it's disabled. The existing tailwind `disabled:opacity-60` on most buttons handles this. Verify each button's class string includes `disabled:opacity-60`. If a button is missing it (e.g. system audio, talkback, zoom icons), add it.

For the cameras tile selector at the top of the page (the row of pill buttons), do NOT gate by capability. A user always needs to be able to select a camera regardless of its hardware.

The dashboard and admin pages are NOT gated. They are informational - render values + thumbnails, do not show controls.

**Step 3.11 - Logging style polish.**

The few `console.log` calls you add (`[ui]`) get a blank line before:
```typescript
console.log('');
console.log(`[ui] system audio enabled=${enabled}`);
```

No emojis.

**Done criteria for AI 3.**

- Zoom slider is read-only; flanking icons are buttons that call `zoomIn` / `zoomOut`.
- Slider value reflects server-reported `cameraState.zoomLevel`.
- Mic toggle fires `talkbackOn` / `talkbackOff` in addition to the existing local capture toggle.
- System audio toggle prints a `[ui]` log to the browser console.
- Dashboard tiles update live (online dot, recording state, temperature) when telemetry arrives.
- Dashboard tiles render real thumbnails (initial from API loader, live updates from sync).
- Admin page tiles do the same - live state + thumbnails.
- Cameras page controls are grayed out for hardware the camera does not have, with `disabled:opacity-60` visible.
- No emojis, no `unsafe*` wrappers, no raw try/catch.

When done, append:
```
### AI 3 - Done
<one-sentence summary>
```
to section 7.

---

### 4.4 Cross-lane contracts

These are the interfaces between AIs. Match these names exactly so the three lanes line up.

**New command actions** (AI 1 dispatch + AI 2 type union + AI 3 invoke):
- `zoomIn` (no payload)
- `zoomOut` (no payload)
- `talkbackOn` (no payload)
- `talkbackOff` (no payload)

**New telemetry field** (AI 1 produces + AI 2 ingests + AI 3 reads):
- `zoomLevel: number | null` - integer 1..100 or null. JSON key `zoomLevel` (camelCase).

**Sync broadcast field** (AI 2 schema + AI 3 read):
- `cameraStateUpdated/v1` patch may include `zoomLevel: number | null`.

**Thumbnail upload payload** (AI 1 sends + AI 2 receives):
- HTTP POST `cameras/uploadThumbnail/v1`
- `{ cameraId: string, capturedAt: ISO8601 string, jpegBase64: string }`

**Thumbnail sync event** (AI 2 emits + AI 3 reads):
- `cameras/thumbnailUpdated/v1` server output: `{ status: 'success', cameraId, capturedAt, jpegBase64 }`

**Sync rooms** (AI 2 broadcasts + AI 3 joins):
- Per-camera room: `camera-${cameraId}` (existing - cameras page)
- Global overview room: `cameras-overview` (new - dashboard + admin)
- BOTH `cameraStateUpdated/v1` and `thumbnailUpdated/v1` are broadcast to both rooms.

**Initial-load thumbnail field** (AI 2 adds + AI 3 reads):
- `getCameraList/v1` (cameras page loader) and `admin/getCameraCatalog/v1` responses gain `thumbnail: { jpegBase64: string, capturedAt: string } | null` per camera.

**Capabilities object** (AI 1 produces + AI 2 stores + AI 3 reads):
- Telemetry payload key: `capabilities`
- Shape: `{ hasCamera, hasIR, hasPanTilt, hasMicrophone, hasSpeaker, hasMotion, hasZoom, hasTemperature }` - all booleans, all required.
- Pi 5 stores in-memory in `cameraCapabilityStore`.
- `cameraStateUpdated/v1` patch may include `capabilities`.
- `getCameraList/v1` and `admin/getCameraCatalog/v1` responses include `capabilities: Capabilities | null` per camera.
- Frontend default-when-missing: treat as `true` (do not lock the user out before first telemetry arrives).

**Log prefix conventions** (all AIs):
- `[boot]` - boot probe banner content (lifecycle banner uses no prefix, just the framed banner)
- `[action]` - Pi 5, UI-driven backend event
- `[telemetry]` - Pi 5, telemetry ingest
- `[offline-watcher]` - Pi 5, offline transitions
- `[executor]` - Pi Zero, command dispatch entry
- `[adapter]` - Pi Zero, adapter method call
- `[ui]` - browser console only

**Visual structure** (all AIs):
- Banners: 60-char `=` line, two blank lines above and below
- Section dividers: 60-char `-` line, only for significant transitions (offline flip, stream stall recovery)
- Per-event lines: single blank line BEFORE the line, no blank line after

---

## 5. Final integration (the user runs this, after all 3 AIs are done)

Steps to run in order, as one human:

```
On the development machine (Pi 5):
[ ] git status   (confirm all 3 AIs' changes are committed or in working tree)
[ ] npm run generateArtifacts   (regenerates apiTypes.generated.ts for the new actions + zoomLevel)
[ ] npm run lint                (must be clean)
[ ] Restart Pi 5 server

On each Pi Zero:
[ ] git pull
[ ] Restart camera_node service
```

Database: no migrations. No `prisma:generate` or `prisma db push` needed.

---

## 6. Master verification checklist

Run this after the integration steps in section 5.

```
Boot banners:
[ ] Pi 5 startup log shows the "PI 5 CAMERA SUBSYSTEM BOOT" banner
[ ] Pi 5 banner shows redis OK, prisma OK, configured pi zeros = N
[ ] Each Pi Zero startup log shows "CAMERA NODE BOOT - HARDWARE PROBE" banner
[ ] Pi Zero banner shows OK / SKIP / FAIL per component, expected on this hardware
[ ] Sanity: physically disconnect the IR GPIO; reboot; banner shows ir led FAIL or SKIP
[ ] Pi Zero process keeps running with FAIL components - no crash

Action logging:
[ ] Click each UI button: Pi 5 log shows the matching [action] line with cameraId + userId
[ ] System audio toggle: browser DevTools console shows [ui] system audio enabled=...
[ ] Each click produces exactly one [action] line (no duplicates)

Offline watcher:
[ ] Power off one Pi Zero. Within ~15s the dot in the cameras page UI turns red.
[ ] Pi 5 log shows: [offline-watcher] camera <id> went offline (last seen Xs ago)
[ ] Power the Pi Zero back on. Dot turns green within ~10s of next telemetry tick.

IR / PTZ (already wired - now with cleaner logs):
[ ] IR On / Off / Auto: Pi 5 [action] cameras/setIRMode + Pi Zero [executor] + [adapter] set_ir_mode
[ ] Each pan/tilt arrow: Pi 5 [action] cameras/executeCommand + Pi Zero [executor] + [adapter] pan/tilt

Recording (already wired):
[ ] Start: Pi 5 [action] cameras/setRecordingMode + Pi Zero [executor] + [adapter] set_recording

Zoom (new, step-based):
[ ] Click zoom_out icon: Pi Zero [adapter] set_zoom level=<old> -> <old-10>, clamped to >=1
[ ] Click zoom_in icon: Pi Zero [adapter] set_zoom level=<old> -> <old+10>, clamped to <=100
[ ] Slider in UI updates to reflect server-reported zoomLevel
[ ] Slider drag does NOT change anything (it is disabled)
[ ] zoomLabel displays the live server value

Talkback mic (new, stub):
[ ] Click mic button to enable: Pi 5 [action] action=talkbackOn + Pi Zero [adapter] set_talkback enabled=True
[ ] Click again: Pi Zero [adapter] set_talkback enabled=False
[ ] Browser mic capture still works (level meter still moves)

Telemetry:
[ ] Pi 5 log shows [telemetry] ingest line every ~5s per camera with online + fps + temp + zoom

Temperature:
[ ] Camera preview overlay shows realistic CPU temperature (~35-65 C idle)

Thumbnails:
[ ] Pi Zero log shows [thumbnail] published cameraId=... bytes=... every 30s when no
    one is watching that camera (idle path)
[ ] Pi Zero log shows [thumbnail] skipped (video stream active) when someone is
    actively previewing that camera
[ ] Pi 5 log shows [thumbnail] received cameraId=... bytes=... per upload
[ ] Open the dashboard page: each camera tile shows a real photo (not a placeholder)
    within ~30s of dashboard open
[ ] Open the admin page: each camera row shows a real photo
[ ] When a camera tile is visible and you wait 30s, the thumbnail refreshes (timestamp
    advances). Open DevTools Network -> WS to confirm the sync event arrives.
[ ] Restart Pi 5: thumbnails disappear briefly, then refill within 30s

Capability graying:
[ ] Pi 5 log shows [capabilities] cameraId=... hasIR=... hasPanTilt=... etc on first
    telemetry tick after Pi 5 boot, and only repeats when the values change.
[ ] On a Pi Zero with no IR GPIO configured, the IR off/on/auto buttons render dimmed
    (opacity-60) and clicking them does nothing.
[ ] On a Pi Zero with no servos configured, the pan/tilt arrows render dimmed and
    clicking them does nothing. The home (center) button still works.
[ ] On a Pi Zero with no microphone, the system audio button renders dimmed.
[ ] On a Pi Zero with no speaker, the talkback mic toggle renders dimmed.
[ ] hasZoom is reported false (no real zoom hardware), so the zoom-in/zoom-out icon
    buttons render dimmed.
[ ] If you open the cameras page BEFORE the first telemetry tick lands, all controls
    are interactive (default-when-missing safety). Once telemetry arrives, the gating
    kicks in.
[ ] Add a configured GPIO pin for IR or a servo, restart the Pi Zero, and within ~5s
    the matching button on the cameras page becomes interactive again.

Live dashboard / admin values:
[ ] Open dashboard. Without refreshing the page, power off one Pi Zero. Within ~15s the
    online dot for that camera turns red.
[ ] Power it back on. Without refreshing, the dot returns to green within ~10s of next telemetry tick.
[ ] On the admin page, do the same - online state updates without refresh.
[ ] Toggle recording on a camera (via the cameras page). The dashboard / admin recording
    indicator for that camera updates live.
[ ] Temperature value shown on dashboard / admin updates per telemetry tick (~5s).

Visual log polish:
[ ] Each [action], [telemetry], [executor]+[adapter], [offline-watcher], [thumbnail] event
    has a blank line before it
[ ] Banners are surrounded by blank lines and use 60-char = and - separators
[ ] No emojis anywhere in any log
```

---

## 7. Per-AI completion log

Each AI fills this in when done.

### AI 1 - Done
_(empty - awaiting completion)_

### AI 2 - Done
_(empty - awaiting completion)_

### AI 3 - Done
_(empty - awaiting completion)_

---

## 8. Cross-lane coordination

If an AI discovers it needs to edit a file outside its lane, append a note here describing the conflict and STOP. Do not edit out-of-lane files.

_(empty - no conflicts so far)_

---

## 9. After all three AIs ship

Recommended follow-up tasks (not in this plan):

- Update `SESSION_STATE.md` to reflect what shipped this session
- Update `pi_zero_2w/PI5_API_CONTRACT.md` with the new action names (`zoomIn`, `zoomOut`, `talkbackOn`, `talkbackOff`) and the new telemetry field `zoomLevel`
- Decide whether to remove the dev `[action]` / `[telemetry]` / `[ui]` prints once the system is exercised end-to-end (single grep + delete pass)
- Clean up locale-key debt called out in `SESSION_STATE.md` section 4.3
