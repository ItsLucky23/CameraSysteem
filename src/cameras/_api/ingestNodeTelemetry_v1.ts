import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { tryCatch } from '../../../server/functions/tryCatch';
import { emitCameraSyncEvent, getCameraRoomCode } from '../../../server/utils/cameraHelpers';
import {
  capabilitiesEqual,
  getCapabilities,
  setCapabilities,
  Capabilities,
} from '../../../server/utils/cameraCapabilityStore';

export const rateLimit: number | false = 480;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: false,
  additional: [],
};

type CameraMode = 'off' | 'idle' | 'live' | 'record';
type IRMode = 'off' | 'on' | 'auto';

type CommandResultStatus = 'executed' | 'failed' | 'rejected';

export interface ApiParams {
  data: {
    cameraIp: string;
    nodeSecret: string;
    isOnline: boolean;
    mode?: CameraMode;
    irMode?: IRMode;
    irEnabled?: boolean;
    pan?: number;
    tilt?: number;
    temperatureC?: number | null;
    motionDetected?: boolean;
    recording?: boolean;
    measuredFps?: number | null;
    lastFrameAgeMs?: number | null;
    zoomLevel?: number | null;
    capabilities?: {
      hasCamera: boolean;
      hasIR: boolean;
      hasPanTilt: boolean;
      hasMicrophone: boolean;
      hasSpeaker: boolean;
      hasMotion: boolean;
      hasZoom: boolean;
      hasTemperature: boolean;
    };
    commandResult?: {
      commandId: string;
      action: string;
      result: CommandResultStatus;
      reasonCode?: string;
    };
  };
  user: SessionLayout;
  functions: Functions;
}

const isMode = (value: unknown): value is CameraMode => {
  return value === 'off' || value === 'idle' || value === 'live' || value === 'record';
};

const isIRMode = (value: unknown): value is IRMode => {
  return value === 'off' || value === 'on' || value === 'auto';
};

const isCommandResultStatus = (value: unknown): value is CommandResultStatus => {
  return value === 'executed' || value === 'failed' || value === 'rejected';
};

const isCapabilities = (value: unknown): value is Capabilities => {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.hasCamera === 'boolean'
    && typeof v.hasIR === 'boolean'
    && typeof v.hasPanTilt === 'boolean'
    && typeof v.hasMicrophone === 'boolean'
    && typeof v.hasSpeaker === 'boolean'
    && typeof v.hasMotion === 'boolean'
    && typeof v.hasZoom === 'boolean'
    && typeof v.hasTemperature === 'boolean'
  );
};

interface CameraStatePatch {
  mode?: CameraMode;
  irMode?: IRMode;
  irEnabled?: boolean;
  pan?: number;
  tilt?: number;
  temperatureC?: number | null;
  recording?: boolean;
  motionDetected?: boolean;
  measuredFps?: number | null;
  lastFrameAgeMs?: number | null;
  zoomLevel?: number | null;
  capabilities?: Capabilities | null;
  isOnline: boolean;
}

const buildCameraPatch = ({
  data,
  capabilities,
}: {
  data: ApiParams['data'];
  capabilities: Capabilities | null;
}): CameraStatePatch => {
  const patch: CameraStatePatch = {
    isOnline: data.isOnline,
  };

  if (data.mode !== undefined) {
    patch.mode = data.mode;
  }
  if (data.irMode !== undefined) {
    patch.irMode = data.irMode;
  }
  if (data.irEnabled !== undefined) {
    patch.irEnabled = data.irEnabled;
  }
  if (data.pan !== undefined) {
    patch.pan = data.pan;
  }
  if (data.tilt !== undefined) {
    patch.tilt = data.tilt;
  }
  if (data.temperatureC !== undefined) {
    patch.temperatureC = data.temperatureC;
  }
  if (data.motionDetected !== undefined) {
    patch.motionDetected = data.motionDetected;
  }
  if (data.recording !== undefined) {
    patch.recording = data.recording;
  }
  if (data.measuredFps !== undefined) {
    patch.measuredFps = data.measuredFps;
  }
  if (data.lastFrameAgeMs !== undefined) {
    patch.lastFrameAgeMs = data.lastFrameAgeMs;
  }
  if (data.zoomLevel !== undefined) {
    patch.zoomLevel = data.zoomLevel;
  }
  if (capabilities !== null) {
    patch.capabilities = capabilities;
  }

  return patch;
};

