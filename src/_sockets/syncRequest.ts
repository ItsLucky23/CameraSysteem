import { dev, SessionLayout } from "config";
import { toast } from "sonner";
import { incrementResponseIndex, socket, waitForSocket } from "./socketInitializer";
import { statusContent } from "src/_providers/socketStatusProvider";
import { Dispatch, RefObject, SetStateAction } from "react";
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
type DataRequired<T> = {} extends T ? false : true;

type UnionToIntersection<U> =
  (U extends any ? (arg: U) => void : never) extends ((arg: infer I) => void)
    ? I
    : never;

// ═══════════════════════════════════════════════════════════════════════════════
// Global Sync Params
// ═══════════════════════════════════════════════════════════════════════════════

// All possible sync names across all pages
type SyncRouteRecord = UnionToIntersection<{
  [P in keyof SyncTypeMap]: {
    [N in keyof SyncTypeMap[P] as `${P & string}/${N & string}`]: SyncTypeMap[P][N]
  }
}[keyof SyncTypeMap]>;

type SyncFullName = keyof SyncRouteRecord & string;
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

// ═══════════════════════════════════════════════════════════════════════════════
// Sync Event Callbacks Registry
// ═══════════════════════════════════════════════════════════════════════════════

const syncEvents: Record<string, ((params: { clientOutput: any; serverOutput: any }) => void)> = {};

// ═══════════════════════════════════════════════════════════════════════════════
// syncRequest Function Overloads
// ═══════════════════════════════════════════════════════════════════════════════

export function syncRequest<F extends SyncFullName, V extends VersionsForFullName<F>>(
  params: SyncParamsForFullName<F, V>
): Promise<boolean>;

