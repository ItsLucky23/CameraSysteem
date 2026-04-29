// Per-camera, per-feature debug logging toggle store. Admins flip these from
// the cameras page to get verbose logs on the Pi 5 + the Pi Zero for a
// specific subsystem. State is in-memory and resets when Pi 5 restarts —
// matches the user's intent ("turn this on for a few minutes while I debug,
// then forget about it").

export const LOG_FEATURES = [
  'ir',
  'recording',
  'performance',
  'streamPipeline',
  'commandQueue',
] as const;

export type LogFeature = typeof LOG_FEATURES[number];

export const isLogFeature = (value: unknown): value is LogFeature => {
  if (typeof value !== 'string') return false;
  return (LOG_FEATURES as readonly string[]).includes(value);
};

const flagsByCamera = new Map<string, Set<LogFeature>>();

export const getLogFlagsForCamera = (cameraId: string): LogFeature[] => {
  const set = flagsByCamera.get(cameraId);
  if (!set) return [];
  return Array.from(set);
};

export const isCameraLogEnabled = (cameraId: string, feature: LogFeature): boolean => {
  return flagsByCamera.get(cameraId)?.has(feature) ?? false;
};

export const setCameraLogFlag = (
  cameraId: string,
  feature: LogFeature,
  enabled: boolean,
): LogFeature[] => {
  let set = flagsByCamera.get(cameraId);
  if (!set) {
    if (!enabled) return [];
    set = new Set<LogFeature>();
    flagsByCamera.set(cameraId, set);
  }
  if (enabled) set.add(feature);
  else set.delete(feature);
  if (set.size === 0) flagsByCamera.delete(cameraId);
  return Array.from(set ?? []);
};

export const getAllCameraLogFlags = (): Record<string, LogFeature[]> => {
  const result: Record<string, LogFeature[]> = {};
  for (const [cameraId, set] of flagsByCamera.entries()) {
    result[cameraId] = Array.from(set);
  }
  return result;
};
