import { randomUUID } from 'node:crypto';

import { prisma } from '../functions/db';
import { enqueueCommand } from '../functions/cameraNode';
import { tryCatch } from '../functions/tryCatch';

import {
  getCameraIngestLastPacketAt,
  getCameraIngestRtpPort,
  isCameraIngestRunning,
  markCameraIngestKicked,
  startCameraIngest,
  stopCameraIngest,
} from './cameraWebrtcBridge';
import { cameraThumbnailExtractor } from './cameraThumbnailExtractor';

const SYSTEM_USER_ID = '__system__';

// Same reason as cameraWebrtcBridge: dev hot-reload swaps this module while
// Pi 5 stays up, so the socket/activation bookkeeping has to live on
// globalThis or a reload would wipe the state that the still-connected client
// and still-streaming Pi Zero depend on.
interface OrchestratorSingletonState {
  connectedSocketIds: Set<string>;
  activatedCameraIds: Set<string>;
  reconcileTimer: ReturnType<typeof globalThis.setInterval> | null;
  cameraIpById: Map<string, string>;
  // When the last socket disconnects we don't tear down the Pi Zero pipeline
  // immediately — flaky proxies / VPN / browser-tab throttling cause spurious
  // sub-second drops. We schedule a deferred deactivation and cancel it if a
  // socket reconnects within the grace window.
  pendingDeactivationTimer: ReturnType<typeof globalThis.setTimeout> | null;
  // Cameras with an in-progress recording. The orchestrator force-keeps the
  // stream active as long as a reservation is held, even if no browser sockets
  // are connected.
  recordingReservations: Set<string>;
}

const ORCHESTRATOR_SINGLETON_KEY = '__luckyStackCameraStreamOrchestratorState__';

const orchestratorScope = globalThis as typeof globalThis & {
  [ORCHESTRATOR_SINGLETON_KEY]?: OrchestratorSingletonState;
};

const orchestratorState: OrchestratorSingletonState = orchestratorScope[ORCHESTRATOR_SINGLETON_KEY] ?? {
  connectedSocketIds: new Set<string>(),
  activatedCameraIds: new Set<string>(),
  reconcileTimer: null,
  cameraIpById: new Map<string, string>(),
  pendingDeactivationTimer: null,
  recordingReservations: new Set<string>(),
};

// Backfill on HMR: an existing singleton from before this field was added
// won't carry recordingReservations, so initialize it lazily.
if (!orchestratorState.recordingReservations) {
  orchestratorState.recordingReservations = new Set<string>();
}

if (!orchestratorScope[ORCHESTRATOR_SINGLETON_KEY]) {
  orchestratorScope[ORCHESTRATOR_SINGLETON_KEY] = orchestratorState;
}

const connectedSocketIds = orchestratorState.connectedSocketIds;
// Per-camera activation state so we never double-start the Pi Zero stream.
const activatedCameraIds = orchestratorState.activatedCameraIds;
// Remembers the IP each activated camera was started with, so the reconciler
// can re-enqueue startVideoStream without another DB lookup.
const cameraIpById = orchestratorState.cameraIpById;
const recordingReservations = orchestratorState.recordingReservations;

// If ingest hasn't received an RTP packet in this many ms while the camera is
// supposed to be active, assume the Pi Zero pipeline died (reboot, crash) and
// re-issue startVideoStream.
//
// The threshold has to comfortably exceed the rpicam-vid cold-start cost on a
// Pi Zero 2W: libcamera init + IPA tuning load + sensor mode select takes ~10s
// before the first frame leaves the encoder. Setting this too low causes the
// reconciler to re-kick the pipeline before it has finished warming up, which
// produces an infinite stop/start loop. 20s gives enough slack on slow boots.
const STREAM_STALL_THRESHOLD_MS = 20000;
const RECONCILE_INTERVAL_MS = 4000;