// Implementation
export function syncRequest(params: any): Promise<boolean> {
  let { name, version, data, receiver, ignoreSelf } = params;

  return new Promise(async (resolve) => {
    if (!name || typeof name !== "string") {
      if (dev) {
        console.error("Invalid name for syncRequest");
        toast.error("Invalid name for syncRequest");
      }
      return resolve(false);
    }

    if (!data || typeof data !== "object") {
      data = {};
    }

    if (!version || typeof version !== 'string') {
      if (dev) {
        console.error("Invalid version for syncRequest");
        toast.error("Invalid version for syncRequest");
      }
      return resolve(false);
    }

    if (!receiver) {
      if (dev) {
        console.error("You need to provide a receiver for syncRequest, this can be either 'all' to trigger all sockets wich we dont recommend or it can be any value such as a code e.g 'Ag2cg4'. this works together with the joinRoom and leaveRoom function");
        toast.error("You need to provide a receiver for syncRequest, this can be either 'all' to trigger all sockets wich we dont recommend or it can be any value such as a code e.g 'Ag2cg4'. this works together with the joinRoom and leaveRoom function");
      }
      return resolve(false);
    }

    if (!await waitForSocket()) { return resolve(false); }
    if (!socket) { return resolve(false); }

    name = name.replace(/^\/+|\/+$/g, '');
    const fullName = `sync/${name}/${version}`;
    let queueId: string | null = null;

    const canSendNow = (s: Socket) => {
      if (!s.connected) return false;
      return isOnline();
    };

    const runRequest = (socketInstance: Socket) => {
      if (!canSendNow(socketInstance)) {
        if (!queueId) {
          queueId = `${Date.now()}-${Math.random()}`;
        }
        enqueueSyncRequest({
          id: queueId,
          key: fullName,
          run: (s) => runRequest(s),
          createdAt: Date.now(),
        });
        return;
      }

      const tempIndex = incrementResponseIndex();

      if (dev) { console.log(`Client Sync Request: `, { name, data, receiver, ignoreSelf }) }

      socketInstance.emit('sync', { name: fullName, data, cb: `${name}/${version}`, receiver, responseIndex: tempIndex, ignoreSelf });

      socketInstance.once(`sync-${tempIndex}`, (data: { status: "success" | "error", message: string }) => {
        if (data.status === "error") {
          if (dev) {
            console.error(`Sync ${name} failed: ${data.message}`);
            toast.error(`Sync ${name} failed: ${data.message}`);
          }
          return resolve(false);
        }
        resolve(data.status == "success");
      });
    };

    runRequest(socket);
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// useSyncEvents Hook - Type-Safe Event Registration
// ═══════════════════════════════════════════════════════════════════════════════

export const useSyncEvents = () => {
  type TypedCallbackParams<F extends SyncFullName, V extends VersionsForFullName<F>> = {
    clientOutput: ClientOutputForFullName<F, V>;
    serverOutput: ServerOutputForFullName<F, V>;
  };

  type UpsertParams<F extends SyncFullName, V extends VersionsForFullName<F>> = {
    name: F;
    version: V;
    callback: (params: TypedCallbackParams<F, V>) => void;
  };

  function upsertSyncEventCallback<F extends SyncFullName, V extends VersionsForFullName<F>>(
    params: UpsertParams<F, V>
  ): void {

    if (!params.name || typeof params.name !== 'string') {
      if (dev) {
        console.error("Invalid name for upsertSyncEventCallback");
        toast.error("Invalid name for upsertSyncEventCallback");
      }
      return;
    }

    if (!params.version || typeof params.version !== 'string') {
      if (dev) {
        console.error("Invalid version for upsertSyncEventCallback");
        toast.error("Invalid version for upsertSyncEventCallback");
      }
      return;
    }

    if (typeof params.callback !== 'function') {
      if (dev) {
        console.error("Invalid callback for upsertSyncEventCallback");
        toast.error("Invalid callback for upsertSyncEventCallback");
      }
      return;
    }

    const sanitizedName = params.name.replace(/^\/+|\/+$/g, '');
    const fullName = `sync/${sanitizedName}/${params.version}`;
    syncEvents[fullName] = params.callback;
  }

  return { upsertSyncEventCallback };
}

export const useSyncEventTrigger = () => {

  const triggerSyncEvent = (name: string, clientOutput: any = {}, serverOutput: any = {}) => {
    const cb = syncEvents[name];
    if (!cb) {
      if (dev) {
        console.log(syncEvents)
        console.error(`Sync event ${name} not found`);
        toast.error(`Sync event ${name} not found`);
      }
      return;
    }
    if (typeof cb == 'function') {
      cb({ clientOutput, serverOutput });
    }
  }

  return { triggerSyncEvent }
}

export const initSyncRequest = async ({
  socketStatus,
  setSocketStatus,
  sessionRef
}: {
  socketStatus: {
    self: statusContent;
    [userId: string]: statusContent;
  };
  setSocketStatus: Dispatch<
    SetStateAction<{
      self: statusContent;
      [userId: string]: statusContent;
    }>
  >;
  sessionRef: RefObject<SessionLayout> | null;
}) => {

  if (!await waitForSocket()) { return; }
  if (!socket) { return; }
  if (!sessionRef) { return; }

  socket.on("connect", () => {
    console.log(socketStatus)
    console.log("Connected to server");
    setSocketStatus(prev => ({
      ...prev,
      self: {
        ...prev.self,
        status: "CONNECTED",
        // reconnectAttempt: undefined,
      }
    }));
  });

  socket.on("disconnect", () => {
    setSocketStatus(prev => ({
      ...prev,
      self: {
        ...prev.self,
        status: "DISCONNECTED",
      }
    }));
    console.log("Disconnected, trying to reconnect...");
  });

  socket.on("reconnect_attempt", (attempt) => {
    setSocketStatus(prev => ({
      ...prev,
      self: {
        ...prev.self,
        status: "RECONNECTING",
        reconnectAttempt: attempt,
      }
    }));
    console.log(`Reconnecting attempt ${attempt}...`);
  });

  //? will not trigger when you call this event
  socket.on("userAfk", ({ userId, endTime }) => {
    if (userId == sessionRef.current?.id) {
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
  });

  //? will not trigger when you call this event
  socket.on("userBack", ({ userId }) => {
    console.log("userBack", { userId });

    setSocketStatus(prev => {
      const newStatus = { ...prev };
      newStatus[userId] = {
        status: "CONNECTED",
        endTime: undefined,
      };
      return newStatus;
    });
  });

  socket.on("connect_error", (err) => {
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
      toast.error(`Connection error: ${err.message}`);
    }
  });

}