import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { tryCatch } from '../../../server/functions/tryCatch';
import {
  acquireCameraActionLock,
  canControlCamera,
  emitCameraSyncEvent,
  getCameraRoomCode,
  isCameraAction,
} from '../../../server/utils/cameraHelpers';

export const rateLimit: number | false = 90;

export const auth: AuthProps = {
  login: true,
  additional: [],
};

export interface ApiParams {
  data: {
    cameraId: string;
    commandId: string;
    action: string;
    payload?: Record<string, string | number | boolean>;
  };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const cameraId = data.cameraId.trim();
  const commandId = data.commandId.trim();
  const actionValue = data.action.trim();

  if (!cameraId || !commandId || !actionValue) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  if (!isCameraAction(actionValue)) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  if (data.payload && typeof data.payload !== 'object') {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  const payload = data.payload ?? {};
  const roomCode = getCameraRoomCode(cameraId);

  const [existingCommandError, existingCommand] = await tryCatch(async () => {
    return functions.db.prisma.cameraCommand.findUnique({ where: { commandId } });
  });

  if (existingCommandError) {
    return { status: 'error', errorCode: 'camera.commandFailed', httpStatus: 500 };
  }

  if (existingCommand) {
    const knownStatus = existingCommand.status === 'executed' ? 'executed' : 'accepted';
    const fallbackCooldownMs = existingCommand.cooldownMs ?? 3000;

    return {
      status: 'success',
      command: {
        commandId: existingCommand.commandId,
        cameraId: existingCommand.cameraId,
        action: existingCommand.action,
        status: knownStatus,
        lockUntil: new Date(existingCommand.createdAt.getTime() + fallbackCooldownMs).toISOString(),
      },
    };
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
    return { status: 'error', errorCode: 'camera.commandFailed', httpStatus: 500 };
  }

  const [camera, access] = cameraFetchResult;
  if (!camera) {
    return { status: 'error', errorCode: 'camera.notFound', httpStatus: 404 };
  }

  if (!canControlCamera({ isAdmin: user.admin, access })) {
    return { status: 'error', errorCode: 'camera.controlDenied', httpStatus: 403 };
  }

  const [lockError, lockResult] = await tryCatch(async () => {
    return acquireCameraActionLock({
      cameraId,
      action: actionValue,
      userId: user.id,
      commandId,
      ttlMs: 3000,
    });
  });

  if (lockError || !lockResult) {
    return { status: 'error', errorCode: 'camera.commandFailed', httpStatus: 500 };
  }

  if (!lockResult.acquired) {
    emitCameraSyncEvent({
      fullName: 'sync/cameras/cameraCommandResult/v1',
      receiver: roomCode,
      serverOutput: {
        status: 'success',
        cameraId,
        commandId,
        action: actionValue,
        result: 'rejected',
        cooldownUntil: lockResult.lockUntil,
        reasonCode: 'camera.locked',
      },
    });

    return {
      status: 'error',
      errorCode: 'camera.locked',
      errorParams: [{ key: 'seconds', value: lockResult.cooldownSeconds }],
      httpStatus: 409,
    };
  }

  const [commandCreateError] = await tryCatch(async () => {
    return functions.db.prisma.cameraCommand.create({
      data: {
        commandId,
        cameraId,
        userId: user.id,
        action: actionValue,
        payloadJson: JSON.stringify(payload),
        status: 'accepted',
        cooldownMs: lockResult.cooldownMs,
      },
    });
  });

  if (commandCreateError) {
    return { status: 'error', errorCode: 'camera.commandFailed', httpStatus: 500 };
  }

  const [dispatchError, dispatchResult] = await tryCatch(async () => {
    return functions.cameraNode.enqueueCommand({
      nodeId: camera.nodeId,
      cameraId,
      commandId,
      action: actionValue,
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

    emitCameraSyncEvent({
      fullName: 'sync/cameras/cameraCommandResult/v1',
      receiver: roomCode,
      serverOutput: {
        status: 'success',
        cameraId,
        commandId,
        action: actionValue,
        result: 'failed',
        reasonCode: 'camera.nodeQueueFailed',
      },
    });

    return { status: 'error', errorCode: 'camera.nodeQueueFailed', httpStatus: 503 };
  }

  await tryCatch(async () => {
    return functions.db.prisma.cameraEvent.create({
      data: {
        cameraId,
        type: 'command',
        severity: 'info',
        messageCode: 'camera.command.accepted',
        metadataJson: JSON.stringify({
          commandId,
          action: actionValue,
          userId: user.id,
          publishedReceivers: dispatchResult.publishedReceivers,
        }),
      },
    });
  });

  emitCameraSyncEvent({
    fullName: 'sync/cameras/cameraCommandResult/v1',
    receiver: roomCode,
    serverOutput: {
      status: 'success',
      cameraId,
      commandId,
      action: actionValue,
      result: 'accepted',
      cooldownUntil: lockResult.lockUntil,
    },
  });

  return {
    status: 'success',
    command: {
      commandId,
      cameraId,
      action: actionValue,
      status: 'accepted',
      lockUntil: lockResult.lockUntil,
    },
  };
};
