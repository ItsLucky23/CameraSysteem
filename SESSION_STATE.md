# Session state

Snapshot of where the camera-surveillance project stands. Load this first when continuing work in a fresh AI session — it contains everything needed without paying for prior conversation history.

The user is using **Gemini** (a separate AI in a browser) for the physical-wiring side of any new hardware build, sending photos and short questions. Claude in the IDE handles all code. This file's "Section B for Gemini" prompt is what the user pastes into Gemini themselves.

---

## 1. Session summary (what's in the codebase today)

### Architecture
```
Pi Zero 2W (camera_node, Python, lgpio backend)
  rpicam-vid  -->  ffmpeg (RTP packetizer)  -->  UDP/H.264 to Pi 5
                                                      |
Pi 5 (LuckyStack server, Node.js + Socket.io + Prisma) v
  cameraWebrtcBridge: 1 UDP ingest socket per active camera
       parses RTP, fans out to N werift RTCPeerConnections
       tracks lastPacketAt
  cameraStreamOrchestrator: owns "which cameras should be streaming"
       drives Pi Zero start/stop via Redis command queue
       60s kick throttle, 40s stall threshold (no more storms)
  cameraRecordingManager: passthrough mp4 muxer with retention hooks
  cameraControlSession: Redis-backed per-camera control lock (5min TTL)
  cameraThumbnailExtractor: Pi 5-side RTP-tap thumbnails when streaming
  ingestNodeTelemetry: receives Pi Zero state + stats, broadcasts via sync
                                                      |
Browser (React 19 + React Router + Tailwind)          v
  /cameras: WebRTC preview, take-control gate, hold-to-move PTZ, IR toggle
  /recordings: clip browser (Day timeline + All-recordings views), thumbnails, mp4 streamer
  /dashboard, /admin, /admin/camera-access: live tiles
```

### Recently shipped (verified by git log)
- **Motion detection (HC-SR501)** — wired on GPIO 7, working in code: telemetry's `motionDetected` + `lastMotionAt`, frontend's "Active now" pill + "Last seen Xs ago" row. **About to be paused — see §3.**
- **Control session model** — Redis key `camera:controller:{id}` (60s TTL refreshed per command). New APIs `cameras/acquireControl/v1`, `cameras/releaseControl/v1`. Sync event `cameras/controlSession/v1`. `executeCameraCommand` enforces caller is current controller. PTZ has hold-to-move (250ms cadence) + 200ms per-action lock; other commands no per-action lock.
- **Client-side zoom** — CSS `transform: scale()` on the preview video element (1× to 4× in 0.5× steps). No Pi Zero round-trip.
- **Recording thumbnails** — `/recordings/thumbnail/:id.jpg` endpoint, ffmpeg first-frame extraction lazy-cached as `.thumb.jpg` next to the mp4. Used in clip rows + as `<video poster>`.
- **Recordings All-view + lazy load** — toggle between Day timeline (current) and All recordings (grouped by date). `<video src>` only set when clip selected.
- **Stream kick throttle** — 60s per-camera floor on `kickPiZeroStream`, 40s stall threshold. Kills the libcamera-recovery storm pattern.
- **lgpio backend** — `python3-lgpio` + `liblgpio-dev` + `swig` apt packages, then `pip install lgpio` in venv. Without it `gpiozero` falls back to NativeFactory which can't drive PWM or detect edges on Bookworm/Trixie kernels.
- **Boot-probe vs. adapter race** fixed — probe runs BEFORE `adapter.startup()` in `runtime.py` so GPIO 18 (IR) doesn't false-FAIL.
- **`HARDWARE_SUMMARY.md`** at repo root — canonical wiring SoT translated from the user's Dutch original. Reference this in all GPIO/wiring discussions.
- **Pi Zero log noise quieted** — `[thumbnail] capture failed` is now suppressed during the "sensor busy" streak (Pi 5 takes over via `cameraThumbnailExtractor` automatically).
- **Avatar memoization** — `Avatar` wrapped in `React.memo` to defend against context-driven re-renders.
- **Recording video player auth** — added `?token=` query-string fallback in `serveRecording` for dev mode (sessionBasedToken=true).

