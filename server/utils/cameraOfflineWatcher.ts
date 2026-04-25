import { prisma } from '../functions/db';
import { tryCatch } from '../functions/tryCatch';
import { emitCameraSyncEvent, getCameraRoomCode } from './cameraHelpers';
import { cameraRecordingManager } from './cameraRecordingManager';

const CAMERA_OFFLINE_TIMEOUT_MS = 15_000;
const CAMERA_OFFLINE_SWEEP_INTERVAL_MS = 5_000;
const SECTION_DIVIDER = '-'.repeat(60);

const OFFLINE_WATCHER_SINGLETON_KEY = '__luckyStackCameraOfflineWatcherState__';

interface OfflineWatcherSingletonState {
  sweepTimer: ReturnType<typeof globalThis.setInterval> | null;
  started: boolean;
}

const watcherScope = globalThis as typeof globalThis & {
  [OFFLINE_WATCHER_SINGLETON_KEY]?: OfflineWatcherSingletonState;
};

const watcherState: OfflineWatcherSingletonState = watcherScope[OFFLINE_WATCHER_SINGLETON_KEY] ?? {
  sweepTimer: null,
  started: false,
};

if (!watcherScope[OFFLINE_WATCHER_SINGLETON_KEY]) {
  watcherScope[OFFLINE_WATCHER_SINGLETON_KEY] = watcherState;
}

const sweepOnce = async (): Promise<void> => {
  const cutoff = new Date(Date.now() - CAMERA_OFFLINE_TIMEOUT_MS);

  const [fetchError, staleCameras] = await tryCatch(async () => {
    return prisma.camera.findMany({
      where: {
        isOnline: true,
        lastSeenAt: { lt: cutoff },
      },
      select: { id: true, lastSeenAt: true },
    });
  });

  if (fetchError || !staleCameras || staleCameras.length === 0) {
    return;
  }

  for (const camera of staleCameras) {
    const ageMs = camera.lastSeenAt ? Date.now() - camera.lastSeenAt.getTime() : null;
    const ageS = ageMs === null ? '?' : (ageMs / 1000).toFixed(1);

    const [updateError] = await tryCatch(async () => {
      return prisma.camera.update({
        where: { id: camera.id },
        data: { isOnline: false },
      });
    });

    if (updateError) {
      console.warn(`[offline-watcher] failed to mark camera ${camera.id} offline: ${updateError.message}`);
      continue;
    }

    console.log('');
    console.log(SECTION_DIVIDER);
    console.log(`[offline-watcher] camera ${camera.id} went offline (last seen ${ageS}s ago)`);
    console.log(SECTION_DIVIDER);

    const patch = { isOnline: false };

    emitCameraSyncEvent({
      fullName: 'sync/cameras/cameraStateUpdated/v1',
      receiver: getCameraRoomCode(camera.id),
      serverOutput: {
        status: 'success',
        cameraId: camera.id,
        patch,
        at: new Date().toISOString(),
      },
    });

    emitCameraSyncEvent({
      fullName: 'sync/cameras/cameraStateUpdated/v1',
      receiver: 'cameras-overview',
      serverOutput: {
        status: 'success',
        cameraId: camera.id,
        patch,
        at: new Date().toISOString(),
      },
    });

    // Tell the recording manager so any in-progress recording on this camera
    // stops with reason=cameraOffline. tryCatch keeps a stop failure from
    // crashing the sweep loop.
    const [notifyError] = await tryCatch(async () => {
      return cameraRecordingManager.notifyCameraOffline(camera.id);
    });
    if (notifyError) {
      console.warn(
        `[offline-watcher] notifyCameraOffline failed for ${camera.id}: ${notifyError.message}`,
      );
    }
  }
};

export const startCameraOfflineWatcher = (): void => {
  if (watcherState.sweepTimer !== null) {
    watcherState.started = true;
    return;
  }

  watcherState.sweepTimer = globalThis.setInterval(() => {
    void sweepOnce();
  }, CAMERA_OFFLINE_SWEEP_INTERVAL_MS);

  watcherState.started = true;
};

export const isCameraOfflineWatcherStarted = (): boolean => {
  return watcherState.started;
};
