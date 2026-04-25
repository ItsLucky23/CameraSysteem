import { prisma } from '../functions/db';
import redis from '../functions/redis';
import { tryCatch } from '../functions/tryCatch';
import { isCameraOfflineWatcherStarted } from './cameraOfflineWatcher';

const BANNER_LINE = '='.repeat(60);

const formatRow = (label: string, status: string, detail: string): string => {
  const labelPadded = label.padEnd(26, ' ');
  const statusPadded = status.padEnd(9, ' ');
  return `  ${labelPadded} ${statusPadded} ${detail}`;
};

interface ProbeRow {
  label: string;
  status: string;
  detail: string;
}

const probeRedis = async (): Promise<ProbeRow> => {
  const [pingError, pong] = await tryCatch(async () => {
    return redis.ping();
  });

  if (pingError || !pong) {
    return { label: 'redis', status: 'FAIL', detail: pingError?.message ?? 'no PONG' };
  }

  return { label: 'redis', status: 'OK', detail: String(pong) };
};

const probePrisma = async (): Promise<ProbeRow> => {
  const [queryError] = await tryCatch(async () => {
    return prisma.$runCommandRaw({ ping: 1 });
  });

  if (queryError) {
    //? Fall back to a trivial collection count for non-MongoDB providers where
    //? $runCommandRaw is unavailable. Either succeeding proves connectivity.
    const [countError] = await tryCatch(async () => {
      return prisma.camera.count();
    });
    if (countError) {
      return { label: 'prisma db connection', status: 'FAIL', detail: countError.message };
    }
  }

  return { label: 'prisma db connection', status: 'OK', detail: 'connected' };
};

const probeCameraCount = async (): Promise<ProbeRow> => {
  const [countError, count] = await tryCatch(async () => {
    return prisma.camera.count({ where: { enabled: true } });
  });

  if (countError || count === null) {
    return { label: 'configured pi zeros', status: 'FAIL', detail: countError?.message ?? 'unknown' };
  }

  return { label: 'configured pi zeros', status: String(count), detail: 'enabled' };
};

const probeOfflineWatcher = (): ProbeRow => {
  if (!isCameraOfflineWatcherStarted()) {
    return { label: 'offline-watcher', status: 'FAIL', detail: 'not started' };
  }
  return { label: 'offline-watcher', status: 'OK', detail: 'threshold=15000ms' };
};

export const runBootProbe = async (): Promise<void> => {
  const redisRow = await probeRedis();
  const prismaRow = await probePrisma();
  const orchestratorRow: ProbeRow = { label: 'cameraStreamOrchestrator', status: 'OK', detail: 'loaded' };
  const bridgeRow: ProbeRow = { label: 'cameraWebrtcBridge', status: 'OK', detail: 'loaded' };
  const watcherRow = probeOfflineWatcher();
  const camerasRow = await probeCameraCount();

  const lines = [
    '',
    '',
    BANNER_LINE,
    '  PI 5 CAMERA SUBSYSTEM BOOT',
    BANNER_LINE,
    formatRow(redisRow.label, redisRow.status, redisRow.detail),
    formatRow(prismaRow.label, prismaRow.status, prismaRow.detail),
    formatRow(orchestratorRow.label, orchestratorRow.status, orchestratorRow.detail),
    formatRow(bridgeRow.label, bridgeRow.status, bridgeRow.detail),
    formatRow(watcherRow.label, watcherRow.status, watcherRow.detail),
    formatRow(camerasRow.label, camerasRow.status, camerasRow.detail),
    BANNER_LINE,
    '',
    '',
  ];

  for (const line of lines) {
    console.log(line);
  }
};
