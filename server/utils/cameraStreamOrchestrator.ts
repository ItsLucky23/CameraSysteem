import { randomUUID } from 'node:crypto';

import { prisma } from '../functions/db';
import { enqueueCommand } from '../functions/cameraNode';
import { tryCatch } from '../functions/tryCatch';

import {
  getCameraIngestRtpPort,
  isCameraIngestRunning,
  startCameraIngest,
  stopCameraIngest,
} from './cameraWebrtcBridge';

const SYSTEM_USER_ID = '__system__';

const connectedSocketIds = new Set<string>();

// Per-camera activation state so we never double-start the Pi Zero stream.
const activatedCameraIds = new Set<string>();

// Quality -> bitrate (bits per second). rpicam-vid --bitrate takes bps.
const qualityBitrateBps: Record<string, number> = {
  low: 1_000_000,
  medium: 2_000_000,
  high: 4_000_000,
};

const resolveBitrateBps = (quality: string | null | undefined): number => {
  if (!quality) return qualityBitrateBps.medium;
  return qualityBitrateBps[quality] ?? qualityBitrateBps.medium;
};

const getPi5LanIp = (): string | null => {
  const value = process.env.PI5_LAN_IP?.trim();
  return value && value.length > 0 ? value : null;
};

const fetchCameraStreamConfig = async (
  cameraId: string,
): Promise<{ targetFps: number; bitrateBps: number } | null> => {
  const [fetchError, camera] = await tryCatch(async () => {
    return prisma.camera.findUnique({
      where: { id: cameraId },
      select: { targetFps: true, quality: true },
    });
  });

  if (fetchError || !camera) {
    return null;
  }

  // MongoDB docs created before the schema added these fields won't carry them.
  // Fall back to the schema defaults so the stream still starts.
  const targetFps = typeof camera.targetFps === 'number' ? camera.targetFps : 15;
  const quality = camera.quality ?? 'medium';

  return {
    targetFps,
    bitrateBps: resolveBitrateBps(quality),
  };
};

const activateCamera = async ({
  cameraId,
  cameraIp,
}: {
  cameraId: string;
  cameraIp: string;
}): Promise<void> => {
  if (activatedCameraIds.has(cameraId)) {
    console.log(`cameraStreamOrchestrator: activateCamera short-circuit — ${cameraId} already active`);
    return;
  }
  console.log(`cameraStreamOrchestrator: activateCamera ${cameraId} (ip=${cameraIp})`);

  const pi5LanIp = getPi5LanIp();
  if (!pi5LanIp) {
    console.warn(
      `cameraStreamOrchestrator: cannot activate camera ${cameraId} — PI5_LAN_IP is not set`,
    );
    return;
  }

  const streamConfig = await fetchCameraStreamConfig(cameraId);
  if (!streamConfig) {
    console.error(`cameraStreamOrchestrator: failed to fetch stream config for ${cameraId}`);
    return;
  }
  console.log(
    `cameraStreamOrchestrator: stream config for ${cameraId} -> targetFps=${String(streamConfig.targetFps)} bitrateBps=${String(streamConfig.bitrateBps)}`,
  );

  const [ingestError, ingestResult] = await tryCatch(() => {
    if (isCameraIngestRunning(cameraId)) {
      const port = getCameraIngestRtpPort(cameraId);
      return port !== null ? { rtpPort: port } : startCameraIngest({ cameraId });
    }
    return startCameraIngest({ cameraId });
  });

  if (ingestError || !ingestResult) {
    console.error(`cameraStreamOrchestrator: failed to start ingest for ${cameraId}`, ingestError);
    return;
  }

  const startPayload = {
    rtpHost: pi5LanIp,
    rtpPort: ingestResult.rtpPort,
    targetFps: streamConfig.targetFps,
    bitrateBps: streamConfig.bitrateBps,
  };
  console.log(
    `cameraStreamOrchestrator: enqueue startVideoStream for ${cameraId} payload=${JSON.stringify(startPayload)}`,
  );

  const [enqueueError] = await tryCatch(async () => {
    return enqueueCommand({
      cameraIp,
      cameraId,
      commandId: randomUUID(),
      action: 'startVideoStream',
      payload: startPayload,
      requestedByUserId: SYSTEM_USER_ID,
    });
  });

  if (enqueueError) {
    console.error(`cameraStreamOrchestrator: failed to enqueue startVideoStream for ${cameraId}`, enqueueError);
    stopCameraIngest({ cameraId });
    return;
  }

  activatedCameraIds.add(cameraId);
};

