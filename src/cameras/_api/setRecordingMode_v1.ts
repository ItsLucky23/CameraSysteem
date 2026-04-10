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
    recording: boolean;
  };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const cameraId = data.cameraId.trim();
  if (!cameraId || typeof data.recording !== 'boolean') {
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
    return { status: 'error', errorCode: 'camera.commandFailed', httpStatus: 500 };
  }

  const [camera, access] = cameraFetchResult;
  if (!camera) {
    return { status: 'error', errorCode: 'camera.notFound', httpStatus: 404 };
  }

  if (!canControlCamera({ isAdmin: user.admin, access })) {
    return { status: 'error', errorCode: 'camera.controlDenied', httpStatus: 403 };
  }

  if (data.recording && typeof camera.temperatureC === 'number' && camera.temperatureC >= 85) {
    return { status: 'error', errorCode: 'camera.thermalSafetyLock', httpStatus: 409 };
  }

  const mode = data.recording ? 'record' : 'live';

  const [cameraUpdateError, updatedCamera] = await tryCatch(async () => {
    return functions.db.prisma.camera.update({
      where: { id: cameraId },
      data: {
        mode,
      },
    });
  });

  if (cameraUpdateError || !updatedCamera) {
    return { status: 'error', errorCode: 'camera.commandFailed', httpStatus: 500 };
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
        type: 'recording',
        severity: 'info',
        messageCode: 'camera.recording.updated',
        metadataJson: JSON.stringify({ recording: data.recording, userId: user.id }),
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
        mode: updatedCamera.mode,
        recording: updatedCamera.mode === 'record',
      },
      at: new Date().toISOString(),
    },
  });

  return {
    status: 'success',
    cameraId,
    recording: updatedCamera.mode === 'record',
  };
};
