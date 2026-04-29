import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { tryCatch } from '../../../server/functions/tryCatch';
import { canControlCamera, emitCameraSyncEvent, getCameraRoomCode } from '../../../server/utils/cameraHelpers';

export const rateLimit: number | false = 60;

export const auth: AuthProps = {
  login: true,
  additional: [],
};

type IRMode = 'off' | 'on' | 'auto';

export interface ApiParams {
  data: {
    cameraId: string;
    irMode: IRMode;
    irStrength?: number | null;
  };
  user: SessionLayout;
  functions: Functions;
}

const isIRMode = (value: string): value is IRMode => {
  return value === 'off' || value === 'on' || value === 'auto';
};

const isValidStrength = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100;
};

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const cameraId = data.cameraId.trim();
  const irModeValue = data.irMode.trim();
  const irStrengthRaw = data.irStrength;

  if (!cameraId || !irModeValue || !isIRMode(irModeValue)) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  if (irStrengthRaw !== undefined && irStrengthRaw !== null && !isValidStrength(irStrengthRaw)) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  console.log('');
  console.log(
    `[action] cameras/setIRMode cameraId=${cameraId} userId=${user.id} mode=${irModeValue}`,
  );

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

  const irEnabled = irModeValue === 'on' ? true : (irModeValue === 'off' ? false : camera.irEnabled);

  // Strength is only persisted when the user is in 'on' mode (or explicitly
  // resets via null). 'auto' lets the controller pick the level so we leave
  // the persisted value alone. Default to 100 when the existing row has null
  // (legacy data before this field existed).
  let persistStrength: number;
  if (irModeValue === 'on' && isValidStrength(irStrengthRaw)) {
    persistStrength = irStrengthRaw;
  } else if (irStrengthRaw === null) {
    persistStrength = 100;
  } else {
    persistStrength = camera.irStrength ?? 100;
  }

  const [cameraUpdateError, updatedCamera] = await tryCatch(async () => {
    return functions.db.prisma.camera.update({
      where: { id: cameraId },
      data: {
        irMode: irModeValue,
        irEnabled,
        irStrength: persistStrength,
      },
    });
  });

  if (cameraUpdateError || !updatedCamera) {
    return { status: 'error', errorCode: 'camera.commandFailed', httpStatus: 500 };
  }

  // The DB update + sync broadcast above only flips client-visible state; the
  // Pi Zero MOSFET gate (GPIO 18) won't actually change unless we enqueue a
  // command. 'auto' wakes up the lux-driven controller on the Pi Zero.
  const actionMap: Record<IRMode, 'irOn' | 'irOff' | 'irAuto'> = {
    on: 'irOn',
    off: 'irOff',
    auto: 'irAuto',
  };
  const action = actionMap[irModeValue];
  const commandPayload: Record<string, unknown> =
    irModeValue === 'on' ? { strength: updatedCamera.irStrength ?? 100 } : {};

  const commandId = globalThis.crypto.randomUUID();

  await tryCatch(async () => {
    return functions.db.prisma.cameraCommand.create({
      data: {
        commandId,
        cameraId,
        userId: user.id,
        action,
        payloadJson: JSON.stringify(commandPayload),
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
      action,
      payload: commandPayload,
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

  await tryCatch(async () => {
    return functions.db.prisma.cameraStateSnapshot.create({
      data: {
        cameraId: updatedCamera.id,
        isOnline: updatedCamera.isOnline,
        mode: updatedCamera.mode,
        irMode: updatedCamera.irMode,
        irEnabled: updatedCamera.irEnabled,
        pan: updatedCamera.pan,
        tilt: updatedCamera.tilt,
        temperatureC: updatedCamera.temperatureC,
        motionDetected: false,
        recording: updatedCamera.mode === 'record',
      },
    });
  });

  await tryCatch(async () => {
    return functions.db.prisma.cameraEvent.create({
      data: {
        cameraId,
        type: 'command',
        severity: 'info',
        messageCode: 'camera.irMode.updated',
        metadataJson: JSON.stringify({ irMode: irModeValue, userId: user.id }),
      },
    });
  });

  emitCameraSyncEvent({
    fullName: 'sync/cameras/cameraStateUpdated/v1',
    receiver: getCameraRoomCode(cameraId),
    serverOutput: {
      status: 'success',
      cameraId,
      patch: {
        irMode: updatedCamera.irMode,
        irEnabled: updatedCamera.irEnabled,
        irStrength: updatedCamera.irStrength,
      },
      at: new Date().toISOString(),
    },
  });

  return {
    status: 'success',
    cameraId,
    irMode: updatedCamera.irMode,
    irStrength: updatedCamera.irStrength,
  };
};
