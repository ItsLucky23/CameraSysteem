import { randomUUID } from 'node:crypto';

import redis from '../functions/redis';
import { tryCatch } from '../functions/tryCatch';
import { emitCameraSyncEvent, getCameraRoomCode } from './cameraHelpers';

// One control session per camera. The TTL is short on purpose: a user that
// closes the tab without releasing leaves the slot for at most CONTROL_TTL_MS,
// after which anyone permitted can take it. Active controllers extend the TTL
// on every successful command via touchControlSession().

const projectPrefix = process.env.PROJECT_NAME ? `${process.env.PROJECT_NAME}-` : '';

export const CONTROL_TTL_MS = 60_000;

export interface ControlSessionRecord {
  userId: string;
  userName: string;
  sessionId: string;
  acquiredAt: number;
  expiresAt: number;
}

const getKey = (cameraId: string): string => `${projectPrefix}camera:controller:${cameraId}`;

const parseRecord = (raw: string | null): ControlSessionRecord | null => {
  if (!raw) return null;
  let parsed: Partial<ControlSessionRecord>;
  try {
    parsed = JSON.parse(raw) as Partial<ControlSessionRecord>;
  } catch {
    return null;
  }
  if (typeof parsed.userId !== 'string' || typeof parsed.sessionId !== 'string'
    || typeof parsed.acquiredAt !== 'number' || typeof parsed.expiresAt !== 'number') {
    return null;
  }
  return {
    userId: parsed.userId,
    userName: typeof parsed.userName === 'string' ? parsed.userName : '',
    sessionId: parsed.sessionId,
    acquiredAt: parsed.acquiredAt,
    expiresAt: parsed.expiresAt,
  };
};

const broadcast = (cameraId: string, record: ControlSessionRecord | null): void => {
  emitCameraSyncEvent({
    fullName: 'sync/cameras/controlSession/v1',
    receiver: getCameraRoomCode(cameraId),
    serverOutput: {
      status: 'success',
      cameraId,
      session: record === null ? null : {
        userId: record.userId,
        userName: record.userName,
        acquiredAt: new Date(record.acquiredAt).toISOString(),
        expiresAt: new Date(record.expiresAt).toISOString(),
      },
    },
  });
};

export const getControlSession = async (cameraId: string): Promise<ControlSessionRecord | null> => {
  const [readError, raw] = await tryCatch(async () => redis.get(getKey(cameraId)));
  if (readError) return null;
  const record = parseRecord(raw);
  if (!record) return null;
  // Defensive: drop expired (Redis TTL should already have wiped it).
  if (record.expiresAt < Date.now()) return null;
  return record;
};

export const acquireControlSession = async ({
  cameraId,
  userId,
  userName,
  takeOver,
}: {
  cameraId: string;
  userId: string;
  userName: string;
  takeOver: boolean;
}): Promise<{
  status: 'acquired' | 'alreadyHeld' | 'heldByOther';
  session: ControlSessionRecord;
} | { status: 'heldByOther'; session: ControlSessionRecord }> => {
  const existing = await getControlSession(cameraId);

  if (existing) {
    // Re-acquire by the same user is a no-op extension.
    if (existing.userId === userId) {
      const refreshed = await refreshControlSession(cameraId, existing.sessionId);
      return { status: 'alreadyHeld', session: refreshed ?? existing };
    }
    if (!takeOver) {
      return { status: 'heldByOther', session: existing };
    }
  }

  const now = Date.now();
  const record: ControlSessionRecord = {
    userId,
    userName,
    sessionId: randomUUID(),
    acquiredAt: now,
    expiresAt: now + CONTROL_TTL_MS,
  };

  await redis.set(getKey(cameraId), JSON.stringify(record), 'PX', CONTROL_TTL_MS);
  broadcast(cameraId, record);
  return { status: 'acquired', session: record };
};

export const releaseControlSession = async ({
  cameraId,
  userId,
  isAdmin,
}: {
  cameraId: string;
  userId: string;
  isAdmin: boolean;
}): Promise<{ released: boolean }> => {
  const existing = await getControlSession(cameraId);
  if (!existing) return { released: false };
  if (!isAdmin && existing.userId !== userId) return { released: false };

  await redis.del(getKey(cameraId));
  broadcast(cameraId, null);
  return { released: true };
};

export const refreshControlSession = async (
  cameraId: string,
  sessionId: string,
): Promise<ControlSessionRecord | null> => {
  const existing = await getControlSession(cameraId);
  if (!existing) return null;
  if (existing.sessionId !== sessionId) return null;

  const now = Date.now();
  const refreshed: ControlSessionRecord = {
    ...existing,
    expiresAt: now + CONTROL_TTL_MS,
  };
  await redis.set(getKey(cameraId), JSON.stringify(refreshed), 'PX', CONTROL_TTL_MS);
  // No re-broadcast on refresh — clients track expiry locally with a timer.
  return refreshed;
};

// Used by executeCameraCommand to enforce that the caller is the controller.
// Returns the refreshed session on success, or null if caller doesn't hold it.
export const assertCallerIsController = async ({
  cameraId,
  userId,
}: {
  cameraId: string;
  userId: string;
}): Promise<ControlSessionRecord | null> => {
  const existing = await getControlSession(cameraId);
  if (!existing) return null;
  if (existing.userId !== userId) return null;

  // Refresh the lease so an actively-controlling user doesn't get yanked
  // mid-session by TTL expiry.
  return refreshControlSession(cameraId, existing.sessionId);
};
