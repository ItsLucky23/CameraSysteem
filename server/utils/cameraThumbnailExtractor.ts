import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { createSocket } from 'node:dgram';
import { writeFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { tryCatch } from '../functions/tryCatch';
import { emitCameraSyncEvent, getCameraRoomCode } from './cameraHelpers';
import { setThumbnail } from './cameraThumbnailStore';
import { onThumbnailUpdated } from './cameraIRController';
import { subscribeRtp } from './cameraWebrtcBridge';

// Pi 5-side thumbnail extractor. The Pi Zero's rpicam-jpeg path can't share
// the sensor with rpicam-vid, so once a viewer connects and the video stream
// starts, the Pi Zero stops producing thumbnails. This module taps the
// existing RTP stream (same UDP-loopback + SDP pattern as the recording
// manager) and runs ffmpeg with image2pipe MJPEG output to extract one JPEG
// every THUMBNAIL_INTERVAL_SEC. Each frame is stored via setThumbnail and
// broadcast on the cameras-overview + per-camera rooms.

// Tick cadence. Drives both thumbnail broadcast frequency AND the auto-IR
// controller's re-evaluation interval (the controller is invoked from
// handleJpegFrame). 30 in prod; drop to 1 during dev to make auto-IR react
// in near-real-time. Clamped to [1, 600] so a typo in .env can't disable
// the extractor or DoS the broadcast room.
const parseThumbnailIntervalSec = (): number => {
  const raw = process.env.CAMERA_THUMBNAIL_INTERVAL_SEC;
  if (!raw) return 30;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(1, Math.min(600, parsed));
};
const THUMBNAIL_INTERVAL_SEC = parseThumbnailIntervalSec();
const THUMBNAIL_WIDTH = 1280;
const THUMBNAIL_HEIGHT = 720;
const JPEG_QUALITY = 5; // ffmpeg -q:v scale (lower = better; 5 ~ high quality)

// JPEG SOI/EOI markers — used to slice complete frames out of ffmpeg's
// concatenated image2pipe stream.
const SOI_HIGH = 0xff;
const SOI_LOW = 0xd8;
const EOI_LOW = 0xd9;

// Hard ceiling on how often we emit a thumbnail to subscribers. ffmpeg's fps
// filter is supposed to throttle to 1/THUMBNAIL_INTERVAL_SEC, but it relies
// on input timestamps; with the "Timestamps are unset in a packet" warning
// we sometimes see, ffmpeg can emit frames much faster than intended. This
// floor guarantees we never blast the sync rooms even if upstream throttling
// fails. Set just under the lowest sane interval (1s) so a healthy stream
// still passes through.
const MIN_EMIT_INTERVAL_MS = 750;

interface ExtractorState {
  cameraId: string;
  ffmpeg: ChildProcessByStdio<null, Readable, Readable>;
  unsubscribeRtp: () => void;
  cleanup: () => void;
  buffer: Buffer;
  stopping: boolean;
  // Set when ffmpeg's stderr reports "bind failed" — means the loopback port
  // we picked was actually still pending release on the OS. Triggers an
  // immediate fresh-port restart that does NOT consume the retry budget,
  // so the 10/60s cap is reserved for genuine failures (RTP not flowing,
  // codec issues, etc.).
  bindErrorDetected: boolean;
}

interface ExtractorSingleton {
  extractors: Map<string, ExtractorState>;
  // Per-camera ms timestamps of the most recent restart attempts. Used to
  // cap the restart loop at 10 in 60s so a permanently broken stream can't
  // pin a CPU spawning ffmpeg over and over.
  restartAttempts: Map<string, number[]>;
  // Per-camera pending restart timers so we don't stack multiple delayed
  // restarts if exit() fires twice in quick succession.
  restartTimers: Map<string, ReturnType<typeof globalThis.setTimeout>>;
  // Per-camera timestamp of the most recent emitted thumbnail. Used to
  // throttle handleJpegFrame so a misbehaving ffmpeg can't blast the sync
  // rooms (and the auto-IR controller) faster than MIN_EMIT_INTERVAL_MS.
  lastEmitAt: Map<string, number>;
}

const SINGLETON_KEY = '__luckyStackCameraThumbnailExtractorState__';

const scope = globalThis as typeof globalThis & {
  [SINGLETON_KEY]?: ExtractorSingleton;
};

const state: ExtractorSingleton = scope[SINGLETON_KEY] ?? {
  extractors: new Map<string, ExtractorState>(),
  restartAttempts: new Map<string, number[]>(),
  restartTimers: new Map<string, ReturnType<typeof globalThis.setTimeout>>(),
  lastEmitAt: new Map<string, number>(),
};

// Backfill on HMR (existing singleton from before these maps were added).
if (!state.restartAttempts) {
  state.restartAttempts = new Map<string, number[]>();
}
if (!state.restartTimers) {
  state.restartTimers = new Map<string, ReturnType<typeof globalThis.setTimeout>>();
}
if (!state.lastEmitAt) {
  state.lastEmitAt = new Map<string, number>();
}

if (!scope[SINGLETON_KEY]) {
  scope[SINGLETON_KEY] = state;
}

const scheduleRestart = (cameraId: string): void => {
  const now = Date.now();
  const attempts = (state.restartAttempts.get(cameraId) ?? []).filter(
    (t) => now - t < 60_000,
  );
  if (attempts.length >= 10) {
    console.warn(
      `[thumbnail-extractor] giving up on ${cameraId} after ${String(attempts.length)} restarts in 60s — Pi 5 reconciler will retry on next activateCamera`,
    );
    state.restartAttempts.delete(cameraId);
    return;
  }
  attempts.push(now);
  state.restartAttempts.set(cameraId, attempts);

  // Linear backoff capped at 5s. First retry is fast (500ms) because the
  // common case is "ffmpeg exited because RTP wasn't flowing yet" and the
  // Pi Zero usually recovers within a couple of seconds.
  const backoffMs = Math.min(500 * attempts.length, 5_000);
  console.log(
    `[thumbnail-extractor] restarting ${cameraId} in ${String(backoffMs)}ms (attempt ${String(attempts.length)}/10)`,
  );

  const existingTimer = state.restartTimers.get(cameraId);
  if (existingTimer) globalThis.clearTimeout(existingTimer);

  const timer = globalThis.setTimeout(() => {
    state.restartTimers.delete(cameraId);
    void start(cameraId);
  }, backoffMs);
  state.restartTimers.set(cameraId, timer);
};

const handleJpegFrame = (cameraId: string, jpegBytes: Buffer): void => {
  // Hard ceiling on emit rate — see MIN_EMIT_INTERVAL_MS comment. Drops
  // frames silently if we're below the floor (no log spam, no sync flood).
  const now = Date.now();
  const last = state.lastEmitAt.get(cameraId);
  if (last !== undefined && now - last < MIN_EMIT_INTERVAL_MS) {
    return;
  }
  state.lastEmitAt.set(cameraId, now);

  // Healthy frame arrived — reset the restart-attempt history so a future
  // hiccup gets the full 10-retry budget instead of inheriting old failures.
  state.restartAttempts.delete(cameraId);

  const capturedAt = new Date();
  const jpegBase64 = jpegBytes.toString('base64');

  setThumbnail(cameraId, jpegBase64, capturedAt);

  // Drive the auto-IR controller off the same JPEGs we already produce here.
  // Cadence is CAMERA_THUMBNAIL_INTERVAL_SEC (env, default 30s) — set to 1
  // during dev for snappy auto-IR verification at the cost of louder sync
  // broadcasts.
  void onThumbnailUpdated({ cameraId, jpegBase64 });

  const capturedAtIso = capturedAt.toISOString();

  const payload = {
    status: 'success' as const,
    cameraId,
    capturedAt: capturedAtIso,
    jpegBase64,
  };

  emitCameraSyncEvent({
    fullName: 'sync/cameras/thumbnailUpdated/v1',
    receiver: getCameraRoomCode(cameraId),
    serverOutput: payload,
  });

  emitCameraSyncEvent({
    fullName: 'sync/cameras/thumbnailUpdated/v1',
    receiver: 'cameras-overview',
    serverOutput: payload,
  });

  console.log('');
  console.log(
    `[thumbnail] extracted cameraId=${cameraId} bytes=${String(jpegBytes.length)}`,
  );
};

// ffmpeg image2pipe concatenates JPEGs back-to-back. Each frame begins with
// the SOI marker FF D8 and ends with the EOI marker FF D9. We accumulate
// stdout chunks into a buffer, then slice out complete frames as their EOI
// arrives.
const consumeStdoutChunk = (extractor: ExtractorState, chunk: Buffer): void => {
  extractor.buffer = Buffer.concat([extractor.buffer, chunk]);

  let buffer = extractor.buffer;

  while (true) {
    if (buffer.length < 4) break;

    if (buffer[0] !== SOI_HIGH || buffer[1] !== SOI_LOW) {
      // Drop bytes until we find the next SOI. Realigns the stream if a
      // partial frame was dropped or ffmpeg emitted padding.
      const soiIndex = buffer.indexOf(Buffer.from([SOI_HIGH, SOI_LOW]));
      if (soiIndex === -1) {
        buffer = Buffer.alloc(0);
        break;
      }
      buffer = buffer.subarray(soiIndex);
    }

    // Search for EOI starting after the SOI to skip the marker itself.
    let eoiIndex = -1;
    for (let i = 2; i < buffer.length - 1; i += 1) {
      if (buffer[i] === SOI_HIGH && buffer[i + 1] === EOI_LOW) {
        eoiIndex = i;
        break;
      }
    }

    if (eoiIndex === -1) {
      // Incomplete frame — wait for more bytes.
      break;
    }

    const frameEnd = eoiIndex + 2;
    const frame = buffer.subarray(0, frameEnd);
    handleJpegFrame(extractor.cameraId, frame);
    buffer = buffer.subarray(frameEnd);
  }

  extractor.buffer = buffer;
};

const start = async (cameraId: string): Promise<void> => {
  if (state.extractors.has(cameraId)) {
    return;
  }

  // Probe a free UDP port for the loopback hop (same pattern as the
  // recording manager). Bind, read assigned port, close — then ffmpeg can
  // bind the same port for receive. Single-machine deployment, so the
  // narrow race window is acceptable.
  const probeSocket = createSocket('udp4');
  const [probeError] = await tryCatch(async () => {
    return new Promise<void>((resolve, reject) => {
      probeSocket.once('error', reject);
      probeSocket.bind(0, '127.0.0.1', () => {
        probeSocket.removeListener('error', reject);
        resolve();
      });
    });
  });
  if (probeError) {
    console.warn(
      `[thumbnail-extractor] failed to probe UDP port for ${cameraId}: ${probeError.message}`,
    );
    try { probeSocket.close(); } catch { /* ignore */ }
    return;
  }
  const loopbackPort = (probeSocket.address() as { port: number }).port;
  // AWAIT close: probeSocket.close() is async and on Windows the OS keeps
  // the UDP port in a pending-release state for a few ms. If we proceed to
  // spawn ffmpeg before the OS frees the port, ffmpeg's bind hits
  // WSAEADDRINUSE (-10048) and the extractor falls into a retry loop that
  // burns the entire restart budget. Waiting for the 'close' event ensures
  // the socket is fully released before we hand the port to ffmpeg.
  await new Promise<void>((resolve) => {
    probeSocket.once('close', () => resolve());
    probeSocket.close();
  });

  const sdpContent = [
    'v=0',
    'o=- 0 0 IN IP4 127.0.0.1',
    's=Camera Thumbnail',
    'c=IN IP4 127.0.0.1',
    't=0 0',
    `m=video ${String(loopbackPort)} RTP/AVP 96`,
    'a=rtpmap:96 H264/90000',
    'a=fmtp:96 packetization-mode=1',
    '',
  ].join('\n');

  const sdpPath = path.join(os.tmpdir(), `thumbnail-${cameraId}.sdp`);
  const [sdpWriteError] = await tryCatch(async () => writeFile(sdpPath, sdpContent, 'utf8'));
  if (sdpWriteError) {
    console.warn(
      `[thumbnail-extractor] failed to write SDP for ${cameraId}: ${sdpWriteError.message}`,
    );
    return;
  }

  const ffmpegArgs = [
    '-loglevel', 'warning',
    '-protocol_whitelist', 'file,udp,rtp',
    '-f', 'sdp',
    '-i', sdpPath,
    '-vf', `fps=1/${String(THUMBNAIL_INTERVAL_SEC)},scale=${String(THUMBNAIL_WIDTH)}:${String(THUMBNAIL_HEIGHT)}`,
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    '-q:v', String(JPEG_QUALITY),
    'pipe:1',
  ];

  let ffmpegProcess: ChildProcessByStdio<null, Readable, Readable>;
  try {
    ffmpegProcess = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (spawnError) {
    void tryCatch(async () => unlink(sdpPath));
    console.error(`[thumbnail-extractor] ffmpeg spawn failed for ${cameraId}`, spawnError);
    return;
  }

  ffmpegProcess.stderr.on('data', (chunk: Buffer) => {
    const line = chunk.toString('utf8').trim();
    if (line.length > 0) {
      console.log(`[thumbnail-extractor] ffmpeg[${cameraId}]: ${line}`);
    }
    // Detect bind contention so the on('exit') handler can re-probe a fresh
    // port immediately instead of treating this as a real ffmpeg failure.
    if (line.includes('bind failed')) {
      const current = state.extractors.get(cameraId);
      if (current) current.bindErrorDetected = true;
    }
  });

  // Forward each RTP packet from the bridge subscription to the loopback
  // port ffmpeg is reading on.
  const sendSocket = createSocket('udp4');
  const writeRtp = (rtpBytes: Buffer): void => {
    sendSocket.send(rtpBytes, loopbackPort, '127.0.0.1', (sendError) => {
      if (sendError) {
        console.warn(
          `[thumbnail-extractor] udp send failed for ${cameraId}: ${sendError.message}`,
        );
      }
    });
  };

  const unsubscribeFromBridge = subscribeRtp(cameraId, (rtpBytes) => {
    writeRtp(rtpBytes);
  });

  const extractor: ExtractorState = {
    cameraId,
    ffmpeg: ffmpegProcess,
    unsubscribeRtp: () => {
      unsubscribeFromBridge();
      try { sendSocket.close(); } catch { /* already closed */ }
      void tryCatch(async () => unlink(sdpPath));
    },
    cleanup: () => {
      // Replaced once ffmpeg exits; placeholder so the type is non-nullable.
    },
    buffer: Buffer.alloc(0),
    stopping: false,
    bindErrorDetected: false,
  };

  ffmpegProcess.stdout.on('data', (chunk: Buffer) => {
    consumeStdoutChunk(extractor, chunk);
  });

  ffmpegProcess.on('exit', (code, signal) => {
    const current = state.extractors.get(cameraId);
    if (!current || current !== extractor) return;
    state.extractors.delete(cameraId);
    extractor.unsubscribeRtp();
    if (!extractor.stopping) {
      console.warn(
        `[thumbnail-extractor] ffmpeg exited unexpectedly cameraId=${cameraId} code=${String(code)} signal=${String(signal)} bindError=${String(extractor.bindErrorDetected)}`,
      );
      if (extractor.bindErrorDetected) {
        // Port-allocation race (loopback port still pending release on
        // Windows when ffmpeg tried to bind it). NOT a real failure — re-
        // probe immediately with a fresh port and DO NOT consume the
        // retry budget. The 10/60s cap stays reserved for actual failures
        // (RTP not flowing, codec issues, etc.).
        const existingTimer = state.restartTimers.get(cameraId);
        if (existingTimer) globalThis.clearTimeout(existingTimer);
        const timer = globalThis.setTimeout(() => {
          state.restartTimers.delete(cameraId);
          void start(cameraId);
        }, 100);
        state.restartTimers.set(cameraId, timer);
        return;
      }
      // Real failure: ffmpeg gives up when RTP isn't flowing (cold start,
      // Pi Zero retry cycle) because it can't find codec parameters.
      // Without this the extractor stays dead even after the Pi Zero
      // recovers, breaking thumbnails AND auto-IR (which fires off each
      // incoming JPEG via handleJpegFrame).
      scheduleRestart(cameraId);
    }
  });

  state.extractors.set(cameraId, extractor);
  console.log(
    `[thumbnail-extractor] start cameraId=${cameraId} loopbackPort=${String(loopbackPort)} intervalSec=${String(THUMBNAIL_INTERVAL_SEC)}`,
  );
};

const stop = async (cameraId: string): Promise<void> => {
  // Cancel any pending restart so a manual stop isn't followed by an
  // automatic restart from the backoff timer.
  const pendingTimer = state.restartTimers.get(cameraId);
  if (pendingTimer) {
    globalThis.clearTimeout(pendingTimer);
    state.restartTimers.delete(cameraId);
  }
  state.restartAttempts.delete(cameraId);
  state.lastEmitAt.delete(cameraId);

  const extractor = state.extractors.get(cameraId);
  if (!extractor) return;

  extractor.stopping = true;
  extractor.unsubscribeRtp();

  await new Promise<void>((resolve) => {
    let resolved = false;
    const finalize = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };
    extractor.ffmpeg.once('exit', () => finalize());
    try {
      extractor.ffmpeg.kill('SIGTERM');
    } catch {
      finalize();
      return;
    }
    globalThis.setTimeout(() => {
      if (!resolved) {
        try { extractor.ffmpeg.kill('SIGKILL'); } catch { /* gone */ }
        finalize();
      }
    }, 2_000);
  });

  state.extractors.delete(cameraId);
  console.log(`[thumbnail-extractor] stop cameraId=${cameraId}`);
};

export const cameraThumbnailExtractor = {
  start,
  stop,
};
