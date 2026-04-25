# Future Roadmap (post PARALLEL_WORK_PLAN.md)

> Created 2026-04-25. The work in `PARALLEL_WORK_PLAN.md` ships first. Everything in this doc is what comes after.

This is a personal-use surveillance system on owned Pi hardware. Single user, home LAN, iPhone notifications. Hardware is fixed: **Pi 5 16GB RAM** as server, **Pi Zero 2W** as camera nodes, **Pi Camera Module 3**, plus PIR sensors per node (HC-SR501 / HC-SR505 / AM312 in stock — AM312 preferred for new wiring).

---

## 1. Locked decisions from the planning conversation

- **Motion source: PIR sensors**, not rpicam motion vectors. Cheaper, more reliable, no false-trigger on shadows / sun / fan blades. Each Pi Zero gets a PIR module wired to a GPIO pin.
- **AM312 is preferred** for new installs (3.3V native, smallest, lowest idle current). HC-SR501 / HC-SR505 work fine, but HC-SR501's 5V output should go through a divider before the Pi GPIO.
- **No AI / model recognition** in this roadmap. Architecture is designed to slot it in later (see `CameraEvent` schema in step 3) but no inference is built.
- **Thumbnails stay in-memory, overwrite-only**, every 30 seconds. No history retained.
- **Notifications: ntfy.sh + iPhone ntfy app.** No Apple Developer account, no APNs certs, no costs. One env var (`NTFY_TOPIC`).
- **Recording on motion: 30s pre-roll + 5 min post-motion.**
- **Recording forces always-on streaming** (see step 5 below — required tradeoff).
- **Heat management** stays via per-camera fps/bitrate config (already shipped). Hot cameras get low fps. Streaming is no longer gated on viewer presence.

## 2. Hardware on hand

| Component | Quantity | Notes |
|---|---|---|
| Raspberry Pi 5 16GB | 1 | Server. Runs werift bridge, recording muxer, motion event ingest, ntfy notifier. ffmpeg installed. |
| Raspberry Pi Zero 2W | N | One per camera location. Runs camera node, PIR listener. 512MB RAM. |
| Pi Camera Module 3 | N | Per Pi Zero. |
| HC-SR501 / HC-SR505 / AM312 | mixed stock | One PIR per Pi Zero. AM312 preferred. |

## 3. Roadmap

In order. Each step is small enough to ship in one session.

### Step 1: Finish PARALLEL_WORK_PLAN.md

Boot probes, action logging, capabilities, thumbnails, recordings, dashboard live values, capability graying. Already planned, not started. This roadmap assumes that work has shipped.

### Step 2: Refactor `src/cameras/page.tsx` into reusable components

Currently 1456 lines. Mobile + desktop layouts duplicate every control. Split into:
- `src/cameras/_components/PtzPad.tsx`
- `src/cameras/_components/IRControls.tsx`
- `src/cameras/_components/MicUplink.tsx`
- `src/cameras/_components/ZoomBar.tsx`
- `src/cameras/_components/PreviewPanel.tsx`
- `src/cameras/_components/SystemAudioToggle.tsx`

Estimated half-day. Do this **before** motion features — every step below would otherwise hit the same monolithic file twice (mobile + desktop).

### Step 3: Define `CameraEvent` schema (the spine)

One table for all timestamped per-camera events. Future motion, AI classifications, recording transitions, offline transitions, thermal alerts — all sit on this.

```prisma
enum CameraEventType {
  motion
  recordingStart
  recordingStop
  cameraOffline
  cameraOnline
}

model CameraEvent {
  id          String           @id @default(auto()) @map("_id") @db.ObjectId
  cameraId    String           @db.ObjectId
  camera      Camera           @relation(fields: [cameraId], references: [id])
  type        CameraEventType
  occurredAt  DateTime         @default(now())
  attributes  Json             // type-specific payload, e.g. motion intensity, recording id, offline duration
  @@index([cameraId, occurredAt])
  @@index([type, occurredAt])
}
```

Why one table: notifications, dashboards, search, triggers, future history features — all subscribe to one source of truth. Adding a new event type doesn't add a new table.

