# Session Handoff: Pi5 + Pi Zero 2W Camera Work

Date: 2026-04-10

## Why This File Exists

This is a full handoff context so work can resume quickly after rest, without re-discovering architecture decisions or implementation status.

## What Was Completed This Session

1. Pi5 camera platform implementation was pushed further toward end-to-end completeness.
2. Frontend camera operator flow was completed on `/cameras`:
   - camera list and state panel
   - command controls (PTZ, IR, recording)
   - preview session request
   - in-browser WebRTC preview start/stop lifecycle
   - live sync updates for state and command results
3. Admin access management flow was completed on `/admin/camera-access`:
   - user-camera access matrix
   - toggle preview/control rights
   - real-time access update propagation
4. Route protection was tightened:
   - `/cameras` requires login
   - `/admin/camera-access` requires admin
5. Locale coverage was expanded in all supported languages (en/nl/de/fr) for camera/admin strings and error codes.
6. Environment/config docs were updated for camera signaling and node secret setup.
7. Pi Zero 2W runtime package was created at `pi_zero_2w/` using Python:
   - command polling from Pi5
   - command execution pipeline
   - telemetry ingest back to Pi5
   - mock adapter and Raspberry Pi adapter structure
   - deployment artifacts (`.env.example`, `requirements.txt`, `systemd` template)
8. Lint cleanup was completed to zero errors.
9. Pi Zero execution was aligned to virtualenv-first operation:
   - README run commands now use `./.venv/bin/python`
   - systemd template now uses `/opt/camera/pi_zero_2w/.venv/bin/python`

## What Changed and Why

1. Python was chosen for Pi Zero because Raspberry Pi hardware integration (GPIO/camera tooling/process control) is more direct and maintainable.
2. Pi5 remains the source of truth for auth, access control, command locking, command queueing, telemetry persistence, and frontend state fan-out.
3. WebRTC preview on the web client was added now to validate operator UX early, while signaling/media infrastructure can still evolve independently.
4. Lint was made strict-clean to reduce follow-up friction and prevent hidden type-safety regressions.
5. venv usage was enforced for Pi Zero to avoid global Python package drift and environment mismatch during deployment.

## Device Responsibility Split (Important)

## Pi5 Responsibilities

1. User auth and access control.
2. Camera access matrix and admin edits.
3. Command acceptance, cooldown/lock enforcement, queueing.
4. Telemetry + command-result ingestion.
5. Camera state persistence and sync fan-out.
6. Preview token issuance and WebRTC offer proxying.

## Pi Zero 2W Responsibilities

1. Poll pending commands from Pi5.
2. Execute hardware actions locally (PTZ/IR/record).
3. Report camera telemetry and command outcomes to Pi5.
4. Keep local runtime resilient (looping worker + stop handling).

## End-to-End Runtime Expectations

1. User issues command from `/cameras`.
2. Pi5 validates permissions and lock window, stores command, enqueues to node channel.
3. Pi Zero polls and executes command.
4. Pi Zero posts telemetry and command result.
5. Pi5 updates DB snapshot and emits sync updates.
6. Operator/admin UIs reflect updates in near real time.

## Validation Performed

1. Ran lint and fixed all reported problems in camera/admin TypeScript paths.
2. Confirmed final lint state is clean (`npm run lint` exits without errors).
3. Confirmed no stale residual issues by running targeted no-cache eslint checks when cache behavior looked inconsistent.

## Remaining Work (Prioritized)

1. Wire and validate the real signaling/media backend contract used by `api/cameras/webrtc/offer/v1`.
2. Implement real PTZ hardware movement in `pi_zero_2w/camera_node/adapters/raspberry_pi_adapter.py`.
3. Integrate real recording pipeline lifecycle (start/stop supervision, process robustness).
4. Add operator/admin timeline views for command and event history.
5. Add scaling support for larger access matrices (pagination/filtering).
6. Add ops observability for Pi Zero (health metrics/watchdog strategy).

## Simple Term Explanations

1. PTZ means pan/tilt/zoom (move left-right, up-down, and zoom if supported).
2. Hardware driver means the code that talks to the physical motor/controller board.
3. Signaling service means the part that sets up the WebRTC connection.
4. Fleet size means how many cameras and users you expect at the same time.
5. Pagination means splitting a big table into multiple pages.

## Decisions Confirmed By You

1. PTZ motor model is now confirmed: Micro Servo 9g (SG90).
2. Recording/stream requirement: use a setup that can send Pi camera video and lets V2 keep input audio and output audio separate, with input audio filtered out of output audio.
3. Signaling service location: Pi5 is the main host.
4. Fleet size is unknown for now; keep current UI simple and only add pagination/index tuning when needed.
5. Permissions model: per user per camera only.

