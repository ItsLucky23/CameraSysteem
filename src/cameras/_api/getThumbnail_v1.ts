import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { getThumbnail } from '../../../server/utils/cameraThumbnailStore';

export const rateLimit: number | false = 120;

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

export const main = async ({ data }: ApiParams): Promise<ApiResponse> => {
  const cameraId = data.cameraId.trim();

  if (!cameraId) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  const stored = getThumbnail(cameraId);

  if (!stored) {
    return {
      status: 'success',
      cameraId,
      thumbnail: null,
    };
  }

  return {
    status: 'success',
    cameraId,
    thumbnail: {
      jpegBase64: stored.jpegBase64,
      capturedAt: stored.capturedAt.toISOString(),
    },
  };
};
