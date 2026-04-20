# Pi Zero Video-Only Localhost Quickstart

Goal: show Pi Zero camera video in your browser today with minimum setup.

Scope for this quickstart:

- includes camera video only
- skips PTZ, IR, motion detection, and full production signaling flow

## Device Roles

- Pi Zero 2W: capture camera and host temporary MJPEG preview server
- Home computer: open browser and optionally tunnel as localhost
- Pi5: not required for this quickstart

## 1. Copy Preview Script To Pi Zero

From your home computer in repo root:

```powershell
scp pi_zero_2w/video_only_preview_server.py pi@<PI_ZERO_IP>:~/video_only_preview_server.py
```

Replace `<PI_ZERO_IP>` with your Pi Zero local IP.

## 2. Install Packages On Pi Zero

SSH into Pi Zero:

```bash
ssh pi@<PI_ZERO_IP>
```

Install required packages:

```bash
sudo apt update
sudo apt install -y python3-flask python3-picamera2
```

Optional camera sanity check (either command can work depending on OS image):

```bash
rpicam-hello -t 3000 || libcamera-hello -t 3000
```

## 3. Start Temporary Preview Server On Pi Zero

Run:

```bash
python3 ~/video_only_preview_server.py
```

If it starts correctly, it listens on port `8080`.

## 4. Open Video In Browser

Option A: direct network URL from home computer:

- `http://<PI_ZERO_IP>:8080`

Option B: localhost URL via SSH tunnel (recommended if you specifically want localhost):

From home computer, open a new terminal and run:

```powershell
ssh -N -L 8080:localhost:8080 pi@<PI_ZERO_IP>
```

Then open:

- `http://localhost:8080`

## 5. Stop Server

On Pi Zero terminal, press `Ctrl + C`.

## 6. Troubleshooting

1. Browser shows no image:
- confirm script is still running on Pi Zero
- confirm Pi Zero camera ribbon is seated correctly
- run `rpicam-hello -t 3000 || libcamera-hello -t 3000` again

2. Package install fails for `python3-picamera2`:
- run `sudo apt update && sudo apt full-upgrade -y`
- reboot and retry installation

3. Tunnel works but page does not load:
- check no local app already uses port 8080 on home computer

## 7. Next Step After This Works

After video works in this quickstart path, move to the full WebRTC integration:

1. Keep this script as camera sanity verification only.
2. Configure and run your WebRTC signaling service (the Pi5 API calls it via `CAMERA_WEBRTC_SIGNALING_URL`).
3. Point your Pi Zero media pipeline to that signaling service.
4. Run LuckyStack locally on your home computer (client + server).
5. Open `/cameras`, request a preview session, then start preview.

Important:

- `/cameras` now uses the WebRTC preview path.
- The MJPEG endpoint is a temporary/local verification path and is not the primary monitor transport.