const deactivateCamera = async ({
  cameraId,
  cameraIp,
}: {
  cameraId: string;
  cameraIp: string;
}): Promise<void> => {
  activatedCameraIds.delete(cameraId);

  await tryCatch(async () => {
    return enqueueCommand({
      cameraIp,
      cameraId,
      commandId: randomUUID(),
      action: 'stopVideoStream',
      payload: {},
      requestedByUserId: SYSTEM_USER_ID,
    });
  });

  stopCameraIngest({ cameraId });
};

const activateAllEnabledCameras = async (): Promise<void> => {
  const [fetchError, cameras] = await tryCatch(async () => {
    return prisma.camera.findMany({
      where: { enabled: true },
      select: { id: true, ip: true },
    });
  });

  if (fetchError || !cameras) {
    console.error('cameraStreamOrchestrator: failed to fetch enabled cameras for activation', fetchError);
    return;
  }

  await Promise.all(cameras.map((camera) => {
    return activateCamera({ cameraId: camera.id, cameraIp: camera.ip });
  }));
};

const deactivateAllCameras = async (): Promise<void> => {
  const activeIds = Array.from(activatedCameraIds);
  if (activeIds.length === 0) {
    return;
  }

  const [fetchError, cameras] = await tryCatch(async () => {
    return prisma.camera.findMany({
      where: { id: { in: activeIds } },
      select: { id: true, ip: true },
    });
  });

  if (fetchError || !cameras) {
    for (const cameraId of activeIds) {
      stopCameraIngest({ cameraId });
      activatedCameraIds.delete(cameraId);
    }
    return;
  }

  await Promise.all(cameras.map((camera) => {
    return deactivateCamera({ cameraId: camera.id, cameraIp: camera.ip });
  }));
};

export const notifySocketConnected = (socketId: string): void => {
  const wasEmpty = connectedSocketIds.size === 0;
  connectedSocketIds.add(socketId);
  console.log(
    `cameraStreamOrchestrator: socket connected (id=${socketId}, total=${String(connectedSocketIds.size)}, wasEmpty=${String(wasEmpty)})`,
  );

  if (wasEmpty) {
    void activateAllEnabledCameras();
  }
};

export const notifySocketDisconnected = (socketId: string): void => {
  if (!connectedSocketIds.delete(socketId)) {
    return;
  }

  if (connectedSocketIds.size === 0) {
    void deactivateAllCameras();
  }
};

// Called on server boot so any Pi Zeros left streaming by a previous Pi 5 instance stop.
export const broadcastStreamStopOnBoot = async (): Promise<void> => {
  const [fetchError, cameras] = await tryCatch(async () => {
    return prisma.camera.findMany({ select: { id: true, ip: true } });
  });

  if (fetchError || !cameras) {
    console.error('cameraStreamOrchestrator: boot broadcast failed — could not fetch cameras', fetchError);
    return;
  }

  await Promise.all(cameras.map((camera) => {
    return tryCatch(async () => {
      return enqueueCommand({
        cameraIp: camera.ip,
        cameraId: camera.id,
        commandId: randomUUID(),
        action: 'stopVideoStream',
        payload: {},
        requestedByUserId: SYSTEM_USER_ID,
      });
    });
  }));
};

// Called from admin flows when a camera gets enabled/disabled while the site has users.
export const onCameraEnabledChanged = async ({
  cameraId,
  cameraIp,
  enabled,
}: {
  cameraId: string;
  cameraIp: string;
  enabled: boolean;
}): Promise<void> => {
  const hasConnectedSockets = connectedSocketIds.size > 0;

  if (enabled && hasConnectedSockets) {
    await activateCamera({ cameraId, cameraIp });
    return;
  }

  if (!enabled) {
    await deactivateCamera({ cameraId, cameraIp });
  }
};

// Called when admin edits fps/quality for a camera that is actively streaming.
// The Pi Zero pipeline params are baked in at start time, so a restart is required.
export const onCameraStreamConfigChanged = async ({
  cameraId,
  cameraIp,
}: {
  cameraId: string;
  cameraIp: string;
}): Promise<void> => {
  if (!activatedCameraIds.has(cameraId)) {
    return;
  }

  await deactivateCamera({ cameraId, cameraIp });
  await activateCamera({ cameraId, cameraIp });
};
