import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { tryCatch } from '../../../server/functions/tryCatch';
import { waitForCommandSignal } from '../../../server/functions/cameraNode';

export const rateLimit: number | false = 240;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: false,
  additional: [],
};

export interface ApiParams {
  data: {
    cameraIp: string;
    nodeSecret: string;
    limit?: number;
    waitMs?: number;
  };
  user: SessionLayout;
  functions: Functions;
}

//? Cap how long the server holds the request open. Has to be shorter than the
//? Pi Zero side HTTP timeout, and well under any upstream proxy idle timeout
//? (most are 60s+).
const MAX_LONG_POLL_MS = 25000;

export const main = async ({ data, functions }: ApiParams): Promise<ApiResponse> => {
  const cameraIp = data.cameraIp.trim();
  const nodeSecret = data.nodeSecret.trim();

  if (!cameraIp || !nodeSecret) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  const expectedSecret = process.env.CAMERA_NODE_SHARED_SECRET?.trim();
  if (!expectedSecret) {
    return { status: 'error', errorCode: 'camera.nodeSecretMissing', httpStatus: 500 };
  }

  if (nodeSecret !== expectedSecret) {
    return { status: 'error', errorCode: 'camera.nodeUnauthorized', httpStatus: 403 };
  }

  const limit = typeof data.limit === 'number' ? data.limit : 20;
  const requestedWaitMs = typeof data.waitMs === 'number' ? data.waitMs : MAX_LONG_POLL_MS;
  const waitMs = Math.max(0, Math.min(MAX_LONG_POLL_MS, requestedWaitMs));

  //? First-pass drain. If the queue already has work, return immediately and
  //? skip the long-poll. Common case when commands are firing in quick bursts
  //? (e.g. PTZ hold, or reconciler-triggered stop+start).
  const [firstPopError, firstBatch] = await tryCatch(async () => {
    return functions.cameraNode.getPendingCommands({ cameraIp, limit });
  });

  if (firstPopError || !firstBatch) {
    return { status: 'error', errorCode: 'camera.nodeQueueFailed', httpStatus: 500 };
  }

  if (firstBatch.length > 0 || waitMs === 0) {
    if (firstBatch.length > 0) {
      const actions = firstBatch.map((c) => `${c.action}/${c.commandId.slice(0, 8)}`).join(', ');
      console.log(`[node ${cameraIp}] long-poll fast-path returned ${String(firstBatch.length)} command(s): ${actions}`);
    }
    return {
      status: 'success',
      cameraIp,
      channel: functions.cameraNode.getCommandChannel(),
      commands: firstBatch,
    };
  }

  //? Block until either the pub/sub channel signals a new command for this
  //? cameraIp or the long-poll timeout elapses. The waiter resolves true when
  //? a publish wakes it (re-LPOP to drain) and false on timeout (return empty
  //? so the Pi Zero can reissue the request immediately).
  console.log(`[node ${cameraIp}] long-poll waiting up to ${String(waitMs)}ms`);
  const wokenByPublish = await waitForCommandSignal({ cameraIp, timeoutMs: waitMs });

  const [secondPopError, secondBatch] = await tryCatch(async () => {
    return functions.cameraNode.getPendingCommands({ cameraIp, limit });
  });

  if (secondPopError || !secondBatch) {
    return { status: 'error', errorCode: 'camera.nodeQueueFailed', httpStatus: 500 };
  }

  if (secondBatch.length > 0) {
    const actions = secondBatch.map((c) => `${c.action}/${c.commandId.slice(0, 8)}`).join(', ');
    console.log(`[node ${cameraIp}] long-poll wake (publish=${String(wokenByPublish)}) returned ${String(secondBatch.length)} command(s): ${actions}`);
  } else {
    console.log(`[node ${cameraIp}] long-poll timeout, no commands queued`);
  }

  return {
    status: 'success',
    cameraIp,
    channel: functions.cameraNode.getCommandChannel(),
    commands: secondBatch,
  };
};