### Hardware status (today)
| Component | Status | GPIO | Notes |
|---|---|---|---|
| Pi Zero 2W | Wired | — | Streaming verified |
| Pi Camera Module 3 NoIR | Wired | CSI | NoIR variant — can see 850nm IR |
| HC-SR501 PIR | Wired (going on hold) | 7 | Software path about to be paused |
| IR LED ring + IRLB8748 MOSFET | NOT yet wired | 18 (gate) | Section B builds this |
| MG90S pan/tilt servos | NOT wired | 12, 13 | Phase 3 — needs `pigpiod` |
| USB sound card / mic / speaker | NOT wired | — | V2 — needs bidirectional audio pipeline |

---

## 2. Current state

### Working
- Pi Zero boot → camera streaming → WebRTC preview → telemetry → control session → recording → thumbnails — all end-to-end functional.
- Motion detection works (HC-SR501 wired on GPIO 7, gpiozero reads edges via lgpio).

### Known sharp edges
- **HC-SR501 trim pots/jumper need user adjustment** — out of the box, Tx delay is too high (15s+) and jumper often defaults to L (single-shot). Causes UI jumpiness. **Resolved by physical adjustment, not code.** User wants to put motion on hold rather than polish further.
- **Pan/tilt servo PWM** — GPIO 12/13 only get PWM via `pigpio` factory. Without `pigpiod` running + `GPIOZERO_PIN_FACTORY=pigpio` in systemd unit, `AngularServo` fails. Out of scope for the current build.
- **IR boot-probe row** — currently says `OK GPIO 18` even with no LED connected. The probe only verifies the GPIO can be claimed, not hardware presence. About to be improved in Section A's audit.

### Uncommitted changes
None. `git status` clean on `main`. Last commit: `3c0ba4d tweak to make motion detection work`.

---

## 3. The plan: motion-pause + IR-build

The user wants to **put PIR motion detection on hold** (HC-SR501 stays physically wired; only the software path pauses) and **build the IR LED ring next** (12V via IRLB8748 MOSFET, gate on GPIO 18).

Two AI sessions execute in parallel:
- **Claude Sonnet** in the IDE does Section A (codebase changes).
- **Gemini** in a browser, with photos from the user, does Section B (physical wiring guidance).

### Sentinel-comment convention (for Section A)
Every paused motion block is wrapped with these markers so the user can grep `MOTION DETECTION LOGIC` and uncomment in one pass to revive:

```ts
// MOTION DETECTION LOGIC (start)
// <commented-out code, line by line>
// MOTION DETECTION LOGIC (end)
```

Python uses `#` instead of `//`. Markdown uses `<!-- -->`. JSON locales (no comment syntax) leave keys in place — they become harmless dead text — and a single `// MOTION DETECTION LOGIC (locale keys live in en/nl/de/fr.json: ...)` comment is added near the consumer in `src/cameras/page.tsx`.

### Section A — copy-paste this prompt into a new Claude Sonnet session

