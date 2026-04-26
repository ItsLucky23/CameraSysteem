import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { releaseControlSession } from '../../../server/utils/cameraControlSession';

export const rateLimit: number | false = 60;

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

export const main = async ({ data, user }: ApiParams): Promise<ApiResponse> => {
  const cameraId = data.cameraId.trim();
  if (!cameraId) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  const result = await releaseControlSession({
    cameraId,
    userId: user.id,
    isAdmin: user.admin,
  });

  return {
    status: 'success',
    cameraId,
    released: result.released,
  };
};
