import http from 'node:http';
import { spawn } from 'node:child_process';
import { stat, open } from 'node:fs/promises';

import { prisma } from '../functions/db';
import { getSession } from '../functions/session';
import { tryCatch } from '../functions/tryCatch';
import { canControlCamera } from './cameraHelpers';
import { extractTokenFromRequest } from './extractTokenFromRequest';

export const RECORDING_THUMBNAIL_PATH_PREFIX = '/recordings/thumbnail/';

const THUMBNAIL_WIDTH = 320;
const THUMBNAIL_HEIGHT = 180;
const THUMBNAIL_QUALITY = 5; // ffmpeg -q:v scale: lower = better
const FFMPEG_TIMEOUT_MS = 10_000;
// Skip past the first second so the frame isn't a black/empty pre-roll one,
// but fall back to seek=0 if the recording is shorter than 1s.
const SEEK_SECONDS = 1;

const writeJson = (res: http.ServerResponse, status: number, body: unknown): void => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

const thumbnailPathFor = (mp4Path: string): string => `${mp4Path}.thumb.jpg`;

// Run ffmpeg once to extract a single frame to disk. Resolves to true on
// success and false on any failure (process error, non-zero exit, missing
// output file). The caller decides whether to surface a 404 or 500.
const generateThumbnail = async (mp4Path: string, jpegPath: string): Promise<boolean> => {
  const args = [
    '-y',
    '-loglevel', 'error',
    '-ss', String(SEEK_SECONDS),
    '-i', mp4Path,
    '-frames:v', '1',
    '-vf', `scale=${String(THUMBNAIL_WIDTH)}:${String(THUMBNAIL_HEIGHT)}:force_original_aspect_ratio=decrease`,
    '-q:v', String(THUMBNAIL_QUALITY),
    jpegPath,
  ];

  const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });

  const stderrChunks: Buffer[] = [];
  child.stderr.on('data', (chunk: Buffer) => { stderrChunks.push(chunk); });

  const exitCode = await new Promise<number | null>((resolve) => {
    let resolved = false;
    const timeout = globalThis.setTimeout(() => {
      if (resolved) return;
      try { child.kill('SIGKILL'); } catch { /* gone */ }
      resolved = true;
      resolve(null);
    }, FFMPEG_TIMEOUT_MS);
    child.on('exit', (code) => {
      if (resolved) return;
      resolved = true;
      globalThis.clearTimeout(timeout);
      resolve(code);
    });
    child.on('error', () => {
      if (resolved) return;
      resolved = true;
      globalThis.clearTimeout(timeout);
      resolve(null);
    });
  });

  if (exitCode !== 0) {
    const stderrText = Buffer.concat(stderrChunks).toString('utf8').trim();
    console.warn(`[recording-thumbnail] ffmpeg failed code=${String(exitCode)} mp4=${mp4Path} err=${stderrText}`);
    return false;
  }

  // Confirm ffmpeg actually wrote the file (it can exit 0 and not produce
  // output if the input is corrupted past the seek point).
  const [statError, fileStat] = await tryCatch(async () => stat(jpegPath));
  if (statError || !fileStat || fileStat.size === 0) {
    return false;
  }
  return true;
};

