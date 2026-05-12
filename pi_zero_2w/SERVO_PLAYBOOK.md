# Pan/tilt servo playbook

Status snapshot as of session 2026-05-03, plus the action plan for when a working servo is in hand.

---

## TL;DR — current state

- **Pan servo (GPIO 12 / pin 32):** wired but non-functional. The current physical unit (and the two before it) all have a defective dead zone — no PWM pulse width holds the servo still. Suspected root cause: bad batch from the original seller. Two prior units burned out from runaway spinning (antenna effect — no pull-down at the time).
- **Tilt servo (GPIO 13 / pin 33):** never wired. Not blocking anything.
- **Wiring is now safe:** 10 kΩ pull-down on GPIO 12 → GND, external 5 V via HW-131, common ground tied. No more fire risk even if a future servo also lacks a dead zone, because the pull-down forces the line LOW when our code isn't actively driving it.
- **Code is shipped and works** assuming the servo cooperates. If you plug in a healthy positional MG90S or SG90 today, the pan buttons in the cameras page will respond. The CR press-and-hold path is also live and would work with a healthy CR servo.
- **Next concrete step:** buy a single real Tower Pro MG90S (positional, has end-stops, can't run away) from a reputable seller and follow the "When a new servo arrives" section below.

---

## What's currently in the codebase

### Hardware contract

| File | Section | What it documents |
|---|---|---|
| `HARDWARE_SUMMARY.md` | §3 | GPIO 12 = pan, GPIO 13 = tilt, both 5 V externally powered |
| `HARDWARE_SUMMARY.md` | §5b | Servo safety rules (mandatory pull-down, 3.3 V first-test rule, kill switch) |
| `pi_zero_2w/.env.example` | servo block | `PAN_SERVO_GPIO_PIN=12`, `TILT_SERVO_GPIO_PIN=13`, `PAN_SERVO_NEUTRAL_ANGLE_OFFSET=0` |

### Pi Zero adapter (`camera_node/adapters/raspberry_pi_adapter.py`)

- `AngularServo` initialized with **continuous-rotation pulse range 1.0-2.0 ms** (`sg90_min_pw` / `sg90_max_pw`). Centered at 1.5 ms = neutral.
- `pan(delta)` — positional model, kept for backward compat with the old `panLeft` / `panRight` actions. Won't do anything sensible on a CR servo (just sends a momentary speed pulse).
- `tilt(delta)` — same, for tilt.
- `start_pan_continuous(direction='left'|'right')` — drives servo to ±90° = full forward / reverse. Used by the new `panStartLeft` / `panStartRight` actions.
- `stop_pan_continuous()` — drives servo to 0 + `_pan_servo_neutral_angle_offset` (stop). Used by `panStop`.
- Logs every pan/tilt call unconditionally as `[ptz]` — easy to verify commands reach the adapter.

### Pi Zero command executor (`camera_node/command_executor.py`)

Dispatches:
- `panLeft` / `panRight` / `tiltUp` / `tiltDown` → positional `pan(delta)` / `tilt(delta)`
- `panStartLeft` / `panStartRight` → `start_pan_continuous(direction=...)`
- `panStop` → `stop_pan_continuous()`

### Pi 5 server (`server/utils/cameraHelpers.ts`)

- `CAMERA_ACTIONS` includes `panStartLeft`, `panStartRight`, `panStop`
- Same three are also in `STUB_CAMERA_ACTIONS` so they bypass the Prisma `CAMERA_ACTION` enum (no DB schema change needed)
- `executeCameraCommand_v1.ts` does NOT add them to `PTZ_ACTIONS` (no rate-limit lock — they're single press-and-hold events, not rapid-fire)

### Cameras page UI (`src/cameras/page.tsx`)

- `CommandAction` type union includes the three new actions
- `PtzAction` type narrowed to `'tiltUp' | 'tiltDown'` (positional only)
- PTZ pad is split into two button groups:
  - **Tilt buttons (up/down):** existing `startPtzHold` / `stopPtzHold` repeat-while-held positional model
  - **Pan buttons (left/right):** new press-and-hold model — `pointerDown` sends `panStartLeft` or `panStartRight`, `pointerUp` / `pointerLeave` / `pointerCancel` sends `panStop`
- `irStrengthDraft`, `setIRStrength` etc. are commented-out behind `HARDWARE IR SENSOR DELEGATION` markers from the earlier IR work — unrelated to servo

### Test / calibration scripts (in `pi_zero_2w/`)

| Script | Purpose |
|---|---|
| `test_pan_servo.py` | Safety-first 5-step test: STOP confirmation → small forward → small reverse → optional sweep → optional interactive. Each step asks for confirmation before continuing. Run this BEFORE integrating any new servo. |
| `test_pan_servo_fullspeed.py` | One-shot maximum-amplitude test: full forward 2 s → stop → full reverse 2 s → stop. Use to verify PWM is reaching the servo at all. |
| `calibrate_pan_servo.py` | Two modes: `--pot` (default) holds STOP indefinitely while you tune the trim screw on the servo body; `--software` sweeps small offsets and tells you what value to put in `PAN_SERVO_NEUTRAL_ANGLE_OFFSET`. |
| `diag_pan_servo.py` | Raw pulse-width prompt. Type ms values directly (0.4-2.6 ms range). Used to hunt for a dead zone outside the standard 1.0-2.0 ms window. |

All scripts:
- Require `sudo pkill -f run.py` first (camera_node holds GPIO 12)
- Use `1.0-2.0 ms` pulse range with 1.5 ms neutral (matches CR-SG90 spec)
- Detach + close the servo on exit so the pull-down can take over

---

## What we learned (the why)

### Why the first two servos burned

No pull-down resistor was wired at the time. When the Pi wasn't actively driving GPIO 12 (during boot, between PWM updates, when camera_node wasn't running), the signal pin floated. A floating CMOS input picks up EMI from the 12 V supply, the 5 V rail, mains, and even static. To a continuous-rotation servo, garbage pulses look like "go" commands. Servo spun continuously at full speed, drew stall current, melted plastic, caught fire.

### Why this third servo doesn't have a usable dead zone

A healthy CR-SG90 has a 50-100 µs dead zone where the comparator says "no signal, motor off". Yours snaps directly from forward to reverse at 1.55 ms with no slow zone in between. Confirmed via `diag_pan_servo.py`:

- 1.5 ms → spins one direction at full speed
- 1.6 ms → spins other direction at full speed
- nothing between stops it

Most likely cause: defective comparator from the same bad batch as the first two. The "SG90" label is unprotected; entire batches ship without proper analog reference circuits and the seller never tests them. Software PWM precision can't help — the dead zone is genuinely zero, not just narrow.

### Why hardware PWM probably won't save the existing servo

The Pi's hardware PWM (sub-microsecond precision) would help if the dead zone were *narrow* (say 5-10 µs, narrower than software PWM's 5-10 µs jitter). But if the comparator is defective and has *zero* dead zone, no PWM source can find a value that holds the motor still. ~70% bet that hardware PWM doesn't help with this specific unit.

