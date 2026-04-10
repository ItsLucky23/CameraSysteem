import { AuthProps, SessionLayout } from '../../../../config';
import { Functions, SyncServerResponse, MaybePromise } from '../../../../src/_sockets/apiTypes.generated';

export const auth: AuthProps = {
  login: true,
  additional: [{ key: 'admin', value: true }],
};

export interface SyncParams {
  clientInput: {
    userId: string;
    cameraId: string;
    roomCode: string;
    reasonCode: string;
  };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = ({ clientInput }: SyncParams): MaybePromise<SyncServerResponse> => {
  return {
    status: 'success',
    userId: clientInput.userId,
    cameraId: clientInput.cameraId,
    roomCode: clientInput.roomCode,
    reasonCode: clientInput.reasonCode,
  };
};
