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
  const [cameraReadError, camera] = await tryCatch(async () => {
    return prisma.camera.findUnique({
      where: { id: cameraId },
      select: { id: true, ip: true, irMode: true, irStrength: true },
    });
  });
  if (cameraReadError || !camera) return;

  // Only auto mode drives the LED. 'on' is user-controlled, 'off' means IR
  // explicitly disabled. Either way we reset our hysteresis state so the next
  // switch back to auto starts fresh.
  if (camera.irMode !== 'auto') {
    stateByCamera.delete(cameraId);
    return;
  }

  const meanY = await computeMeanLuma(jpegBase64);
  if (meanY === null) return;

  const target = computeTargetStrength(meanY);
  const state = stateByCamera.get(cameraId) ?? { lastAppliedStrength: -1, zeroStreak: 0 };

  let toApply: number;
  if (target === 0 && state.lastAppliedStrength > 0) {
    state.zeroStreak += 1;
    if (state.zeroStreak < OFF_HYSTERESIS_SAMPLES) {
      stateByCamera.set(cameraId, state);
      if (isCameraLogEnabled(cameraId, 'ir')) {
        console.log(
          `[ir-auto] cameraId=${cameraId} meanY=${meanY.toFixed(1)} target=0 holdingOff streak=${state.zeroStreak}/${OFF_HYSTERESIS_SAMPLES} (last=${state.lastAppliedStrength}%)`,
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
    if (isCameraLogEnabled(cameraId, 'ir')) {
      console.log(
        `[ir-auto] cameraId=${cameraId} meanY=${meanY.toFixed(1)} target=${toApply}% deltaSkip (previous=${previous}%)`,
      );
    }
    return;
  }

  if (isCameraLogEnabled(cameraId, 'ir')) {
    console.log(
      `[ir-auto] cameraId=${cameraId} meanY=${meanY.toFixed(1)} thresholds=[${DARK_THRESHOLD}..${BRIGHT_THRESHOLD}] target=${toApply}% previous=${previous}% applying`,
    );
  }

  // Persist the new value so the next page load + the cameras list reflect it.
  await tryCatch(async () => {
    return prisma.camera.update({
      where: { id: cameraId },
      data: { irStrength: toApply },
    });
  });

  // Push to the Pi Zero via the existing irSetStrength command path. We do
  // NOT write a cameraCommand row for these — they're high-frequency and
  // would clutter the audit log. The slider commits go through
  // setIRStrength_v1 which does write rows (those are user-initiated).
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
