import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse, MaybePromise } from '../../../src/_sockets/apiTypes.generated';

export const auth: AuthProps = {
  login: true,
  additional: [{ key: 'admin', value: true }],
};

export interface SyncParams {
  clientInput: {
    cameraId: string;
    patch: {
      isOnline?: boolean;
      mode?: 'off' | 'idle' | 'live' | 'record';
      irMode?: 'off' | 'on' | 'auto';
      irEnabled?: boolean;
      pan?: number;
      tilt?: number;
      temperatureC?: number | null;
      motionDetected?: boolean;
      recording?: boolean;
      measuredFps?: number | null;
      lastFrameAgeMs?: number | null;
      // Step-based zoom level reported by the Pi Zero (1..100). Ephemeral.
      zoomLevel?: number | null;
      // Admin-configured stream params. Broadcast from updateCamera_v1 so the
      // cameras page reflects new quality/fps labels without a page reload.
      targetFps?: number;
      quality?: 'low' | 'medium' | 'high';
      // Hardware capability report sourced from the Pi Zero boot probe.
      // Refilled every telemetry tick so Pi 5 restarts self-heal in <5s.
      capabilities?: {
        hasCamera: boolean;
        hasIR: boolean;
        hasPanTilt: boolean;
        hasMicrophone: boolean;
        hasSpeaker: boolean;
        hasMotion: boolean;
        hasZoom: boolean;
        hasTemperature: boolean;
      } | null;
    };
    at: string;
  };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = ({ clientInput }: SyncParams): MaybePromise<SyncServerResponse> => {
  return {
    status: 'success',
    cameraId: clientInput.cameraId,
    patch: clientInput.patch,
    at: clientInput.at,
  };
};
