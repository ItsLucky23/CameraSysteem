export interface StoredThumbnail {
  jpegBase64: string;
  capturedAt: Date;
}

const THUMBNAIL_STORE_SINGLETON_KEY = '__luckyStackCameraThumbnailStore__';

const storeScope = globalThis as typeof globalThis & {
  [THUMBNAIL_STORE_SINGLETON_KEY]?: Map<string, StoredThumbnail>;
};

const store: Map<string, StoredThumbnail> =
  storeScope[THUMBNAIL_STORE_SINGLETON_KEY] ?? new Map<string, StoredThumbnail>();

if (!storeScope[THUMBNAIL_STORE_SINGLETON_KEY]) {
  storeScope[THUMBNAIL_STORE_SINGLETON_KEY] = store;
}

export const setThumbnail = (cameraId: string, jpegBase64: string, capturedAt: Date): void => {
  store.set(cameraId, { jpegBase64, capturedAt });
};

export const getThumbnail = (cameraId: string): StoredThumbnail | null => {
  return store.get(cameraId) ?? null;
};

export const getAllThumbnails = (): Map<string, StoredThumbnail> => {
  return store;
};
