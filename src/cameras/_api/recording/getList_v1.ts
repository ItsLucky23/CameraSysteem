import { AuthProps, SessionLayout } from '../../../../config';
import { Functions, ApiResponse } from '../../../../src/_sockets/apiTypes.generated';
import { tryCatch } from '../../../../server/functions/tryCatch';
import { cameraRecordingManager } from '../../../../server/utils/cameraRecordingManager';

export const rateLimit: number | false = 60;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET';

export const auth: AuthProps = {
  login: true,
  additional: [],
};

const HISTORY_LIMIT_PER_CAMERA = 100;

export interface ApiParams {
  data: Record<string, never>;
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ user, functions }: ApiParams): Promise<ApiResponse> => {
  const [cameraFetchError, cameras] = await tryCatch(async () => {
    if (user.admin) {
      return functions.db.prisma.camera.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
    }
    const accessRows = await functions.db.prisma.cameraAccess.findMany({
      where: { userId: user.id, canControl: true },
      select: { camera: { select: { id: true, name: true } } },
      orderBy: { camera: { name: 'asc' } },
    });
    return accessRows
      .map((row: { camera: { id: string; name: string } | null }) => row.camera)
      .filter((camera: { id: string; name: string } | null): camera is { id: string; name: string } => camera !== null);
  });

  if (cameraFetchError || !cameras) {
    return { status: 'error', errorCode: 'recording.listFailed', httpStatus: 500 };
  }

  const cameraIds = cameras.map((camera: { id: string }) => camera.id);
  if (cameraIds.length === 0) {
    return { status: 'success', perCamera: [] };
  }

  const [recordingsError, recordings] = await tryCatch(async () => {
    return functions.db.prisma.recording.findMany({
      where: { cameraId: { in: cameraIds } },
      orderBy: { startedAt: 'desc' },
    });
  });

  if (recordingsError || !recordings) {
    return { status: 'error', errorCode: 'recording.listFailed', httpStatus: 500 };
  }

  const recordingsByCamera = new Map<string, typeof recordings>();
  for (const camera of cameras) {
    recordingsByCamera.set(camera.id, []);
  }
  for (const recording of recordings) {
    const list = recordingsByCamera.get(recording.cameraId);
    if (!list) continue;
    if (list.length >= HISTORY_LIMIT_PER_CAMERA + 1) continue;
    list.push(recording);
  }

  const perCamera = cameras.map((camera: { id: string; name: string }) => {
    const recordingList = recordingsByCamera.get(camera.id) ?? [];
    const active = cameraRecordingManager.getActiveRecording(camera.id);

    return {
      cameraId: camera.id,
      cameraName: camera.name,
      activeRecording: active === null
        ? null
        : {
          id: active.id,
          startedAt: active.startedAt.toISOString(),
          startedByUserId: active.startedByUserId,
        },
      history: recordingList.slice(0, HISTORY_LIMIT_PER_CAMERA).map((rec: {
        id: string;
        startedAt: Date;
        stoppedAt: Date | null;
        durationMs: number | null;
        fileSizeBytes: number | null;
        startedByUserId: string;
        stopReason: string | null;
      }) => ({
        id: rec.id,
        startedAt: rec.startedAt.toISOString(),
        stoppedAt: rec.stoppedAt ? rec.stoppedAt.toISOString() : null,
        durationMs: rec.durationMs,
        fileSizeBytes: rec.fileSizeBytes,
        startedByUserId: rec.startedByUserId,
        stopReason: rec.stopReason,
      })),
    };
  });

  return { status: 'success', perCamera };
};
