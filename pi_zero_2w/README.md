# Pi Zero 2W Camera Node

This folder contains a standalone Pi Zero 2W runtime that integrates with the Pi5 camera control plane already implemented in this repository.

## Why Python for Pi Zero

Python is used instead of Node.js for this node runtime because it has better Raspberry Pi ecosystem support for camera and GPIO control (`gpiozero`, camera tooling, easy shell integration) while still keeping enough performance for the required control loop:

- poll command queue from Pi5
- execute PTZ/IR/recording actions
- send telemetry and command results back to Pi5

## What this package does

- Polls `POST /api/cameras/getPendingNodeCommands/v1`
- Executes command actions:
  - `panLeft`
  - `panRight`
  - `tiltUp`
  - `tiltDown`
  - `irOn`
  - `irOff`
  - `recordStart`
  - `recordStop`
- Reports status and command outcomes to:
  - `POST /api/cameras/ingestNodeTelemetry/v1`
- Runs with either:
  - `mock` adapter (no hardware)
  - `rpi` adapter (GPIO/recording command hooks)

## Structure

```text
pi_zero_2w/
  run.py
  .env.example
  requirements.txt
  PI5_API_CONTRACT.md
  systemd/
    camera-node.service.template
  camera_node/
    config.py
    api_client.py
    runtime.py
    command_executor.py
    telemetry.py
    adapters/
      base.py
      mock_adapter.py
      raspberry_pi_adapter.py
```

## Prerequisites on Pi Zero 2W

1. Raspberry Pi OS (Bookworm or Bullseye)
2. Python 3.11+
3. Network access to Pi5 backend URL
4. `NODE_ID`, `CAMERA_ID`, and shared secret that match Pi5 database/config

## Setup

1. Copy this folder to the Pi Zero, for example:
   - `/opt/camera/pi_zero_2w`
2. Create virtual environment (required):
   - `python3 -m venv .venv`
   - `source .venv/bin/activate`
3. Install dependencies:
   - `pip install -r requirements.txt`
4. Create environment file:
   - `cp .env.example .env`
5. Edit `.env` with real values:
   - `PI5_BASE_URL`
   - `NODE_ID`
   - `CAMERA_ID`
   - `NODE_SECRET`

## Required Pi5-side assumptions

1. `CAMERA_NODE_SHARED_SECRET` is configured on Pi5 and matches `NODE_SECRET`.
2. A `Camera` record exists where `Camera.id == CAMERA_ID` and `Camera.nodeId == NODE_ID`.
3. Pi5 APIs are reachable from the Pi Zero:
   - `/api/cameras/getPendingNodeCommands/v1`
   - `/api/cameras/ingestNodeTelemetry/v1`

## Run modes

### 1. Mock mode (safe first run)

Set in `.env`:

```text
HARDWARE_ADAPTER=mock
```

Run:

```bash
./.venv/bin/python run.py
```

### 2. Raspberry Pi mode

Set in `.env`:

```text
HARDWARE_ADAPTER=rpi
IR_GPIO_PIN=18
PAN_SERVO_GPIO_PIN=12
TILT_SERVO_GPIO_PIN=13
```

`PAN_SERVO_GPIO_PIN` and `TILT_SERVO_GPIO_PIN` enable direct control for Micro Servo 9g (SG90) motors.

Recommended SG90 wiring:

- pan signal -> GPIO12
- tilt signal -> GPIO13
- servo power -> external 5V supply
- external supply ground -> Pi ground (common ground)

Do not power SG90 servos from Pi GPIO power pins directly.

Optional recording hooks:

```text
RECORDING_START_COMMAND=libcamera-vid --inline --timeout 0 -o /tmp/camera.h264
RECORDING_STOP_COMMAND=pkill -f libcamera-vid
```

Run:

```bash
./.venv/bin/python run.py
```

## systemd service

1. Copy service template:

```bash
sudo cp systemd/camera-node.service.template /etc/systemd/system/camera-node.service
```

2. Adjust paths and user in service file if needed.
   - Keep `ExecStart` pointed to the venv interpreter: `/opt/camera/pi_zero_2w/.venv/bin/python`.
3. Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable camera-node.service
sudo systemctl start camera-node.service
```

4. Logs:

```bash
journalctl -u camera-node.service -f
```

## Command behavior

| Action | Runtime behavior |
| --- | --- |
| `panLeft` | pan decreases by `PTZ_STEP` |
| `panRight` | pan increases by `PTZ_STEP` |
| `tiltUp` | tilt increases by `PTZ_STEP` |
| `tiltDown` | tilt decreases by `PTZ_STEP` |
| `irOn` | IR mode `on`, IR enabled |
| `irOff` | IR mode `off`, IR disabled |
| `recordStart` | starts recording command if configured |
| `recordStop` | stops recording command if configured |

## Telemetry sent to Pi5

Every telemetry update includes:

- node and camera identity
- `isOnline`
- mode and IR fields
- pan/tilt
- temperature
- motion/recording flags
- optional command result (`executed`, `failed`, or `rejected`)

## Hardware integration notes

The `rpi` adapter supports SG90 pan/tilt servos when `PAN_SERVO_GPIO_PIN` and `TILT_SERVO_GPIO_PIN` are set.
If these are not set, PTZ stays in software state.

Current built-in SG90 behavior:

- pan/tilt commands move servo angle in steps from `PTZ_STEP`
- pan and tilt are clamped to `-90` to `90` degrees

For custom motor drivers or different servo behavior, extend:

- `camera_node/adapters/raspberry_pi_adapter.py`

Recommended extension points:

- replace `pan` and `tilt` with actual PWM/servo driver calls
- add camera motion detection source updates to adapter state
- replace recording shell commands with your preferred pipeline manager

## Security notes

1. Keep `NODE_SECRET` only on Pi5 and Pi Zero.
2. Restrict network access between Pi Zero and Pi5 where possible.
3. Use HTTPS and `VERIFY_TLS=true` when certificates are available.

## Troubleshooting

1. `camera.nodeUnauthorized`:
   - check `NODE_SECRET`
   - check `NODE_ID` matches `Camera.nodeId`
2. `camera.notFound`:
   - check `CAMERA_ID`
3. No commands arriving:
   - check Pi5 command dispatch is writing queue entries
   - verify Pi Zero can reach Pi5 URL
4. Recording does nothing:
   - set `RECORDING_START_COMMAND` and `RECORDING_STOP_COMMAND`
   - test the shell commands manually on Pi Zero
