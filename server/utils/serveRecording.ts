import http from 'node:http';
import { stat, open } from 'node:fs/promises';

import { prisma } from '../functions/db';
import { getSession } from '../functions/session';
import { tryCatch } from '../functions/tryCatch';
import { canControlCamera } from './cameraHelpers';
import { extractTokenFromRequest } from './extractTokenFromRequest';

export const RECORDING_STREAM_PATH_PREFIX = '/recordings/stream/';

const writeJson = (res: http.ServerResponse, status: number, body: unknown): void => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

export const serveRecording = async (
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

  const recordingId = routePath.slice(RECORDING_STREAM_PATH_PREFIX.length).split('/')[0];
  if (!recordingId) {
    writeJson(res, 400, { status: 'error', errorCode: 'recording.invalidId' });
    return;
  }

  // The <video src=...> element cannot send Authorization headers. Accept a
  // ?token=... query-string as a fallback so dev (sessionBasedToken=true)
  // playback works. Cookie/Bearer modes still take precedence when present.
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
      select: { id: true, cameraId: true, filePath: true },
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

  if (!canControlCamera({ isAdmin: Boolean(session.admin), access })) {
    writeJson(res, 403, { status: 'error', errorCode: 'camera.controlDenied' });
    return;
  }

  const [statError, fileStat] = await tryCatch(async () => stat(recording.filePath));
  if (statError || !fileStat) {
    writeJson(res, 404, { status: 'error', errorCode: 'recording.fileMissing' });
    return;
  }

  const totalSize = fileStat.size;
  const rangeHeader = req.headers.range;

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Accept-Ranges', 'bytes');
  // Recordings are mutable while in progress (ffmpeg appends to the file). Tell
  // proxies and browsers not to cache so seek-back during recording stays fresh.
  res.setHeader('Cache-Control', 'no-cache');

  let start = 0;
  let end = totalSize - 1;
  let isPartial = false;

  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!match) {
      res.statusCode = 416;
      res.setHeader('Content-Range', `bytes */${String(totalSize)}`);
      res.end();
      return;
    }
    const rawStart = match[1];
    const rawEnd = match[2];
    if (rawStart === '' && rawEnd === '') {
      res.statusCode = 416;
      res.setHeader('Content-Range', `bytes */${String(totalSize)}`);
      res.end();
      return;
    }

    if (rawStart === '' && rawEnd !== '') {
      // Suffix range: last N bytes
      const suffix = Number.parseInt(rawEnd, 10);
      if (!Number.isFinite(suffix) || suffix <= 0) {
        res.statusCode = 416;
        res.setHeader('Content-Range', `bytes */${String(totalSize)}`);
        res.end();
        return;
      }
      start = Math.max(0, totalSize - suffix);
      end = totalSize - 1;
    } else {
      const parsedStart = Number.parseInt(rawStart, 10);
      if (!Number.isFinite(parsedStart) || parsedStart < 0 || parsedStart >= totalSize) {
        res.statusCode = 416;
        res.setHeader('Content-Range', `bytes */${String(totalSize)}`);
        res.end();
        return;
      }
      start = parsedStart;
      if (rawEnd !== '') {
        const parsedEnd = Number.parseInt(rawEnd, 10);
        if (!Number.isFinite(parsedEnd) || parsedEnd < start) {
          res.statusCode = 416;
          res.setHeader('Content-Range', `bytes */${String(totalSize)}`);
          res.end();
          return;
        }
        end = Math.min(parsedEnd, totalSize - 1);
      }
    }
    isPartial = true;
  }

  const contentLength = end - start + 1;

  if (isPartial) {
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${String(start)}-${String(end)}/${String(totalSize)}`);
  } else {
    res.statusCode = 200;
  }
  res.setHeader('Content-Length', String(contentLength));

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const [openError, fileHandle] = await tryCatch(async () => open(recording.filePath, 'r'));
  if (openError || !fileHandle) {
    if (!res.headersSent) {
      writeJson(res, 500, { status: 'error', errorCode: 'recording.streamFailed' });
    } else {
      res.end();
    }
    return;
  }

  const stream = fileHandle.createReadStream({ start, end });
  stream.on('error', (streamError: Error) => {
    console.error(`[recording] stream error recordingId=${recordingId}`, streamError);
    res.end();
    void fileHandle.close().catch(() => undefined);
  });
  stream.on('close', () => {
    void fileHandle.close().catch(() => undefined);
  });
  stream.pipe(res);
};
