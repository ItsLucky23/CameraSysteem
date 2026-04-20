import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { tryCatch } from '../../../server/functions/tryCatch';

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
        nodeId: true,
        streamUrl: true,
        isOnline: true,
        mode: true,
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
    cameras: cameras.map((camera) => ({
      id: camera.id,
      slug: camera.slug,
      name: camera.name,
      nodeId: camera.nodeId,
      streamUrl: camera.streamUrl,
      isOnline: camera.isOnline,
      mode: camera.mode,
      lastSeenAt: camera.lastSeenAt ? camera.lastSeenAt.toISOString() : null,
      createdAt: camera.createdAt.toISOString(),
      updatedAt: camera.updatedAt.toISOString(),
    })),
  };
};
