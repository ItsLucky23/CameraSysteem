import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse, MaybePromise } from '../../../src/_sockets/apiTypes.generated';

export const auth: AuthProps = {
  login: true,
  additional: [],
};

export interface SyncParams {
  clientInput: {
    cameraId: string;
    session: {
      userId: string;
      userName: string;
      acquiredAt: string;
      expiresAt: string;
    } | null;
  };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = ({ clientInput }: SyncParams): MaybePromise<SyncServerResponse> => {
  return {
    status: 'success',
    cameraId: clientInput.cameraId,
    session: clientInput.session,
  };
};
