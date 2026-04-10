import redis from '../functions/redis';
import { ioInstance } from '../sockets/socket';

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

export const getCameraPreviewTokenKey = (token: string): string => `${projectPrefix}camera-preview-token:${token}`;

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
  if (!ioInstance) {
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
    ioInstance.emit('sync', payload);
    return;
  }

  ioInstance.to(receiver).emit('sync', payload);
};
