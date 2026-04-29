import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { tryCatch } from '../../../server/functions/tryCatch';
import { getThumbnail } from '../../../server/utils/cameraThumbnailStore';
import { getCapabilities } from '../../../server/utils/cameraCapabilityStore';
import { cameraRecordingManager } from '../../../server/utils/cameraRecordingManager';

export const rateLimit: number | false = 60;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET';

export const auth: AuthProps = {
  login: true,
  additional: [{ key: 'admin', value: true }],
};

export interface ApiParams {
  data: Record<string, never>;
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ functions }: ApiParams): Promise<ApiResponse> => {
  const [cameraReadError, cameras] = await tryCatch(async () => {
    return functions.db.prisma.camera.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        ip: true,
        isOnline: true,
        mode: true,
        targetFps: true,
        quality: true,
        resolutionWidth: true,
        resolutionHeight: true,
        bitrateBps: true,
        lastSeenAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [
        { name: 'asc' },
      ],
    });
  });

  if (cameraReadError || !cameras) {
    return { status: 'error', errorCode: 'camera.unexpectedError', httpStatus: 500 };
  }

  return {
    status: 'success',
    cameras: cameras.map((camera) => {
      const stored = getThumbnail(camera.id);
      const active = cameraRecordingManager.getActiveRecording(camera.id);
      return {
        id: camera.id,
        slug: camera.slug,
        name: camera.name,
        cameraIp: camera.ip,
        isOnline: camera.isOnline,
        mode: camera.mode,
        targetFps: camera.targetFps,
        quality: camera.quality,
        resolutionWidth: camera.resolutionWidth ?? null,
        resolutionHeight: camera.resolutionHeight ?? null,
        bitrateBps: camera.bitrateBps ?? null,
        lastSeenAt: camera.lastSeenAt ? camera.lastSeenAt.toISOString() : null,
        createdAt: camera.createdAt.toISOString(),
        updatedAt: camera.updatedAt.toISOString(),
        thumbnail: stored
          ? { jpegBase64: stored.jpegBase64, capturedAt: stored.capturedAt.toISOString() }
          : null,
        capabilities: getCapabilities(camera.id),
        activeRecording: active
          ? { recordingId: active.id, startedAt: active.startedAt.toISOString() }
          : null,
      };
    }),
  };
};
