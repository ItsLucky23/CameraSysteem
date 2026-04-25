import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, stat, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createSocket } from 'node:dgram';

import { prisma } from '../functions/db';
import { tryCatch } from '../functions/tryCatch';
import {
  addRecordingReservation,
  ensureCameraActive,
  removeRecordingReservation,
} from './cameraStreamOrchestrator';
import { subscribeRtp } from './cameraWebrtcBridge';
import { emitCameraSyncEvent, getCameraRoomCode } from './cameraHelpers';

type StopReason =
  | 'manual'
  | 'expired'
  | 'cameraOffline'
  | 'serverShutdown'
  | 'noStream'
  | 'ffmpegExit'
  | 'error';

const RECORDING_BASE_DIR = path.resolve(process.cwd(), 'recordings');
const RECORDING_MAX_DURATION_MS = 60 * 60 * 1000;
const NO_RTP_TIMEOUT_MS = 60_000;
const NO_RTP_CHECK_INTERVAL_MS = 5_000;
const FFMPEG_GRACEFUL_EXIT_MS = 5_000;

interface ActiveRecording {
  recordingId: string;
  cameraId: string;
  filePath: string;
  startedAt: number;
  startedByUserId: string;
  ffmpeg: ChildProcessWithoutNullStreams;
  unsubscribeRtp: () => void;
  expirationTimer: ReturnType<typeof globalThis.setTimeout>;
  noRtpTimer: ReturnType<typeof globalThis.setInterval>;
  lastRtpAt: number | null;
  stopping: boolean;
}

interface RecordingManagerSingleton {
  recordings: Map<string, ActiveRecording>;
}

const SINGLETON_KEY = '__luckyStackCameraRecordingManagerState__';

const managerScope = globalThis as typeof globalThis & {
  [SINGLETON_KEY]?: RecordingManagerSingleton;
};

const managerState: RecordingManagerSingleton = managerScope[SINGLETON_KEY] ?? {
  recordings: new Map<string, ActiveRecording>(),
};

if (!managerScope[SINGLETON_KEY]) {
  managerScope[SINGLETON_KEY] = managerState;
}

const padTwo = (value: number): string => String(value).padStart(2, '0');

const buildFilePath = (cameraId: string, startedAt: Date, recordingId: string): string => {
  const yyyy = startedAt.getFullYear();
  const mm = padTwo(startedAt.getMonth() + 1);
  const dd = padTwo(startedAt.getDate());
  const hh = padTwo(startedAt.getHours());
  const min = padTwo(startedAt.getMinutes());
  const ss = padTwo(startedAt.getSeconds());
  const fileName = `${hh}-${min}-${ss}-${recordingId}.mp4`;
  return path.join(RECORDING_BASE_DIR, cameraId, `${String(yyyy)}-${mm}-${dd}`, fileName);
};

const broadcastRecordingStatus = (params: {
  cameraId: string;
  recordingId: string | null;
  startedAt: string | null;
  startedByUserId: string | null;
}): void => {
  const payload = {
    status: 'success',
    cameraId: params.cameraId,
    recordingId: params.recordingId,
    startedAt: params.startedAt,
    startedByUserId: params.startedByUserId,
  };

  emitCameraSyncEvent({
    fullName: 'sync/cameras/recordingStatus/v1',
    receiver: getCameraRoomCode(params.cameraId),
    serverOutput: payload,
  });

  emitCameraSyncEvent({
    fullName: 'sync/cameras/recordingStatus/v1',
    receiver: 'cameras-overview',
    serverOutput: payload,
  });
};

const finalizeRecordingRow = async (
  recordingId: string,
  filePath: string,
  startedAt: number,
  reason: StopReason,
): Promise<void> => {
  const stoppedAt = new Date();
  const durationMs = stoppedAt.getTime() - startedAt;

  const [statError, fileStat] = await tryCatch(async () => {
    return stat(filePath);
  });

  const fileSizeBytes = !statError && fileStat ? fileStat.size : null;

  await tryCatch(async () => {
    return prisma.recording.update({
      where: { id: recordingId },
      data: {
        stoppedAt,
        durationMs,
        fileSizeBytes,
        stopReason: reason,
      },
    });
  });
};

const startRecording = async (params: {
  cameraId: string;
  userId: string;
}): Promise<
  | { status: 'success'; recordingId: string; startedAt: string; alreadyActive: boolean }
  | { status: 'error'; errorCode: 'recording.cameraNotFound' | 'recording.startFailed' }
