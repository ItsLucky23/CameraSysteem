import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { tryCatch } from '../../../server/functions/tryCatch';
import { canControlCamera, emitCameraSyncEvent, getCameraRoomCode } from '../../../server/utils/cameraHelpers';
import {
  CONTROL_TTL_MS,
  assertCallerIsController,
} from '../../../server/utils/cameraControlSession';
import {
  clearMicEnabled,
  setMicEnabled as setMicEnabledRedis,
} from '../../../server/utils/cameraMicState';

export const rateLimit: number | false = 30;

export const auth: AuthProps = {
  login: true,
  additional: [],
};

export interface ApiParams {
  data: {
    cameraId: string;
    enabled: boolean;
  };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const cameraId = data.cameraId.trim();
  if (!cameraId || typeof data.enabled !== 'boolean') {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  const [fetchError, lookup] = await tryCatch(async () => Promise.all([
    functions.db.prisma.camera.findUnique({
      where: { id: cameraId },
      select: { id: true },
    }),
    user.admin
      ? Promise.resolve(null)
      : functions.db.prisma.cameraAccess.findUnique({
        where: { cameraId_userId: { cameraId, userId: user.id } },
      }),
  ]));

  if (fetchError || !lookup) {
    return { status: 'error', errorCode: 'camera.commandFailed', httpStatus: 500 };
  }

  const [camera, access] = lookup;
  if (!camera) {
    return { status: 'error', errorCode: 'camera.notFound', httpStatus: 404 };
  }

  if (!canControlCamera({ isAdmin: user.admin, access })) {
    return { status: 'error', errorCode: 'camera.controlDenied', httpStatus: 403 };
  }

  // Mic enable is gated to the active control session. This guarantees only
  // one user can talk into a camera at a time even if multiple users have
  // permission. Releasing control implicitly disables their mic too because
  // the redis key has the same TTL as the control session.
  const session = await assertCallerIsController({ cameraId, userId: user.id });
  if (!session) {
    return { status: 'error', errorCode: 'camera.controlHeldByOther', httpStatus: 409 };
  }

  if (data.enabled) {
    await setMicEnabledRedis({
      cameraId,
      userId: user.id,
      userName: user.name || user.email || user.id,
      ttlMs: CONTROL_TTL_MS,
    });
  } else {
    await clearMicEnabled({ cameraId });
  }

  emitCameraSyncEvent({
    fullName: 'sync/cameras/micEnabledChanged/v1',
    receiver: getCameraRoomCode(cameraId),
    serverOutput: {
      status: 'success',
      cameraId,
      enabled: data.enabled,
      userId: data.enabled ? user.id : null,
      userName: data.enabled ? (user.name || user.email || user.id) : null,
    },
  });

  return {
    status: 'success',
    cameraId,
    enabled: data.enabled,
  };
};
