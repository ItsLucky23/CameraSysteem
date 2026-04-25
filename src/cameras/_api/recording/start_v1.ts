import { AuthProps, SessionLayout } from '../../../../config';
import { Functions, ApiResponse } from '../../../../src/_sockets/apiTypes.generated';
import { tryCatch } from '../../../../server/functions/tryCatch';
import { canControlCamera } from '../../../../server/utils/cameraHelpers';
import { cameraRecordingManager } from '../../../../server/utils/cameraRecordingManager';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

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

  const [accessError, accessResult] = await tryCatch(async () => {
    return Promise.all([
      functions.db.prisma.camera.findUnique({ where: { id: cameraId } }),
      user.admin
        ? Promise.resolve(null)
        : functions.db.prisma.cameraAccess.findUnique({
          where: { cameraId_userId: { cameraId, userId: user.id } },
        }),
    ]);
  });

  if (accessError || !accessResult) {
    return { status: 'error', errorCode: 'recording.startFailed', httpStatus: 500 };
  }

  const [camera, access] = accessResult;
  if (!camera) {
    return { status: 'error', errorCode: 'camera.notFound', httpStatus: 404 };
  }

  if (!canControlCamera({ isAdmin: user.admin, access })) {
    return { status: 'error', errorCode: 'camera.controlDenied', httpStatus: 403 };
  }

  console.log('');
  console.log(`[action] cameras/recording/start cameraId=${cameraId} userId=${user.id}`);

  const result = await cameraRecordingManager.startRecording({ cameraId, userId: user.id });
  if (result.status === 'error') {
    return { status: 'error', errorCode: result.errorCode, httpStatus: 500 };
  }

  return {
    status: 'success',
    recordingId: result.recordingId,
    startedAt: result.startedAt,
    alreadyActive: result.alreadyActive,
  };
};
