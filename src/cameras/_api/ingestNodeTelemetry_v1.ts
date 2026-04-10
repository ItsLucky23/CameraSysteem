import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { tryCatch } from '../../../server/functions/tryCatch';
import { emitCameraSyncEvent, getCameraRoomCode } from '../../../server/utils/cameraHelpers';

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
    nodeId: string;
    nodeSecret: string;
    cameraId: string;
    isOnline: boolean;
    mode?: CameraMode;
    irMode?: IRMode;
    irEnabled?: boolean;
    pan?: number;
    tilt?: number;
    temperatureC?: number | null;
    motionDetected?: boolean;
    recording?: boolean;
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

const buildCameraPatch = ({
  data,
}: {
  data: ApiParams['data'];
}): {
  mode?: CameraMode;
  irMode?: IRMode;
  irEnabled?: boolean;
  pan?: number;
  tilt?: number;
  temperatureC?: number | null;
  recording?: boolean;
  motionDetected?: boolean;
  isOnline: boolean;
} => {
  const patch: {
    mode?: CameraMode;
    irMode?: IRMode;
    irEnabled?: boolean;
    pan?: number;
    tilt?: number;
    temperatureC?: number | null;
    recording?: boolean;
    motionDetected?: boolean;
    isOnline: boolean;
  } = {
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

  return patch;
};

export const main = async ({ data, functions }: ApiParams): Promise<ApiResponse> => {
  const nodeId = data.nodeId.trim();
  const nodeSecret = data.nodeSecret.trim();
  const cameraId = data.cameraId.trim();

  if (!nodeId || !nodeSecret || !cameraId || typeof data.isOnline !== 'boolean') {
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
    return functions.db.prisma.camera.findUnique({
      where: { id: cameraId },
    });
  });

  if (cameraReadError) {
    return { status: 'error', errorCode: 'camera.unexpectedError', httpStatus: 500 };
  }

  if (!camera) {
    return { status: 'error', errorCode: 'camera.notFound', httpStatus: 404 };
  }

  if (camera.nodeId !== nodeId) {
    return { status: 'error', errorCode: 'camera.nodeUnauthorized', httpStatus: 403 };
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

  const statePatch = buildCameraPatch({ data });

  emitCameraSyncEvent({
    fullName: 'sync/cameras/cameraStateUpdated/v1',
    receiver: getCameraRoomCode(cameraId),
    serverOutput: {
      status: 'success',
      cameraId,
      patch: statePatch,
      at: new Date().toISOString(),
    },
  });

  return {
    status: 'success',
    cameraId,
    receivedAt: new Date().toISOString(),
  };
};
