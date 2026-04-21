import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { tryCatch } from '../../../server/functions/tryCatch';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'PUT';

export const auth: AuthProps = {
  login: true,
  additional: [{ key: 'admin', value: true }],
};

export interface ApiParams {
  data: {
    cameraId: string;
    slug: string;
    name: string;
    cameraIp: string;
    streamUrl: string;
  };
  user: SessionLayout;
  functions: Functions;
}

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ipv4Regex = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export const main = async ({ data, functions }: ApiParams): Promise<ApiResponse> => {
  const cameraId = data.cameraId.trim();
  const slug = data.slug.trim().toLowerCase();
  const name = data.name.trim();
  const cameraIp = data.cameraIp.trim();
  const streamUrl = data.streamUrl.trim();

  if (!cameraId || !slug || !name || !cameraIp || !streamUrl) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  if (!slugRegex.test(slug)) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  if (!ipv4Regex.test(cameraIp)) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  const [urlParseError, parsedUrl] = await tryCatch(() => {
    return new URL(streamUrl);
  });

  if (urlParseError || !parsedUrl || (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:')) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  const [cameraReadError, existingCamera] = await tryCatch(async () => {
    return functions.db.prisma.camera.findUnique({
      where: { id: cameraId },
      select: { id: true },
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
        nodeId: cameraIp,
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
        nodeId: cameraIp,
        streamUrl,
      },
    });
  });

  if (updateError || !updatedCamera) {
    return { status: 'error', errorCode: 'camera.unexpectedError', httpStatus: 500 };
  }

  return {
    status: 'success',
    camera: {
      id: updatedCamera.id,
      slug: updatedCamera.slug,
      name: updatedCamera.name,
      cameraIp: updatedCamera.nodeId,
      streamUrl: updatedCamera.streamUrl,
      isOnline: updatedCamera.isOnline,
      mode: updatedCamera.mode,
      lastSeenAt: updatedCamera.lastSeenAt ? updatedCamera.lastSeenAt.toISOString() : null,
      createdAt: updatedCamera.createdAt.toISOString(),
      updatedAt: updatedCamera.updatedAt.toISOString(),
    },
  };
};
