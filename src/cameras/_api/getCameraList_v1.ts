import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { tryCatch } from '../../../server/functions/tryCatch';

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
        lastSeenAt: Date | null;
      }) => ({
        id: camera.id,
        slug: camera.slug,
        name: camera.name,
        isOnline: camera.isOnline,
        mode: camera.mode,
        irMode: camera.irMode,
        canPreview: true,
        canControl: true,
        lastSeenAt: camera.lastSeenAt ? camera.lastSeenAt.toISOString() : null,
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
        lastSeenAt: Date | null;
      };
    }) => ({
      id: accessRow.camera.id,
      slug: accessRow.camera.slug,
      name: accessRow.camera.name,
      isOnline: accessRow.camera.isOnline,
      mode: accessRow.camera.mode,
      irMode: accessRow.camera.irMode,
      canPreview: accessRow.canPreview,
      canControl: accessRow.canControl,
      lastSeenAt: accessRow.camera.lastSeenAt ? accessRow.camera.lastSeenAt.toISOString() : null,
    })),
  };
};
