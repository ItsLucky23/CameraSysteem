import { randomUUID } from 'node:crypto';
import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { tryCatch } from '../../../server/functions/tryCatch';
import { canPreviewCamera, getCameraPreviewTokenKey } from '../../../server/utils/cameraHelpers';

export const rateLimit: number | false = 60;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET';

export const auth: AuthProps = {
  login: true,
  additional: [],
};

export interface ApiParams {
  data: {
    cameraId: string;
  };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const cameraId = data.cameraId.trim();
  if (!cameraId) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  const [cameraFetchError, cameraFetchResult] = await tryCatch(async () => {
    return Promise.all([
      functions.db.prisma.camera.findUnique({
        where: { id: cameraId },
      }),
      user.admin
        ? Promise.resolve(null)
        : functions.db.prisma.cameraAccess.findUnique({
          where: {
            cameraId_userId: {
              cameraId,
              userId: user.id,
            },
          },
        }),
    ]);
  });

  if (cameraFetchError || !cameraFetchResult) {
    return { status: 'error', errorCode: 'camera.unexpectedError', httpStatus: 500 };
  }

  const [camera, access] = cameraFetchResult;
  if (!camera) {
    return { status: 'error', errorCode: 'camera.notFound', httpStatus: 404 };
  }

  if (!canPreviewCamera({ isAdmin: user.admin, access })) {
    return { status: 'error', errorCode: 'camera.accessDenied', httpStatus: 403 };
  }

  if (!camera.isOnline) {
    return { status: 'error', errorCode: 'camera.streamUnavailable', httpStatus: 503 };
  }

  const previewToken = randomUUID();
  const expiresAt = new Date(Date.now() + 60 * 1000);

  const [sessionStoreError] = await tryCatch(async () => {
    const key = getCameraPreviewTokenKey(previewToken);
    const payload = JSON.stringify({
      cameraId: camera.id,
      userId: user.id,
      expiresAt: expiresAt.toISOString(),
    });

    await functions.redis.redis.set(key, payload, 'PX', 60 * 1000);
  });

  if (sessionStoreError) {
    return { status: 'error', errorCode: 'camera.previewSessionCreateFailed', httpStatus: 500 };
  }

  return {
    status: 'success',
    transport: 'webrtc',
    cameraId: camera.id,
    streamKey: camera.streamKey,
    signaling: {
      offerUrl: '/api/cameras/webrtc/offer/v1',
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      token: previewToken,
      expiresAt: expiresAt.toISOString(),
    },
  };
};
