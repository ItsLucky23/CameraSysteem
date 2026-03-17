import { dev } from "config";
import { toast } from "sonner";
import { incrementResponseIndex, socket, waitForSocket } from "./socketInitializer";
import type { ApiTypeMap } from './apiTypes.generated';
import notify from "src/_functions/notify";
import { enqueueApiRequest, isOnline, removeApiQueueItem } from "./offlineQueue";
import { Socket } from "socket.io-client";
import { normalizeErrorResponseCore } from "../../shared/responseNormalizer";

//? Abort controller logic:
//? - abortable: true → always use abort controller
//? - abortable: false → never use abort controller
//? - abortable: undefined → use abort controller for GET APIs (from generated types)
const abortControllers = new Map<string, AbortController>();

/**
 * Check if an API is a GET method using the generated type map.
 * Falls back to name inference if API not found in map.
 */
const isGetMethod = (apiName: string): boolean => {
  const lower = apiName.toLowerCase();
  return lower.startsWith('get') || lower.startsWith('fetch') || lower.startsWith('list');
};


// ═══════════════════════════════════════════════════════════════════════════════
// Type Helpers
// ═══════════════════════════════════════════════════════════════════════════════

// Check if data input is required (i.e., T does NOT allow empty object)
// Unions like {a:1} | {b:1} do NOT allow {}, so data will be required
type DataRequired<T> = {} extends T ? false : true;

type UnionToIntersection<U> =
  (U extends any ? (arg: U) => void : never) extends ((arg: infer I) => void)
    ? I
    : never;

// ═══════════════════════════════════════════════════════════════════════════════
// Global API Params - Union of ALL valid API calls with proper data enforcement
// ═══════════════════════════════════════════════════════════════════════════════
type ApiRouteRecord = UnionToIntersection<{
  [P in keyof ApiTypeMap]: {
    [N in keyof ApiTypeMap[P] as P extends 'root' ? `${N & string}` : `${P & string}/${N & string}`]: ApiTypeMap[P][N]
  }
}[keyof ApiTypeMap]>;

type ApiFullName = keyof ApiRouteRecord & string;
type VersionsForFullName<F extends ApiFullName> = keyof ApiRouteRecord[F] & string;

// Force expansion of types to clear aliases in tooltips
type Prettify<T> = { [K in keyof T]: T[K] } & {};

// Get input type for an API name (union if exists on multiple pages)
type InputForFullName<F extends ApiFullName, V extends VersionsForFullName<F>> = ApiRouteRecord[F][V] extends { input: infer I }
  ? I
  : never;

// Get output type for an API name (union if exists on multiple pages)
type OutputForFullName<F extends ApiFullName, V extends VersionsForFullName<F>> = ApiRouteRecord[F][V] extends { output: infer O }
  ? O
  : never;

// Build params type for a specific API name
type ApiParamsForFullName<
  F extends ApiFullName,
  V extends VersionsForFullName<F>
> = DataRequired<InputForFullName<F, V>> extends true
  ? { name: F; version: V; data: Prettify<InputForFullName<F, V>>; abortable?: boolean; disableErrorMessage?: boolean; }
  : { name: F; version: V; data?: Prettify<InputForFullName<F, V>>; abortable?: boolean; disableErrorMessage?: boolean; };

type RuntimeApiParams = {
  name?: string;
  version?: string;
  data?: unknown;
  abortable?: boolean;
  disableErrorMessage?: boolean;
};

/**
 * Type-safe API request function.
 * 
 * @example
 * ```typescript
 * // Full name usage - includes page in the name
 * const result = await apiRequest({ name: 'examples/publicApi', version: 'v1', data: { message: 'hello' } });
 * // result is typed correctly for publicApi
 * 
 * // Root APIs do not include a page prefix
 * await apiRequest({ name: 'session', version: 'v1' });
 * ```
 */

