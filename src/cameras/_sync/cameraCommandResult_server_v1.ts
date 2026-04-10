import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse, MaybePromise } from '../../../src/_sockets/apiTypes.generated';

export const auth: AuthProps = {
  login: true,
  additional: [{ key: 'admin', value: true }],
};

export interface SyncParams {
  clientInput: {
    cameraId: string;
    commandId: string;
    action: string;
    result: 'accepted' | 'rejected' | 'executed' | 'failed';
    cooldownUntil?: string;
    reasonCode?: string;
  };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = ({ clientInput }: SyncParams): MaybePromise<SyncServerResponse> => {
  return {
    status: 'success',
    cameraId: clientInput.cameraId,
    commandId: clientInput.commandId,
    action: clientInput.action,
    result: clientInput.result,
    cooldownUntil: clientInput.cooldownUntil,
    reasonCode: clientInput.reasonCode,
  };
};
