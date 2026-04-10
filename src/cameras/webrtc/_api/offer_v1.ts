import { AuthProps, SessionLayout } from '../../../../config';
import { Functions, ApiResponse } from '../../../../src/_sockets/apiTypes.generated';
import { tryCatch } from '../../../../server/functions/tryCatch';
import { canPreviewCamera, getCameraPreviewTokenKey } from '../../../../server/utils/cameraHelpers';

export const rateLimit: number | false = 120;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: true,
  additional: [],
};

interface PreviewTokenPayload {
  cameraId: string;
  userId: string;
  expiresAt: string;
}

interface SignalingAnswer {
  answerSdp: string;
  iceCandidates?: { candidate: string; sdpMid?: string; sdpMLineIndex?: number }[];
}

export interface ApiParams {
  data: {
    cameraId: string;
    previewToken: string;
    offerSdp: string;
  };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const cameraId = data.cameraId.trim();
  const previewToken = data.previewToken.trim();
  const offerSdp = data.offerSdp.trim();

  if (!cameraId || !previewToken || !offerSdp) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  const [cameraFetchError, cameraFetchResult] = await tryCatch(async () => {
    return Promise.all([
      functions.db.prisma.camera.findUnique({
        where: { id: cameraId },
      }),
      user.admin
        ? Promise.resolve(null)
        : functions.db.prisma.cameraAccess.findUnique({
          where: {
            cameraId_userId: {
              cameraId,
              userId: user.id,
            },
          },
        }),
    ]);
  });

  if (cameraFetchError || !cameraFetchResult) {
    return { status: 'error', errorCode: 'camera.unexpectedError', httpStatus: 500 };
  }

  const [camera, access] = cameraFetchResult;
  if (!camera) {
    return { status: 'error', errorCode: 'camera.notFound', httpStatus: 404 };
  }

  if (!canPreviewCamera({ isAdmin: user.admin, access })) {
    return { status: 'error', errorCode: 'camera.accessDenied', httpStatus: 403 };
  }

  const [tokenReadError, rawTokenPayload] = await tryCatch(async () => {
    return functions.redis.redis.get(getCameraPreviewTokenKey(previewToken));
  });

  if (tokenReadError || !rawTokenPayload) {
    return { status: 'error', errorCode: 'camera.previewTokenInvalid', httpStatus: 403 };
  }

  const [tokenParseError, tokenPayload] = await tryCatch(() => {
    return JSON.parse(rawTokenPayload) as PreviewTokenPayload;
  });

  if (tokenParseError || !tokenPayload) {
    return { status: 'error', errorCode: 'camera.previewTokenInvalid', httpStatus: 403 };
  }

  if (tokenPayload.cameraId !== cameraId || tokenPayload.userId !== user.id) {
    return { status: 'error', errorCode: 'camera.previewTokenInvalid', httpStatus: 403 };
  }

  const expiresAtMs = Date.parse(tokenPayload.expiresAt);
  if (Number.isNaN(expiresAtMs) || expiresAtMs <= Date.now()) {
    return { status: 'error', errorCode: 'camera.previewTokenInvalid', httpStatus: 403 };
  }

  const signalingUrl = process.env.CAMERA_WEBRTC_SIGNALING_URL?.trim();
  if (!signalingUrl) {
    return { status: 'error', errorCode: 'camera.webrtcSignalingUnavailable', httpStatus: 503 };
  }

  const [signalError, signalResponse] = await tryCatch(async () => {
    return fetch(`${signalingUrl.replace(/\/$/, '')}/offer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        cameraId,
        nodeId: camera.nodeId,
        offerSdp,
        previewToken,
      }),
    });
  });

  if (signalError || !signalResponse) {
    return { status: 'error', errorCode: 'camera.webrtcSignalingFailed', httpStatus: 502 };
  }

  if (!signalResponse.ok) {
    return { status: 'error', errorCode: 'camera.webrtcSignalingFailed', httpStatus: 502 };
  }

  const [answerParseError, answerPayload] = await tryCatch(async () => {
    return signalResponse.json() as Promise<SignalingAnswer>;
  });

  if (answerParseError || !answerPayload || typeof answerPayload.answerSdp !== 'string') {
    return { status: 'error', errorCode: 'camera.webrtcSignalingFailed', httpStatus: 502 };
  }

  return {
    status: 'success',
    cameraId,
    answerSdp: answerPayload.answerSdp,
    iceCandidates: answerPayload.iceCandidates ?? [],
  };
};
