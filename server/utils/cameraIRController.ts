import sharp from 'sharp';

import { tryCatch } from '../functions/tryCatch';
import { prisma } from '../functions/db';
import { enqueueCommand } from '../functions/cameraNode';
import { isCameraLogEnabled } from './cameraLogFlagStore';

// Auto IR controller. Decisions live entirely on the Pi 5: every time a fresh
// thumbnail JPEG is stored (uploadThumbnail_v1 OR cameraThumbnailExtractor),
// we decode it, compute mean luminance, decide a target PWM duty cycle for
// the IR ring, and push it to the Pi Zero via the existing irSetStrength
// command. The Pi Zero plays a passive role: just apply whatever strength we
// send. Resets to dormant when irMode flips off auto.

// Tuned for indoor 1280x720 frames. Mean luminance Y is on a 0..255 scale.
// Below DARK the LED runs at 100%; above BRIGHT it shuts off; linear ramp
// in between. Re-tune in this file if you find the LED is on too eagerly
// during dim daylight or stays off too late at dusk.
const DARK_THRESHOLD = 50;
const BRIGHT_THRESHOLD = 120;
// Two consecutive samples below ~5% target before we actually drop to 0.
// Prevents flicker when a flashlight or a passing car briefly brightens the
// scene. Off-only hysteresis — ramp-up applies immediately so the IR fades on
// smoothly as evening sets in.
const OFF_HYSTERESIS_SAMPLES = 2;
// Skip command dispatch when the new target differs from the previously
// applied value by less than this many percentage points. Keeps the command
// queue quiet while the AGC drifts.
const MIN_DELTA_TO_APPLY = 3;
// Luma analysis resolution. 64x36 is small enough to decode in <1ms and
// large enough that one bright streetlight in a corner doesn't dominate.
const ANALYSIS_WIDTH = 64;
const ANALYSIS_HEIGHT = 36;

interface ControllerState {
  lastAppliedStrength: number;
  zeroStreak: number;
}

const stateByCamera = new Map<string, ControllerState>();

const computeTargetStrength = (meanY: number): number => {
  if (meanY <= DARK_THRESHOLD) return 100;
  if (meanY >= BRIGHT_THRESHOLD) return 0;
  const ratio = (BRIGHT_THRESHOLD - meanY) / (BRIGHT_THRESHOLD - DARK_THRESHOLD);
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
};

const computeMeanLuma = async (jpegBase64: string): Promise<number | null> => {
  const buffer = Buffer.from(jpegBase64, 'base64');
  const [error, result] = await tryCatch(async () => {
    return sharp(buffer)
      .resize(ANALYSIS_WIDTH, ANALYSIS_HEIGHT, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
  });
  if (error || !result) return null;
  const { data } = result;
  if (data.length === 0) return null;
  let total = 0;
  for (let i = 0; i < data.length; i += 1) total += data[i];
  return total / data.length;
};

export const onThumbnailUpdated = async ({
  cameraId,
  jpegBase64,
}: {
  cameraId: string;
  jpegBase64: string;
}): Promise<void> => {
  const logEnabled = isCameraLogEnabled(cameraId, 'ir');

  const [cameraReadError, camera] = await tryCatch(async () => {
    return prisma.camera.findUnique({
      where: { id: cameraId },
      select: { id: true, ip: true, irMode: true, irStrength: true },
    });
  });
  if (cameraReadError) {
    if (logEnabled) {
      console.log(`[ir] cameraId=${cameraId} thumbnail tick — skip: db read error`);
    }
    return;
  }
  if (!camera) {
    if (logEnabled) {
      console.log(`[ir] cameraId=${cameraId} thumbnail tick — skip: camera not in db`);
    }
    return;
  }

  // 'on' is a constant user-set value applied by setIRStrength_v1 + the Pi
  // Zero adapter. 'off' explicitly disables IR. The auto controller is the
  // ONLY thing that should drive irSetStrength here — and only when
  // irMode === 'auto'. Reset hysteresis state so the next switch into auto
  // starts fresh.
  if (camera.irMode !== 'auto') {
    if (stateByCamera.has(cameraId)) {
      stateByCamera.delete(cameraId);
    }
    if (logEnabled) {
      console.log(
        `[ir] cameraId=${cameraId} thumbnail tick — skip: mode=${camera.irMode} (auto controller is dormant; manual strength=${String(camera.irStrength ?? 100)}%)`,
      );
    }
    return;
  }

  const meanY = await computeMeanLuma(jpegBase64);
  if (meanY === null) {
    if (logEnabled) {
      console.log(`[ir] cameraId=${cameraId} thumbnail tick — skip: meanY decode failed`);
    }
    return;
  }

  const target = computeTargetStrength(meanY);
  const state = stateByCamera.get(cameraId) ?? { lastAppliedStrength: -1, zeroStreak: 0 };

  if (logEnabled) {
    console.log(
      `[ir] cameraId=${cameraId} mode=auto meanY=${meanY.toFixed(1)} thresholds=[${DARK_THRESHOLD}..${BRIGHT_THRESHOLD}] computedTarget=${target}% lastApplied=${state.lastAppliedStrength}% zeroStreak=${state.zeroStreak}`,
    );
  }

  let toApply: number;
  if (target === 0 && state.lastAppliedStrength > 0) {
    state.zeroStreak += 1;
    if (state.zeroStreak < OFF_HYSTERESIS_SAMPLES) {
      stateByCamera.set(cameraId, state);
      if (logEnabled) {
        console.log(
          `[ir] cameraId=${cameraId} mode=auto holdingOff streak=${state.zeroStreak}/${OFF_HYSTERESIS_SAMPLES} (waiting one more dark→bright sample before dropping LED to 0)`,
        );
      }
      return;
    }
    toApply = 0;
  } else {
    state.zeroStreak = 0;
    toApply = target;
  }

  const previous = state.lastAppliedStrength;
  if (previous >= 0 && Math.abs(previous - toApply) < MIN_DELTA_TO_APPLY) {
    stateByCamera.set(cameraId, state);
    if (logEnabled) {
      console.log(
        `[ir] cameraId=${cameraId} mode=auto deltaSkip target=${toApply}% previous=${previous}% (|delta|<${MIN_DELTA_TO_APPLY})`,
      );
    }
    return;
  }

  if (logEnabled) {
    console.log(
      `[ir] cameraId=${cameraId} mode=auto APPLY target=${toApply}% previous=${previous}% — enqueuing irSetStrength`,
    );
  }

  // Auto-driven strength is intentionally NOT persisted into Camera.irStrength.
  // That column is reserved for the user's manual 'on' value so flipping
  // Auto → On returns to whatever the operator last picked, not whatever the
  // auto loop last drove.
  const commandId = globalThis.crypto.randomUUID();
  await tryCatch(async () => {
    return enqueueCommand({
      cameraIp: camera.ip,
      cameraId,
      commandId,
      action: 'irSetStrength',
      payload: { strength: toApply },
      requestedByUserId: 'system:ir-auto',
      coalesceAction: 'irSetStrength',
    });
  });

  state.lastAppliedStrength = toApply;
  stateByCamera.set(cameraId, state);
};

export const resetIRControllerState = (cameraId: string): void => {
  stateByCamera.delete(cameraId);
};
