# Parallel Work Plan: Boot Probes + Action Logging + Stubbed Buttons

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

Three deliverables, in priority order:

1. **Boot-time hardware probe and service probe** (Pi Zero + Pi 5) - on startup, log a banner showing the detection result for every configured hardware component or service. Non-fatal: missing hardware logs FAIL but never crashes the process.
2. **Action logging** - every UI-driven backend event gets a Pi 5 log line. Visual structure: blank line before each event, single-line section dividers around significant transitions.
3. **Stubbed buttons** - wire the unwired UI buttons (zoom step-based, talkback mic) through the existing command queue so they log on the Pi Zero even though no hardware exists yet. Existing FPS / quality / IR / PTZ / record paths are NOT in scope; do not touch them.

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
11. **When done**, append a "Done" line to your section in this file with a one-sentence summary. Then suggest the deployment / verification steps from section 5.

---

## 4. The three lanes

Find your AI number below. Read **only** your section to do the work, plus the cross-lane contracts in section 4.4. The other two sections are for context, not for action.

### 4.1 AI 1 - Pi Zero (Python)

You own the entire `pi_zero_2w/camera_node/` directory.

#### File ownership

```
pi_zero_2w/camera_node/boot_probe.py             NEW
pi_zero_2w/camera_node/runtime.py                EDIT
pi_zero_2w/camera_node/command_executor.py       EDIT
pi_zero_2w/camera_node/models.py                 EDIT
pi_zero_2w/camera_node/telemetry.py              EDIT
pi_zero_2w/camera_node/adapters/base.py          EDIT
pi_zero_2w/camera_node/adapters/mock_adapter.py  EDIT
pi_zero_2w/camera_node/adapters/raspberry_pi_adapter.py  EDIT
```

Do not touch:
- `pi_zero_2w/camera_node/video_publisher.py` (FPS work owns this)
- `pi_zero_2w/camera_node/api_client.py` (already-shipped Pi5ApiError handling)
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

**Done criteria for AI 1.**

- Pi Zero boots and prints the hardware probe banner.
- Boot succeeds with zero hardware attached (mock adapter on dev box).
- New `zoomIn` / `zoomOut` / `talkbackOn` / `talkbackOff` commands accepted and printed.
- Telemetry payload contains `zoomLevel: int | null`.
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
server/server.ts                               EDIT (boot wiring only)
src/cameras/_api/executeCameraCommand_v1.ts    EDIT (extend action union, [action] log)
src/cameras/_api/setIRMode_v1.ts               EDIT ([action] log)
src/cameras/_api/setRecordingMode_v1.ts        EDIT ([action] log)
src/cameras/_api/ingestNodeTelemetry_v1.ts     EDIT (zoomLevel + [telemetry] log)
src/cameras/_api/webrtc/offer_v1.ts            EDIT ([action] log)
src/cameras/_api/webrtc/close_v1.ts            EDIT ([action] log)
src/cameras/_sync/cameraStateUpdated_server_v1.ts  EDIT (zoomLevel patch field)
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

**Done criteria for AI 2.**

- Pi 5 server starts, prints both boot banners (yours + AI 1's, if AI 1 has shipped).
- Every UI-driven backend event prints an `[action]` line.
- Telemetry ingest prints `[telemetry]` per tick.
- Offline watcher flips a stale camera and logs.
- New action union accepts `zoomIn` / `zoomOut` / `talkbackOn` / `talkbackOff`.
- `cameraStateUpdated/v1` sync broadcasts include `zoomLevel` when present.

When done, append:
```
### AI 2 - Done
<one-sentence summary>
```
to section 7.

---

### 4.3 AI 3 - Frontend (React / TypeScript)

You own the cameras page UI changes only.

#### File ownership

```
src/cameras/page.tsx          EDIT
```

That is the only file. No other frontend changes are in scope.

Do not touch:
- `src/admin/page.tsx` (FPS work touches admin; stay out)
- Any `_components/`, `_providers/`, `_functions/` (no shared component changes needed)
- Any sync or API definition files (AI 2 owns those)
- Locale files (no new strings - the buttons already have labels)

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

**Done criteria for AI 3.**

- Zoom slider is read-only; flanking icons are buttons that call `zoomIn` / `zoomOut`.
- Slider value reflects server-reported `cameraState.zoomLevel`.
- Mic toggle fires `talkbackOn` / `talkbackOff` in addition to the existing local capture toggle.
- System audio toggle prints a `[ui]` log to the browser console.
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

Visual log polish:
[ ] Each [action], [telemetry], [executor]+[adapter], [offline-watcher] event has a blank line before it
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
