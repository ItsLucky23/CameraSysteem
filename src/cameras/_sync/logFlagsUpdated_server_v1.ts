import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse, MaybePromise } from '../../../src/_sockets/apiTypes.generated';

export const auth: AuthProps = {
  login: true,
  additional: [{ key: 'admin', value: true }],
};

export interface SyncParams {
  clientInput: {
    cameraId: string;
    features: string[];
    at: string;
  };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = ({ clientInput }: SyncParams): MaybePromise<SyncServerResponse> => {
  return {
    status: 'success',
    cameraId: clientInput.cameraId,
    features: clientInput.features,
    at: clientInput.at,
  };
};