---

## When a new servo arrives — action plan

### Decision tree

```
New servo plugged in (10kΩ pull-down already in place from before)
│
├── Is it POSITIONAL (Tower Pro SG90 / MG90S)?
│   │   How to tell: spec sheet says "180° rotation", physical horn has end-stops
│   │
│   ├── YES → Follow "Path A: Positional servo" below
│   │
│   └── NO (continuous rotation) → Follow "Path B: Continuous-rotation servo" below
│
└── (Tilt servo? Wire it the same way on GPIO 13 + add a second pull-down to pin 6)
```

### Path A: Positional servo (RECOMMENDED — no fire risk, simpler code)

1. **Wire it** the same way as documented in `HARDWARE_SUMMARY.md` §4.B. Pull-down stays.
2. **Run `test_pan_servo.py`.** Step A: servo seeks to 0° and holds. Step B: nudges to +5°. Step C: nudges to -5°. All steps should pass cleanly because positional servos have hard internal end-stops — they can't run away.
3. **Revert the UI to the click-pulse model** (since press-and-hold doesn't make sense for positional). One file change in `src/cameras/page.tsx`:
   - In the PTZ button JSX, change the pan-buttons block back to using `startPtzHold(btn.dir)` / `stopPtzHold` with `dir: 'panLeft'` / `'panRight'` (matching the existing tilt buttons' shape)
   - Optionally remove `panStartLeft` / `panStartRight` / `panStop` from `CommandAction` if you don't want the dead types lying around
4. **Optional: bump `PTZ_STEP`** in `pi_zero_2w/.env` from the default 5° to something like 15° if individual clicks feel too small. Each click moves the servo by `PTZ_STEP` degrees.
5. **Test from the cameras page.** Hold pan-right — servo should step right at ~5 Hz while held, stop on release. Same for tilt if wired.

You can leave the new continuous-rotation actions (`panStartLeft` etc.) in the codebase; they just won't be used. Or strip them out for cleanliness.

### Path B: Continuous-rotation servo (only if you intentionally want one)

1. **Wire it** the same way. Pull-down stays.
2. **Run `test_pan_servo.py`. Step A is the make-or-break test:** does the servo hold still on a 1.5 ms STOP pulse? If yes → great, dead zone works. If no → it's another defective unit; either tune the trim pot (Step 4) or send it back.
3. **If Step A fails on the trim pot but the servo is otherwise working:** run `python3 calibrate_pan_servo.py` and follow the on-screen instructions to tune the trim pot live. Find the angle where the servo stops, press Enter.
4. **If no trim pot or pot can't reach neutral:** run `python3 calibrate_pan_servo.py --software`. It'll sweep small offsets and ask which one stopped the servo. Add `PAN_SERVO_NEUTRAL_ANGLE_OFFSET=<value>` to `pi_zero_2w/.env`. Restart camera_node.
5. **The press-and-hold UI already works for this case.** No code changes needed. Pan-left button on hold → servo spins left; release → servo stops at the calibrated neutral.

### Path C: A tilt servo arrives separately

1. Wire it on GPIO 13 (pin 33), same external 5 V + common ground + 10 kΩ pull-down.
2. Set `TILT_SERVO_GPIO_PIN=13` in `pi_zero_2w/.env` (already in `.env.example`).
3. The tilt buttons in the UI already work via the existing `tiltUp` / `tiltDown` positional actions — no code change needed.
4. If the tilt servo is also continuous-rotation, you'd need to add `tiltStartUp` / `tiltStartDown` / `tiltStop` mirroring the pan changes. Not done yet because no tilt servo has been tested.

---

## How to revert this session's changes (if you want a clean slate)

If a clean positional servo works perfectly with the old positional code and you want to remove the press-and-hold scaffolding entirely:

| File | What to revert |
|---|---|
| `server/utils/cameraHelpers.ts` | Remove `panStartLeft`, `panStartRight`, `panStop` from both `CAMERA_ACTIONS` and `STUB_CAMERA_ACTIONS` |
| `pi_zero_2w/camera_node/command_executor.py` | Remove the three `elif command.action == "panStartLeft"` etc. branches |
| `pi_zero_2w/camera_node/adapters/base.py` | Remove `start_pan_continuous` and `stop_pan_continuous` abstract methods |
| `pi_zero_2w/camera_node/adapters/raspberry_pi_adapter.py` | Remove the `start_pan_continuous` / `stop_pan_continuous` implementations and the `pan_servo_neutral_angle_offset` constructor arg |
| `pi_zero_2w/camera_node/adapters/mock_adapter.py` | Same removals as raspberry_pi_adapter |
| `pi_zero_2w/run.py` | Remove the `pan_servo_neutral_angle_offset=settings.pan_servo_neutral_angle_offset` line in `build_adapter` |
| `pi_zero_2w/camera_node/config.py` | Remove the `pan_servo_neutral_angle_offset` field + parsing |
| `pi_zero_2w/.env.example` | Remove the `PAN_SERVO_NEUTRAL_ANGLE_OFFSET=0` block |
| `src/cameras/page.tsx` | Re-merge the pan buttons into the same map as tilt buttons; revert `CommandAction` and `PtzAction` types |

The test scripts (`test_pan_servo.py` etc.) can stay regardless — they're useful for diagnosing any future servo regardless of model.

---

## What to buy

If you're shopping for replacements, I'd suggest one of these:

1. **Tower Pro MG90S** — positional, metal gears, real spec sheet, ~$8 from Amazon "Tower Pro" listings (verify the brand). Best choice — can't run away (end-stops), more torque than SG90, well-documented.
2. **Tower Pro SG90** — positional, plastic gears, ~$5. Cheaper but plastic gears can strip under load. Fine for a camera mount that doesn't carry weight.
3. **Avoid:** any "CR-SG90" / "360° SG90" listing under ~$10. The dead-zone-defect problem is endemic to that price point.

Two units (one pan, one tilt) is the eventual goal.

---

## Quick reference

**To test a new servo end-to-end** (after wiring + setting `PAN_SERVO_GPIO_PIN=12` in `.env`):

```
sudo pkill -f run.py
cd /var/www/CameraSysteem/pi_zero_2w
source .venv/bin/activate
python3 test_pan_servo.py
```

If it passes all steps cleanly, restart the camera_node:

```
python3 run.py
```

…and try the pan buttons in the cameras page. Watch the Pi Zero log for `[ptz] pan delta=...` (positional) or `[ptz] start_pan_continuous direction=...` (continuous-rotation) lines confirming the command reached the adapter.

**To physically tune a CR-servo's trim pot:**

```
python3 calibrate_pan_servo.py
```

(Holds STOP indefinitely while you turn the screw on the servo body.)

**To find a software offset for a CR-servo without a usable trim pot:**

```
python3 calibrate_pan_servo.py --software
```

(Sweeps offsets, asks which value stopped the servo, tells you what to put in `.env`.)

**To hunt for a dead zone outside the standard 1.0-2.0 ms range:**

```
python3 diag_pan_servo.py
```

(Raw pulse-width prompt with 0.4-2.6 ms safety-clamped range.)
