import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse, MaybePromise } from '../../../src/_sockets/apiTypes.generated';

export const auth: AuthProps = {
  login: true,
  additional: [],
};

export interface SyncParams {
  clientInput: {
    cameraId: string;
    recordingId: string | null;
    startedAt: string | null;
    startedByUserId: string | null;
  };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = ({ clientInput }: SyncParams): MaybePromise<SyncServerResponse> => {
  return {
    status: 'success',
    cameraId: clientInput.cameraId,
    recordingId: clientInput.recordingId,
    startedAt: clientInput.startedAt,
    startedByUserId: clientInput.startedByUserId,
  };
};