### Step 4: PIR motion detection on Pi Zero

Per-camera config addition: `pir_gpio_pin: int | None` in the Pi Zero env / config.

Code:
- `pi_zero_2w/camera_node/pir_sensor.py` (NEW): wraps `gpiozero.MotionSensor(pin)`, exposes `when_motion` and `when_no_motion` callbacks
- `pi_zero_2w/camera_node/runtime.py` starts the listener if pin configured
- On motion-rising-edge, POST to Pi 5 endpoint `cameras/motionEvent/v1` with `{ cameraId, occurredAt }`
- Boot probe gains `pir sensor (GPIO N)` line — `OK` / `SKIP not configured`
- Capability `hasMotion` flips to true when `pir_gpio_pin` is set

Pi 5 side:
- `src/cameras/_api/motionEvent_v1.ts` (NEW): validates, writes a `CameraEvent` row of type `motion`, broadcasts sync `cameras/cameraEvent/v1` to `cameras-overview` room
- `src/cameras/_sync/cameraEvent_server_v1.ts` (NEW)

### Step 5: Always-on streaming on Pi 5 orchestrator

**Tradeoff explicit:** pre-roll only works while the camera is streaming. Currently the orchestrator only streams when a viewer is connected. Recording-on-motion happens when no viewer is present, so we need always-on.

Change in `server/utils/cameraStreamOrchestrator.ts`:
- Remove the "stop when `connectedSocketIds.size === 0`" path
- A camera streams whenever `enabled === true` in DB (and Pi Zero is reachable)
- The fps/bitrate config still controls heat: hot cameras get low fps

Heat-management story shifts from "idle when nobody's watching" to "always running, but at user-configured intensity". User accepts this.

### Step 6: 30s pre-roll RTP buffer on Pi 5 bridge

In `server/utils/cameraWebrtcBridge.ts`, add a per-camera circular buffer:
- ~15MB per camera at 4Mbps × 30s
- Pi 5 16GB RAM handles N cameras without breaking a sweat
- Append RTP packets on receive, drop oldest > 30s
- Expose `getPreroll(cameraId): RtpPacket[]` for the recording manager

Near-zero CPU. Just memcpy.

### Step 7: Recording-on-motion via the existing recording manager

When a motion `CameraEvent` of type `motion` lands:
- Check if a recording is already active for the camera. If yes, extend its auto-stop timer to "now + 5 min". If no, start a new recording.
- New recording sequence:
  1. `cameraRecordingManager.startRecording({ cameraId, userId: 'system', source: 'motion' })`
  2. Manager pulls the 30s pre-roll from the bridge buffer, writes those RTP packets to ffmpeg first
  3. Manager subscribes to live RTP as normal, continues writing
  4. Auto-stop timer set to `motionEvent.occurredAt + 5min`
- Subsequent motion events within the 5-min window extend the stop time (rolling 5 min after most recent motion)
- Stop reason on auto-stop: `motionTimeout`

This requires extending `cameraRecordingManager` from AI 4's lane:
- Add a `source` field on `Recording` row: `manual` / `motion` / `scheduled`
- Add the pre-roll write path
- Add the rolling extension logic

### Step 8: `MotionTrigger` schema and ntfy.sh notifier

Schema (kept deliberately flat — no DSL):

```prisma
model MotionTrigger {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  cameraId    String?  @db.ObjectId   // null = any camera
  startTime   String?                 // 'HH:MM' or null
  endTime     String?                 // 'HH:MM' or null
  daysOfWeek  Int[]                   // 0-6, empty = all days
  ntfyTopic   String                  // ntfy topic to send to
  enabled     Boolean  @default(true)
}
```

When a motion `CameraEvent` lands:
- For each enabled trigger, check filters (camera match, time window, day-of-week)
- For matches, fire one HTTP POST to `https://ntfy.sh/<topic>` with title = camera name, body = "Motion detected", optional click URL = `https://<host>/cameras?id=<cameraId>`

Admin UI: a simple settings page to add / edit triggers. Form fields map 1:1 to schema. No rule chaining, no AND/OR.

