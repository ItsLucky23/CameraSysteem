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
    recordingId: string;
  };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const recordingId = data.recordingId.trim();
  if (!recordingId) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  const [recordingFetchError, recording] = await tryCatch(async () => {
    return functions.db.prisma.recording.findUnique({
      where: { id: recordingId },
      select: { id: true, cameraId: true, stoppedAt: true },
    });
  });

  if (recordingFetchError) {
    return { status: 'error', errorCode: 'recording.stopFailed', httpStatus: 500 };
  }

  if (!recording) {
    return { status: 'error', errorCode: 'recording.notFound', httpStatus: 404 };
  }

  const [accessError, access] = await tryCatch(async () => {
    if (user.admin) return null;
    return functions.db.prisma.cameraAccess.findUnique({
      where: { cameraId_userId: { cameraId: recording.cameraId, userId: user.id } },
    });
  });

  if (accessError) {
    return { status: 'error', errorCode: 'recording.stopFailed', httpStatus: 500 };
  }

  if (!canControlCamera({ isAdmin: user.admin, access })) {
    return { status: 'error', errorCode: 'camera.controlDenied', httpStatus: 403 };
  }

  console.log('');
  console.log(`[action] cameras/recording/stop recordingId=${recordingId} cameraId=${recording.cameraId} userId=${user.id}`);

  await cameraRecordingManager.stopRecording({ recordingId, reason: 'manual' });

  return {
    status: 'success',
    recordingId,
  };
};
