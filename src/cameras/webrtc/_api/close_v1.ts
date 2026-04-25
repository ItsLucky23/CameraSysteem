import { AuthProps, SessionLayout } from '../../../../config';
import { Functions, ApiResponse } from '../../../../src/_sockets/apiTypes.generated';
import { closeCameraWebrtcPeer } from '../../../../server/utils/cameraWebrtcBridge';

export const rateLimit: number | false = 120;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: true,
  additional: [],
};

export interface ApiParams {
  data: {
    cameraId: string;
    peerId: string;
  };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user }: ApiParams): Promise<ApiResponse> => {
  const cameraId = data.cameraId.trim();
  const peerId = data.peerId.trim();

  if (!cameraId || !peerId) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  console.log('');
  console.log(
    `[action] cameras/webrtc/close cameraId=${cameraId} userId=${user.id} peerId=${peerId}`,
  );

  const closed = closeCameraWebrtcPeer({ cameraId, peerId });

  return {
    status: 'success',
    closed,
  };
};