## One Remaining Choice

1. We still need the exact GPIO pin mapping for pan and tilt SG90 servos on each Pi Zero.

## First-Time Setup Plan (Per Device)

This section is for your exact current state: Pi Zero is flashed and reachable by SSH, camera hardware still needs full wiring and software setup.

### 1. Physical Wiring First (before software testing)

1. Connect the camera ribbon cable to the Pi Zero CSI port.
   Why: the node cannot provide video without a detected camera.
2. Wire SG90 pan servo signal to a GPIO pin (recommended: GPIO12).
   Why: this pin is used by the software to move left and right.
3. Wire SG90 tilt servo signal to a GPIO pin (recommended: GPIO13).
   Why: this pin is used by the software to move up and down.
4. Power SG90 servos from an external 5V supply, not from Pi GPIO power pins.
   Why: SG90 current spikes can reset or destabilize the Pi.
5. Connect external supply ground and Pi ground together (common ground).
   Why: control signal is unreliable without shared ground reference.
6. If you use IR control, wire IR control signal to your chosen GPIO (current default in docs: GPIO18).
   Why: IR on/off commands need a physical control pin.

### 2. Pi5 Main Host Setup

1. Configure Pi5 secrets and signaling URL in `.env.local`.
   Why: Pi Zero authentication and preview signaling depend on these values.
2. Install project dependencies.
   Why: server/client and Prisma commands require local packages.
3. Run Prisma generate and db push.
   Why: camera models/tables must exist before node APIs can work.
4. Create camera records in database with matching `cameraId` and `nodeId`.
   Why: Pi Zero telemetry and command polling are rejected if IDs do not match DB records.
5. Start Pi5 app services (server and client).
   Why: Pi Zero needs live API endpoints for polling and telemetry.
6. Open admin pages and verify users can be granted per-camera access.
   Why: command and preview permissions are enforced by this access matrix.

### 3. Pi Zero 2W Setup

1. Update Pi OS packages and install Python venv tools.
   Why: runtime and dependency installation must be available first.
2. Copy `pi_zero_2w` folder to Pi Zero.
   Why: this folder contains the node runtime and env template.
3. Create `.venv`, activate it, and install requirements.
   Why: runtime is intentionally isolated from global Python packages.
4. Create `.env` from `.env.example` and fill required values:
   - `PI5_BASE_URL`
   - `NODE_ID`
   - `CAMERA_ID`
   - `NODE_SECRET`
   - `PAN_SERVO_GPIO_PIN`
   - `TILT_SERVO_GPIO_PIN`
   Why: these values connect the node to Pi5 and map movement commands to real pins.
5. Run a local camera check on Pi Zero (for example with libcamera tools) before node runtime.
   Why: this confirms camera hardware works independently of app code.
6. Start node runtime manually with `.venv/bin/python run.py` and watch logs.
   Why: manual run is the fastest way to catch config/wiring issues before service mode.

### 4. End-to-End Test Order (Recommended)

1. Check Pi Zero telemetry is reaching Pi5.
   Why: this proves auth, network, and API connectivity are correct.
2. Test pan/tilt commands from `/cameras`.
   Why: this validates SG90 wiring, GPIO mapping, and command flow.
3. Test IR and recording commands.
   Why: confirms non-PTZ actions work through same command pipeline.
4. Test preview from `/cameras`.
   Why: verifies signaling path and media path are both working.
5. Test permission behavior using a non-admin user.
   Why: confirms per-user per-camera security works as intended.

### 5. Move To Service Mode (After Manual Tests Pass)

1. Install and enable the systemd service template.
   Why: gives auto-restart and boot-time startup.
2. Reboot Pi Zero and confirm service auto-started.
   Why: validates production-like behavior.

### 6. Known Not-Done Item

1. The advanced audio requirement (separating input and output audio and filtering input from output) is not fully implemented yet in this session.
   Why: this requires a dedicated media pipeline design step and validation against your exact V2 flow.

## Fast Resume Checklist

1. Pull latest code.
2. On Pi5, verify `.env.local` includes:
   - `CAMERA_NODE_SHARED_SECRET`
   - `CAMERA_WEBRTC_SIGNALING_URL`
3. For each Pi Zero node:
   - copy `.env.example` to `.env`
   - create venv (`python3 -m venv .venv`)
   - install deps (`source .venv/bin/activate && pip install -r requirements.txt`)
   - run with `./.venv/bin/python run.py`
4. If deploying service mode, use `systemd/camera-node.service.template` with venv path.
5. Verify command round-trip from `/cameras` before expanding hardware-specific behavior.

## Notes

This handoff intentionally favors implementation clarity over brevity so no context is lost overnight.
