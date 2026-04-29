import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { tryCatch } from '../../../server/functions/tryCatch';
import { emitCameraSyncEvent, getCameraRoomCode } from '../../../server/utils/cameraHelpers';
import { setThumbnail } from '../../../server/utils/cameraThumbnailStore';
import { onThumbnailUpdated } from '../../../server/utils/cameraIRController';

export const rateLimit: number | false = 240;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: false,
  additional: [],
};

export interface ApiParams {
  data: {
    cameraId?: string;
    cameraIp?: string;
    nodeSecret: string;
    capturedAt: string;
    jpegBase64: string;
  };
  user: SessionLayout;
  functions: Functions;
}

const MAX_BASE64_LENGTH = 800_000;

const startsWithJpegMagic = (decoded: Buffer): boolean => {
  return decoded.length >= 3 && decoded[0] === 0xff && decoded[1] === 0xd8 && decoded[2] === 0xff;
};

export const main = async ({ data, functions }: ApiParams): Promise<ApiResponse> => {
  const cameraIdRaw = data.cameraId?.trim() ?? '';
  const cameraIpRaw = data.cameraIp?.trim() ?? '';
  const nodeSecret = data.nodeSecret.trim();
  const capturedAtRaw = data.capturedAt.trim();
  const jpegBase64 = data.jpegBase64;

  if ((!cameraIdRaw && !cameraIpRaw) || !nodeSecret || !capturedAtRaw || typeof jpegBase64 !== 'string') {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  const expectedSecret = process.env.CAMERA_NODE_SHARED_SECRET?.trim();
  if (!expectedSecret) {
    return { status: 'error', errorCode: 'camera.nodeSecretMissing', httpStatus: 500 };
  }

  if (nodeSecret !== expectedSecret) {
    return { status: 'error', errorCode: 'camera.nodeUnauthorized', httpStatus: 403 };
  }

  if (jpegBase64.length === 0 || jpegBase64.length > MAX_BASE64_LENGTH) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  const capturedAt = new Date(capturedAtRaw);
  if (Number.isNaN(capturedAt.getTime())) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  const [decodeError, decoded] = await tryCatch(async () => {
    return Buffer.from(jpegBase64, 'base64');
  });

  if (decodeError || !decoded || !startsWithJpegMagic(decoded)) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  // Resolve cameraId: prefer the explicit id when present, otherwise look up by
  // ip. The Pi Zero only knows its own ip on boot — it caches cameraId from
  // observed commands but the first thumbnail can fire before any command
  // arrives, so the ip fallback (mirroring ingestNodeTelemetry) is required.
  const [cameraReadError, camera] = await tryCatch(async () => {
    if (cameraIdRaw) {
      return functions.db.prisma.camera.findUnique({
        where: { id: cameraIdRaw },
        select: { id: true },
      });
    }
    return functions.db.prisma.camera.findFirst({
      where: { ip: cameraIpRaw },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
  });

  if (cameraReadError) {
    return { status: 'error', errorCode: 'camera.unexpectedError', httpStatus: 500 };
  }

  if (!camera) {
    return { status: 'error', errorCode: 'camera.notFound', httpStatus: 404 };
  }

  const cameraId = camera.id;

  setThumbnail(cameraId, jpegBase64, capturedAt);

  // Fire-and-forget auto-IR evaluation. Errors are swallowed inside the
  // controller so a sharp decode failure can't break thumbnail ingestion.
  void onThumbnailUpdated({ cameraId, jpegBase64 });

  console.log('');
  console.log(
    `[thumbnail] received cameraId=${cameraId} bytes=${String(jpegBase64.length)}`,
  );

  const capturedAtIso = capturedAt.toISOString();

  emitCameraSyncEvent({
    fullName: 'sync/cameras/thumbnailUpdated/v1',
    receiver: getCameraRoomCode(cameraId),
    serverOutput: {
      status: 'success',
      cameraId,
      capturedAt: capturedAtIso,
      jpegBase64,
    },
  });

  emitCameraSyncEvent({
    fullName: 'sync/cameras/thumbnailUpdated/v1',
    receiver: 'cameras-overview',
    serverOutput: {
      status: 'success',
      cameraId,
      capturedAt: capturedAtIso,
      jpegBase64,
    },
  });

  return {
    status: 'success',
    cameraId,
    receivedAt: new Date().toISOString(),
  };
};