export const serveRecordingThumbnail = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  routePath: string,
): Promise<void> => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end();
    return;
  }

  // Strip optional ".jpg" suffix so URLs can be either /thumbnail/{id} or
  // /thumbnail/{id}.jpg — the latter helps browser caches and download UIs
  // pick the right MIME.
  const rawId = routePath.slice(RECORDING_THUMBNAIL_PATH_PREFIX.length).split('/')[0];
  const recordingId = rawId.replace(/\.jpg$/i, '');
  if (!recordingId) {
    writeJson(res, 400, { status: 'error', errorCode: 'recording.invalidId' });
    return;
  }

  let token = extractTokenFromRequest(req);
  if (!token) {
    const rawUrl = req.url ?? '';
    const queryIndex = rawUrl.indexOf('?');
    if (queryIndex !== -1) {
      const queryParams = new URLSearchParams(rawUrl.slice(queryIndex + 1));
      token = queryParams.get('token');
    }
  }
  if (!token) {
    writeJson(res, 401, { status: 'error', errorCode: 'auth.required' });
    return;
  }

  const session = await getSession(token);
  if (!session?.id) {
    writeJson(res, 401, { status: 'error', errorCode: 'auth.required' });
    return;
  }

  const [fetchError, recording] = await tryCatch(async () => {
    return prisma.recording.findUnique({
      where: { id: recordingId },
      select: { id: true, cameraId: true, filePath: true, stoppedAt: true },
    });
  });

  if (fetchError) {
    writeJson(res, 500, { status: 'error', errorCode: 'recording.streamFailed' });
    return;
  }

  if (!recording) {
    writeJson(res, 404, { status: 'error', errorCode: 'recording.notFound' });
    return;
  }

  const [accessError, access] = await tryCatch(async () => {
    if (session.admin) return null;
    return prisma.cameraAccess.findUnique({
      where: { cameraId_userId: { cameraId: recording.cameraId, userId: session.id } },
    });
  });

  if (accessError) {
    writeJson(res, 500, { status: 'error', errorCode: 'recording.streamFailed' });
    return;
  }

  if (!canControlCamera({ isAdmin: session.admin, access })) {
    writeJson(res, 403, { status: 'error', errorCode: 'camera.controlDenied' });
    return;
  }

  // Confirm the source mp4 exists. For an active (still-recording) clip the
  // first second may not be muxed yet, so we still attempt extraction but the
  // ffmpeg call may fail and we'll 404 — the UI keeps the placeholder.
  const [mp4StatError, mp4Stat] = await tryCatch(async () => stat(recording.filePath));
  if (mp4StatError || !mp4Stat) {
    writeJson(res, 404, { status: 'error', errorCode: 'recording.fileMissing' });
    return;
  }

  const jpegPath = thumbnailPathFor(recording.filePath);

  // Cache lookup: serve the existing thumbnail if it's been generated and is
  // newer than the mp4 (so a re-recorded clip with the same path triggers a
  // re-extract).
  const [thumbStatError, thumbStat] = await tryCatch(async () => stat(jpegPath));
  let thumbnailReady = !thumbStatError && thumbStat != null && thumbStat.size > 0
    && thumbStat.mtimeMs >= mp4Stat.mtimeMs;

  if (!thumbnailReady) {
    const generated = await generateThumbnail(recording.filePath, jpegPath);
    if (!generated) {
      writeJson(res, 404, { status: 'error', errorCode: 'recording.thumbnailUnavailable' });
      return;
    }
    thumbnailReady = true;
  }

  const [finalStatError, finalStat] = await tryCatch(async () => stat(jpegPath));
  if (finalStatError || !finalStat) {
    writeJson(res, 500, { status: 'error', errorCode: 'recording.streamFailed' });
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Content-Length', String(finalStat.size));
  // Completed recordings are immutable — let browsers cache aggressively. For
  // active (still-recording) clips we revalidate so a thumbnail re-extract
  // after stop is reflected.
  if (recording.stoppedAt) {
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
  } else {
    res.setHeader('Cache-Control', 'no-cache');
  }

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const [openError, fileHandle] = await tryCatch(async () => open(jpegPath, 'r'));
  if (openError || !fileHandle) {
    if (res.headersSent) {
      res.end();
    } else {
      writeJson(res, 500, { status: 'error', errorCode: 'recording.streamFailed' });
    }
    return;
  }

  const closeHandle = (): void => {
    void fileHandle.close().catch(() => { /* already closed */ });
  };

  const stream = fileHandle.createReadStream();
  stream.on('error', (streamError: Error) => {
    console.error(`[recording-thumbnail] stream error recordingId=${recordingId}`, streamError);
    res.end();
    closeHandle();
  });
  stream.on('close', closeHandle);
  stream.pipe(res);
};
