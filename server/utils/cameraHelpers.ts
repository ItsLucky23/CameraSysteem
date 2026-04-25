import redis from '../functions/redis';
import { getIoInstance } from '../sockets/socket';

type CameraAccessLike = {
  canPreview?: boolean;
  canControl?: boolean;
};

export const CAMERA_ACTIONS = [
  'panLeft',
  'panRight',
  'tiltUp',
  'tiltDown',
  'irOn',
  'irOff',
  'recordStart',
  'recordStop',
] as const;

export type CameraAction = (typeof CAMERA_ACTIONS)[number];

const projectPrefix = process.env.PROJECT_NAME ? `${process.env.PROJECT_NAME}-` : '';

export const getCameraRoomCode = (cameraId: string): string => `camera-${cameraId}`;

export const getCameraLockKey = ({
  cameraId,
  action,
}: {
  cameraId: string;
  action: CameraAction;
}): string => `${projectPrefix}lock:camera:${cameraId}:action:${action}`;

export const getActiveUserTokensKey = (userId: string): string => `${projectPrefix}activeUsers:${userId}`;

export const isCameraAction = (value: string): value is CameraAction => {
  return CAMERA_ACTIONS.includes(value as CameraAction);
};

export const canPreviewCamera = ({
  isAdmin,
  access,
}: {
  isAdmin: boolean;
  access: CameraAccessLike | null;
}): boolean => {
  if (isAdmin) {
    return true;
  }

  return Boolean(access?.canPreview);
};

export const canControlCamera = ({
  isAdmin,
  access,
}: {
  isAdmin: boolean;
  access: CameraAccessLike | null;
}): boolean => {
  if (isAdmin) {
    return true;
  }

  return Boolean(access?.canControl);
};

export const acquireCameraActionLock = async ({
  cameraId,
  action,
  userId,
  commandId,
  ttlMs = 3000,
}: {
  cameraId: string;
  action: CameraAction;
  userId: string;
  commandId: string;
  ttlMs?: number;
}): Promise<{
  acquired: boolean;
  cooldownMs: number;
  cooldownSeconds: number;
  lockUntil: string;
}> => {
  const lockKey = getCameraLockKey({ cameraId, action });
  const now = Date.now();
  const nextLockUntil = now + ttlMs;

  const lockValue = JSON.stringify({
    lockedByUserId: userId,
    commandId,
    lockUntil: nextLockUntil,
  });

  const lockResult = await redis.set(lockKey, lockValue, 'PX', ttlMs, 'NX');
  if (lockResult === 'OK') {
    return {
      acquired: true,
      cooldownMs: ttlMs,
      cooldownSeconds: Math.max(1, Math.ceil(ttlMs / 1000)),
      lockUntil: new Date(nextLockUntil).toISOString(),
    };
  }

  const ttlRemaining = await redis.pttl(lockKey);
  const safeCooldownMs = ttlRemaining > 0 ? ttlRemaining : ttlMs;

  return {
    acquired: false,
    cooldownMs: safeCooldownMs,
    cooldownSeconds: Math.max(1, Math.ceil(safeCooldownMs / 1000)),
    lockUntil: new Date(Date.now() + safeCooldownMs).toISOString(),
  };
};

export const emitCameraSyncEvent = ({
  fullName,
  receiver,
  serverOutput,
}: {
  fullName: string;
  receiver: string;
  serverOutput: Record<string, unknown>;
}): void => {
  //? Pull cameraId out of the payload so every emit log is greppable by camera.
  const cameraId = typeof (serverOutput as { cameraId?: unknown }).cameraId === 'string'
    ? (serverOutput as { cameraId: string }).cameraId
    : null;
  const tag = cameraId ? `[cam ${cameraId}]` : '[cam ?]';

  //? Resolve through the globalThis singleton on every call. Reading the
  //? imported binding once at module load gives us a stale null whenever HMR
  //? re-imports cameraHelpers.ts before loadSocket() has populated the new
  //? module's ioInstance.
  const ioInstance = getIoInstance();

  if (!ioInstance) {
    //? Loud about this — if it ever fires it means the HTTP API runs in a
    //? module instance that hasn't seen loadSocket() (HMR / split bundles).
    console.warn(
      `${tag} emitCameraSyncEvent: ioInstance is null, dropping ${fullName} -> ${receiver}`,
    );
    return;
  }

  const routeSegments = fullName.split('/').filter(Boolean);
  const callbackRoute = routeSegments.slice(1).join('/');

  const payload = {
    cb: callbackRoute,
    fullName,
    serverOutput,
    clientOutput: {},
    status: 'success' as const,
    message: `${fullName} success`,
  };

  if (receiver === 'all') {
    const recipients = ioInstance.sockets.sockets.size;
    console.log(`${tag} sync emit ${fullName} -> all (sockets=${String(recipients)})`);
    ioInstance.emit('sync', payload);
    return;
  }

  //? Count membership BEFORE emit so we can tell whether the client is actually
  //? in the receiver room. If members=0 but the user expects to be subscribed,
  //? the client either never joined or its room membership was lost on a reconnect.
  const room = ioInstance.sockets.adapter.rooms.get(receiver);
  const roomSize = room ? room.size : 0;
  console.log(`${tag} sync emit ${fullName} -> ${receiver} (members=${String(roomSize)})`);
  ioInstance.to(receiver).emit('sync', payload);
};
