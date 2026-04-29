import redis, { redisSubscriber } from './redis';
import { isCameraLogEnabled } from '../utils/cameraLogFlagStore';

const projectPrefix = process.env.PROJECT_NAME ? `${process.env.PROJECT_NAME}-` : '';
const NODE_COMMAND_CHANNEL = `${projectPrefix}camera-node:commands`;

//? Per-cameraIp long-poll waiter registry. When a Pi Zero polls and the queue
//? is empty, we register a one-shot resolver here and wait for either an
//? enqueueCommand pub/sub notification or a timeout. This eliminates the
//? Pi-Zero-side polling loop without forcing the node into socket.io.
type CommandWaiter = () => void;
const waitersByCameraIp = new Map<string, Set<CommandWaiter>>();
let subscriberInitialized = false;

const ensureCommandSubscriber = (): void => {
  if (subscriberInitialized) {
    return;
  }
  subscriberInitialized = true;

  void redisSubscriber.subscribe(NODE_COMMAND_CHANNEL).catch((err) => {
    console.error('cameraNode: failed to subscribe to command channel', err);
    subscriberInitialized = false;
  });

  redisSubscriber.on('message', (channel, message) => {
    if (channel !== NODE_COMMAND_CHANNEL) {
      return;
    }
    let parsed: { cameraIp?: unknown };
    try {
      parsed = JSON.parse(message) as { cameraIp?: unknown };
    } catch {
      return;
    }
    const cameraIp = typeof parsed.cameraIp === 'string' ? parsed.cameraIp.trim() : '';
    if (!cameraIp) {
      return;
    }
    const waiters = waitersByCameraIp.get(cameraIp);
    if (!waiters || waiters.size === 0) {
      return;
    }
    //? Wake every waiter for this cameraIp. Each one will LPOP and decide
    //? whether the message it received was its own.
    for (const waiter of waiters) {
      waiter();
    }
  });
};

export interface CameraNodeCommand {
  commandId: string;
  cameraId: string;
  cameraIp: string;
  action: string;
  payload: Record<string, unknown>;
  requestedByUserId: string;
  requestedAt: string;
}

export const getNodeQueueKey = (cameraIp: string): string => {
  return `${projectPrefix}camera-node:queue:${cameraIp}`;
};

export const getCommandChannel = (): string => {
  return NODE_COMMAND_CHANNEL;
};

export const enqueueCommand = async ({
  cameraIp,
  cameraId,
  commandId,
  action,
  payload,
  requestedByUserId,
  coalesceAction,
}: {
  cameraIp: string;
  cameraId: string;
  commandId: string;
  action: string;
  payload?: Record<string, unknown>;
  requestedByUserId: string;
  coalesceAction?: string;
}): Promise<{
  queued: boolean;
  publishedReceivers: number;
}> => {
  const normalizedCameraIp = cameraIp.trim();
  if (!normalizedCameraIp) {
    return {
      queued: false,
      publishedReceivers: 0,
    };
  }

  const command: CameraNodeCommand = {
    commandId,
    cameraId,
    cameraIp: normalizedCameraIp,
    action,
    payload: payload ?? {},
    requestedByUserId,
    requestedAt: new Date().toISOString(),
  };

  const message = JSON.stringify(command);
  const queueKey = getNodeQueueKey(normalizedCameraIp);

  if (coalesceAction) {
    // Best-effort coalesce: read the queue, drop matching actions, replace.
    // Race-safe against the Pi Zero's LPOP — worst case a single duplicate
    // sneaks through, which the Pi Zero just applies.
    const existing = await redis.lrange(queueKey, 0, -1);
    const kept: string[] = [];
    let dropped = 0;
    for (const item of existing) {
      try {
        const parsed = JSON.parse(item) as { action?: string };
        if (parsed.action === coalesceAction) {
          dropped += 1;
          continue;
        }
      } catch {
        // keep unparseable items intact
      }
      kept.push(item);
    }
    if (dropped > 0) {
      const tx = redis.multi();
      tx.del(queueKey);
      if (kept.length > 0) tx.rpush(queueKey, ...kept);
      await tx.exec();
      console.log(
        `[cam ${cameraId}] coalesced ${String(dropped)} queued ${coalesceAction} command(s) before enqueueing ${commandId}`,
      );
    }
  }

  await redis.rpush(queueKey, message);
  await redis.expire(queueKey, 60 * 60 * 24);

  const publishedReceivers = await redis.publish(NODE_COMMAND_CHANNEL, message);

  console.log(
    `[cam ${cameraId}] enqueueCommand action=${action} commandId=${commandId} ip=${normalizedCameraIp} pubReceivers=${String(publishedReceivers)}`,
  );

  if (isCameraLogEnabled(cameraId, 'commandQueue')) {
    console.log(
      `[commandQueue] cameraId=${cameraId} action=${action} payload=${JSON.stringify(payload ?? {})} requestedBy=${requestedByUserId}`,
    );
  }

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
  cameraIp,
  limit = 20,
}: {
  cameraIp: string;
  limit?: number;
}): Promise<CameraNodeCommand[]> => {
  const normalizedCameraIp = cameraIp.trim();
  if (!normalizedCameraIp) {
    return [];
  }

  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const queueKey = getNodeQueueKey(normalizedCameraIp);

  const raw = await redis.lpop(queueKey, safeLimit);
  return toCommandArray(raw);
};

//? Long-poll wait: register a waiter for this cameraIp, wait until either an
//? enqueueCommand pub/sub message wakes it or `timeoutMs` elapses. Resolves
//? with `true` if woken by a publish, `false` on timeout.
export const waitForCommandSignal = async ({
  cameraIp,
  timeoutMs,
}: {
  cameraIp: string;
  timeoutMs: number;
}): Promise<boolean> => {
  const normalizedCameraIp = cameraIp.trim();
  if (!normalizedCameraIp) {
    return false;
  }

  ensureCommandSubscriber();

  return new Promise<boolean>((resolve) => {
    let waiters = waitersByCameraIp.get(normalizedCameraIp);
    if (!waiters) {
      waiters = new Set<CommandWaiter>();
      waitersByCameraIp.set(normalizedCameraIp, waiters);
    }

    let settled = false;
    const cleanup = () => {
      const set = waitersByCameraIp.get(normalizedCameraIp);
      if (set) {
        set.delete(waiter);
        if (set.size === 0) {
          waitersByCameraIp.delete(normalizedCameraIp);
        }
      }
    };

    const waiter: CommandWaiter = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve(true);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(false);
    }, Math.max(1, timeoutMs));

    waiters.add(waiter);
  });
};
