# Session State

## Session summary

- **Goal:** plan + implement end-to-end 2-way audio (camera mic <-> browser, with talker control-session lock and recording mux of both directions).
- **Plan reviewed and approved:** stored at `C:\Users\mathi\.claude\plans\go-over-the-codebase-curried-crown.md`. Implements all 5 phases over the existing video stack (RTP/UDP Pi Zero -> Pi 5 -> WebRTC browser).
- **All 5 phases implemented:**
  - Phase 1 (docs/scaffold): `HARDWARE_SUMMARY.md` §6.A migration procedure, env vars `AUDIO_INPUT_DEVICE`/`AUDIO_OUTPUT_DEVICE`/`AUDIO_BITRATE_BPS` plumbed through `pi_zero_2w/.env.example` + `pi_zero_2w/camera_node/config.py`.
  - Phase 2 (downlink — Pi mic to browser): `pi_zero_2w/camera_node/audio_publisher.py:1` (arecord+ffmpeg Opus -> RTP), `server/utils/cameraAudioBridge.ts:1` ingest half, audio transceiver added in `server/utils/cameraWebrtcBridge.ts` with `useOPUS({ payloadType: 111 })`, command actions `startAudioUplink`/`stopAudioUplink` in `pi_zero_2w/camera_node/command_executor.py`, orchestrator enqueues both audio commands alongside `startVideoStream` in `server/utils/cameraStreamOrchestrator.ts`.
  - Phase 3 (uplink — browser mic to Pi speaker, control-gated): `pi_zero_2w/camera_node/audio_subscriber.py:1` (RTP -> ffmpeg -> aplay), egress half of `cameraAudioBridge.ts`, ontrack -> `writeAudioEgressRtp` wired in `cameraWebrtcBridge.ts`. Control gate via new `server/utils/cameraMicState.ts:1` (Redis lock with `CONTROL_TTL_MS` TTL), `src/cameras/_api/setMicEnabled_v1.ts:1`, sync handler `src/cameras/_sync/micEnabledChanged_server_v1.ts:1`. Browser side: audio transceiver + hidden `<audio autoplay>` element + mic toggle now calls `setMicEnabled` then `replaceTrack` on the existing audio sender (`src/cameras/page.tsx`).
  - Phase 4 (recording mux): `server/utils/cameraRecordingManager.ts` allocates two extra UDP loopback ports, extends SDP to 3 streams, picks ffmpeg arg set (copy / `aac 128k` single / `amix=inputs=2:duration=longest:dropout_transition=2 -> aac 128k`).
  - Phase 5 (polish): `audioPipeline` log flag added to both Pi 5 and Pi Zero log-flag stores + cameras-page debug panel; `aperture.monitor.audioMicHeldByOther` and `aperture.monitor.debugFeatureAudio` locale strings added in en/nl/de/fr; Pi 5 env vars `PI5_AUDIO_INGEST_PORT_BASE=6600` and `PI5_AUDIO_EGRESS_PORT_BASE=7600` added to `.env`/`.env_template`.
- **Build verification:** `npm run build` exits 0, only pre-existing warnings, no new ones from the audio change.
- **Python verification:** `python -m py_compile` passes cleanly on all changed Pi Zero files.
- **NOT YET TESTED ON HARDWARE.** All audio changes are gated on `AUDIO_INPUT_DEVICE` / `AUDIO_OUTPUT_DEVICE` being set in the Pi Zero `.env`; until those are populated the audio commands log a no-op.

## Current state

- **Working (verified by build/typecheck only):**
  - Server build is green. TypeScript types include the new `setMicEnabled` API and `micEnabledChanged` sync event.
  - Pi Zero Python files all `py_compile` clean.
  - Existing video path is untouched at the message-shape level — the new audio transceiver was added to the same `RTCPeerConnection` and existing video clients should keep working.
- **Implemented but unverified:**
  - The full audio path Pi Zero mic -> browser speaker.
  - The full audio path browser mic -> Pi Zero speaker.
  - Control-session-gated mic ownership ("X is talking" indicator + non-owner mic toggle disabled).
  - Recording with mixed audio (camera mic + browser mic interleaved into the AAC track of the MP4).
