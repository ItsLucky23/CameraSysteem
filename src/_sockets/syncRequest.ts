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
import { normalizeErrorResponseCore } from "../../shared/responseNormalizer";

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

type Prettify<T> = { [K in keyof T]: T[K] } & {};

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

interface SyncErrorParam { key: string; value: string | number | boolean };

interface SyncResponseError {
  status: 'error';
  message: string;
  errorCode: string;
  errorParams?: SyncErrorParam[];
  httpStatus?: number;
}

interface SyncAckResponse {
  status?: 'success' | 'error';
  message?: string;
  result?: unknown;
  errorCode?: string;
  errorParams?: SyncErrorParam[];
  httpStatus?: number;
}

type SyncResultForFullName<F extends SyncFullName, V extends VersionsForFullName<F>> =
  [ServerOutputForFullName<F, V>] extends [never]
    ? Record<string, never>
    : ServerOutputForFullName<F, V>;

type SyncRequestResponseForFullName<F extends SyncFullName, V extends VersionsForFullName<F>> =
  | SyncResponseError
  | {
    status: 'success';
    message: string;
    result: SyncResultForFullName<F, V>;
  };

// ═══════════════════════════════════════════════════════════════════════════════
// Sync Event Callbacks Registry
// ═══════════════════════════════════════════════════════════════════════════════

type SyncEventCallback = (params: { clientOutput: unknown; serverOutput: unknown }) => void;
const syncEvents: Partial<Record<string, SyncEventCallback[]>> = {};
const noop = () => null;

interface SyncLifecycleHandlers {
  connect: () => void;
  disconnect: () => void;
  reconnectAttempt: (attempt: number) => void;
  userAfk: (payload: { userId: string; endTime?: number }) => void;
  userBack: (payload: { userId: string }) => void;
  connectError: (err: { message: string }) => void;
}

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

const normalizeSyncError = ({
  response,
  fallbackErrorCode,
}: {
  response: SyncAckResponse;
  fallbackErrorCode: string;
}): SyncResponseError => {
  const normalized = normalizeErrorResponseCore({
    response,
    fallbackErrorCode,
    resolveMessage: ({ errorCode }) => {
      if (typeof response.message === 'string' && response.message.trim().length > 0) {
        return response.message;
      }

      return errorCode;
    },
  });

  return {
    status: 'error',
    message: normalized.message,
    errorCode: normalized.errorCode,
    errorParams: normalized.errorParams,
    httpStatus: normalized.httpStatus,
  };
};

type SyncRequestParamsWithOptions<F extends SyncFullName, V extends VersionsForFullName<F>> =
  SyncParamsForFullName<F, V>;

const syncRequestInternal = <F extends SyncFullName, V extends VersionsForFullName<F>>(
  params: SyncRequestParamsWithOptions<F, V>
): Promise<Prettify<SyncRequestResponseForFullName<F, V>>> => {
  const runtimeParams = params as RuntimeSyncParams;
  const { name, version, receiver, ignoreSelf } = runtimeParams;
  const payloadData = runtimeParams.data;

  type RequestOutput = Prettify<SyncRequestResponseForFullName<F, V>>;

  return new Promise<RequestOutput>((resolve) => {
    void (async () => {
      if (!name || typeof name !== "string") {
        if (dev) {
          console.error("Invalid name for syncRequest");
          notify.error({ key: 'sync.invalidName' });
        }
        resolve(normalizeSyncError({
          response: { status: 'error', errorCode: 'sync.invalidName' },
          fallbackErrorCode: 'sync.invalidName',
        }) as RequestOutput);
        return;
      }

      const data = payloadData && typeof payloadData === "object" ? payloadData : {};

      if (!version || typeof version !== 'string') {
        if (dev) {
          console.error("Invalid version for syncRequest");
          notify.error({ key: 'sync.invalidVersion' });
        }
        resolve(normalizeSyncError({
          response: { status: 'error', errorCode: 'sync.invalidVersion' },
          fallbackErrorCode: 'sync.invalidVersion',
        }) as RequestOutput);
        return;
      }

      if (!receiver) {
        if (dev) {
          console.error("You need to provide a receiver for syncRequest, this can be either 'all' to trigger all sockets which we do not recommend or it can be any value such as a code e.g 'Ag2cg4'. this works together with the joinRoom and leaveRoom function");
          notify.error({ key: 'sync.missingReceiver' });
        }
        resolve(normalizeSyncError({
          response: { status: 'error', errorCode: 'sync.missingReceiver' },
          fallbackErrorCode: 'sync.missingReceiver',
        }) as RequestOutput);
        return;
      }

      if (!await waitForSocket()) {
        resolve(normalizeSyncError({
          response: { status: 'error', errorCode: 'sync.ioUnavailable' },
          fallbackErrorCode: 'sync.ioUnavailable',
        }) as RequestOutput);
        return;
      }
      if (!socket) {
        resolve(normalizeSyncError({
          response: { status: 'error', errorCode: 'sync.ioUnavailable' },
          fallbackErrorCode: 'sync.ioUnavailable',
        }) as RequestOutput);
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
            run: (s) => {
              runRequest(s);
            },
            createdAt: Date.now(),
          });
          return;
        }

        const tempIndex = incrementResponseIndex();

        if (dev) {
          console.log(`Client Sync Request(${String(tempIndex)}):`, { syncName: sanitizedName, data, receiver, ignoreSelf });
        }

        socketInstance.emit('sync', { name: fullName, data, cb: `${sanitizedName}/${version}`, receiver, responseIndex: tempIndex, ignoreSelf });

        socketInstance.once(`sync-${String(tempIndex)}`, (responseData: SyncAckResponse) => {
          if (responseData.status === "error") {
            const normalizedError = normalizeSyncError({
              response: responseData,
              fallbackErrorCode: 'sync.failedRequest',
            });

            if (dev) {
              console.error(`Sync ${sanitizedName} failed: ${normalizedError.message}`);
              notify.error({
                key: 'sync.failedRequest',
                params: [
                  { key: 'name', value: sanitizedName },
                  { key: 'message', value: normalizedError.message },
                ],
              });
            }
            resolve(normalizedError);
            return;
          }

          if (responseData.status !== 'success') {
            resolve(normalizeSyncError({
              response: responseData,
              fallbackErrorCode: 'sync.invalidServerResponse',
            }) as RequestOutput);
            return;
          }

          const result = responseData.result && typeof responseData.result === 'object'
            ? responseData.result
            : {};

          resolve({
            status: 'success',
            message: typeof responseData.message === 'string' && responseData.message.trim().length > 0
              ? responseData.message
              : `sync ${sanitizedName} success`,
            result,
          } as RequestOutput);
        });
      };

      runRequest(socket);
    })();
  });
};

