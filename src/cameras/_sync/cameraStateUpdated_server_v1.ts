import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse, MaybePromise } from '../../../src/_sockets/apiTypes.generated';

export const auth: AuthProps = {
  login: true,
  additional: [{ key: 'admin', value: true }],
};

export interface SyncParams {
  clientInput: {
    cameraId: string;
    patch: {
      isOnline?: boolean;
      mode?: 'off' | 'idle' | 'live' | 'record';
      irMode?: 'off' | 'on' | 'auto';
      irEnabled?: boolean;
      pan?: number;
      tilt?: number;
      temperatureC?: number | null;
      motionDetected?: boolean;
      recording?: boolean;
    };
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
    patch: clientInput.patch,
    at: clientInput.at,
  };
};
