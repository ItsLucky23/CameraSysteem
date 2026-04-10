import { AuthProps, SessionLayout } from '../../../../config';
import { Functions, ApiResponse } from '../../../../src/_sockets/apiTypes.generated';
import { tryCatch } from '../../../../server/functions/tryCatch';
import redisClient from '../../../../server/functions/redis';
import { ioInstance } from '../../../../server/sockets/socket';
import {
  emitCameraSyncEvent,
  getActiveUserTokensKey,
  getCameraRoomCode,
} from '../../../../server/utils/cameraHelpers';

export const rateLimit: number | false = 30;

export const auth: AuthProps = {
  login: true,
  additional: [{ key: 'admin', value: true }],
};

export interface ApiParams {
  data: {
    userId: string;
    cameraId: string;
    canPreview: boolean;
    canControl: boolean;
  };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const userId = data.userId.trim();
  const cameraId = data.cameraId.trim();

  if (!userId || !cameraId || typeof data.canPreview !== 'boolean' || typeof data.canControl !== 'boolean') {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  const canControl = data.canControl;
  const canPreview = canControl ? true : data.canPreview;

  const [entityFetchError, entityFetchResult] = await tryCatch(async () => {
    return Promise.all([
      functions.db.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      }),
      functions.db.prisma.camera.findUnique({
        where: { id: cameraId },
        select: { id: true },
      }),
    ]);
  });

  if (entityFetchError || !entityFetchResult) {
    return { status: 'error', errorCode: 'camera.unexpectedError', httpStatus: 500 };
  }

  const [targetUser, camera] = entityFetchResult;
  if (!targetUser) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 404 };
  }

  if (!camera) {
    return { status: 'error', errorCode: 'camera.notFound', httpStatus: 404 };
  }

  const [accessUpdateError, updatedAccess] = await tryCatch(async () => {
    return functions.db.prisma.cameraAccess.upsert({
      where: {
        cameraId_userId: {
          cameraId,
          userId,
        },
      },
      update: {
        canPreview,
        canControl,
        grantedByUserId: user.id,
      },
      create: {
        cameraId,
        userId,
        canPreview,
        canControl,
        grantedByUserId: user.id,
      },
    });
  });

  if (accessUpdateError || !updatedAccess) {
    return { status: 'error', errorCode: 'camera.unexpectedError', httpStatus: 500 };
  }

  const [activeTokensError, activeTokens] = await tryCatch(async () => {
    return redisClient.smembers(getActiveUserTokensKey(userId));
  });

  const safeActiveTokens = activeTokensError || !activeTokens
    ? []
    : [...new Set(activeTokens.filter((token) => typeof token === 'string' && token.length > 0))];

  const cameraRoomCode = getCameraRoomCode(cameraId);

  for (const token of safeActiveTokens) {
    emitCameraSyncEvent({
      fullName: 'sync/admin/camera-access/cameraAccessUpdated/v1',
      receiver: token,
      serverOutput: {
        status: 'success',
        userId,
        cameraId,
        canPreview,
        canControl,
        updatedAt: updatedAccess.updatedAt.toISOString(),
      },
    });

    if (!canPreview) {
      const [sessionReadError, sessionData] = await tryCatch(async () => {
        return functions.session.getSession(token);
      });

      if (!sessionReadError && sessionData) {
        const nextRoomCodes = (sessionData.roomCodes ?? []).filter((roomCode: string) => roomCode !== cameraRoomCode);

        await tryCatch(async () => {
          return functions.session.saveSession(token, {
            ...sessionData,
            roomCodes: nextRoomCodes,
          });
        });
      }

      const sockets = ioInstance?.sockets.adapter.rooms.get(token);
      if (sockets) {
        for (const socketId of sockets) {
          const targetSocket = ioInstance?.sockets.sockets.get(socketId);
          if (!targetSocket) {
            continue;
          }

          await tryCatch(async () => {
            await targetSocket.leave(cameraRoomCode);
          });
        }
      }

      emitCameraSyncEvent({
        fullName: 'sync/admin/camera-access/userForcedLeaveCameraRoom/v1',
        receiver: token,
        serverOutput: {
          status: 'success',
          userId,
          cameraId,
          roomCode: cameraRoomCode,
          reasonCode: 'camera.accessDenied',
        },
      });
    }
  }

  return {
    status: 'success',
    access: {
      userId: updatedAccess.userId,
      cameraId: updatedAccess.cameraId,
      canPreview: updatedAccess.canPreview,
      canControl: updatedAccess.canControl,
      updatedAt: updatedAccess.updatedAt.toISOString(),
    },
  };
};
