import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { getLogFlagsForCamera } from '../../../server/utils/cameraLogFlagStore';

export const rateLimit: number | false = 120;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET';

export const auth: AuthProps = {
  login: true,
  additional: [{ key: 'admin', value: true }],
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
  return {
    status: 'success',
    cameraId,
    features: getLogFlagsForCamera(cameraId),
  };
};
