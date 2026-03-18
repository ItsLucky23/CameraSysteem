import { dev } from "config";
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

const canSendNow = (socketInstance: Socket) => {
  if (!socketInstance.connected) return false;
  return isOnline();
};

const createQueueId = () => {
  return `${String(Date.now())}-${String(Math.random())}`;
};

const sanitizeName = (name: string) => name.replaceAll(/^\/+|\/+$/g, '');

const shouldUseAbortController = ({
  abortable,
  isGet,
}: {
  abortable: boolean | undefined;
  isGet: boolean;
}) => {
  if (abortable === true) return true;
  if (abortable === false) return false;
  return isGet;
};


// ═══════════════════════════════════════════════════════════════════════════════
// Type Helpers
// ═══════════════════════════════════════════════════════════════════════════════

// Check if data input is required (i.e., T does NOT allow empty object)
// Unions like {a:1} | {b:1} do NOT allow {}, so data will be required
type DataRequired<T> = Record<string, never> extends T ? false : true;

type UnionToIntersection<U> =
  (U extends unknown ? (arg: U) => void : never) extends ((arg: infer I) => void)
    ? I
    : never;

// ═══════════════════════════════════════════════════════════════════════════════
// Global API Params - Union of ALL valid API calls with proper data enforcement
// ═══════════════════════════════════════════════════════════════════════════════
type ApiRouteRecord = UnionToIntersection<{
  [P in keyof ApiTypeMap]: {
    [N in keyof ApiTypeMap[P] as P extends 'root'
      ? Extract<N, string>
      : `${Extract<P, string>}/${Extract<N, string>}`]: ApiTypeMap[P][N]
  }
}[keyof ApiTypeMap]>;

type ApiFullName = Extract<keyof ApiRouteRecord, string>;
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

interface RuntimeApiParams {
  name?: string;
  version?: string;
  data?: unknown;
  abortable?: boolean;
  disableErrorMessage?: boolean;
}

interface ApiErrorResponse {
  status: 'error';
  httpStatus: number;
  message: string;
  errorCode: string;
  errorParams?: { key: string; value: string | number | boolean }[];
}

interface ApiSuccessResponse extends Record<string, unknown> {
  status: 'success';
  httpStatus: number;
}

type ApiResponse = ApiErrorResponse | ApiSuccessResponse;

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
  type RequestOutput = Prettify<OutputForFullName<F, V> & ApiResponse>;
  const runtimeParams = params as RuntimeApiParams;
  const { name, version, disableErrorMessage = false } = runtimeParams;
  const payloadData = runtimeParams.data;

  return new Promise<RequestOutput>((resolve, reject) => {
    void (async () => {
      if (!name || typeof name !== "string") {
        if (dev) {
          console.error("Invalid name");
          notify.error({ key: 'api.invalidName' });
        }
        resolve(null as unknown as RequestOutput);
        return;
      }

      if (!version || typeof version !== 'string') {
        if (dev) {
          console.error("Invalid version");
          notify.error({ key: 'api.invalidVersion' });
        }
        resolve(null as unknown as RequestOutput);
        return;
      }

      const data = payloadData && typeof payloadData === "object" ? payloadData : {};

      if (!await waitForSocket()) {
        resolve(null as unknown as RequestOutput);
        return;
      }
      if (!socket) {
        resolve(null as unknown as RequestOutput);
        return;
      }

      const sanitizedName = sanitizeName(name);

      //? Abort controller logic:
      //? - abortable: true → always use abort controller
      //? - abortable: false → never use abort controller
      //? - abortable: undefined → smart default (GET-like APIs get abort controller)
      const terminalName = sanitizedName.split('/').at(-1) ?? sanitizedName;
      const isGet = isGetMethod(terminalName);
      const useAbortController = shouldUseAbortController({
        abortable: runtimeParams.abortable,
        isGet,
      });
      const fullName = `api/${sanitizedName}/${version}`;

      let signal: AbortSignal | null = null;
      let abortHandler: (() => void) | null = null;
      let queueId: string | null = null;

      const cleanupAbortController = () => {
        if (signal && abortHandler) {
          signal.removeEventListener("abort", abortHandler);
        }
        abortControllers.delete(fullName);
      };

      if (useAbortController) {
        if (abortControllers.has(fullName)) {
          const prevAbortController = abortControllers.get(fullName);
          prevAbortController?.abort();
        }
        const abortController = new AbortController();
        abortControllers.set(fullName, abortController);
        signal = abortController.signal;

        abortHandler = () => {
          cleanupAbortController();
          if (queueId) {
            removeApiQueueItem(queueId);
          }
          reject(new Error(`Request ${fullName} aborted`));
        };

        signal.addEventListener("abort", abortHandler);
      }

      const runRequest = (socketInstance: Socket) => {
        if (!canSendNow(socketInstance)) {
          queueId ??= createQueueId();
          enqueueApiRequest({
            id: queueId,
            key: fullName,
            run: (nextSocket) => {
              runRequest(nextSocket);
            },
            createdAt: Date.now(),
          });
          return;
        }

        if (signal?.aborted) {
          return;
        }

        const tempIndex = incrementResponseIndex();
        socketInstance.emit('apiRequest', { name: fullName, data, responseIndex: tempIndex });

        if (dev) {
          console.log(`Client API Request(${String(tempIndex)}):`, { APINAME: sanitizedName, data });
        }

        socketInstance.once(`apiResponse-${String(tempIndex)}`, (response: RequestOutput) => {
          if (signal?.aborted) {
            return;
          }

          const status = response.status;

          if (dev) {
            console.log(`Server API Response(${String(tempIndex)}):`, { ...response, APINAME: sanitizedName });
          }

          if (status === "error") {
            const normalizedError = normalizeErrorResponseCore({ response });

            if (!disableErrorMessage) {
              if (normalizedError.errorCode) {
                notify.error({ key: normalizedError.errorCode, params: normalizedError.errorParams });
              } else {
                notify.error({ key: normalizedError.message });
              }
            }

            Object.assign(response, normalizedError);
            cleanupAbortController();
            resolve(response);
            return;
          }

          cleanupAbortController();

          resolve(response);
        });
      };

      runRequest(socket);
    })();
  });
}