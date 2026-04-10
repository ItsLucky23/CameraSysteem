import redis from './redis';

const projectPrefix = process.env.PROJECT_NAME ? `${process.env.PROJECT_NAME}-` : '';
const NODE_COMMAND_CHANNEL = `${projectPrefix}camera-node:commands`;

export interface CameraNodeCommand {
  commandId: string;
  cameraId: string;
  nodeId: string;
  action: string;
  payload: Record<string, string | number | boolean | null>;
  requestedByUserId: string;
  requestedAt: string;
}

export const getNodeQueueKey = (nodeId: string): string => {
  return `${projectPrefix}camera-node:queue:${nodeId}`;
};

export const getCommandChannel = (): string => {
  return NODE_COMMAND_CHANNEL;
};

export const enqueueCommand = async ({
  nodeId,
  cameraId,
  commandId,
  action,
  payload,
  requestedByUserId,
}: {
  nodeId: string;
  cameraId: string;
  commandId: string;
  action: string;
  payload?: Record<string, string | number | boolean | null>;
  requestedByUserId: string;
}): Promise<{
  queued: boolean;
  publishedReceivers: number;
}> => {
  const normalizedNodeId = nodeId.trim();
  if (!normalizedNodeId) {
    return {
      queued: false,
      publishedReceivers: 0,
    };
  }

  const command: CameraNodeCommand = {
    commandId,
    cameraId,
    nodeId: normalizedNodeId,
    action,
    payload: payload ?? {},
    requestedByUserId,
    requestedAt: new Date().toISOString(),
  };

  const message = JSON.stringify(command);
  const queueKey = getNodeQueueKey(normalizedNodeId);

  await redis.rpush(queueKey, message);
  await redis.expire(queueKey, 60 * 60 * 24);

  const publishedReceivers = await redis.publish(NODE_COMMAND_CHANNEL, message);

  return {
    queued: true,
    publishedReceivers,
  };
};

const toCommandArray = (value: string | string[] | null): CameraNodeCommand[] => {
  if (!value) {
    return [];
  }

  const items = Array.isArray(value) ? value : [value];
  const parsed: CameraNodeCommand[] = [];

  for (const item of items) {
    try {
      const command = JSON.parse(item) as CameraNodeCommand;
      if (!command || typeof command !== 'object') {
        continue;
      }

      parsed.push(command);
    } catch {
      continue;
    }
  }

  return parsed;
};

export const getPendingCommands = async ({
  nodeId,
  limit = 20,
}: {
  nodeId: string;
  limit?: number;
}): Promise<CameraNodeCommand[]> => {
  const normalizedNodeId = nodeId.trim();
  if (!normalizedNodeId) {
    return [];
  }

  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const queueKey = getNodeQueueKey(normalizedNodeId);

  const raw = await redis.lpop(queueKey, safeLimit);
  return toCommandArray(raw);
};
