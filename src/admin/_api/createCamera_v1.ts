import { randomUUID } from 'node:crypto';

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { tryCatch } from '../../../server/functions/tryCatch';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: true,
  additional: [{ key: 'admin', value: true }],
};

export interface ApiParams {
  data: {
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
  const slug = data.slug.trim().toLowerCase();
  const name = data.name.trim();
  const cameraIp = data.cameraIp.trim();
  const streamUrl = data.streamUrl.trim();

  if (!slug || !name || !cameraIp || !streamUrl) {
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

  const [existingCameraError, existingCamera] = await tryCatch(async () => {
    return functions.db.prisma.camera.findUnique({
      where: { slug },
      select: { id: true },
    });
  });

  if (existingCameraError) {
    return { status: 'error', errorCode: 'camera.unexpectedError', httpStatus: 500 };
  }

  if (existingCamera) {
    return { status: 'error', errorCode: 'camera.slugTaken', httpStatus: 409 };
  }

  const [existingIpError, existingIpCamera] = await tryCatch(async () => {
    return functions.db.prisma.camera.findFirst({
      where: { nodeId: cameraIp },
      select: { id: true },
    });
  });

  if (existingIpError) {
    return { status: 'error', errorCode: 'camera.unexpectedError', httpStatus: 500 };
  }

  if (existingIpCamera) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 409 };
  }

  const [createCameraError, createdCamera] = await tryCatch(async () => {
    return functions.db.prisma.camera.create({
      data: {
        slug,
        name,
        nodeId: cameraIp,
        streamUrl,
        streamKey: `${slug}-${randomUUID()}`,
      },
    });
  });

  if (createCameraError || !createdCamera) {
    return { status: 'error', errorCode: 'camera.unexpectedError', httpStatus: 500 };
  }

  return {
    status: 'success',
    camera: {
      id: createdCamera.id,
      slug: createdCamera.slug,
      name: createdCamera.name,
      cameraIp: createdCamera.nodeId,
      streamUrl: createdCamera.streamUrl,
      isOnline: createdCamera.isOnline,
      mode: createdCamera.mode,
      lastSeenAt: createdCamera.lastSeenAt ? createdCamera.lastSeenAt.toISOString() : null,
      createdAt: createdCamera.createdAt.toISOString(),
      updatedAt: createdCamera.updatedAt.toISOString(),
    },
  };
};