iPhone setup: install ntfy app, subscribe to the topic, done.

### Step 9: Boot probe + capability for PIR

Add to `pi_zero_2w/camera_node/boot_probe.py`:
- `pir sensor (GPIO N)` line in the banner
- `OK` if init succeeds, `SKIP not configured` if no pin set, `FAIL` if init fails
- Set `has_motion: bool` in the `CapabilityReport`
- Pi 5 capability gating already follows automatically (UI grays out motion-related controls if `hasMotion: false`)

### Step 10: Dashboard / cameras page motion indicators

Add a compact "last motion N min ago" line per camera tile on dashboard and admin pages, sourced from the `CameraEvent` query (latest event of type `motion`). Live-update via the new `cameras/cameraEvent/v1` sync subscription.

On the cameras page, surface "motion was detected 30s ago" as a transient banner that fades after a minute. Tap to scrub the most recent recording.

---

## 4. Things explicitly NOT in this roadmap

- **AI / object classification.** Architecture supports it (motion event → enrichment pipeline → enriched event), but no inference code is built. Future addition.
- **Thumbnail history.** In-memory only, overwrite. Locked decision.
- **Per-Pi-Zero auth credentials.** Single shared secret stays for now. Personal LAN, low risk.
- **Tests.** Same policy as the rest of the project.
- **Multi-tenant / multi-user.** Personal use only.
- **Recording retention policy.** Recordings accumulate on the Pi 5 SD card or USB drive. Manual cleanup until disk pressure becomes real. Recording-on-motion already keeps disk usage modest (probably <500MB/day per camera vs ~40GB/day continuous).

## 5. Hardware notes for PIR wiring

**AM312 (preferred):**
```
AM312 VCC  -> Pi Zero 3.3V
AM312 GND  -> Pi Zero GND
AM312 OUT  -> Pi Zero GPIO (any free, e.g. GPIO 4)
```

**HC-SR501 / HC-SR505 (5V output):**
```
HC-SR501 VCC  -> Pi Zero 5V
HC-SR501 GND  -> Pi Zero GND
HC-SR501 OUT  -> 1k resistor -> 2k resistor to GND, midpoint to Pi Zero GPIO
                 (3.3V-clamped voltage divider)
```

HC-SR501 has two trim pots: sensitivity (range) and time-delay (output stays HIGH for X seconds after trigger). Tune at install time. Lower sensitivity = fewer false positives from small animals; higher delay = retrigger gap.

## 6. Open questions / decisions deferred

- **Should triggers support "only when armed" mode?** I.e. global "armed / disarmed" toggle that gates ALL notifications. Useful when user is home and doesn't want every cat triggering an iPhone buzz. If yes, add `Setting.armed: boolean` and check at trigger-fire time. Easy to add later.
- **Should motion events de-bounce?** PIR can chatter (rapid HIGH/LOW) at the edge of detection. The Pi Zero side should probably suppress motion events within a configurable window (e.g. 10s). Add to step 4.
- **Pre-roll for cameras with low-fps config:** if a camera is configured at 5fps, the pre-roll is 5fps × 30s = 150 frames. That's still useful but choppy. Document this so it's not a surprise.
- **Recording playback during motion:** when a motion-triggered recording is mid-write, can the user watch it via the recordings page? mp4 with `-movflags frag_keyframe+empty_moov` should support this (fragmented mp4 is playable while still being written) but verify.
- **Multiple PIR per camera:** what if a high-coverage location wants two PIRs (e.g. front-door + driveway, one camera)? V1: one PIR per Pi Zero. If needed later: extend `pir_gpio_pin` to a list.

---

## 7. When picking this up next

1. Read this file
2. Read `PARALLEL_WORK_PLAN.md` (must be shipped + verified before starting here)
3. Read `SESSION_STATE.md` for current state
4. Pick step 2 (refactor) first. Then step 3 (schema). Then steps 4-7 are mostly independent.
5. Do NOT start step 7 (recording-on-motion) until steps 5 and 6 are working — pre-roll has no buffer to read from otherwise.