> I'm continuing work on the LuckyStack camera-surveillance project at `E:\code\CameraSysteem`. Read `HARDWARE_SUMMARY.md` and the **§1 + §2 + §3** of `SESSION_STATE.md` before doing anything.
>
> The user is putting PIR motion detection **on hold** (HC-SR501 sensor stays physically connected on GPIO 7; only the software path pauses) and the **12V IR LED ring is the next build target** (already partially in code via `IR_GPIO_PIN=18`). Your job is two passes:
>
> **A1. Comment-out (do NOT delete) every motion-detection block.** Wrap each block with the sentinel markers `// MOTION DETECTION LOGIC (start)` and `// MOTION DETECTION LOGIC (end)` (or `#` for Python, `<!--` for Markdown). The user must be able to grep for `MOTION DETECTION LOGIC` and uncomment in one pass to revive everything later.
>
> Touchpoints (full file:line inventory — verify exact line numbers with Grep before editing):
>
> *Pi Zero (Python)*
> - `pi_zero_2w/camera_node/boot_probe.py` — `_probe_motion()` function (≈ lines 150-169); the call to `_safe_probe(_probe_motion, motion_gpio_pin)` and `motion_gpio_pin` extraction in `run_hardware_probe`; the `motion` row in the printed banner (`_format_line("motion detection", motion[0], motion[1])`); the `has_motion=motion[2]` field on `CapabilityReport`. Replace `has_motion` with `has_motion=False` so the dataclass field still exists (struct-shape stability) but always reports false.
> - `pi_zero_2w/camera_node/adapters/raspberry_pi_adapter.py` — `motion_gpio_pin` ctor parameter and field, `_motion_sensor` field, the MotionSensor init block in `startup()` (≈ lines 109-122), `_on_motion_detected` and `_on_motion_cleared` methods, the cleanup block in `shutdown()` (≈ lines 148-155), and the `motion_detected=...` / `last_motion_at=...` lines in the seed `CameraState(...)` and in the `get_state()` return — leave those as `False` and `None` literals so the model still serialises but never carries motion data.
> - `pi_zero_2w/camera_node/models.py` — leave `motion_detected: bool = False` and `last_motion_at: str | None = None` declarations IN PLACE (so telemetry payload shape doesn't change) but add a `# MOTION DETECTION LOGIC (paused — these fields remain in the model but are never set true while paused)` note above them.
> - `pi_zero_2w/camera_node/config.py` — comment out the `motion_gpio_pin: int | None` field on `NodeSettings` AND the `motion_gpio_pin=_parse_optional_int(os.getenv("MOTION_GPIO_PIN"))` parsing line.
> - `pi_zero_2w/camera_node/telemetry.py` — comment out the `"motionDetected"` and `"lastMotionAt"` lines in the payload, AND the `"hasMotion": capabilities.has_motion,` line in the capabilities block.
> - `pi_zero_2w/run.py` — comment out the `motion_gpio_pin=settings.motion_gpio_pin,` argument in the `RaspberryPiHardwareAdapter(...)` call.
> - `pi_zero_2w/.env.example` — comment out the entire `MOTION_GPIO_PIN` block (lines ≈ 43-46) including the explanatory comments above it.
>
> *Pi 5 (TypeScript)*
> - `src/cameras/_api/ingestNodeTelemetry_v1.ts` — comment out `motionDetected?` and `lastMotionAt?` in the `ApiParams.data` type, the `hasMotion: boolean` field in capabilities, the `motionDetected` / `lastMotionAt` validation blocks (≈ lines 200-210), the corresponding fields in `CameraStatePatch`, the patch-build assignments in `buildCameraPatch`, the `hasMotion=` log fragment, and the `motionDetected: data.motionDetected ?? false` line in `prisma.cameraStateSnapshot.create`. Set `motionDetected: false` literally if Prisma requires the field.
> - `src/cameras/_sync/cameraStateUpdated_server_v1.ts` — comment out `motionDetected?` and `lastMotionAt?` from the patch type, and `hasMotion: boolean` from capabilities.
> - `src/cameras/_api/getCameraState_v1.ts` — comment out `motionDetected: ...` and `lastMotionAt: null,` in the success-response `camera` object. (If the response type still expects them, leave hardcoded `motionDetected: false, lastMotionAt: null` with a sentinel-comment note.)
>
> *Frontend*
> - `src/cameras/page.tsx` — comment out: `motionDetected` / `lastMotionAt` in the local `CameraState` interface (or hardcode to `false` / `null`), the `motionDetected` / `lastMotionAt` patch lines in the sync callback, the `motionLabel` useMemo, the `Motion` row inside the telemetry-panel `[…].map((row, …))` array, the green "Active now" pill in the preview overlay, the `formatRelativeAgo` helper if it has no other consumer (verify with grep first — it might be used by the recordings page or control-session expiry), and the `now`-tick `setInterval` if it has no other consumer (it IS used for the control-session expiry countdown — DO NOT comment that out). Do NOT remove the `Capabilities.hasMotion` field — leave it; it just stays false.
>
> *Locales* — JSON has no comment syntax. Leave the existing motion keys in `src/_locales/{en,nl,de,fr}.json` untouched (`aperture.monitor.motion`, `motionActive`, `motionLastSeen`, `motionNeverSeen`, `motionDisabled`, `aperture.recordings.filterMotion`, `aperture.dashboard.motion`) — they become dead strings, harmless. Add a one-line sentinel comment in `src/cameras/page.tsx` near the now-commented `motionLabel` pointing to those keys.
>
> *Docs* — `HARDWARE_SUMMARY.md`: wrap §4.A "HC-SR501 PIR motion sensor" with the markdown sentinel and prefix the section heading with `(ON HOLD — code path paused, hardware still wired)`. Leave the GPIO 7 row in §3 in place but add a footnote indicating motion is paused. Don't touch §7 (lgpio dependency) — that's still required for non-motion GPIO use.
>
> **Dangling-reference notes:**
> - `_on_motion_detected`/`_on_motion_cleared` are referenced only via `self._motion_sensor.when_motion = ...` — commenting the assignment removes all references.
> - `formatRelativeAgo` and the `now` setInterval — verify with grep before commenting; they may be used elsewhere (control session, recordings page).
>
> **Verification for A1**: type-check (`npx tsc --noEmit -p tsconfig.client.json` and `tsconfig.server.json`) and lint (`npx eslint <changed files>`) must pass clean. Run `python -c "import ast; ast.parse(open('<file>').read())"` on every changed Python file. Boot the Pi Zero — the banner row for motion should disappear (don't print it at all) and telemetry payloads should no longer carry `motionDetected`/`lastMotionAt`/`hasMotion`. Cameras page should not render the Motion row in the side panel and should not show the green "Active now" pill regardless of PIR state.
>
> **A2. IR LED implementation audit.** The codebase already supports IR end-to-end. Confirm each path and tighten any sloppy bit.
>
> Files to audit:
> - `pi_zero_2w/camera_node/adapters/raspberry_pi_adapter.py` `set_ir_mode(self, mode: str)` — verify: `on` → `_ir_device.on()`, `off` → `_ir_device.off()`, `auto` → keeps current state. Confirm `_ir_device` is initialised in `startup()` from `IR_GPIO_PIN`.
> - `pi_zero_2w/camera_node/command_executor.py` — verify `irOn` → `set_ir_mode("on")`, `irOff` → `set_ir_mode("off")`.
> - `pi_zero_2w/camera_node/boot_probe.py` `_probe_ir` — change the success line to `("OK", f"GPIO {ir_gpio_pin} (pin claim ok — wiring not verified)", True)` so the boot banner is honest about what the probe actually checks.
> - `src/cameras/_api/setIRMode_v1.ts` and the cameras-page IR mode segmented toggle (`aperture.monitor.irOff` / `irAuto` / `irOn`) — confirm the chain works.
>
> **A3. Add an "IR self-test on boot" toggle** (NOT enabled by default).
> - In `pi_zero_2w/camera_node/config.py` add `ir_boot_self_test: bool` driven by `IR_BOOT_SELF_TEST` env var (default `false`).
> - In `runtime.py`, after `adapter.startup()` and the boot probe, if the flag is true and `adapter._ir_device is not None`, call `_ir_device.on()` for 500ms then `_ir_device.off()`, twice in a row, with a `logger.info("[ir-self-test] flashing IR LED")` line. Hands-free wiring confirmation without needing the cameras page.
> - Document in `pi_zero_2w/.env.example` and `HARDWARE_SUMMARY.md` §7.
>
> **A4. Final cleanup.**
> - Run lint + type-check + Python syntax check across all changed files.
> - List every changed file in your final summary so the user knows what to commit.
> - Print deployment steps: on the Pi Zero `git pull`, `pip install -r requirements.txt` if needed, restart `camera_node` service. On Pi 5: `git pull`, regen artifacts (`npm run generateArtifacts`) only if you altered any API or sync surface (you should NOT have, but verify), then restart the Pi 5 process.
>
> **Do NOT:** delete files (comment only), touch the recording / control-session / thumbnail / stream-orchestrator code, change locale strings, run `prisma db push`, modify schema, or change pigpiod / servo / audio code.

### Section B — copy-paste this prompt into Gemini, alongside breadboard photos

> I'm wiring a 12 V infrared LED ring to a Raspberry Pi Zero 2 W via an IRLB8748 N-channel logic-level MOSFET. The Pi Zero is already running and streaming H.264 video; the camera is the **Pi Camera Module 3 NoIR** so it CAN see 850 nm IR. Walk me through the build with quick visual feedback — I'll send pictures of my breadboard at each step and you tell me if it's correct or what to change.
>
> **Reference: my project's hardware Single Source of Truth is `HARDWARE_SUMMARY.md`. The IR-relevant sections are §2 (MOSFET gate), §3 (GPIO pin layout), §4.C (IR LED ring), §5 (multimeter checklist).**
>
> **Pin contract (do not change without telling me first):**
> - MOSFET Gate (pin 1) → Pi physical pin 12 (BCM GPIO 18).
> - MOSFET Gate (pin 1) → blue (GND) rail via a **10 kΩ pull-down resistor**. Mandatory — without it the IR ring flickers during Pi GPIO settling.
> - MOSFET Drain (pin 2) → IR ring black wire (–).
> - MOSFET Source (pin 3) → blue (GND) rail.
> - IR ring red wire (+) → 12 V rail.
> - 12 V supply GND → tied to the same blue rail as Pi GND (common ground; mandatory for MOSFET to switch).
>
> **Parts on the bench:**
> - Pi Zero 2 W with breadboard headers
> - Breadboard (HW-131 power module feeding 5 V red rail and a separate 12 V rail)
> - IRLB8748 MOSFET (TO-220 package, three pins, metal heatsink tab)
> - 10 kΩ resistor
> - 12 V IR LED ring (CCTV-style, 850 nm)
> - 12 V DC supply rated for the ring's current draw
> - Jumper wires
> - Multimeter
>
> **What I need from you:**
> 1. Confirm IRLB8748 pinout — printed face toward me, pins down: which is Gate, Drain, Source?
> 2. Tell me where on the breadboard to place the MOSFET so the three pins land in distinct rows.
> 3. Walk me through, photo-by-photo, the wiring of: gate jumper to Pi pin 12, gate-to-GND pull-down resistor, drain to IR-ring black, source to GND rail, ring-red to 12 V rail, common ground.
> 4. Multimeter checklist — what to probe in what order BEFORE I turn either power supply on. The success criterion for each probe.
> 5. After power-on, the LED should be OFF (gate held low). I'll then SSH into the Pi Zero and toggle GPIO 18 high (`python3 -c "from gpiozero import OutputDevice; d = OutputDevice(18); d.on()"`). The ring should light up. Tell me what to check if it stays dark, and what to check if it comes on at full power-on (gate-floating fault).
> 6. After the bench test passes, walk me through securing the LED ring to the camera housing (cable-tie / 3M tape) without obscuring the lens or the PIR dome.
>
> **Feedback style:** terse, visual. I'll send a photo and ask "is this right?" — answer in 1-2 sentences plus the next step. Skip the theory.
>
> **Stop conditions:** if my photo shows ANY of the following, stop and tell me explicitly:
> - 12 V wire touching a Pi GPIO pin
> - missing pull-down resistor on the gate
> - red and 12 V rails bridged
> - no common ground between Pi and 12 V supply
> - MOSFET in backwards (Source ↔ Drain swapped)
>
> **Don't:** change pin assignments (codebase expects GPIO 18), recommend skipping the 10 kΩ pull-down "to test quickly", or suggest powering the IR ring from the Pi 5 V rail.

### End-to-end verification (after both A and B complete)
1. Boot banner shows `motion detection` row gone, `ir led OK GPIO 18 (pin claim ok — wiring not verified)`. Telemetry payload no longer contains `motionDetected` / `lastMotionAt` / `hasMotion`.
2. Cameras page: no green "Active now" pill, no Motion row in telemetry side-panel. IR mode toggle still visible.
3. With `IR_BOOT_SELF_TEST=true` in Pi Zero `.env`, restart — IR ring blinks twice on boot. Disable the flag again.
4. From cameras page, click IR mode = **On** → ring lights. Click **Off** → ring goes dark. (Phone-camera trick to verify if eye can't see 850nm.)
5. Update `HARDWARE_SUMMARY.md` to mark §4.C IR section as "BUILT — verified $(date)".

---

## 4. Next steps (priority order)

1. **Section A (Claude Sonnet, IDE)** — strip motion + audit IR + add boot self-test toggle. Files listed above. Verify with type-check, lint, Python syntax check.
2. **Section B (user + Gemini, in parallel)** — physically wire the IR LED ring + MOSFET per `HARDWARE_SUMMARY.md` §4.C. Multimeter checks before power-on.
3. **End-to-end verification** — see §3.
4. **Commit + deploy** — list of changed files comes out of Section A.A4.
5. **Update `HARDWARE_SUMMARY.md`** to mark IR built.

### Out of scope (for this build)
- MG90S pan/tilt servos — phase 3, needs `pigpiod` install + `GPIOZERO_PIN_FACTORY=pigpio` in systemd unit.
- V2 audio (INMP441 mic + MAX98357A amp) — deferred until bidirectional audio pipeline exists.
- IR auto-mode (turn on at low light) — needs ambient light source.
- Reviving motion detection — explicit user action: grep `MOTION DETECTION LOGIC` and uncomment.

---

## 5. User action required

- **Pick a moment** to start the IR build. Section A and Section B can run in parallel — Claude Sonnet does code in the IDE while you work with Gemini in a browser tab on wiring.
- **Wire the IR LED ring** physically (the IDE can't do this). Follow Gemini's photo-by-photo guidance. Section B prompt is ready to paste.
- **Run final verification steps** in §3 once both halves are done.
- **Commit + deploy** per the deployment block at the bottom of Section A.

Nothing else is blocking. Ultraplan errored out before refining the plan — the local plan in this file is what you'll execute.
