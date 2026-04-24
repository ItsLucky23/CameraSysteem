import { AuthProps, SessionLayout } from '../../../../config';
import { Functions, ApiResponse } from '../../../../src/_sockets/apiTypes.generated';
import { tryCatch } from '../../../../server/functions/tryCatch';
import { createCameraWebrtcAnswer } from '../../../../server/utils/cameraWebrtcBridge';
import { canPreviewCamera } from '../../../../server/utils/cameraHelpers';

export const rateLimit: number | false = 120;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: true,
  additional: [],
};

export interface ApiParams {
  data: {
    cameraId: string;
    offerSdp: string;
  };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const cameraId = data.cameraId.trim();
  const offerSdp = data.offerSdp.trim();

  if (!cameraId || !offerSdp) {
    return { status: 'error', errorCode: 'camera.invalidInput', httpStatus: 400 };
  }

  const [cameraFetchError, cameraFetchResult] = await tryCatch(async () => {
    return Promise.all([
      functions.db.prisma.camera.findUnique({
        where: { id: cameraId },
        select: { id: true, enabled: true },
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

  if (!camera.enabled) {
    return { status: 'error', errorCode: 'camera.streamNotActive', httpStatus: 409 };
  }

  if (!canPreviewCamera({ isAdmin: user.admin, access })) {
    return { status: 'error', errorCode: 'camera.accessDenied', httpStatus: 403 };
  }

  const bridgeResponse = await createCameraWebrtcAnswer({
    cameraId,
    offerSdp,
  });

  if (bridgeResponse.status === 'error') {
    if (bridgeResponse.errorCode === 'camera.streamNotActive') {
      return { status: 'error', errorCode: 'camera.streamNotActive', httpStatus: 409 };
    }

    if (bridgeResponse.errorCode === 'camera.webrtcSignalingUnavailable') {
      return { status: 'error', errorCode: 'camera.webrtcSignalingUnavailable', httpStatus: 503 };
    }

    return { status: 'error', errorCode: 'camera.webrtcSignalingFailed', httpStatus: 502 };
  }

  return {
    status: 'success',
    cameraId,
    peerId: bridgeResponse.peerId,
    answerSdp: bridgeResponse.answerSdp,
    iceCandidates: bridgeResponse.iceCandidates,
  };
};