// When the last connected socket leaves, hold off tearing down the Pi Zero
// pipeline for this long. Real-world client sockets flap intermittently
// (proxy idle timeouts, VPN reconnects, browser tab throttling) and tearing
// the camera down on every blip costs the user a 10-second cold-start the
// next time they reconnect.
const SOCKET_DEACTIVATION_GRACE_MS = 30000;

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
): Promise<{ targetFps: number; bitrateBps: number; quality: string } | null> => {
  const [fetchError, camera] = await tryCatch(async () => {
    return prisma.camera.findUnique({
      where: { id: cameraId },
      select: { targetFps: true, quality: true },
    });
  });

  if (fetchError || !camera) {
    return null;
  }

  //? MongoDB docs created before the schema added these fields won't carry
  //? them. Falling back silently was the pre-existing source of "the camera
  //? doesn't use my admin-configured fps/quality" reports — the doc literally
  //? doesn't have the field, so we returned 15/medium without any signal.
  //? Now we warn loudly so the operator knows the doc needs to be updated.
  const hasTargetFps = typeof camera.targetFps === 'number';
  const hasQuality = typeof camera.quality === 'string' && camera.quality.length > 0;
  const targetFps = hasTargetFps ? (camera.targetFps as number) : 15;
  const quality = hasQuality ? (camera.quality as string) : 'medium';

  if (!hasTargetFps || !hasQuality) {
    console.warn(
      `[cam ${cameraId}] DB stream config missing fields — using fallback. ` +
      `hasTargetFps=${String(hasTargetFps)} hasQuality=${String(hasQuality)}. ` +
      `Open admin and re-save this camera so the document gets the targetFps + quality fields persisted.`,
    );
  }

  console.log(
    `[cam ${cameraId}] DB stream config -> targetFps=${String(targetFps)} quality=${quality} bitrateBps=${String(resolveBitrateBps(quality))}`,
  );

  return {
    targetFps,
    quality,
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
    const lastPacketAt = getCameraIngestLastPacketAt(cameraId);
    const ageMs = lastPacketAt === null ? null : Date.now() - lastPacketAt;
    console.log(
      `[cam ${cameraId}] activateCamera short-circuit — already active (lastPacketAgeMs=${String(ageMs)})`,
    );
    //? If we think the camera is active but RTP has been silent for longer
    //? than the stall threshold, the Pi Zero almost certainly restarted while
    //? we held its activation slot. Force-kick to recover instead of waiting
    //? for the reconciler — this is the path that bites a user who restarts
    //? their Pi Zero and then opens the cameras page within 20s.
    if (ageMs !== null && ageMs > STREAM_STALL_THRESHOLD_MS) {
      console.warn(
        `[cam ${cameraId}] activateCamera detected stale ingest (${String(ageMs)}ms) — force-kicking Pi Zero`,
      );
      await kickPiZeroStream({ cameraId, cameraIp });
    }
    return;
  }
  console.log(`[cam ${cameraId}] activateCamera (ip=${cameraIp})`);

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
  cameraIpById.set(cameraId, cameraIp);
  ensureReconciler();

  // Spin up the Pi 5-side thumbnail extractor so dashboard / admin / cameras
  // page tiles get fresh JPEGs while the Pi Zero's sensor is locked by
  // rpicam-vid. ffmpeg taps the bridge's RTP fan-out, so no impact on the Pi
  // Zero pipeline. Idempotent — safe to call on re-activation.
  void cameraThumbnailExtractor.start(cameraId);
};