export function syncRequest<F extends SyncFullName, V extends VersionsForFullName<F>>(
  params: SyncRequestParamsWithOptions<F, V>
): Promise<Prettify<SyncRequestResponseForFullName<F, V>>> {
  return syncRequestInternal(params);
}

// ═══════════════════════════════════════════════════════════════════════════════
// useSyncEvents Hook - Type-Safe Event Registration
// ═══════════════════════════════════════════════════════════════════════════════

export const useSyncEvents = () => {
  const localRegistryRef = useRef<Map<string, SyncEventCallback>>(new Map());

  interface TypedCallbackParams<F extends SyncFullName, V extends VersionsForFullName<F>> {
    clientOutput: ClientOutputForFullName<F, V>;
    serverOutput: ServerOutputForFullName<F, V>;
  }

  interface UpsertParams<F extends SyncFullName, V extends VersionsForFullName<F>> {
    name: F;
    version: V;
    callback: (params: TypedCallbackParams<F, V>) => void;
  }

  const upsertSyncEventCallback = useCallback(<F extends SyncFullName, V extends VersionsForFullName<F>>(
    params: UpsertParams<F, V>
  ): (() => void) => {

    if (typeof params.version !== 'string') {
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
    if (sanitizedName.length === 0) {
      if (dev) {
        console.error("Invalid name for upsertSyncEventCallback");
        notify.error({ key: 'sync.invalidName' });
      }
      return noop;
    }

    const fullName = `sync/${sanitizedName}/${params.version}`;
    const callback = params.callback as SyncEventCallback;
    const callbacks = getCallbacksForRoute(fullName);

    const previousForRoute = localRegistryRef.current.get(fullName);
    if (previousForRoute) {
      syncEvents[fullName] = callbacks.filter((cb) => cb !== previousForRoute);
    }

    const nextCallbacks = getCallbacksForRoute(fullName);
    // Multiple components can intentionally subscribe to the same sync event.
    // Only warn when the exact same callback is registered twice.
    if (nextCallbacks.includes(callback)) {
      if (dev) {
        console.warn(`[SyncEvents] Duplicate callback registration for ${fullName} was ignored.`);
      }

      localRegistryRef.current.set(fullName, callback);

      return () => {
        const current = getCallbacksForRoute(fullName);
        syncEvents[fullName] = current.filter((cb) => cb !== callback);

        if (localRegistryRef.current.get(fullName) === callback) {
          localRegistryRef.current.delete(fullName);
        }
      };
    }

    nextCallbacks.push(callback);
    syncEvents[fullName] = nextCallbacks;
    localRegistryRef.current.set(fullName, callback);

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
    console.log(`Reconnecting attempt ${String(attempt)}...`);
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