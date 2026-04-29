import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { tryCatch } from '../../../server/functions/tryCatch';
import { emitCameraSyncEvent, getCameraRoomCode } from '../../../server/utils/cameraHelpers';
import {
  isLogFeature,
  setCameraLogFlag,
  getLogFlagsForCamera,
} from '../../../server/utils/cameraLogFlagStore';

export const rateLimit: number | false = 60;

export const auth: AuthProps = {
  login: true,
  additional: [{ key: 'admin', value: true }],
};

export interface ApiParams {
  data: {
    cameraId: string;
    feature: string;
    enabled: boolean;
  };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const cameraId = data.cameraId.trim();
  const feature = data.feature;
  const enabled = data.enabled;

  if (!cameraId || typeof enabled !== 'boolean' || !isLogFeature(feature)) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  const [cameraReadError, camera] = await tryCatch(async () => {
    return functions.db.prisma.camera.findUnique({ where: { id: cameraId } });
  });

  if (cameraReadError) {
    return { status: 'error', errorCode: 'camera.unexpectedError', httpStatus: 500 };
  }
  if (!camera) {
    return { status: 'error', errorCode: 'camera.notFound', httpStatus: 404 };
  }

  const updatedFeatures = setCameraLogFlag(cameraId, feature, enabled);

  console.log('');
  console.log(
    `[action] cameras/setLogFlag cameraId=${cameraId} userId=${user.id} feature=${feature} enabled=${String(enabled)} active=${updatedFeatures.join(',') || '-'}`,
  );

  // Push the new full set to the Pi Zero so its is_log_enabled() helper sees
  // the updated feature list. Best-effort: if the Pi Zero is offline the flag
  // is still persisted on the Pi 5 (so server-side log gates still work).
  const commandId = globalThis.crypto.randomUUID();
  const payload = { features: updatedFeatures };

  await tryCatch(async () => {
    return functions.db.prisma.cameraCommand.create({
      data: {
        commandId,
        cameraId,
        userId: user.id,
        action: 'setLogFlags',
        payloadJson: JSON.stringify(payload),
        status: 'accepted',
        cooldownMs: 0,
      },
    });
  });

  await tryCatch(async () => {
    return functions.cameraNode.enqueueCommand({
      cameraIp: camera.ip,
      cameraId,
      commandId,
      action: 'setLogFlags',
      payload,
      requestedByUserId: user.id,
    });
  });

  // Sync broadcast so other admin tabs viewing the same camera reflect the new
  // toggle state without a manual refresh.
  emitCameraSyncEvent({
    fullName: 'sync/cameras/logFlagsUpdated/v1',
    receiver: getCameraRoomCode(cameraId),
    serverOutput: {
      status: 'success',
      cameraId,
      features: getLogFlagsForCamera(cameraId),
      at: new Date().toISOString(),
    },
  });

  return {
    status: 'success',
    cameraId,
    features: getLogFlagsForCamera(cameraId),
  };
};
