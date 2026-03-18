import { dev, SessionLayout } from "config";
import notify from "src/_functions/notify";
import { incrementResponseIndex, socket, waitForSocket } from "./socketInitializer";
import { statusContent } from "src/_providers/socketStatusProvider";
import { Dispatch, RefObject, SetStateAction, useCallback, useEffect, useRef } from "react";
import { enqueueSyncRequest, isOnline } from "./offlineQueue";
import type {
  SyncTypeMap
} from "./apiTypes.generated";
import { Socket } from "socket.io-client";

// ═══════════════════════════════════════════════════════════════════════════════
// Type Helpers for Sync Requests
// ═══════════════════════════════════════════════════════════════════════════════

// Check if data input is required (i.e., T does NOT allow empty object)
// Unions like {a:1} | {b:1} do NOT allow {}, so data will be required
type DataRequired<T> = Record<string, never> extends T ? false : true;

type UnionToIntersection<U> =
  (U extends unknown ? (arg: U) => void : never) extends ((arg: infer I) => void)
    ? I
    : never;

// ═══════════════════════════════════════════════════════════════════════════════
// Global Sync Params
// ═══════════════════════════════════════════════════════════════════════════════

// All possible sync names across all pages
type SyncRouteRecord = UnionToIntersection<{
  [P in keyof SyncTypeMap]: {
    [N in keyof SyncTypeMap[P] as `${Extract<P, string>}/${Extract<N, string>}`]: SyncTypeMap[P][N]
  }
}[keyof SyncTypeMap]>;

type SyncFullName = Extract<keyof SyncRouteRecord, string>;
type VersionsForFullName<F extends SyncFullName> = keyof SyncRouteRecord[F] & string;

type ClientInputForFullName<F extends SyncFullName, V extends VersionsForFullName<F>> = SyncRouteRecord[F][V] extends { clientInput: infer I }
  ? I
  : never;

type ServerOutputForFullName<F extends SyncFullName, V extends VersionsForFullName<F>> = SyncRouteRecord[F][V] extends { serverOutput: infer O }
  ? O
  : never;

type ClientOutputForFullName<F extends SyncFullName, V extends VersionsForFullName<F>> = SyncRouteRecord[F][V] extends { clientOutput: infer O }
  ? O
  : never;

type SyncParamsForFullName<
  F extends SyncFullName,
  V extends VersionsForFullName<F>
> = DataRequired<ClientInputForFullName<F, V>> extends true
  ? {
    name: F;
    version: V;
    data: ClientInputForFullName<F, V>;
    receiver: string;
    ignoreSelf?: boolean;
  }
  : {
    name: F;
    version: V;
    data?: ClientInputForFullName<F, V>;
    receiver: string;
    ignoreSelf?: boolean;
  };

