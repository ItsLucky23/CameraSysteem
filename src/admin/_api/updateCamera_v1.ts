import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { tryCatch } from '../../../server/functions/tryCatch';
import { onCameraStreamConfigChanged } from '../../../server/utils/cameraStreamOrchestrator';
import { emitCameraSyncEvent, getCameraRoomCode } from '../../../server/utils/cameraHelpers';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'PUT';

export const auth: AuthProps = {
  login: true,
  additional: [{ key: 'admin', value: true }],
};

type Quality = 'low' | 'medium' | 'high';

export interface ApiParams {
  data: {
    cameraId: string;
    slug: string;
    name: string;
    cameraIp: string;
    targetFps?: number;
    quality?: Quality;
  };
  user: SessionLayout;
  functions: Functions;
}

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ipv4Regex = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const qualityValues: Quality[] = ['low', 'medium', 'high'];

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const cameraId = data.cameraId.trim();
  const slug = data.slug.trim().toLowerCase();
  const name = data.name.trim();
  const cameraIp = data.cameraIp.trim();
  // 0 = uncapped (sensor's native max). Treat any negative input (e.g. -1) as 0
  // so the admin can express "no fps cap" as either value.
  const rawFps = data.targetFps ?? 15;
  const targetFps = Number.isFinite(rawFps) && rawFps < 0 ? 0 : rawFps;
  const quality: Quality = data.quality ?? 'medium';

  if (!cameraId || !slug || !name || !cameraIp) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  if (!slugRegex.test(slug)) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  if (!ipv4Regex.test(cameraIp)) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  if (!Number.isInteger(targetFps) || targetFps < 0 || targetFps > 60) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  if (!qualityValues.includes(quality)) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  const [cameraReadError, existingCamera] = await tryCatch(async () => {
    return functions.db.prisma.camera.findUnique({
      where: { id: cameraId },
      select: { id: true, targetFps: true, quality: true },
    });
  });

  if (cameraReadError) {
    return { status: 'error', errorCode: 'camera.unexpectedError', httpStatus: 500 };
  }

  if (!existingCamera) {
    return { status: 'error', errorCode: 'camera.notFound', httpStatus: 404 };
  }

  const [slugCheckError, slugCamera] = await tryCatch(async () => {
    return functions.db.prisma.camera.findFirst({
      where: {
        slug,
        NOT: { id: cameraId },
      },
      select: { id: true },
    });
  });

  if (slugCheckError) {
    return { status: 'error', errorCode: 'camera.unexpectedError', httpStatus: 500 };
  }

  if (slugCamera) {
    return { status: 'error', errorCode: 'camera.slugTaken', httpStatus: 409 };
  }

  const [ipCheckError, ipCamera] = await tryCatch(async () => {
    return functions.db.prisma.camera.findFirst({
      where: {
        ip: cameraIp,
        NOT: { id: cameraId },
      },
      select: { id: true },
    });
  });

  if (ipCheckError) {
    return { status: 'error', errorCode: 'camera.unexpectedError', httpStatus: 500 };
  }

  if (ipCamera) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 409 };
  }

  const [updateError, updatedCamera] = await tryCatch(async () => {
    return functions.db.prisma.camera.update({
      where: { id: cameraId },
      data: {
        slug,
        name,
        ip: cameraIp,
        targetFps,
        quality,
      },
    });
  });

  if (updateError || !updatedCamera) {
    return { status: 'error', errorCode: 'camera.unexpectedError', httpStatus: 500 };
  }

  console.log('');
  console.log(
    `[action] admin/updateCamera cameraId=${cameraId} userId=${user.id} slug=${slug} ip=${cameraIp} targetFps=${String(targetFps)} quality=${quality}`,
  );

  const streamConfigChanged =
    existingCamera.targetFps !== targetFps || existingCamera.quality !== quality;

  if (streamConfigChanged) {
    void onCameraStreamConfigChanged({ cameraId, cameraIp });

    // Broadcast the new target fps / quality so anyone already on the cameras
    // page sees the labels update live. Pi Zero's real measuredFps follows
    // ~5s later via the regular telemetry broadcast.
    emitCameraSyncEvent({
      fullName: 'sync/cameras/cameraStateUpdated/v1',
      receiver: getCameraRoomCode(cameraId),
      serverOutput: {
        status: 'success',
        cameraId,
        patch: {
          targetFps,
          quality,
        },
        at: new Date().toISOString(),
      },
    });
  }

  return {
    status: 'success',
    camera: {
      id: updatedCamera.id,
      slug: updatedCamera.slug,
      name: updatedCamera.name,
      cameraIp: updatedCamera.ip,
      isOnline: updatedCamera.isOnline,
      mode: updatedCamera.mode,
      targetFps: updatedCamera.targetFps,
      quality: updatedCamera.quality,
      lastSeenAt: updatedCamera.lastSeenAt ? updatedCamera.lastSeenAt.toISOString() : null,
      createdAt: updatedCamera.createdAt.toISOString(),
      updatedAt: updatedCamera.updatedAt.toISOString(),
    },
  };
};
