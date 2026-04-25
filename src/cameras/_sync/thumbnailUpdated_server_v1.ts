import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse, MaybePromise } from '../../../src/_sockets/apiTypes.generated';

export const auth: AuthProps = {
  login: true,
  additional: [{ key: 'admin', value: true }],
};

export interface SyncParams {
  clientInput: {
    cameraId: string;
    capturedAt: string;
    jpegBase64: string;
  };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = ({ clientInput }: SyncParams): MaybePromise<SyncServerResponse> => {
  return {
    status: 'success',
    cameraId: clientInput.cameraId,
    capturedAt: clientInput.capturedAt,
    jpegBase64: clientInput.jpegBase64,
  };
};
