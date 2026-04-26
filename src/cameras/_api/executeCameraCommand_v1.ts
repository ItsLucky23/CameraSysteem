import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { tryCatch } from '../../../server/functions/tryCatch';
import {
  acquireCameraActionLock,
  canControlCamera,
  emitCameraSyncEvent,
  getCameraRoomCode,
  isCameraAction,
  isStubCameraAction,
} from '../../../server/utils/cameraHelpers';
import { assertCallerIsController } from '../../../server/utils/cameraControlSession';

export const rateLimit: number | false = 240;

// PTZ commands need to flow at ~5 Hz when the user holds a button. Other
// commands are click-once toggles and need no per-action lock — the control
// session already gates who can send them.
const PTZ_ACTIONS = new Set(['panLeft', 'panRight', 'tiltUp', 'tiltDown']);
const PTZ_LOCK_TTL_MS = 200;

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

  console.log('');
  console.log(
    `[action] cameras/executeCameraCommand cameraId=${cameraId} userId=${user.id} action=${actionValue} payload=${JSON.stringify(payload)}`,
  );

  if (isStubCameraAction(actionValue)) {
    const [stubFetchError, stubCamera] = await tryCatch(async () => {
      return Promise.all([
        functions.db.prisma.camera.findUnique({
          where: { id: cameraId },
          select: { id: true, ip: true },
        }),
        user.admin
          ? Promise.resolve(null)
          : functions.db.prisma.cameraAccess.findUnique({
            where: {
              cameraId_userId: { cameraId, userId: user.id },
            },
          }),
      ]);
    });

    if (stubFetchError || !stubCamera) {
      return { status: 'error', errorCode: 'camera.commandFailed', httpStatus: 500 };
    }

    const [stubCameraRow, stubAccess] = stubCamera;
    if (!stubCameraRow) {
      return { status: 'error', errorCode: 'camera.notFound', httpStatus: 404 };
    }

    if (!canControlCamera({ isAdmin: user.admin, access: stubAccess })) {
      return { status: 'error', errorCode: 'camera.controlDenied', httpStatus: 403 };
    }

    const stubController = await assertCallerIsController({ cameraId, userId: user.id });
    if (!stubController) {
      return { status: 'error', errorCode: 'camera.notControlling', httpStatus: 409 };
    }

    const [stubDispatchError, stubDispatchResult] = await tryCatch(async () => {
      return functions.cameraNode.enqueueCommand({
        cameraIp: stubCameraRow.ip,
        cameraId,
        commandId,
        action: actionValue,
        payload,
        requestedByUserId: user.id,
      });
    });

    if (stubDispatchError || !stubDispatchResult?.queued) {
      return { status: 'error', errorCode: 'camera.nodeQueueFailed', httpStatus: 503 };
    }

    return {
      status: 'success',
      command: {
        commandId,
        cameraId,
        action: actionValue,
        status: 'accepted',
        lockUntil: new Date().toISOString(),
      },
    };
  }

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

  const controller = await assertCallerIsController({ cameraId, userId: user.id });
  if (!controller) {
    return { status: 'error', errorCode: 'camera.notControlling', httpStatus: 409 };
  }

  // Per-action lock kept only for PTZ commands so a held button at 250ms
  // cadence doesn't outpace the servo. All other commands are click-once
  // toggles where the control session is the only gate they need.
  const isPtz = PTZ_ACTIONS.has(actionValue);
  const lockTtlMs = isPtz ? PTZ_LOCK_TTL_MS : 0;

  let lockResult: Awaited<ReturnType<typeof acquireCameraActionLock>> | null = null;
  if (lockTtlMs > 0) {
    const [lockError, result] = await tryCatch(async () => {
      return acquireCameraActionLock({
        cameraId,
        action: actionValue,
        userId: user.id,
        commandId,
        ttlMs: lockTtlMs,
      });
    });

    if (lockError || !result) {
      return { status: 'error', errorCode: 'camera.commandFailed', httpStatus: 500 };
    }

    if (!result.acquired) {
      emitCameraSyncEvent({
        fullName: 'sync/cameras/cameraCommandResult/v1',
        receiver: roomCode,
        serverOutput: {
          status: 'success',
          cameraId,
          commandId,
          action: actionValue,
          result: 'rejected',
          cooldownUntil: result.lockUntil,
          reasonCode: 'camera.locked',
        },
      });

      return {
        status: 'error',
        errorCode: 'camera.locked',
        errorParams: [{ key: 'seconds', value: result.cooldownSeconds }],
        httpStatus: 409,
      };
    }

    lockResult = result;
  }

  const lockUntilIso = lockResult ? lockResult.lockUntil : new Date().toISOString();
  const cooldownMs = lockResult ? lockResult.cooldownMs : 0;

  const [commandCreateError] = await tryCatch(async () => {
    return functions.db.prisma.cameraCommand.create({
      data: {
        commandId,
        cameraId,
        userId: user.id,
        action: actionValue,
        payloadJson: JSON.stringify(payload),
        status: 'accepted',
        cooldownMs,
      },
    });
  });

  if (commandCreateError) {
    return { status: 'error', errorCode: 'camera.commandFailed', httpStatus: 500 };
  }

  const [dispatchError, dispatchResult] = await tryCatch(async () => {
    return functions.cameraNode.enqueueCommand({
      cameraIp: camera.ip,
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
      cooldownUntil: lockUntilIso,
    },
  });

  return {
    status: 'success',
    command: {
      commandId,
      cameraId,
      action: actionValue,
      status: 'accepted',
      lockUntil: lockUntilIso,
    },
  };
};
