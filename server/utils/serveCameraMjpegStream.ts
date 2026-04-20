import { IncomingMessage, ServerResponse } from 'http';

import { prisma } from '../functions/db';
import redis from '../functions/redis';
import { tryCatch } from '../functions/tryCatch';
import { getCameraPreviewTokenKey } from './cameraHelpers';

interface PreviewTokenPayload {
  cameraId: string;
  userId: string;
  expiresAt: string;
}

const writeJsonError = ({
  res,
  httpStatus,
  errorCode,
}: {
  res: ServerResponse;
  httpStatus: number;
  errorCode: string;
}) => {
  if (res.writableEnded || res.destroyed) {
    return;
  }

  if (!res.headersSent) {
    res.writeHead(httpStatus, { 'Content-Type': 'application/json; charset=utf-8' });
  }

  res.end(JSON.stringify({
    status: 'error',
    httpStatus,
    errorCode,
    message: errorCode,
  }));
};

const isValidHttpUrl = async (value: string): Promise<boolean> => {
  const [parseError, parsedUrl] = await tryCatch(() => {
    return new URL(value);
  });

  if (parseError || !parsedUrl) {
    return false;
  }

  return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
};

export const serveCameraMjpegStream = async ({
  req,
  res,
  params,
}: {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, unknown>;
}) => {
  const cameraId = typeof params.cameraId === 'string' ? params.cameraId.trim() : '';
  const previewToken = typeof params.previewToken === 'string' ? params.previewToken.trim() : '';

  if (!cameraId || !previewToken) {
    writeJsonError({ res, httpStatus: 400, errorCode: 'camera.invalidInput' });
    return;
  }

  const [tokenReadError, rawTokenPayload] = await tryCatch(async () => {
    return redis.get(getCameraPreviewTokenKey(previewToken));
  });

  if (tokenReadError || !rawTokenPayload) {
    writeJsonError({ res, httpStatus: 403, errorCode: 'camera.previewTokenInvalid' });
    return;
  }

  const [tokenParseError, tokenPayload] = await tryCatch(() => {
    return JSON.parse(rawTokenPayload) as PreviewTokenPayload;
  });

  if (tokenParseError || !tokenPayload) {
    writeJsonError({ res, httpStatus: 403, errorCode: 'camera.previewTokenInvalid' });
    return;
  }

  if (tokenPayload.cameraId !== cameraId) {
    writeJsonError({ res, httpStatus: 403, errorCode: 'camera.previewTokenInvalid' });
    return;
  }

  const expiresAtMs = Date.parse(tokenPayload.expiresAt);
  if (Number.isNaN(expiresAtMs) || expiresAtMs <= Date.now()) {
    writeJsonError({ res, httpStatus: 403, errorCode: 'camera.previewTokenInvalid' });
    return;
  }

  const [cameraReadError, camera] = await tryCatch(async () => {
    return prisma.camera.findUnique({
      where: { id: cameraId },
      select: {
        id: true,
        streamUrl: true,
      },
    });
  });

  if (cameraReadError) {
    writeJsonError({ res, httpStatus: 500, errorCode: 'camera.unexpectedError' });
    return;
  }

  if (!camera) {
    writeJsonError({ res, httpStatus: 404, errorCode: 'camera.notFound' });
    return;
  }

  const streamUrl = camera.streamUrl.trim();
  if (!streamUrl || !(await isValidHttpUrl(streamUrl))) {
    writeJsonError({ res, httpStatus: 503, errorCode: 'camera.streamUnavailable' });
    return;
  }

  const controller = new AbortController();
  const abortUpstream = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  req.on('close', abortUpstream);
  req.on('aborted', abortUpstream);

  const [upstreamError, upstreamResponse] = await tryCatch(async () => {
    return fetch(streamUrl, {
      method: 'GET',
      headers: {
        'Cache-Control': 'no-cache',
      },
      signal: controller.signal,
    });
  });

  if (upstreamError || !upstreamResponse || !upstreamResponse.ok || !upstreamResponse.body) {
    req.off('close', abortUpstream);
    req.off('aborted', abortUpstream);
    writeJsonError({ res, httpStatus: 502, errorCode: 'camera.streamUnavailable' });
    return;
  }

  const contentType = upstreamResponse.headers.get('content-type') ?? 'multipart/x-mixed-replace; boundary=frame';

  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
  });

  const reader = upstreamResponse.body.getReader();

  while (!res.writableEnded && !res.destroyed) {
    const [readError, chunkResult] = await tryCatch(async () => {
      return reader.read();
    });

    if (readError || !chunkResult || chunkResult.done) {
      break;
    }

    if (!chunkResult.value || chunkResult.value.length === 0) {
      continue;
    }

    const canContinue = res.write(Buffer.from(chunkResult.value));

    if (!canContinue) {
      await new Promise<void>((resolve) => {
        res.once('drain', () => resolve());
      });
    }
  }

  abortUpstream();
  req.off('close', abortUpstream);
  req.off('aborted', abortUpstream);

  if (!res.writableEnded && !res.destroyed) {
    res.end();
  }
};

export default serveCameraMjpegStream;
