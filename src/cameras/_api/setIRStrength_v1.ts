import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { tryCatch } from '../../../server/functions/tryCatch';
import { canControlCamera, emitCameraSyncEvent, getCameraRoomCode } from '../../../server/utils/cameraHelpers';

export const rateLimit: number | false = 60;

export const auth: AuthProps = {
  login: true,
  additional: [],
};

export interface ApiParams {
  data: {
    cameraId: string;
    strength: number;
  };
  user: SessionLayout;
  functions: Functions;
}

const isValidStrength = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100;
};

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const cameraId = data.cameraId.trim();
  const strength = data.strength;

  if (!cameraId || !isValidStrength(strength)) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  const [cameraFetchError, cameraFetchResult] = await tryCatch(async () => {
    return Promise.all([
      functions.db.prisma.camera.findUnique({ where: { id: cameraId } }),
      user.admin
        ? Promise.resolve(null)
        : functions.db.prisma.cameraAccess.findUnique({
          where: { cameraId_userId: { cameraId, userId: user.id } },
        }),
    ]);
  });

  if (cameraFetchError || !cameraFetchResult) {
    return { status: 'error', errorCode: 'camera.commandFailed', httpStatus: 500 };
  }

  const [camera, access] = cameraFetchResult;
  if (!camera) {
    return { status: 'error', errorCode: 'camera.notFound', httpStatus: 404 };
  }

  if (!canControlCamera({ isAdmin: user.admin, access })) {
    return { status: 'error', errorCode: 'camera.controlDenied', httpStatus: 403 };
  }

  const [updateError, updatedCamera] = await tryCatch(async () => {
    return functions.db.prisma.camera.update({
      where: { id: cameraId },
      data: { irStrength: strength },
    });
  });

  if (updateError || !updatedCamera) {
    return { status: 'error', errorCode: 'camera.commandFailed', httpStatus: 500 };
  }

  // Live slider drags fire many of these per second; we still enqueue an
  // irSetStrength command per call (debouncing happens client-side). The Pi
  // Zero adapter applies the new PWM duty cycle immediately when in 'on' mode.
  const commandId = globalThis.crypto.randomUUID();
  const payload = { strength };

  await tryCatch(async () => {
    return functions.db.prisma.cameraCommand.create({
      data: {
        commandId,
        cameraId,
        userId: user.id,
        action: 'irSetStrength',
        payloadJson: JSON.stringify(payload),
        status: 'accepted',
        cooldownMs: 0,
      },
    });
  });

  const [dispatchError, dispatchResult] = await tryCatch(async () => {
    return functions.cameraNode.enqueueCommand({
      cameraIp: updatedCamera.ip,
      cameraId,
      commandId,
      action: 'irSetStrength',
      payload,
      requestedByUserId: user.id,
    });
  });

  if (dispatchError || !dispatchResult?.queued) {
    await tryCatch(async () => {
      return functions.db.prisma.cameraCommand.update({
        where: { commandId },
        data: {
          status: 'failed',
          rejectedReason: 'camera.nodeQueueFailed',
          resolvedAt: new Date(),
        },
      });
    });
    return { status: 'error', errorCode: 'camera.nodeQueueFailed', httpStatus: 503 };
  }

  emitCameraSyncEvent({
    fullName: 'sync/cameras/cameraStateUpdated/v1',
    receiver: getCameraRoomCode(cameraId),
    serverOutput: {
      status: 'success',
      cameraId,
      patch: {
        irStrength: updatedCamera.irStrength,
      },
      at: new Date().toISOString(),
    },
  });

  return {
    status: 'success',
    cameraId,
    irStrength: updatedCamera.irStrength,
  };
};
