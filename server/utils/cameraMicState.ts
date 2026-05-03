import redis from '../functions/redis';
import { tryCatch } from '../functions/tryCatch';

// Tracks which user (if any) currently has their browser microphone enabled
// for talking into a given camera. The key TTL matches the control-session
// TTL so a user that closes the tab without disabling first can't
// indefinitely hold the slot — releasing control implicitly clears mic too.

const projectPrefix = process.env.PROJECT_NAME ? `${process.env.PROJECT_NAME}-` : '';

interface MicEnabledRecord {
  userId: string;
  userName: string;
  enabledAt: number;
}

const getKey = (cameraId: string): string => `${projectPrefix}camera:mic:${cameraId}`;

export const getMicEnabled = async (cameraId: string): Promise<MicEnabledRecord | null> => {
  const [readError, raw] = await tryCatch(async () => redis.get(getKey(cameraId)));
  if (readError || !raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MicEnabledRecord>;
    if (typeof parsed.userId !== 'string' || typeof parsed.enabledAt !== 'number') {
      return null;
    }
    return {
      userId: parsed.userId,
      userName: typeof parsed.userName === 'string' ? parsed.userName : '',
      enabledAt: parsed.enabledAt,
    };
  } catch {
    return null;
  }
};

export const setMicEnabled = async ({
  cameraId,
  userId,
  userName,
  ttlMs,
}: {
  cameraId: string;
  userId: string;
  userName: string;
  ttlMs: number;
}): Promise<void> => {
  const record: MicEnabledRecord = {
    userId,
    userName,
    enabledAt: Date.now(),
  };
  await redis.set(getKey(cameraId), JSON.stringify(record), 'PX', Math.max(1000, ttlMs));
};

export const clearMicEnabled = async ({ cameraId }: { cameraId: string }): Promise<void> => {
  await redis.del(getKey(cameraId));
};
