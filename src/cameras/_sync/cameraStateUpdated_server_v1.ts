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
      // Persisted user-set strength (0..100). Manual control in 'on' mode.
      irStrength?: number | null;
      // Live PWM duty cycle the Pi Zero is actually driving right now.
      // Telemetered from the auto controller; matches irStrength in 'on' mode.
      irActiveStrength?: number | null;
      pan?: number;
      tilt?: number;
      temperatureC?: number | null;
      // MOTION DETECTION LOGIC (start)
      // motionDetected?: boolean;
      // lastMotionAt?: string | null;
      // MOTION DETECTION LOGIC (end)
      recording?: boolean;
      measuredFps?: number | null;
      lastFrameAgeMs?: number | null;
      // Step-based zoom level reported by the Pi Zero (1..100). Ephemeral.
      zoomLevel?: number | null;
      // Admin-configured stream params. Broadcast from updateCamera_v1 so the
      // cameras page reflects new quality/fps/resolution/bitrate labels without
      // a page reload. null on resolution/bitrate means "use the orchestrator
      // fallback" (legacy DB rows that were never re-saved).
      targetFps?: number;
      quality?: 'low' | 'medium' | 'high';
      resolutionWidth?: number | null;
      resolutionHeight?: number | null;
      bitrateBps?: number | null;
      // Hardware capability report sourced from the Pi Zero boot probe.
      // Refilled every telemetry tick so Pi 5 restarts self-heal in <5s.
      capabilities?: {
        hasCamera: boolean;
        hasIR: boolean;
        hasPanTilt: boolean;
        hasMicrophone: boolean;
        hasSpeaker: boolean;
        // MOTION DETECTION LOGIC (start)
        // hasMotion: boolean;
        // MOTION DETECTION LOGIC (end)
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
