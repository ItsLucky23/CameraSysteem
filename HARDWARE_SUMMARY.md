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

## 6. Future expansion (V2)

- **Audio**: INMP441 MEMS mic (I²S) + MAX98357A amplifier (I²S). Wire only after the video base is stable and the Pi-Zero-side bidirectional audio pipeline exists.
- **Cooling**: optional 5 V fan tied to the red rail if the Pi's CPU temperature climbs above 80 °C while streaming.

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