export const main = async ({ data, functions }: ApiParams): Promise<ApiResponse> => {
  const cameraIp = data.cameraIp.trim();
  const nodeSecret = data.nodeSecret.trim();

  if (!cameraIp || !nodeSecret || typeof data.isOnline !== 'boolean') {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  const expectedSecret = process.env.CAMERA_NODE_SHARED_SECRET?.trim();
  if (!expectedSecret) {
    return { status: 'error', errorCode: 'camera.nodeSecretMissing', httpStatus: 500 };
  }

  if (nodeSecret !== expectedSecret) {
    return { status: 'error', errorCode: 'camera.nodeUnauthorized', httpStatus: 403 };
  }

  if (data.mode !== undefined && !isMode(data.mode)) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  if (data.irMode !== undefined && !isIRMode(data.irMode)) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  if (data.irEnabled !== undefined && typeof data.irEnabled !== 'boolean') {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  if (data.pan !== undefined && typeof data.pan !== 'number') {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  if (data.tilt !== undefined && typeof data.tilt !== 'number') {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  if (data.temperatureC !== undefined && data.temperatureC !== null && typeof data.temperatureC !== 'number') {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  if (data.motionDetected !== undefined && typeof data.motionDetected !== 'boolean') {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  if (data.recording !== undefined && typeof data.recording !== 'boolean') {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  if (data.measuredFps !== undefined && data.measuredFps !== null && typeof data.measuredFps !== 'number') {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  if (data.lastFrameAgeMs !== undefined && data.lastFrameAgeMs !== null && typeof data.lastFrameAgeMs !== 'number') {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  if (data.zoomLevel !== undefined && data.zoomLevel !== null) {
    if (typeof data.zoomLevel !== 'number'
      || !Number.isFinite(data.zoomLevel)
      || data.zoomLevel < 1
      || data.zoomLevel > 100) {
      return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
    }
  }

  if (data.capabilities !== undefined && !isCapabilities(data.capabilities)) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  if (data.commandResult !== undefined) {
    const commandResult = data.commandResult;

    if (
      typeof commandResult.commandId !== 'string'
      || commandResult.commandId.trim().length === 0
      || typeof commandResult.action !== 'string'
      || commandResult.action.trim().length === 0
      || !isCommandResultStatus(commandResult.result)
    ) {
      return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
    }

    if (commandResult.reasonCode !== undefined && typeof commandResult.reasonCode !== 'string') {
      return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
    }
  }

  const [cameraReadError, camera] = await tryCatch(async () => {
    return functions.db.prisma.camera.findFirst({
      where: { ip: cameraIp },
      orderBy: {
        updatedAt: 'desc',
      },
    });
  });

  if (cameraReadError) {
    return { status: 'error', errorCode: 'camera.unexpectedError', httpStatus: 500 };
  }

  if (!camera) {
    return { status: 'error', errorCode: 'camera.notFound', httpStatus: 404 };
  }

  const cameraId = camera.id;

  console.log('');
  console.log(
    `[telemetry] ingest cameraId=${cameraId} online=${String(data.isOnline)} fps=${String(data.measuredFps ?? '-')} temp=${String(data.temperatureC ?? '-')} zoom=${String(data.zoomLevel ?? '-')}`,
  );

  // Capability persistence + change-detection log. Telemetry sends the report
  // every tick for self-healing on Pi 5 restart, but capabilities don't change
  // at runtime — only log on first-seen-after-boot or on a real change so the
  // log stream stays readable.
  let storedCapabilities: Capabilities | null = getCapabilities(cameraId);
  if (data.capabilities !== undefined) {
    const incoming = data.capabilities;
    if (!capabilitiesEqual(storedCapabilities, incoming)) {
      console.log('');
      console.log(
        `[capabilities] cameraId=${cameraId} hasCamera=${String(incoming.hasCamera)} hasIR=${String(incoming.hasIR)} hasPanTilt=${String(incoming.hasPanTilt)} hasMicrophone=${String(incoming.hasMicrophone)} hasSpeaker=${String(incoming.hasSpeaker)} hasMotion=${String(incoming.hasMotion)} hasZoom=${String(incoming.hasZoom)} hasTemperature=${String(incoming.hasTemperature)}`,
      );
    }
    setCapabilities(cameraId, incoming);
    storedCapabilities = incoming;
  }

  const modeFromRecording: CameraMode | undefined = typeof data.recording === 'boolean'
    ? (data.recording ? 'record' : 'live')
    : undefined;

  const updateData: {
    isOnline: boolean;
    lastSeenAt: Date;
    mode?: CameraMode;
    irMode?: IRMode;
    irEnabled?: boolean;
    pan?: number;
    tilt?: number;
    temperatureC?: number | null;
  } = {
    isOnline: data.isOnline,
    lastSeenAt: new Date(),
  };

  if (data.mode !== undefined) {
    updateData.mode = data.mode;
  }
  if (data.irMode !== undefined) {
    updateData.irMode = data.irMode;
  }
  if (data.irEnabled !== undefined) {
    updateData.irEnabled = data.irEnabled;
  }
  if (data.pan !== undefined) {
    updateData.pan = data.pan;
  }
  if (data.tilt !== undefined) {
    updateData.tilt = data.tilt;
  }
  if (data.temperatureC !== undefined) {
    updateData.temperatureC = data.temperatureC;
  }
  if (modeFromRecording !== undefined) {
    updateData.mode = modeFromRecording;
  }

  const [cameraUpdateError, updatedCamera] = await tryCatch(async () => {
    return functions.db.prisma.camera.update({
      where: { id: cameraId },
      data: updateData,
    });
  });

  if (cameraUpdateError || !updatedCamera) {
    return { status: 'error', errorCode: 'camera.unexpectedError', httpStatus: 500 };
  }

  const [snapshotError] = await tryCatch(async () => {
    return functions.db.prisma.cameraStateSnapshot.create({
      data: {
        cameraId: updatedCamera.id,
        isOnline: updatedCamera.isOnline,
        mode: updatedCamera.mode,
        irMode: updatedCamera.irMode,
        irEnabled: updatedCamera.irEnabled,
        pan: updatedCamera.pan,
        tilt: updatedCamera.tilt,
        temperatureC: updatedCamera.temperatureC,
        motionDetected: data.motionDetected ?? false,
        recording: typeof data.recording === 'boolean' ? data.recording : updatedCamera.mode === 'record',
      },
    });
  });

  if (snapshotError) {
    return { status: 'error', errorCode: 'camera.unexpectedError', httpStatus: 500 };
  }

  if (data.commandResult !== undefined) {
    const commandResult = data.commandResult;

    const [commandUpdateError] = await tryCatch(async () => {
      return functions.db.prisma.cameraCommand.updateMany({
        where: {
          commandId: commandResult.commandId,
          cameraId,
        },
        data: {
          status: commandResult.result,
          rejectedReason: commandResult.reasonCode,
          resolvedAt: new Date(),
        },
      });
    });

    if (commandUpdateError) {
      return { status: 'error', errorCode: 'camera.unexpectedError', httpStatus: 500 };
    }

    emitCameraSyncEvent({
      fullName: 'sync/cameras/cameraCommandResult/v1',
      receiver: getCameraRoomCode(cameraId),
      serverOutput: {
        status: 'success',
        cameraId,
        commandId: commandResult.commandId,
        action: commandResult.action,
        result: commandResult.result,
        reasonCode: commandResult.reasonCode,
      },
    });
  }

  const statePatch = buildCameraPatch({ data, capabilities: storedCapabilities });
  const stateAtIso = new Date().toISOString();

  emitCameraSyncEvent({
    fullName: 'sync/cameras/cameraStateUpdated/v1',
    receiver: getCameraRoomCode(cameraId),
    serverOutput: {
      status: 'success',
      cameraId,
      patch: statePatch,
      at: stateAtIso,
    },
  });

  emitCameraSyncEvent({
    fullName: 'sync/cameras/cameraStateUpdated/v1',
    receiver: 'cameras-overview',
    serverOutput: {
      status: 'success',
      cameraId,
      patch: statePatch,
      at: stateAtIso,
    },
  });

  return {
    status: 'success',
    cameraId,
    cameraIp,
    receivedAt: new Date().toISOString(),
  };
};
