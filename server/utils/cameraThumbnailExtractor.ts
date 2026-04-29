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

const THUMBNAIL_INTERVAL_SEC = 30;
const THUMBNAIL_WIDTH = 1280;
const THUMBNAIL_HEIGHT = 720;
const JPEG_QUALITY = 5; // ffmpeg -q:v scale (lower = better; 5 ~ high quality)

// JPEG SOI/EOI markers — used to slice complete frames out of ffmpeg's
// concatenated image2pipe stream.
const SOI_HIGH = 0xff;
const SOI_LOW = 0xd8;
const EOI_LOW = 0xd9;

interface ExtractorState {
  cameraId: string;
  ffmpeg: ChildProcessByStdio<null, Readable, Readable>;
  unsubscribeRtp: () => void;
  cleanup: () => void;
  buffer: Buffer;
  stopping: boolean;
}

interface ExtractorSingleton {
  extractors: Map<string, ExtractorState>;
}

const SINGLETON_KEY = '__luckyStackCameraThumbnailExtractorState__';

const scope = globalThis as typeof globalThis & {
  [SINGLETON_KEY]?: ExtractorSingleton;
};

const state: ExtractorSingleton = scope[SINGLETON_KEY] ?? {
  extractors: new Map<string, ExtractorState>(),
};

if (!scope[SINGLETON_KEY]) {
  scope[SINGLETON_KEY] = state;
}

const handleJpegFrame = (cameraId: string, jpegBytes: Buffer): void => {
  const capturedAt = new Date();
  const jpegBase64 = jpegBytes.toString('base64');

  setThumbnail(cameraId, jpegBase64, capturedAt);

  // Drive the auto-IR controller off the same JPEGs we already produce here.
  // Cadence is THUMBNAIL_INTERVAL_SEC (30s by default) — drop that constant
  // for snappier auto-IR reaction at the cost of more sync broadcasts.
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
  probeSocket.close();

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
        `[thumbnail-extractor] ffmpeg exited unexpectedly cameraId=${cameraId} code=${String(code)} signal=${String(signal)}`,
      );
    }
  });

  state.extractors.set(cameraId, extractor);
  console.log(`[thumbnail-extractor] start cameraId=${cameraId} loopbackPort=${String(loopbackPort)}`);
};

const stop = async (cameraId: string): Promise<void> => {
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