interface RuntimeSyncParams {
  name?: string;
  version?: string;
  data?: unknown;
  receiver?: string;
  ignoreSelf?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sync Event Callbacks Registry
// ═══════════════════════════════════════════════════════════════════════════════

type SyncEventCallback = (params: { clientOutput: unknown; serverOutput: unknown }) => void;
const syncEvents: Partial<Record<string, SyncEventCallback[]>> = {};
const noop = () => null;

type SyncLifecycleHandlers = {
  connect: () => void;
  disconnect: () => void;
  reconnectAttempt: (attempt: number) => void;
  userAfk: (payload: { userId: string; endTime?: number }) => void;
  userBack: (payload: { userId: string }) => void;
  connectError: (err: { message: string }) => void;
};

let activeLifecycleHandlers: SyncLifecycleHandlers | null = null;

const canSendNow = (socketInstance: Socket) => {
  if (!socketInstance.connected) return false;
  return isOnline();
};

const createQueueId = () => {
  return `${String(Date.now())}-${String(Math.random())}`;
};

const getCallbacksForRoute = (route: string): SyncEventCallback[] => {
  syncEvents[route] ??= [];
  return syncEvents[route];
};

const triggerSyncCallbacks = (name: string, clientOutput: unknown, serverOutput: unknown) => {
  const callbacks = syncEvents[name] ?? [];
  if (callbacks.length === 0) {
    if (dev) {
      console.warn(`Sync event ${name} has no registered callback on this page`);
    }
    return;
  }

  for (const callback of callbacks) {
    callback({ clientOutput, serverOutput });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// syncRequest Function Overloads
// ═══════════════════════════════════════════════════════════════════════════════

export function syncRequest<F extends SyncFullName, V extends VersionsForFullName<F>>(
  params: SyncParamsForFullName<F, V>
): Promise<boolean> {
  const runtimeParams = params as RuntimeSyncParams;
  const { name, version, receiver, ignoreSelf } = runtimeParams;
  const payloadData = runtimeParams.data;

  return new Promise((resolve) => {
    void (async () => {
      if (!name || typeof name !== "string") {
        if (dev) {
          console.error("Invalid name for syncRequest");
          notify.error({ key: 'sync.invalidName' });
        }
        resolve(false);
        return;
      }

      const data = payloadData && typeof payloadData === "object" ? payloadData : {};

      if (!version || typeof version !== 'string') {
        if (dev) {
          console.error("Invalid version for syncRequest");
          notify.error({ key: 'sync.invalidVersion' });
        }
        resolve(false);
        return;
      }

      if (!receiver) {
        if (dev) {
          console.error("You need to provide a receiver for syncRequest, this can be either 'all' to trigger all sockets which we do not recommend or it can be any value such as a code e.g 'Ag2cg4'. this works together with the joinRoom and leaveRoom function");
          notify.error({ key: 'sync.missingReceiver' });
        }
        resolve(false);
        return;
      }

      if (!await waitForSocket()) {
        resolve(false);
        return;
      }
      if (!socket) {
        resolve(false);
        return;
      }

      const sanitizedName = name.replaceAll(/^\/+|\/+$/g, '');
      const fullName = `sync/${sanitizedName}/${version}`;
      let queueId: string | null = null;

      const runRequest = (socketInstance: Socket) => {
        if (!canSendNow(socketInstance)) {
          queueId ??= createQueueId();
          enqueueSyncRequest({
            id: queueId,
            key: fullName,
            run: (s) => runRequest(s),
            createdAt: Date.now(),
          });
          return;
        }

        const tempIndex = incrementResponseIndex();

        if (dev) { console.log(`Client Sync Request:`, { name: sanitizedName, data, receiver, ignoreSelf }) }

        socketInstance.emit('sync', { name: fullName, data, cb: `${sanitizedName}/${version}`, receiver, responseIndex: tempIndex, ignoreSelf });

        socketInstance.once(`sync-${tempIndex}`, (responseData: { status: "success" | "error", message: string }) => {
          if (responseData.status === "error") {
            if (dev) {
              console.error(`Sync ${sanitizedName} failed: ${responseData.message}`);
              notify.error({
                key: 'sync.failedRequest',
                params: [
                  { key: 'name', value: sanitizedName },
                  { key: 'message', value: responseData.message },
                ],
              });
            }
            resolve(false);
            return;
          }

          resolve(responseData.status === "success");
        });
      };

      runRequest(socket);
    })();
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// useSyncEvents Hook - Type-Safe Event Registration
// ═══════════════════════════════════════════════════════════════════════════════

export const useSyncEvents = () => {
  const localRegistryRef = useRef<Map<string, SyncEventCallback>>(new Map());

  type TypedCallbackParams<F extends SyncFullName, V extends VersionsForFullName<F>> = {
    clientOutput: ClientOutputForFullName<F, V>;
    serverOutput: ServerOutputForFullName<F, V>;
  };

  type UpsertParams<F extends SyncFullName, V extends VersionsForFullName<F>> = {
    name: F;
    version: V;
    callback: (params: TypedCallbackParams<F, V>) => void;
  };

  const upsertSyncEventCallback = useCallback(<F extends SyncFullName, V extends VersionsForFullName<F>>(
    params: UpsertParams<F, V>
  ): (() => void) => {

    if (!params.name || typeof params.name !== 'string') {
      if (dev) {
        console.error("Invalid name for upsertSyncEventCallback");
        notify.error({ key: 'sync.invalidName' });
      }
      return noop;
    }

    if (!params.version || typeof params.version !== 'string') {
      if (dev) {
        console.error("Invalid version for upsertSyncEventCallback");
        notify.error({ key: 'sync.invalidVersion' });
      }
      return noop;
    }

    if (typeof params.callback !== 'function') {
      if (dev) {
        console.error("Invalid callback for upsertSyncEventCallback");
        notify.error({ key: 'sync.invalidCallback' });
      }
      return noop;
    }

    const sanitizedName = params.name.replaceAll(/^\/+|\/+$/g, '');
    const fullName = `sync/${sanitizedName}/${params.version}`;
    const callback = params.callback as unknown as SyncEventCallback;
    const callbacks = getCallbacksForRoute(fullName);

    const previousForRoute = localRegistryRef.current.get(fullName);
    if (previousForRoute) {
      syncEvents[fullName] = callbacks.filter((cb) => cb !== previousForRoute);
    }

    const nextCallbacks = getCallbacksForRoute(fullName);
    nextCallbacks.push(callback);
    syncEvents[fullName] = nextCallbacks;
    localRegistryRef.current.set(fullName, callback);

    if (dev && nextCallbacks.length > 1) {
      console.warn(
        `[SyncEvents] Multiple callbacks registered for ${fullName} (${nextCallbacks.length}). ` +
        `If this is unintentional, register callbacks in useEffect and return cleanup.`
      );
    }

    return () => {
      const current = getCallbacksForRoute(fullName);
      syncEvents[fullName] = current.filter((cb) => cb !== callback);

      if (localRegistryRef.current.get(fullName) === callback) {
        localRegistryRef.current.delete(fullName);
      }
    };
  }, []);

  useEffect(() => {
    const localRegistry = localRegistryRef.current;

    return () => {
      for (const [fullName, callback] of localRegistry.entries()) {
        const current = getCallbacksForRoute(fullName);
        syncEvents[fullName] = current.filter((cb) => cb !== callback);
      }
      localRegistry.clear();
    };
  }, []);

  return { upsertSyncEventCallback };
}

export const useSyncEventTrigger = () => {
  const triggerSyncEvent = useCallback((name: string, clientOutput: unknown = {}, serverOutput: unknown = {}) => {
    triggerSyncCallbacks(name, clientOutput, serverOutput);
  }, []);

  return { triggerSyncEvent }
}

export const initSyncRequest = async ({
  setSocketStatus,
  sessionRef
}: {
  setSocketStatus: Dispatch<
    SetStateAction<{
      self: statusContent;
      [userId: string]: statusContent;
    }>
  >;
  sessionRef: RefObject<SessionLayout | null> | null;
}) => {

  if (!await waitForSocket()) { return; }
  if (!socket) { return; }
  if (!sessionRef) { return; }

  if (activeLifecycleHandlers) {
    socket.off("connect", activeLifecycleHandlers.connect);
    socket.off("disconnect", activeLifecycleHandlers.disconnect);
    socket.off("reconnect_attempt", activeLifecycleHandlers.reconnectAttempt);
    socket.off("userAfk", activeLifecycleHandlers.userAfk);
    socket.off("userBack", activeLifecycleHandlers.userBack);
    socket.off("connect_error", activeLifecycleHandlers.connectError);
  }

  const connect = () => {
    console.log("Connected to server");
    setSocketStatus(prev => ({
      ...prev,
      self: {
        ...prev.self,
        status: "CONNECTED",
        // reconnectAttempt: undefined,
      }
    }));
  };

  const disconnect = () => {
    setSocketStatus(prev => ({
      ...prev,
      self: {
        ...prev.self,
        status: "DISCONNECTED",
      }
    }));
    console.log("Disconnected, trying to reconnect...");
  };

  const reconnectAttempt = (attempt: number) => {
    setSocketStatus(prev => ({
      ...prev,
      self: {
        ...prev.self,
        status: "RECONNECTING",
        reconnectAttempt: attempt,
      }
    }));
    console.log(`Reconnecting attempt ${attempt}...`);
  };

  //? will not trigger when you call this event
  const userAfk = ({ userId, endTime }: { userId: string; endTime?: number }) => {
    if (sessionRef.current !== null && userId === sessionRef.current.id) {
      setSocketStatus(prev => ({
        ...prev,
        self: {
          status: "DISCONNECTED",
          reconnectAttempt: undefined,
          endTime
        }
      }));
    } else {
      setSocketStatus(prev => ({
        ...prev,
        [userId]: {
          status: "DISCONNECTED",
          endTime
        }
      }));
    }
  };

  //? will not trigger when you call this event
  const userBack = ({ userId }: { userId: string }) => {
    console.log("userBack", { userId });

    setSocketStatus(prev => ({
      ...prev,
      [userId]: {
        status: "CONNECTED",
        endTime: undefined,
      }
    }));
  };

  const connectError = (err: { message: string }) => {
    console.log("connect_error", { err });
    setSocketStatus(prev => ({
      ...prev,
      self: {
        ...prev.self,
        status: "DISCONNECTED",
        reconnectAttempt: undefined,
      }
    }));
    if (dev) {
      console.error(`Connection error: ${err.message}`);
      notify.error({ key: 'common.connectionError' });
    }
  };

  activeLifecycleHandlers = {
    connect,
    disconnect,
    reconnectAttempt,
    userAfk,
    userBack,
    connectError,
  };

  socket.on("connect", connect);
  socket.on("disconnect", disconnect);
  socket.on("reconnect_attempt", reconnectAttempt);
  socket.on("userAfk", userAfk);
  socket.on("userBack", userBack);
  socket.on("connect_error", connectError);

}