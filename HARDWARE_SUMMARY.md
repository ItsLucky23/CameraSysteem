# Hardware summary — V1 build

This is the Single Source of Truth for the physical camera-node setup. Every pin assignment, voltage rail, MOSFET wire, and safety check lives here. Update this file whenever you change the wiring, and reference it from any code change that touches GPIO defaults.

V1 = Pi Zero 2 W + Pi Camera Module 3 + HC-SR501 PIR + 12 V IR LED ring (via IRLB8748 MOSFET) + MG90S pan/tilt servos.
V2 (deferred) = INMP441 I²S microphone + MAX98357A I²S amplifier.

---

## 1. Power scheme

Three independent voltage rails, all sharing a common ground.

| Rail | Voltage | Loads |
|------|---------|-------|
| **High power** | 12 V | IR LED ring only |
| **Logic & motors** | 5 V | Pi Zero 2 W, MG90S servos, HC-SR501 |
| **Sensors** | 3.3 V | INMP441 microphone (V2) |

**Common ground rule:** every blue (–) rail on the breadboard, every Pi GND pin, and the GND of the 12 V supply must be tied together. The MOSFET will not switch reliably without a common reference.

---

## 2. The MOSFET gate (IR illumination)

The IRLB8748 N-channel logic-level MOSFET acts as the electronic switch for the 12 V IR ring. Pin layout, printed face toward you, pins down:

| MOSFET pin | Name | Connects to | Purpose |
|------------|------|-------------|---------|
| 1 (left) | Gate | Pi GPIO 18 (physical pin 12) | Signal to turn the lamp on/off |
| 2 (middle) | Drain | IR ring black wire (–) | Output to the lamp |
| 3 (right) | Source | Blue (–) GND rail | Path to ground |

**Mandatory pull-down:** place a **10 kΩ resistor between Gate (pin 1) and the blue GND rail**. This holds the gate at 0 V during Pi boot-up GPIO settling, preventing the lamp from flickering on while the Pi is starting.

---

## 3. GPIO pin layout (Raspberry Pi Zero 2 W)

Use this table for every jumper. **Physical pin** = the position on the 40-pin header. **GPIO** = the BCM software name.

| Physical pin | Function | Direction | Component |
|--------------|----------|-----------|-----------|
| 2 | 5 V Out | Out | Red (+) rail of breadboard (5 V side) |
| 6 | GND | — | Blue (–) rail of breadboard |
| 12 | GPIO 18 | Out | MOSFET pin 1 (Gate) |
| 26 | GPIO 7 | In | HC-SR501 OUT (motion path ON HOLD — see §4.A) |
| 32 | GPIO 12 | Out (PWM) | MG90S Servo 1 (Pan), orange wire |
| 33 | GPIO 13 | Out (PWM) | MG90S Servo 2 (Tilt), orange wire |

---

## 4. Component wiring

<!-- MOTION DETECTION LOGIC (start) -->
### A. HC-SR501 PIR motion sensor (ON HOLD — code path paused, hardware still wired)

| HC-SR501 pin | Wire | To |
|--------------|------|----|
| VCC | Red | 5 V red rail |
| GND | Black | Blue GND rail |
| OUT | Yellow / white | Pi physical pin 26 (GPIO 7) |
<!-- MOTION DETECTION LOGIC (end) -->

### B. MG90S pan/tilt servos

| Servo wire | Colour | To |
|------------|--------|----|
| Signal | Orange | Pi physical pin 32 (Pan) or pin 33 (Tilt) |
| Power | Red | 5 V red rail |
| GND | Brown | Blue GND rail |

### C. 12 V IR LED ring

| Ring wire | To |
|-----------|----|
| Red (+) | 12 V rail (e.g. the pins behind the DC jack on the HW-131 module) |
| Black (–) | MOSFET Drain (pin 2) |

> **Onboard CdS sensor:** the IR ring has its own photoresistor that gates the
> LEDs based on ambient light, completely in hardware. Our software defers to
> it: the Pi 5 auto-IR controller and Pi Zero PWM dimming are both commented
> out behind `HARDWARE IR SENSOR DELEGATION (start)/(end)` markers. To revert
> (use software auto-IR + IMX708 luminance instead), uncomment those marker
> blocks in `server/utils/cameraIRController.ts`,
> `pi_zero_2w/camera_node/adapters/raspberry_pi_adapter.py`,
> `pi_zero_2w/camera_node/adapters/mock_adapter.py`, and `src/cameras/page.tsx`
> — and place opaque tape over the CdS sensor on the ring so it doesn't
> override us. UI mode buttons collapse to **On / Off**; Auto is hidden.

---

## 5. Safety & multimeter checklist