> => {
  const { cameraId, userId } = params;

  const existing = managerState.recordings.get(cameraId);
  if (existing) {
    return {
      status: 'success',
      recordingId: existing.recordingId,
      startedAt: new Date(existing.startedAt).toISOString(),
      alreadyActive: true,
    };
  }

  const [cameraError, camera] = await tryCatch(async () => {
    return prisma.camera.findUnique({ where: { id: cameraId }, select: { id: true } });
  });
  if (cameraError || !camera) {
    return { status: 'error', errorCode: 'recording.cameraNotFound' };
  }

  const startedAtDate = new Date();

  const [createError, recording] = await tryCatch(async () => {
    return prisma.recording.create({
      data: {
        cameraId,
        startedByUserId: userId,
        startedAt: startedAtDate,
        filePath: '',
      },
    });
  });

  if (createError || !recording) {
    console.error(`[recording] failed to create recording row for ${cameraId}`, createError);
    return { status: 'error', errorCode: 'recording.startFailed' };
  }

  const filePath = buildFilePath(cameraId, startedAtDate, recording.id);

  const [mkdirError] = await tryCatch(async () => {
    return mkdir(path.dirname(filePath), { recursive: true });
  });
  if (mkdirError) {
    await tryCatch(async () => {
      return prisma.recording.update({
        where: { id: recording.id },
        data: { stoppedAt: new Date(), stopReason: 'error' },
      });
    });
    console.error(`[recording] failed to mkdir ${path.dirname(filePath)}`, mkdirError);
    return { status: 'error', errorCode: 'recording.startFailed' };
  }

  await tryCatch(async () => {
    return prisma.recording.update({
      where: { id: recording.id },
      data: { filePath },
    });
  });

  // Reserve the camera stream BEFORE spawning ffmpeg so RTP starts flowing
  // (if it wasn't already) while ffmpeg sets up its mp4 muxer. The reservation
  // is a pure flag flip; ensureCameraActive is what actually pokes the
  // orchestrator into starting the Pi Zero stream when nobody is previewing.
  addRecordingReservation(cameraId);
  await ensureCameraActive(cameraId);

  // We feed ffmpeg the existing werift RTP packets via a UDP loopback hop
  // rather than re-decoding to H.264 on our side. Pi 5 already parses RTP for
  // the WebRTC fan-out; the bridge's subscribeRtp callback hands us each raw
  // packet, we forward it to a loopback UDP port, and ffmpeg demuxes RTP from
  // that port using a plain SDP file. `-c copy -f mp4` writes the bitstream
  // straight to disk with no re-encode.
  //
  // Bind a temporary recv socket to grab a free ephemeral port, then close it
  // so ffmpeg can bind the same port. The narrow race window (port could be
  // grabbed by another process) is acceptable in this single-machine
  // deployment.
  const probeSocket = createSocket('udp4');
  await new Promise<void>((resolve, reject) => {
    probeSocket.once('error', reject);
    probeSocket.bind(0, '127.0.0.1', () => {
      probeSocket.removeListener('error', reject);
      resolve();
    });
  });
  const loopbackPort = (probeSocket.address() as { port: number }).port;
  probeSocket.close();

  const sdpContent = [
    'v=0',
    'o=- 0 0 IN IP4 127.0.0.1',
    's=Camera Recording',
    'c=IN IP4 127.0.0.1',
    't=0 0',
    `m=video ${String(loopbackPort)} RTP/AVP 96`,
    'a=rtpmap:96 H264/90000',
    'a=fmtp:96 packetization-mode=1',
    '',
  ].join('\n');

  const sdpPath = path.join(os.tmpdir(), `recording-${recording.id}.sdp`);
  const [sdpWriteError] = await tryCatch(async () => writeFile(sdpPath, sdpContent, 'utf8'));
  if (sdpWriteError) {
    removeRecordingReservation(cameraId);
    await tryCatch(async () => {
      return prisma.recording.update({
        where: { id: recording.id },
        data: { stoppedAt: new Date(), stopReason: 'error' },
      });
    });
    console.error(`[recording] failed to write SDP for ${recording.id}`, sdpWriteError);
    return { status: 'error', errorCode: 'recording.startFailed' };
  }

  const ffmpegArgs = [
    '-loglevel', 'warning',
    '-protocol_whitelist', 'file,udp,rtp',
    '-f', 'sdp',
    '-i', sdpPath,
    '-c', 'copy',
    '-movflags', '+faststart+frag_keyframe+empty_moov',
    '-f', 'mp4',
    filePath,
  ];

  let ffmpegProcess: ChildProcessWithoutNullStreams;
  try {
    // Open stdin as a pipe so we can send 'q\n' for a graceful shutdown that
    // finalizes the mp4 moov atom. SIGINT is the fallback if 'q' fails.
    ffmpegProcess = spawn('ffmpeg', ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (spawnError) {
    removeRecordingReservation(cameraId);
    await tryCatch(async () => unlink(sdpPath));
    await tryCatch(async () => {
      return prisma.recording.update({
        where: { id: recording.id },
        data: { stoppedAt: new Date(), stopReason: 'error' },
      });
    });
    console.error(`[recording] ffmpeg spawn failed for ${cameraId}`, spawnError);
    return { status: 'error', errorCode: 'recording.startFailed' };
  }

  ffmpegProcess.stderr.on('data', (chunk: Buffer) => {
    const line = chunk.toString('utf8').trim();
    if (line.length > 0) {
      console.log(`[recording] ffmpeg[${recording.id}]: ${line}`);
    }
  });

  // Push RTP packets to ffmpeg via a fresh send-only loopback socket. The
  // recv-side socket above was just used to grab a free port number.
  const sendSocket = createSocket('udp4');
  const writeRtp = (rtpBytes: Buffer): void => {
    sendSocket.send(rtpBytes, loopbackPort, '127.0.0.1', (sendError) => {
      if (sendError) {
        // Logged but non-fatal — packet drops are the same as UDP wire loss.
        console.warn(`[recording] udp send failed for ${recording.id}: ${sendError.message}`);
      }
    });
  };

  const unsubscribeRtpFromBridge = subscribeRtp(cameraId, (rtpBytes) => {
    const active = managerState.recordings.get(cameraId);
    if (active) {
      active.lastRtpAt = Date.now();
    }
    writeRtp(rtpBytes);
  });

  const unsubscribeRtp = (): void => {
    unsubscribeRtpFromBridge();
    try {
      sendSocket.close();
    } catch {
      /* socket may already be closed */
    }
    void tryCatch(async () => unlink(sdpPath));
  };

  const expirationTimer = globalThis.setTimeout(() => {
    void stopRecording({ recordingId: recording.id, reason: 'expired' });
  }, RECORDING_MAX_DURATION_MS);

  const noRtpTimer = globalThis.setInterval(() => {
    const active = managerState.recordings.get(cameraId);
    if (!active) return;
    const reference = active.lastRtpAt ?? active.startedAt;
    if (Date.now() - reference > NO_RTP_TIMEOUT_MS) {
      void stopRecording({ recordingId: active.recordingId, reason: 'noStream' });
    }
  }, NO_RTP_CHECK_INTERVAL_MS);

  const active: ActiveRecording = {
    recordingId: recording.id,
    cameraId,
    filePath,
    startedAt: startedAtDate.getTime(),
    startedByUserId: userId,
    ffmpeg: ffmpegProcess,
    unsubscribeRtp,
    expirationTimer,
    noRtpTimer,
    lastRtpAt: null,
    stopping: false,
  };
  managerState.recordings.set(cameraId, active);

  ffmpegProcess.on('exit', (code, signal) => {
    const current = managerState.recordings.get(cameraId);
    if (!current || current.recordingId !== recording.id) return;
    if (current.stopping) return;
    console.warn(
      `[recording] ffmpeg exited unexpectedly recordingId=${recording.id} code=${String(code)} signal=${String(signal)}`,
    );
    void stopRecording({ recordingId: recording.id, reason: 'ffmpegExit' });
  });

  console.log('');
  console.log(
    `[recording] start cameraId=${cameraId} recordingId=${recording.id} userId=${userId} filePath=${filePath}`,
  );

  broadcastRecordingStatus({
    cameraId,
    recordingId: recording.id,
    startedAt: startedAtDate.toISOString(),
    startedByUserId: userId,
  });

  return {
    status: 'success',
    recordingId: recording.id,
    startedAt: startedAtDate.toISOString(),
    alreadyActive: false,
  };
};

const stopRecording = async (params: {
  recordingId: string;
  reason: StopReason;
}): Promise<{ status: 'success' } | { status: 'error'; errorCode: 'recording.notFound' }> => {
  let active: ActiveRecording | null = null;
  for (const candidate of managerState.recordings.values()) {
    if (candidate.recordingId === params.recordingId) {
      active = candidate;
      break;
    }
  }

  if (!active) {
    // Could be already-stopped or never-active. Still update the row if it
    // exists so the caller's UI moves on.
    await tryCatch(async () => {
      return prisma.recording.update({
        where: { id: params.recordingId },
        data: {
          stoppedAt: new Date(),
          stopReason: params.reason,
        },
      });
    });
    return { status: 'error', errorCode: 'recording.notFound' };
  }

  if (active.stopping) {
    return { status: 'success' };
  }
  active.stopping = true;

  globalThis.clearTimeout(active.expirationTimer);
  globalThis.clearInterval(active.noRtpTimer);

  active.unsubscribeRtp();

  // Graceful ffmpeg shutdown: closing stdin lets ffmpeg flush the moov atom.
  // Fall back to SIGKILL if it doesn't exit within FFMPEG_GRACEFUL_EXIT_MS.
  const ffmpeg = active.ffmpeg;
  await new Promise<void>((resolve) => {
    let resolved = false;
    const finalize = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };
    ffmpeg.once('exit', () => finalize());
    try {
      // ffmpeg listens for 'q' on stdin to quit gracefully; sending SIGINT also
      // works on POSIX. Use stdin if connected, otherwise SIGINT, then SIGKILL
      // as a last resort.
      if (ffmpeg.stdin && !ffmpeg.stdin.destroyed) {
        ffmpeg.stdin.write('q\n');
        ffmpeg.stdin.end();
      } else {
        ffmpeg.kill('SIGINT');
      }
    } catch {
      try { ffmpeg.kill('SIGINT'); } catch { /* already exiting */ }
    }
    globalThis.setTimeout(() => {
      if (!resolved) {
        try { ffmpeg.kill('SIGKILL'); } catch { /* gone */ }
        finalize();
      }
    }, FFMPEG_GRACEFUL_EXIT_MS);
  });

  managerState.recordings.delete(active.cameraId);
  removeRecordingReservation(active.cameraId);

  await finalizeRecordingRow(active.recordingId, active.filePath, active.startedAt, params.reason);

  const durationMs = Date.now() - active.startedAt;
  const [, fileStat] = await tryCatch(async () => stat(active!.filePath));
  const bytes = fileStat ? fileStat.size : 0;

  console.log('');
  console.log(
    `[recording] stop recordingId=${active.recordingId} reason=${params.reason} durationMs=${String(durationMs)} bytes=${String(bytes)}`,
  );

  broadcastRecordingStatus({
    cameraId: active.cameraId,
    recordingId: null,
    startedAt: null,
    startedByUserId: null,
  });

  return { status: 'success' };
};

const getActiveRecording = (
  cameraId: string,
): { id: string; startedAt: Date; startedByUserId: string } | null => {
  const active = managerState.recordings.get(cameraId);
  if (!active) return null;
  return {
    id: active.recordingId,
    startedAt: new Date(active.startedAt),
    startedByUserId: active.startedByUserId,
  };
};

const stopAllOnShutdown = async (): Promise<void> => {
  const ids = Array.from(managerState.recordings.values()).map((r) => r.recordingId);
  if (ids.length === 0) return;
  console.log('');
  console.log(`[recording] stopAllOnShutdown count=${String(ids.length)}`);
  for (const recordingId of ids) {
    // eslint-disable-next-line no-await-in-loop
    await stopRecording({ recordingId, reason: 'serverShutdown' });
  }
};

// Called by cameraOfflineWatcher the moment a camera flips offline. The
// watcher only fires after 15s of telemetry silence so we treat the call as
// authoritative — no extra debounce here.
const notifyCameraOffline = async (cameraId: string): Promise<void> => {
  const active = managerState.recordings.get(cameraId);
  if (!active) return;
  await stopRecording({ recordingId: active.recordingId, reason: 'cameraOffline' });
};

export const cameraRecordingManager = {
  startRecording,
  stopRecording,
  getActiveRecording,
  stopAllOnShutdown,
  notifyCameraOffline,
};

export type { StopReason as RecordingStopReason };