- **Known broken (intentional):**
  - Until the Pi Zero is rewired (IR LED off GPIO 18) AND `AUDIO_INPUT_DEVICE` is set, the audio commands no-op. This is by design — running `git pull` + restart on a non-rewired Pi Zero leaves IR working as before and skips audio cleanly.
- **Uncommitted changes (this session, on `main`):**
  - New files: `pi_zero_2w/camera_node/audio_publisher.py`, `pi_zero_2w/camera_node/audio_subscriber.py`, `server/utils/cameraAudioBridge.ts`, `server/utils/cameraMicState.ts`, `src/cameras/_api/setMicEnabled_v1.ts`, `src/cameras/_sync/micEnabledChanged_server_v1.ts`.
  - Modified: `HARDWARE_SUMMARY.md`, `pi_zero_2w/.env.example`, `pi_zero_2w/camera_node/config.py`, `pi_zero_2w/camera_node/log_flags.py`, `pi_zero_2w/camera_node/adapters/base.py`, `pi_zero_2w/camera_node/adapters/raspberry_pi_adapter.py`, `pi_zero_2w/camera_node/adapters/mock_adapter.py`, `pi_zero_2w/camera_node/command_executor.py`, `pi_zero_2w/run.py`, `server/utils/cameraWebrtcBridge.ts`, `server/utils/cameraStreamOrchestrator.ts`, `server/utils/cameraRecordingManager.ts`, `server/utils/cameraLogFlagStore.ts`, `src/cameras/page.tsx`, `src/_locales/{en,nl,de,fr}.json`, `.env`, `.env_template`.
  - Also still uncommitted from prior sessions: `server/utils/cameraThumbnailExtractor.ts`.

## Next steps

The phases below are ordered. Do A then B then C (hardware) before D-G (software/verify). Anything in this checklist that fails should stop the chain — fix root cause, rerun the same step, then continue.

### A. Rewire IR LED off GPIO 18 (PHYSICAL)

