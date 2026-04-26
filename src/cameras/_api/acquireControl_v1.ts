import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { tryCatch } from '../../../server/functions/tryCatch';
import { canControlCamera } from '../../../server/utils/cameraHelpers';
import {
  acquireControlSession,
  CONTROL_TTL_MS,
} from '../../../server/utils/cameraControlSession';

export const rateLimit: number | false = 30;

export const auth: AuthProps = {
  login: true,
  additional: [],
};

export interface ApiParams {
  data: {
    cameraId: string;
    takeOver?: boolean;
  };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const cameraId = data.cameraId.trim();
  if (!cameraId) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  const [fetchError, lookup] = await tryCatch(async () => Promise.all([
    functions.db.prisma.camera.findUnique({
      where: { id: cameraId },
      select: { id: true },
    }),
    user.admin
      ? Promise.resolve(null)
      : functions.db.prisma.cameraAccess.findUnique({
        where: { cameraId_userId: { cameraId, userId: user.id } },
      }),
  ]));

  if (fetchError || !lookup) {
    return { status: 'error', errorCode: 'camera.commandFailed', httpStatus: 500 };
  }

  const [camera, access] = lookup;
  if (!camera) {
    return { status: 'error', errorCode: 'camera.notFound', httpStatus: 404 };
  }

  if (!canControlCamera({ isAdmin: user.admin, access })) {
    return { status: 'error', errorCode: 'camera.controlDenied', httpStatus: 403 };
  }

  const result = await acquireControlSession({
    cameraId,
    userId: user.id,
    userName: user.name || user.email || user.id,
    takeOver: data.takeOver === true,
  });

  if (result.status === 'heldByOther') {
    return {
      status: 'error',
      errorCode: 'camera.controlHeldByOther',
      errorParams: [{ key: 'name', value: result.session.userName }],
      httpStatus: 409,
    };
  }

  return {
    status: 'success',
    cameraId,
    session: {
      userId: result.session.userId,
      userName: result.session.userName,
      acquiredAt: new Date(result.session.acquiredAt).toISOString(),
      expiresAt: new Date(result.session.expiresAt).toISOString(),
      ttlMs: CONTROL_TTL_MS,
    },
  };
};
