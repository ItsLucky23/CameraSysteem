export interface Capabilities {
  hasCamera: boolean;
  hasIR: boolean;
  hasPanTilt: boolean;
  hasMicrophone: boolean;
  hasSpeaker: boolean;
  hasMotion: boolean;
  hasZoom: boolean;
  hasTemperature: boolean;
}

const CAPABILITY_STORE_SINGLETON_KEY = '__luckyStackCameraCapabilityStore__';

const storeScope = globalThis as typeof globalThis & {
  [CAPABILITY_STORE_SINGLETON_KEY]?: Map<string, Capabilities>;
};

const store: Map<string, Capabilities> =
  storeScope[CAPABILITY_STORE_SINGLETON_KEY] ?? new Map<string, Capabilities>();

if (!storeScope[CAPABILITY_STORE_SINGLETON_KEY]) {
  storeScope[CAPABILITY_STORE_SINGLETON_KEY] = store;
}

export const setCapabilities = (cameraId: string, capabilities: Capabilities): void => {
  store.set(cameraId, capabilities);
};

export const getCapabilities = (cameraId: string): Capabilities | null => {
  return store.get(cameraId) ?? null;
};

export const getAllCapabilities = (): Map<string, Capabilities> => {
  return store;
};

export const capabilitiesEqual = (a: Capabilities | null, b: Capabilities | null): boolean => {
  if (a === null || b === null) {
    return a === b;
  }
  return (
    a.hasCamera === b.hasCamera
    && a.hasIR === b.hasIR
    && a.hasPanTilt === b.hasPanTilt
    && a.hasMicrophone === b.hasMicrophone
    && a.hasSpeaker === b.hasSpeaker
    && a.hasMotion === b.hasMotion
    && a.hasZoom === b.hasZoom
    && a.hasTemperature === b.hasTemperature
  );
};