1. **Power down Pi Zero:** `sudo poweroff`. Wait until the green LED stops blinking. Unplug the USB-C power.
2. **Move the MOSFET gate jumper:** the Gate (pin 1 of the IRLB8748) is currently on Pi physical pin **12** (GPIO 18). Pull that jumper. Plug it into Pi physical pin **11** (GPIO **17**) instead.
3. **Verify with multimeter (no power):** continuity beep from physical pin 11 to MOSFET gate leg. NO continuity from physical pin 12 to MOSFET gate leg. The 10 kOhm gate-to-GND pull-down stays exactly where it was.
4. **Power back on, do not edit `.env` yet.** SSH in, `journalctl -u camera-node.service -f`. Expected: `IR device initialized on GPIO 18 (PWM @ 200 Hz)` (still 18 because we haven't flipped the env yet). The LED will not respond because the wire is on GPIO 17 now. This is expected — proceed.
5. Edit `/opt/camera/pi_zero_2w/.env` and change `IR_GPIO_PIN=18` -> `IR_GPIO_PIN=17`.
6. `sudo systemctl restart camera-node.service`. Confirm log line now reads `IR device initialized on GPIO 17 (PWM @ 200 Hz)`.
7. Open `/cameras` in browser, take control of this camera, click IR ON. Confirm the LED ring lights up. Click OFF, confirm it goes out. Done with Step A only when this works.

### B. Wire INMP441 mic + MAX98357A amp (PHYSICAL)

Follow `HARDWARE_SUMMARY.md` §6.A step 2 exactly. Power must stay off until every jumper is double-checked. Quick-reference table:

| Wire from | To Pi physical pin |
|-----------|---------------------|
| INMP441 VDD | 1 (3V3) |
| INMP441 GND, L/R, SEL | blue rail (GND) |
| INMP441 SCK | 12 (GPIO 18) |
| INMP441 WS | 35 (GPIO 19) |
| INMP441 SD | 38 (GPIO 20) |
| MAX98357A VIN | 2 (5V) |
| MAX98357A GND | blue rail |
| MAX98357A BCLK | 12 (GPIO 18) — shared with INMP441 SCK |
| MAX98357A LRC | 35 (GPIO 19) — shared with INMP441 WS |
| MAX98357A DIN | 40 (GPIO 21) |
| Speaker + / - | MAX98357A speaker terminals (4-8 Ohm, ≥1 W). Mount **≥10 cm from the mic** to avoid acoustic feedback. |

Leave MAX98357A `GAIN` and `SD` pins floating. Power back on. The pi_zero is still running on the previous code, so audio overlays haven't been enabled — the boot probe will still report `microphone FAIL` and `speaker FAIL`. That's expected. Proceed to step C.

### C. Enable I²S in `/boot/firmware/config.txt`

```bash
sudo sed -i 's/^dtparam=audio=on/#dtparam=audio=on/' /boot/firmware/config.txt
echo 'dtoverlay=googlevoicehat-soundcard' | sudo tee -a /boot/firmware/config.txt
sudo reboot
```

After reboot, `arecord -l` and `aplay -l` should each list one external "snd_rpi_googlevoicehat_soundcar" card (and **no** bcm2835 / vc4-hdmi entries, since `dtparam=audio=on` is now commented out).

### D. Verify the I²S bus in isolation BEFORE any camera_node code touches it

```bash
arecord -D plughw:CARD=sndrpigooglevoi -d 3 -f S16_LE -r 48000 -c 1 /tmp/test.wav
aplay   -D plughw:CARD=sndrpigooglevoi /tmp/test.wav
```

You should hear the 3 s of room audio play back through the speaker. If not, common failures:

- **arecord prints "device not found"** -> overlay didn't load. `sudo dmesg | grep -iE "i2s|googlevoicehat"`. Check `/boot/firmware/config.txt` actually has the line you added.
- **arecord runs but the file is silence (just a buzz)** -> mic L/R or SEL isn't tied to GND, or VDD isn't on 3V3.
- **aplay runs but no sound from speaker** -> MAX98357A VIN is on 3V3 instead of 5V (very common mistake — it MUST be 5V), or the GAIN pin is grounded instead of floating, or the speaker leads are reversed/shorted.
- **CPU is fine but audio is choppy** -> wrong sample rate. Stay at 48000.

Do not move on from D until isolation loopback works. The whole rest of the stack is built on it.

### E. Roll the new code + flip env vars

#### Pi 5

```bash
git pull
npm run build
sudo systemctl restart luckystack
journalctl -u luckystack -f
```

Confirm in the log:
- `cameraStreamOrchestrator: enqueue startVideoStream for <id> ...`
- (new) `cameraStreamOrchestrator: enqueue startAudioUplink ...`
- (new) `cameraStreamOrchestrator: enqueue startAudioDownlink ...`

If the camera was already streaming before the restart, the new audio commands fire on the next viewer-driven activation cycle.

#### Pi Zero

```bash
git pull
nano /opt/camera/pi_zero_2w/.env
#   AUDIO_INPUT_DEVICE=                  -> AUDIO_INPUT_DEVICE=plughw:CARD=sndrpigooglevoi
#   AUDIO_OUTPUT_DEVICE=                 -> AUDIO_OUTPUT_DEVICE=plughw:CARD=sndrpigooglevoi
#   AUDIO_BITRATE_BPS=32000              (already there from the template)
sudo systemctl restart camera-node.service
journalctl -u camera-node.service -f
```

Confirm:
- Boot probe banner now shows `microphone OK` and `speaker OK` (instead of FAIL).
- When a viewer opens the cameras page: `[audio-publisher] start rtpHost=<pi5> rtpPort=<6600+...>`.
- Same for the downlink: `[audio-subscriber] start localPort=<7600+...>`.

If you see `[audio] start_audio_uplink ignored — AUDIO_INPUT_DEVICE unset`, the env var didn't load — check `nano` saved correctly and the service restarted.

### F. End-to-end functional verification

1. **Listen direction.** Open `/cameras`, click into a camera. Within a few seconds you should hear the room audio in your browser. Pi 5 log: `cameraAudioBridge[<cameraId>] first audio RTP packet received on port <port>`. Browser console should show no errors. Volume is governed by your device's system volume; the **System output** toggle in the audio panel acts as a per-tab mute.
2. **Talk direction (single browser).**
   - Take control of the camera (the existing PTZ / take-control flow).
   - Toggle the **Mic uplink** switch ON. Browser will prompt for microphone permission — approve.
   - Speak into your laptop/phone. Voice should come out of the Pi Zero speaker.
   - Pi Zero log: `[audio-subscriber]` lines. ffmpeg log lines (with `audioPipeline` debug flag toggled in the cameras-page debug panel) should show frames flowing.
   - Toggle Mic uplink OFF. Speaker should go silent within ~1 second.
3. **Talk direction (two browsers, ownership lock).**
   - Browser A: hold control + mic on.
   - Browser B (different user): the **Mic uplink** toggle should be disabled, with a "<user A's name> is talking" caption underneath.
   - Browser A: release control. Browser B's toggle should re-enable.
4. **Recording with mixed audio.**
   - Browser A holds control + mic on.
   - Click "Start recording". Speak for ~10 seconds. Click "Stop recording".
   - Open the resulting `.mp4` in VLC. Confirm:
     - Video plays normally (H.264).
     - Audio track is present and contains BOTH the room ambient (camera mic) AND the talker's voice mixed together.
   - If audio is missing entirely, check Pi 5 logs for `subscribeAudioIngestRtp` callbacks firing.
5. **Self-heal.** SSH to Pi Zero, `sudo pkill -f "ffmpeg.*libopus"`. Within a few seconds: `AudioPublisher self-heal: ... — restarting (attempt 1/5)` and audio should resume in the browser without page reload.

### G. Commit + ship

Once F.1 through F.5 all pass:

```bash
git add HARDWARE_SUMMARY.md \
        pi_zero_2w/.env.example pi_zero_2w/run.py \
        pi_zero_2w/camera_node/{audio_publisher.py,audio_subscriber.py,config.py,log_flags.py,command_executor.py} \
        pi_zero_2w/camera_node/adapters/{base.py,raspberry_pi_adapter.py,mock_adapter.py} \
        server/utils/{cameraAudioBridge.ts,cameraWebrtcBridge.ts,cameraStreamOrchestrator.ts,cameraRecordingManager.ts,cameraMicState.ts,cameraLogFlagStore.ts} \
        src/cameras/_api/setMicEnabled_v1.ts \
        src/cameras/_sync/micEnabledChanged_server_v1.ts \
        src/cameras/page.tsx \
        src/_locales/*.json \
        .env_template
git commit -m "2-way audio: I2S INMP441 mic + MAX98357A speaker, control-session-gated talk, mixed audio in recordings"
```

(Do NOT add `.env` — it has secrets and the dev-only `=1` cadence override; only commit `.env_template`.)

If you also want to commit the prior-session `cameraThumbnailExtractor.ts` change at the same time, decide whether it logically belongs in this commit or a separate one before staging.

## User action required

These are the things only you can do:

1. **Hardware:** rewire IR (Step A) and wire I²S (Step B) physically.
2. **OS config:** edit `/boot/firmware/config.txt` and reboot the Pi Zero (Step C).
3. **Bus loopback test:** run the `arecord | aplay` round-trip (Step D) before touching camera_node code.
4. **Deploy:** `git pull` on both hosts, `npm run build` on Pi 5, edit Pi Zero `.env` to flip `IR_GPIO_PIN=17` and set `AUDIO_INPUT_DEVICE` / `AUDIO_OUTPUT_DEVICE`, restart both services (Step E).
5. **Verify:** F.1 through F.5 — listen, talk, lock, recording, self-heal.
6. **Decide on commit shape** for Step G (one cohesive 2-way-audio commit, or split out the thumbnail extractor change).

If anything in F fails, capture the relevant `journalctl` excerpt (Pi 5 + Pi Zero) and the browser console errors before retrying — the failure mode tells me exactly which subsystem to look at next.
