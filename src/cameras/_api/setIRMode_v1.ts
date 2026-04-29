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
  };
  user: SessionLayout;
  functions: Functions;
}

const isIRMode = (value: string): value is IRMode => {
  return value === 'off' || value === 'on' || value === 'auto';
};

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const cameraId = data.cameraId.trim();
  const irModeValue = data.irMode.trim();

  if (!cameraId || !irModeValue || !isIRMode(irModeValue)) {
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

  const [cameraUpdateError, updatedCamera] = await tryCatch(async () => {
    return functions.db.prisma.camera.update({
      where: { id: cameraId },
      data: {
        irMode: irModeValue,
        irEnabled,
      },
    });
  });

  if (cameraUpdateError || !updatedCamera) {
    return { status: 'error', errorCode: 'camera.commandFailed', httpStatus: 500 };
  }

  // The DB update + sync broadcast above only flips client-visible state; the
  // Pi Zero MOSFET gate (GPIO 18) won't actually change unless we enqueue an
  // irOn/irOff command. 'auto' is a no-op on the adapter so we skip it.
  if (irModeValue === 'on' || irModeValue === 'off') {
    const action = irModeValue === 'on' ? 'irOn' : 'irOff';
    const commandId = globalThis.crypto.randomUUID();

    await tryCatch(async () => {
      return functions.db.prisma.cameraCommand.create({
        data: {
          commandId,
          cameraId,
          userId: user.id,
          action,
          payloadJson: JSON.stringify({}),
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
        payload: {},
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
      },
      at: new Date().toISOString(),
    },
  });

  return {
    status: 'success',
    cameraId,
    irMode: updatedCamera.irMode,
  };
};
