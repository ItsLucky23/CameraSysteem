import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { tryCatch } from '../../../server/functions/tryCatch';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: true,
  additional: [{ key: 'admin', value: true }],
};

type Quality = 'low' | 'medium' | 'high';

export interface ApiParams {
  data: {
    slug: string;
    name: string;
    cameraIp: string;
    targetFps?: number;
    quality?: Quality;
    resolutionWidth?: number | null;
    resolutionHeight?: number | null;
    bitrateBps?: number | null;
  };
  user: SessionLayout;
  functions: Functions;
}

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ipv4Regex = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const qualityValues: Quality[] = ['low', 'medium', 'high'];

const ALLOWED_RESOLUTIONS: Array<[number, number]> = [
  [1920, 1080],
  [1280, 720],
  [854, 480],
  [640, 480],
];
const isAllowedResolution = (width: number, height: number): boolean =>
  ALLOWED_RESOLUTIONS.some(([w, h]) => w === width && h === height);

const MIN_BITRATE_BPS = 500_000;
const MAX_BITRATE_BPS = 12_000_000;

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const slug = data.slug.trim().toLowerCase();
  const name = data.name.trim();
  const cameraIp = data.cameraIp.trim();
  // 0 = uncapped (sensor's native max). Treat any negative input (e.g. -1) as 0
  // so the admin can express "no fps cap" as either value.
  const rawFps = data.targetFps ?? 15;
  const targetFps = Number.isFinite(rawFps) && rawFps < 0 ? 0 : rawFps;
  const quality: Quality = data.quality ?? 'medium';

  if (!slug || !name || !cameraIp) {
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

  const resolutionWidthRaw = data.resolutionWidth ?? null;
  const resolutionHeightRaw = data.resolutionHeight ?? null;
  if ((resolutionWidthRaw === null) !== (resolutionHeightRaw === null)) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }
  if (resolutionWidthRaw !== null && resolutionHeightRaw !== null) {
    if (!Number.isInteger(resolutionWidthRaw) || !Number.isInteger(resolutionHeightRaw)) {
      return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
    }
    if (!isAllowedResolution(resolutionWidthRaw, resolutionHeightRaw)) {
      return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
    }
  }

  const bitrateBpsRaw = data.bitrateBps ?? null;
  if (bitrateBpsRaw !== null) {
    if (
      !Number.isInteger(bitrateBpsRaw)
      || bitrateBpsRaw < MIN_BITRATE_BPS
      || bitrateBpsRaw > MAX_BITRATE_BPS
    ) {
      return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
    }
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
      where: { ip: cameraIp },
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
        ip: cameraIp,
        targetFps,
        quality,
        resolutionWidth: resolutionWidthRaw,
        resolutionHeight: resolutionHeightRaw,
        bitrateBps: bitrateBpsRaw,
      },
    });
  });

  if (createCameraError || !createdCamera) {
    return { status: 'error', errorCode: 'camera.unexpectedError', httpStatus: 500 };
  }

  console.log('');
  console.log(
    `[action] admin/createCamera cameraId=${createdCamera.id} userId=${user.id} slug=${slug} ip=${cameraIp}`,
  );

  return {
    status: 'success',
    camera: {
      id: createdCamera.id,
      slug: createdCamera.slug,
      name: createdCamera.name,
      cameraIp: createdCamera.ip,
      isOnline: createdCamera.isOnline,
      mode: createdCamera.mode,
      targetFps: createdCamera.targetFps,
      quality: createdCamera.quality,
      resolutionWidth: createdCamera.resolutionWidth ?? null,
      resolutionHeight: createdCamera.resolutionHeight ?? null,
      bitrateBps: createdCamera.bitrateBps ?? null,
      lastSeenAt: createdCamera.lastSeenAt ? createdCamera.lastSeenAt.toISOString() : null,
      createdAt: createdCamera.createdAt.toISOString(),
      updatedAt: createdCamera.updatedAt.toISOString(),
    },
  };
};