Before powering anything on, verify with a meter:

| Check | Probes | Expected |
|-------|--------|----------|
| **Continuity** | Pi GND ↔ blue rail | Beep (YES) |
| **Voltage** | Red rail ↔ blue rail | ~5 V |
| **Voltage** | 12 V rail ↔ blue rail | ~12 V where the IR ring's red wire is connected |
| **Isolation** | Any 12 V rail point ↔ any Pi pin | No voltage, no continuity (NO). If you read voltage, you have a short — do not power on, you will brick the Pi. |

---

## 5b. Servo safety (READ BEFORE WIRING)

> **For the full pan/tilt status (current state, action plan when a new servo arrives, decision tree for positional vs continuous-rotation, list of test scripts, what to buy), see `pi_zero_2w/SERVO_PLAYBOOK.md`.** This section covers the hardware-safety rules only.

We lost two SG90s to runaway spinning because the signal wire was **floating** during Pi boot / between PWM updates. Many "SG90" units sold cheaply online are actually **continuous-rotation** servos — they have no internal end-stops, so a floating signal line picks up EMI ("antenna effect") and the servo spins at full speed indefinitely. Continuous spin at 5 V → stall current → melted plastic / fire.

**Mandatory safety rules:**

1. **10 kΩ pull-down resistor** between every servo signal pin and GND. Same role as the MOSFET gate pull-down in §2 — when the Pi isn't actively driving the pin (booting, code crashed, service stopped), the resistor holds it LOW so the servo gets no pulses.
2. **First-time test on 3.3 V**, not 5 V. Wire SG90 red → Pi physical pin 1 (3.3 V) for the first power-up. The servo will move slowly or not at all — by design — and can't draw enough current to overheat.
3. **Run `pi_zero_2w/test_pan_servo.py` before integrating with camera_node.** The script commands STOP first, prompts you to confirm the servo is stationary, and only then attempts movement. If the servo doesn't stop on the STOP command, you have a continuous-rotation servo and need to either (a) tune its onboard pot until 1.5 ms pulse = true neutral, or (b) replace it with a real positional SG90.
4. **Have a kill switch** in the servo's power line (in-line switch on the +V wire works) before powering up. If you see runaway spin, cut power within 1 second.
5. **SG90 power must be external** for sustained use (5 V supply, not the Pi 5 V pin) — but only AFTER the 3.3 V test passes. SG90 stall current (250-650 mA) browns out the Pi's regulator.
6. **Common ground** between Pi GND, external 5 V supply GND, and servo brown wire. Without it, the PWM signal floats relative to the servo's reference and you get jitter or runaway.

## 6. Future expansion (V2)

- **Audio**: see §6.A below — wiring procedure is now defined and the software pipeline is in flight.
- **Cooling**: optional 5 V fan tied to the red rail if the Pi's CPU temperature climbs above 80 °C while streaming.

---

## 6.A 2-way audio migration (active — wire when Phase 1 software lands)

Once the audio software path is in place, follow this procedure exactly. Order matters: the I²S bus needs GPIO 18, which the IR MOSFET gate currently occupies. **Do all of step 1 before powering on.**

### Step 1 — Move IR MOSFET gate off GPIO 18

The IR LED ring's onboard CdS sensor still gates brightness in hardware (HARDWARE IR SENSOR DELEGATION), so the new pin only needs to be a digital output — no hardware PWM required. Move the gate jumper:

| What | From | To |
|------|------|----|
| MOSFET pin 1 (Gate) jumper | Pi physical pin **12** (GPIO 18) | Pi physical pin **11** (GPIO **17**) |
| 10 kΩ gate-to-GND pull-down | stays on the gate leg | stays on the gate leg |

After moving the wire, in `pi_zero_2w/.env`: set `IR_GPIO_PIN=17`. Restart camera_node and confirm `[ir]` log lines reference GPIO 17.

### Step 2 — Wire INMP441 (mic) and MAX98357A (amp) on I²S0

Both devices share BCLK + LRCLK and use independent data pins.