const deactivateCamera = async ({
  cameraId,
  cameraIp,
}: {
  cameraId: string;
  cameraIp: string;
}): Promise<void> => {
  activatedCameraIds.delete(cameraId);
  cameraIpById.delete(cameraId);

  // Stop the extractor BEFORE tearing down ingest so it can drain its last
  // chunk cleanly. Awaiting also gives ffmpeg a chance to flush.
  await cameraThumbnailExtractor.stop(cameraId);

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

// Send stop+start to the Pi Zero without touching the ingest socket or any
// connected WebRTC peers. Used by the reconciler so that a transient pipeline
// stall on the Pi Zero doesn't drop everyone watching the camera — viewers see
// a few seconds of frozen video instead of a connection drop + reconnect.
const kickPiZeroStream = async ({
  cameraId,
  cameraIp,
}: {
  cameraId: string;
  cameraIp: string;
}): Promise<void> => {
  const streamConfig = await fetchCameraStreamConfig(cameraId);
  if (!streamConfig) {
    console.error(`cameraStreamOrchestrator: kick aborted — no stream config for ${cameraId}`);
    return;
  }

  const rtpPort = getCameraIngestRtpPort(cameraId);
  if (rtpPort === null) {
    console.warn(`cameraStreamOrchestrator: kick aborted — ingest socket gone for ${cameraId}`);
    return;
  }

  const pi5LanIp = getPi5LanIp();
  if (!pi5LanIp) {
    console.warn(`cameraStreamOrchestrator: kick aborted — PI5_LAN_IP unset`);
    return;
  }

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

  await tryCatch(async () => {
    return enqueueCommand({
      cameraIp,
      cameraId,
      commandId: randomUUID(),
      action: 'startVideoStream',
      payload: {
        rtpHost: pi5LanIp,
        rtpPort,
        targetFps: streamConfig.targetFps,
        bitrateBps: streamConfig.bitrateBps,
      },
      requestedByUserId: SYSTEM_USER_ID,
    });
  });

  // Reset staleness window so we don't fire the kick again on the next tick
  // before the new pipeline has had a chance to produce its first packet.
  markCameraIngestKicked(cameraId);
};

// Self-healing: every RECONCILE_INTERVAL_MS, check each activated camera's
// ingest for RTP liveness. If no packet has arrived in STREAM_STALL_THRESHOLD_MS
// (Pi Zero rebooted, ffmpeg crashed, etc.), kick the Pi Zero pipeline.
const reconcileActiveStreams = async (): Promise<void> => {
  if (activatedCameraIds.size === 0) {
    return;
  }

  const now = Date.now();
  const stale: string[] = [];

  for (const cameraId of activatedCameraIds) {
    const lastPacketAt = getCameraIngestLastPacketAt(cameraId);
    // lastPacketAt null means activation just happened and no packet has arrived
    // yet — give it a grace window starting from "now - threshold" so we don't
    // spam re-enqueues right after first start.
    if (lastPacketAt === null) continue;
    if (now - lastPacketAt > STREAM_STALL_THRESHOLD_MS) {
      stale.push(cameraId);
    }
  }

  if (stale.length === 0) {
    return;
  }

  for (const cameraId of stale) {
    const cameraIp = cameraIpById.get(cameraId);
    if (!cameraIp) {
      continue;
    }
    console.warn(
      `cameraStreamOrchestrator: stream stalled for ${cameraId} (>${String(STREAM_STALL_THRESHOLD_MS)}ms with no RTP) — kicking Pi Zero (preserving ingest+peers)`,
    );
    // eslint-disable-next-line no-await-in-loop
    await kickPiZeroStream({ cameraId, cameraIp });
  }
};

const ensureReconciler = (): void => {
  if (orchestratorState.reconcileTimer !== null) {
    return;
  }
  orchestratorState.reconcileTimer = globalThis.setInterval(() => {
    void reconcileActiveStreams();
  }, RECONCILE_INTERVAL_MS);
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
  // Cameras that still have a recording reservation keep the stream live even
  // when no browser is connected. This is the single OR-condition added for
  // the recording feature: should-stay-active = has-socket || has-reservation.
  const activeIds = Array.from(activatedCameraIds).filter((cameraId) => !recordingReservations.has(cameraId));
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
  // If a deactivation was queued because the last socket left, cancel it.
  // The user came back inside the grace window and we want to keep the
  // already-running Pi Zero pipeline as-is (no restart cost).
  if (orchestratorState.pendingDeactivationTimer !== null) {
    globalThis.clearTimeout(orchestratorState.pendingDeactivationTimer);
    orchestratorState.pendingDeactivationTimer = null;
    console.log(
      `cameraStreamOrchestrator: cancelled pending deactivation — socket ${socketId} reconnected within grace window`,
    );
  }

  const wasEmpty = connectedSocketIds.size === 0;
  connectedSocketIds.add(socketId);
  console.log(
    `cameraStreamOrchestrator: socket connected (id=${socketId}, total=${String(connectedSocketIds.size)}, wasEmpty=${String(wasEmpty)})`,
  );

  // Only re-activate if the camera set is actually empty. If the grace timer
  // cancelled a pending deactivation, activatedCameraIds is still populated
  // and activateCamera would short-circuit anyway, but skipping the call keeps
  // the logs clean.
  if (wasEmpty && activatedCameraIds.size === 0) {
    void activateAllEnabledCameras();
  }
};

export const notifySocketDisconnected = (socketId: string): void => {
  if (!connectedSocketIds.delete(socketId)) {
    return;
  }

  if (connectedSocketIds.size > 0) {
    return;
  }

  // Last socket left. Defer the teardown — most disconnects we see in
  // production are transient (transport close due to proxy idle), and
  // restarting the pipeline costs a 10s libcamera cold start on reconnect.
  if (orchestratorState.pendingDeactivationTimer !== null) {
    globalThis.clearTimeout(orchestratorState.pendingDeactivationTimer);
  }
  console.log(
    `cameraStreamOrchestrator: last socket disconnected — deferring deactivation by ${String(SOCKET_DEACTIVATION_GRACE_MS)}ms`,
  );
  orchestratorState.pendingDeactivationTimer = globalThis.setTimeout(() => {
    orchestratorState.pendingDeactivationTimer = null;
    if (connectedSocketIds.size > 0) {
      // A reconnect happened between the last cancel-check and now. Skip.
      return;
    }
    console.log('cameraStreamOrchestrator: grace window expired — deactivating all cameras');
    void deactivateAllCameras();
  }, SOCKET_DEACTIVATION_GRACE_MS);
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
  const isActive = activatedCameraIds.has(cameraId);
  console.log(
    `cameraStreamOrchestrator: onCameraStreamConfigChanged ${cameraId} (isActive=${String(isActive)})`,
  );
  if (!isActive) {
    return;
  }

  await deactivateCamera({ cameraId, cameraIp });
  await activateCamera({ cameraId, cameraIp });
};

// Called by the recording manager when a recording is about to start. Marks
// the camera as eligible-to-stream regardless of socket count. Pure flag flip:
// the recording manager pairs this with ensureCameraActive to actually start
// the Pi Zero pipeline.
export const addRecordingReservation = (cameraId: string): void => {
  recordingReservations.add(cameraId);
};

// Cancel a pending grace-window deactivation and (if needed) start the Pi
// Zero stream so the recording sees RTP within the standard cold-start
// window. Idempotent: if the camera is already active, this is a no-op apart
// from the cancelled deactivation.
export const ensureCameraActive = async (cameraId: string): Promise<void> => {
  if (orchestratorState.pendingDeactivationTimer !== null) {
    globalThis.clearTimeout(orchestratorState.pendingDeactivationTimer);
    orchestratorState.pendingDeactivationTimer = null;
    console.log(
      `cameraStreamOrchestrator: cancelled pending deactivation for ${cameraId}`,
    );
  }

  if (activatedCameraIds.has(cameraId)) {
    return;
  }

  const cachedIp = cameraIpById.get(cameraId);
  if (cachedIp) {
    await activateCamera({ cameraId, cameraIp: cachedIp });
    return;
  }

  // Cold-start path: camera hasn't been activated since Pi 5 boot, so the IP
  // isn't cached yet. Look it up from the DB.
  const [fetchError, camera] = await tryCatch(async () => {
    return prisma.camera.findUnique({ where: { id: cameraId }, select: { ip: true } });
  });
  if (fetchError || !camera) {
    console.error(
      `cameraStreamOrchestrator: ensureCameraActive could not look up IP for ${cameraId}`,
      fetchError,
    );
    return;
  }
  await activateCamera({ cameraId, cameraIp: camera.ip });
};

// Called by the recording manager when a recording stops. Removes the
// reservation. Does NOT proactively deactivate — if browser sockets are still
// connected the camera stays active; if not, the next deactivate sweep
// (already scheduled or fired by the next disconnect) tears it down.
export const removeRecordingReservation = (cameraId: string): void => {
  if (!recordingReservations.delete(cameraId)) {
    return;
  }

  // Reservation released. If no sockets are connected, schedule the standard
  // grace-window deactivation so we don't keep the Pi Zero pipeline running
  // forever after a recording finishes with nobody watching.
  if (connectedSocketIds.size > 0 || recordingReservations.size > 0) {
    return;
  }

  if (orchestratorState.pendingDeactivationTimer !== null) {
    globalThis.clearTimeout(orchestratorState.pendingDeactivationTimer);
  }
  console.log(
    `cameraStreamOrchestrator: last recording reservation released — deferring deactivation by ${String(SOCKET_DEACTIVATION_GRACE_MS)}ms`,
  );
  orchestratorState.pendingDeactivationTimer = globalThis.setTimeout(() => {
    orchestratorState.pendingDeactivationTimer = null;
    if (connectedSocketIds.size > 0 || recordingReservations.size > 0) {
      return;
    }
    void deactivateAllCameras();
  }, SOCKET_DEACTIVATION_GRACE_MS);
};
