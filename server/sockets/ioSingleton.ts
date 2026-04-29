import type { Server as SocketIOServer } from 'socket.io';

// Lives in its own module so consumers (cameraHelpers, etc.) don't pull in
// socket.ts — that file imports from cameraStreamOrchestrator → ... →
// cameraHelpers, forming a cycle that crashes the bundled build with a TDZ
// error on the `getIoInstance` const.

const IO_SINGLETON_KEY = '__luckyStackSocketIoInstance__';
const ioScope = globalThis as typeof globalThis & {
  [IO_SINGLETON_KEY]?: SocketIOServer | null;
};

export const getIoInstance = (): SocketIOServer | null => {
  return ioScope[IO_SINGLETON_KEY] ?? null;
};

export const setIoInstance = (instance: SocketIOServer | null): void => {
  ioScope[IO_SINGLETON_KEY] = instance;
};