| Device       | Device pin | Pi physical pin | BCM GPIO     | Notes                                    |
|--------------|------------|-----------------|--------------|------------------------------------------|
| INMP441      | VDD        | 1 (3V3)         | —            | Mic uses **3.3 V** rail only             |
| INMP441      | GND        | 6 / 9 / etc     | —            | Common ground                            |
| INMP441      | SCK        | 12              | GPIO 18      | I²S bit clock (now free after step 1)    |
| INMP441      | WS         | 35              | GPIO 19      | I²S word select / LRCLK                  |
| INMP441      | SD         | 38              | GPIO 20      | Mic data → Pi (PCM_DIN)                  |
| INMP441      | L/R        | → GND           | —            | Tie to GND for left-channel-only         |
| MAX98357A    | VIN        | 2 (5V)          | —            | Amp uses **5 V** rail (3.3 V is too weak)|
| MAX98357A    | GND        | 6 / 9 / etc     | —            | Same common ground                       |
| MAX98357A    | BCLK       | 12              | GPIO 18      | Shares with INMP441 SCK                  |
| MAX98357A    | LRC        | 35              | GPIO 19      | Shares with INMP441 WS                   |
| MAX98357A    | DIN        | 40              | GPIO 21      | Pi → amp (PCM_DOUT)                      |
| MAX98357A    | GAIN       | floating        | —            | Default 9 dB (sufficient for 1 W speaker)|
| MAX98357A    | SD         | floating        | —            | Always-on (left disconnected)            |
| Speaker      | + / −      | MAX98357A SPK terminals | —    | 4–8 Ω, ≥1 W. Mount **≥10 cm from mic**   |

> **Power note:** the existing power scheme (§1) lists audio on the 3.3 V rail. INMP441 only — **MAX98357A goes on the 5 V rail** and can pull peaks of ~600 mA at full volume. Update §1 once the wires are physically in.
>
> **Acoustic feedback:** keep the speaker baffled (or at least 10 cm from the mic) to avoid howl. The camera enclosure body is the natural separator; orient the mic facing out and the speaker through a side vent if possible.

### Step 3 — Enable I²S in `/boot/firmware/config.txt`

```bash
sudo sed -i 's/^dtparam=audio=on/#dtparam=audio=on/' /boot/firmware/config.txt
echo 'dtoverlay=googlevoicehat-soundcard' | sudo tee -a /boot/firmware/config.txt
sudo reboot
```

The `googlevoicehat-soundcard` overlay is the Bookworm-supported path for the INMP441 + MAX98357A combo (it's the same overlay the Google AIY Voice HAT used). It exposes one full-duplex ALSA card with both `arecord` and `aplay` working on the same device. `dtparam=audio=on` is disabled because it would otherwise grab ALSA card 0 (built-in BCM2835) and contend for the playback path.

### Step 4 — Verify the I²S bus in isolation

After reboot, before any camera_node code touches it:

```bash
arecord -l                                     # expect 1 external card listed
aplay -l                                       # expect the same card
arecord -D plughw:CARD=sndrpigooglevoi -d 3 -f S16_LE -r 48000 -c 1 /tmp/test.wav
aplay -D plughw:CARD=sndrpigooglevoi /tmp/test.wav
```

If you can record 3 s of room audio and hear it played back through the speaker, the bus is good. The boot probe banner in `journalctl -u camera_node` will then show `microphone OK` and `speaker OK`, and `has_microphone`/`has_speaker` flip to `true` in the next telemetry tick.

### Step 5 — Update §3 and §1 in this doc

Once the wires are in and verified:

- §3 GPIO table: change the IR LED row from GPIO 18 → GPIO 17 (physical pin 11), add four rows for I²S BCLK / LRCLK / mic data / amp data.
- §1 Power scheme: split audio across 3.3 V (mic) and 5 V (amp) rather than 3.3 V only.
- §6 Future expansion: remove the audio bullet (now active).
- §4 Component wiring: add subsection D for audio, mirroring the existing wiring tables.

---

## 7. Software dependencies on the Pi Zero

`gpiozero` needs a real GPIO backend or it silently falls back to `NativeFactory`, which on Bookworm/Trixie kernels cannot drive PWM (servos) or detect edges (PIR motion). Install `lgpio` system-wide AND in the camera_node venv:

```bash
# System-wide:
sudo apt install -y python3-lgpio liblgpio1 liblgpio-dev swig python3-dev

# Inside the camera_node venv:
source /opt/camera/pi_zero_2w/.venv/bin/activate
pip install lgpio        # builds against the apt-installed liblgpio + swig

# Verify:
python3 -c "import lgpio; print('lgpio OK')"
```

If `lgpio` is missing, `journalctl -u camera_node` will show `PinFactoryFallback: Falling back from lgpio: No module named 'lgpio'` and motion edges will never fire even though the boot probe says `motion detection OK`.

### IR boot self-test

The camera node has an optional hands-free IR wiring check. Set `IR_BOOT_SELF_TEST=true` in the Pi Zero `.env` (alongside `IR_GPIO_PIN`) and restart the service — the IR LED will blink twice right after adapter startup so you can confirm the MOSFET + 12 V ring chain without opening the cameras page. Disable the flag again once the wiring is verified; it is not meant to run on every boot in normal operation.
