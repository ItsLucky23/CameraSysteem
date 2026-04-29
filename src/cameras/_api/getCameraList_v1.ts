import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { tryCatch } from '../../../server/functions/tryCatch';
import { getThumbnail } from '../../../server/utils/cameraThumbnailStore';
import { getCapabilities, Capabilities } from '../../../server/utils/cameraCapabilityStore';
import { cameraRecordingManager } from '../../../server/utils/cameraRecordingManager';

export const rateLimit: number | false = 120;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET';

export const auth: AuthProps = {
  login: true,
  additional: [],
};

export interface ApiParams {
  data: Record<string, never>;
  user: SessionLayout;
  functions: Functions;
}

const buildThumbnail = (cameraId: string): { jpegBase64: string; capturedAt: string } | null => {
  const stored = getThumbnail(cameraId);
  if (!stored) return null;
  return {
    jpegBase64: stored.jpegBase64,
    capturedAt: stored.capturedAt.toISOString(),
  };
};

const buildCapabilities = (cameraId: string): Capabilities | null => {
  return getCapabilities(cameraId);
};

// Seeds the recording indicator on initial page load. recordingStatus sync
// only fires on transitions, so without this a user opening a page mid-
// recording would have to wait for the next start/stop event to see it.
const buildActiveRecording = (cameraId: string): { recordingId: string; startedAt: string } | null => {
  const active = cameraRecordingManager.getActiveRecording(cameraId);
  if (!active) return null;
  return {
    recordingId: active.id,
    startedAt: active.startedAt.toISOString(),
  };
};

export const main = async ({ user, functions }: ApiParams): Promise<ApiResponse> => {
  if (user.admin) {
    const [cameraError, cameras] = await tryCatch(async () => {
      return functions.db.prisma.camera.findMany({
        orderBy: { name: 'asc' },
      });
    });

    if (cameraError || !cameras) {
      return { status: 'error', errorCode: 'camera.unexpectedError', httpStatus: 500 };
    }

    return {
      status: 'success',
      cameras: cameras.map((camera: {
        id: string;
        slug: string;
        name: string;
        isOnline: boolean;
        mode: 'off' | 'idle' | 'live' | 'record';
        irMode: 'off' | 'on' | 'auto';
        irStrength: number | null;
        targetFps: number;
        quality: 'low' | 'medium' | 'high';
        lastSeenAt: Date | null;
      }) => ({
        id: camera.id,
        slug: camera.slug,
        name: camera.name,
        isOnline: camera.isOnline,
        mode: camera.mode,
        irMode: camera.irMode,
        irStrength: camera.irStrength ?? 100,
        targetFps: camera.targetFps,
        quality: camera.quality,
        canPreview: true,
        canControl: true,
        lastSeenAt: camera.lastSeenAt ? camera.lastSeenAt.toISOString() : null,
        thumbnail: buildThumbnail(camera.id),
        capabilities: buildCapabilities(camera.id),
        activeRecording: buildActiveRecording(camera.id),
      })),
    };
  }

  const [cameraAccessError, cameraAccessRows] = await tryCatch(async () => {
    return functions.db.prisma.cameraAccess.findMany({
      where: {
        userId: user.id,
        canPreview: true,
      },
      include: {
        camera: true,
      },
      orderBy: {
        camera: {
          name: 'asc',
        },
      },
    });
  });

  if (cameraAccessError || !cameraAccessRows) {
    return { status: 'error', errorCode: 'camera.unexpectedError', httpStatus: 500 };
  }

  return {
    status: 'success',
    cameras: cameraAccessRows.map((accessRow: {
      canPreview: boolean;
      canControl: boolean;
      camera: {
        id: string;
        slug: string;
        name: string;
        isOnline: boolean;
        mode: 'off' | 'idle' | 'live' | 'record';
        irMode: 'off' | 'on' | 'auto';
        irStrength: number | null;
        targetFps: number;
        quality: 'low' | 'medium' | 'high';
        lastSeenAt: Date | null;
      };
    }) => ({
      id: accessRow.camera.id,
      slug: accessRow.camera.slug,
      name: accessRow.camera.name,
      isOnline: accessRow.camera.isOnline,
      mode: accessRow.camera.mode,
      irMode: accessRow.camera.irMode,
      irStrength: accessRow.camera.irStrength ?? 100,
      targetFps: accessRow.camera.targetFps,
      quality: accessRow.camera.quality,
      canPreview: accessRow.canPreview,
      canControl: accessRow.canControl,
      lastSeenAt: accessRow.camera.lastSeenAt ? accessRow.camera.lastSeenAt.toISOString() : null,
      thumbnail: buildThumbnail(accessRow.camera.id),
      capabilities: buildCapabilities(accessRow.camera.id),
      activeRecording: buildActiveRecording(accessRow.camera.id),
    })),
  };
};
