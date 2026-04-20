from __future__ import annotations

import io
import signal
import threading
from typing import Iterator

from flask import Flask, Response, request
from picamera2 import Picamera2
from picamera2.encoders import JpegEncoder
from picamera2.outputs import FileOutput

WIDTH = 960
HEIGHT = 540
FPS = 30
PORT = 8080

app = Flask(__name__)

picam2 = Picamera2()
running = True


class StreamingOutput(io.BufferedIOBase):
    def __init__(self) -> None:
        self._condition = threading.Condition()
        self._frame = b""

    def writable(self) -> bool:
        return True

    def write(self, buffer: bytes) -> int:
        with self._condition:
            self._frame = buffer
            self._condition.notify_all()
        return len(buffer)

    def get_frame(self) -> bytes:
        with self._condition:
            self._condition.wait(timeout=1)
            return self._frame


output = StreamingOutput()


def configure_camera() -> None:
    config = picam2.create_video_configuration(
        main={"size": (WIDTH, HEIGHT), "format": "YUV420"},
        controls={"FrameRate": FPS},
    )
    picam2.configure(config)
    picam2.start_recording(JpegEncoder(), FileOutput(output))


def stop_camera() -> None:
    try:
        picam2.stop_recording()
    except Exception:
        # ignore shutdown races
        pass


def mjpeg_stream() -> Iterator[bytes]:
    while running:
        frame = output.get_frame()

        if not frame:
            continue

        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n"
            b"Cache-Control: no-cache\r\n\r\n"
            + frame
            + b"\r\n"
        )


@app.get("/")
def index() -> str:
    return """
<!doctype html>
<html lang='en'>
  <head>
    <meta charset='utf-8' />
    <meta name='viewport' content='width=device-width, initial-scale=1' />
    <title>Pi Zero Camera Preview</title>
    <style>
      body { font-family: sans-serif; margin: 0; padding: 20px; background: #111; color: #eee; }
      h1 { margin-top: 0; }
      .video { max-width: 960px; width: 100%; border: 1px solid #333; border-radius: 8px; }
      .muted { color: #aaa; font-size: 14px; }
    </style>
  </head>
  <body>
    <h1>Pi Zero Camera Preview</h1>
    <p class='muted'>Temporary video-only preview for local bring-up.</p>
    <img class='video' src='/stream.mjpg' alt='Pi Zero camera preview' />
  </body>
</html>
"""


@app.get("/stream.mjpg")
def stream_mjpg() -> Response:
    return Response(
        mjpeg_stream(),
        mimetype="multipart/x-mixed-replace; boundary=frame",
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def request_stop(signum: int, frame: object) -> None:  # noqa: ARG001
    global running
    running = False
    output.write(b"")
    stop_camera()
    raise SystemExit(0)


@app.post("/shutdown")
def shutdown() -> tuple[dict[str, str], int]:
    # Keep shutdown local-only so random network clients cannot stop it.
    if request.remote_addr not in {"127.0.0.1", "::1"}:
        return {"status": "error", "message": "shutdown is local-only"}, 403

    global running
    running = False
    output.write(b"")
    stop_camera()

    shutdown_fn = request.environ.get("werkzeug.server.shutdown")
    if callable(shutdown_fn):
        shutdown_fn()

    return {"status": "ok"}, 200


def main() -> None:
    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)

    configure_camera()

    try:
        app.run(host="0.0.0.0", port=PORT, debug=False, threaded=True, use_reloader=False)
    finally:
        global running
        running = False
        stop_camera()


if __name__ == "__main__":
    main()
