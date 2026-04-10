import { AuthProps, SessionLayout } from '../../../../config';
import { Functions, ApiResponse } from '../../../../src/_sockets/apiTypes.generated';
import { tryCatch } from '../../../../server/functions/tryCatch';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET';

export const auth: AuthProps = {
  login: true,
  additional: [{ key: 'admin', value: true }],
};

export interface ApiParams {
  data: {
    userIds?: string[];
    cameraIds?: string[];
  };
  user: SessionLayout;
  functions: Functions;
}

const normalizeOptionalStringArray = (value: unknown): string[] | null => {
  if (value === undefined) {
    return null;
  }

  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);

  if (normalized.length !== value.length) {
    return [];
  }

  return normalized;
};

export const main = async ({ data, functions }: ApiParams): Promise<ApiResponse> => {
  const userIds = normalizeOptionalStringArray(data.userIds);
  const cameraIds = normalizeOptionalStringArray(data.cameraIds);

  if (userIds !== null && userIds.length === 0 && Array.isArray(data.userIds) && data.userIds.length > 0) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  if (cameraIds !== null && cameraIds.length === 0 && Array.isArray(data.cameraIds) && data.cameraIds.length > 0) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  const [queryError, queryResult] = await tryCatch(async () => {
    return Promise.all([
      functions.db.prisma.user.findMany({
        where: {
          ...(userIds ? { id: { in: userIds } } : {}),
        },
        select: {
          id: true,
          name: true,
          email: true,
        },
        orderBy: { name: 'asc' },
      }),
      functions.db.prisma.camera.findMany({
        where: {
          ...(cameraIds ? { id: { in: cameraIds } } : {}),
        },
        select: {
          id: true,
          name: true,
        },
        orderBy: { name: 'asc' },
      }),
      functions.db.prisma.cameraAccess.findMany({
        where: {
          ...(userIds ? { userId: { in: userIds } } : {}),
          ...(cameraIds ? { cameraId: { in: cameraIds } } : {}),
        },
        select: {
          userId: true,
          cameraId: true,
          canPreview: true,
          canControl: true,
        },
      }),
    ]);
  });

  if (queryError || !queryResult) {
    return { status: 'error', errorCode: 'camera.unexpectedError', httpStatus: 500 };
  }

  const [users, cameras, matrix] = queryResult;

  return {
    status: 'success',
    users,
    cameras,
    matrix,
  };
};
