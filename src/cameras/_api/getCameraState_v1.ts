import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { tryCatch } from '../../../server/functions/tryCatch';
import { canPreviewCamera } from '../../../server/utils/cameraHelpers';

export const rateLimit: number | false = 180;
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

  const [snapshotError, latestSnapshot] = await tryCatch(async () => {
    return functions.db.prisma.cameraStateSnapshot.findFirst({
      where: { cameraId },
      orderBy: { createdAt: 'desc' },
    });
  });

  if (snapshotError) {
    return { status: 'error', errorCode: 'camera.unexpectedError', httpStatus: 500 };
  }

  return {
    status: 'success',
    camera: {
      id: camera.id,
      isOnline: camera.isOnline,
      mode: camera.mode,
      irMode: camera.irMode,
      irEnabled: camera.irEnabled,
      pan: camera.pan,
      tilt: camera.tilt,
      temperatureC: camera.temperatureC ?? null,
      recording: latestSnapshot?.recording ?? camera.mode === 'record',
      motionDetected: latestSnapshot?.motionDetected ?? false,
      updatedAt: camera.updatedAt.toISOString(),
    },
  };
};