export function apiRequest<F extends ApiFullName, V extends VersionsForFullName<F>>(
  params: ApiParamsForFullName<F, V>
): Promise<Prettify<OutputForFullName<F, V>>> {
  type RequestOutput = Prettify<OutputForFullName<F, V>>;
  const runtimeParams = params as RuntimeApiParams;
  let { name, version, disableErrorMessage = false } = runtimeParams;
  let { data } = runtimeParams;

  return new Promise<RequestOutput>(async (resolve, reject) => {
    if (!name || typeof name !== "string") {
      if (dev) {
        console.error("Invalid name");
        toast.error("Invalid name");
      }
      return resolve(null as unknown as RequestOutput);
    }

    if (!version || typeof version !== 'string') {
      if (dev) {
        console.error("Invalid version");
        toast.error("Invalid version");
      }
      return resolve(null as unknown as RequestOutput);
    }

    if (!data || typeof data !== "object") {
      data = {};
    }

    if (!await waitForSocket()) { return resolve(null as unknown as RequestOutput); }
    if (!socket) { return resolve(null as unknown as RequestOutput); }

    name = name.replace(/^\/+|\/+$/g, '');

    //? Abort controller logic:
    //? - abortable: true → always use abort controller
    //? - abortable: false → never use abort controller  
    //? - abortable: undefined → smart default (GET-like APIs get abort controller)
    const terminalName = name.split('/').at(-1) ?? name;
    const isGet = isGetMethod(terminalName as string);
    const useAbortController = runtimeParams.abortable === true || isGet;
    const fullname = `api/${name}/${version}`;

    let signal: AbortSignal | null = null;
    let abortFunc = () => { };
    let queueId: string | null = null;

    if (useAbortController) {
      if (abortControllers.has(fullname as string)) {
        //? if we have an abort controller we abort it and create a new one
        const prevAbortController = abortControllers.get(fullname as string);
        prevAbortController?.abort();
      }
      //? here we create a new abort controller and add it to the map with the api fullname as the key
      const abortController = new AbortController();
      abortControllers.set(fullname as string, abortController);
      abortFunc = () => {
        if (signal) { signal.removeEventListener("abort", abortFunc); }
        if (queueId) { removeApiQueueItem(queueId); }
        reject(`Request ${fullname} aborted`)
      };
      //? here we bind the abortFunc to the abort event so it will be called when the abort controller is aborted
      signal = abortController.signal;
      signal.addEventListener("abort", abortFunc);
    }

    const canSendNow = (s: Socket) => {
      if (!s.connected) return false;
      return isOnline();
    };

    const runRequest = (socketInstance: Socket) => {
      if (!canSendNow(socketInstance)) {
        if (!queueId) {
          queueId = `${Date.now()}-${Math.random()}`;
        }
        enqueueApiRequest({
          id: queueId,
          key: fullname,
          run: (s) => runRequest(s),
          createdAt: Date.now(),
        });
        return;
      }

      if (signal && signal.aborted) { return; }

      const tempIndex = incrementResponseIndex();
      socketInstance.emit('apiRequest', { name: fullname, data, responseIndex: tempIndex });

      type ApiResponse =
        | ({ status: "success"; httpStatus: number } & any)
        | { status: "error"; httpStatus: number; message: string; errorCode: string; errorParams?: { key: string; value: string | number | boolean; }[] };

      if (dev) { console.log(`Client API Request(${tempIndex}): `, { APINAME: name, data }) }
      socketInstance.once(`apiResponse-${tempIndex}`, (response: ApiResponse) => {
        if (signal && signal.aborted) { return; }

        const { status } = response;

        if (dev) { console.log(`Server API Response(${tempIndex}): `, { ...response, APINAME: name }) }

        if (status === "error") {
          const normalizedError = normalizeErrorResponseCore({ response });

          if (!disableErrorMessage) {
            // toast.error(message)
            if (normalizedError.errorCode) {
              notify.error({ key: normalizedError.errorCode, params: normalizedError.errorParams })
            } else {
              notify.error({ key: normalizedError.message })
            }
          }
          return resolve(normalizedError as unknown as RequestOutput)
        }

        if (signal) {
          signal.removeEventListener("abort", abortFunc);
          abortControllers.delete(fullname as string);
        }

        resolve(response as RequestOutput)
      });
    };

    runRequest(socket);
  })
}