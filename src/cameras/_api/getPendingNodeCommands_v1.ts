import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { tryCatch } from '../../../server/functions/tryCatch';

export const rateLimit: number | false = 240;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: false,
  additional: [],
};

export interface ApiParams {
  data: {
    nodeId: string;
    nodeSecret: string;
    limit?: number;
  };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, functions }: ApiParams): Promise<ApiResponse> => {
  const nodeId = data.nodeId.trim();
  const nodeSecret = data.nodeSecret.trim();

  if (!nodeId || !nodeSecret) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  const expectedSecret = process.env.CAMERA_NODE_SHARED_SECRET?.trim();
  if (!expectedSecret) {
    return { status: 'error', errorCode: 'camera.nodeSecretMissing', httpStatus: 500 };
  }

  if (nodeSecret !== expectedSecret) {
    return { status: 'error', errorCode: 'camera.nodeUnauthorized', httpStatus: 403 };
  }

  const [pendingError, commands] = await tryCatch(async () => {
    return functions.cameraNode.getPendingCommands({
      nodeId,
      limit: typeof data.limit === 'number' ? data.limit : 20,
    });
  });

  if (pendingError || !commands) {
    return { status: 'error', errorCode: 'camera.nodeQueueFailed', httpStatus: 500 };
  }

  return {
    status: 'success',
    nodeId,
    channel: functions.cameraNode.getCommandChannel(),
    commands,
  };
};
