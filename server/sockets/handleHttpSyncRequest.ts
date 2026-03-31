import { syncs, functions } from '../prod/generatedApis';
import { ioInstance } from "./socket";
import { getSession } from "../functions/session";
import config, { SessionLayout } from "../../config";
import { validateRequest } from "../utils/validateRequest";
import { extractTokenFromSocket } from "../utils/extractToken";
import tryCatch from "../../shared/tryCatch";
import { extractLanguageFromHeader, normalizeErrorResponse } from "../utils/responseNormalizer";
import { validateInputByType } from '../utils/runtimeTypeValidation';
import { checkRateLimit } from '../utils/rateLimiter';
import { setSentryUser, startSpan } from '../functions/sentry';

interface HttpSyncRequestParams {
  name: string;
  cb?: string;
  data: Record<string, any>;
  receiver: string;
  ignoreSelf?: boolean;
  token: string | null;
  requesterIp?: string;
  xLanguageHeader?: string | string[];
  acceptLanguageHeader?: string | string[];
}

type HttpSyncResponse = {
  status: 'success' | 'error';
  message: string;
  errorCode?: string;
  errorParams?: { key: string; value: string | number | boolean; }[];
  httpStatus?: number;
};

const getRuntimeSyncMaps = async () => {
  if (process.env.NODE_ENV !== 'production') {
    const { devSyncs, devFunctions } = await import('../dev/loader');
    return {
      syncObject: devSyncs,
      functionsObject: devFunctions,
    };
  }

  return {
    syncObject: syncs,
    functionsObject: functions,
  };
};

export default async function handleHttpSyncRequest({
  name,
  cb,
  data,
  receiver,
  ignoreSelf,
  token,
  requesterIp,
  xLanguageHeader,
  acceptLanguageHeader,
}: HttpSyncRequestParams): Promise<HttpSyncResponse> {
  const preferredLocale =
    extractLanguageFromHeader(xLanguageHeader)
    || extractLanguageFromHeader(acceptLanguageHeader);
  const user = await getSession(token);
  setSentryUser(user?.id ? {
    id: String(user.id),
    email: user.email || undefined,
  } : null);
  const span = startSpan(name, 'sync.request.http') as { end?: () => void } | undefined;

  const buildSyncError = ({
    response,
    preferred,
    userLanguage,
  }: {
    response: { status: 'error'; errorCode?: string; errorParams?: { key: string; value: string | number | boolean; }[]; httpStatus?: number };
    preferred?: string | null;
    userLanguage?: string | null;
  }): HttpSyncResponse => {
    const normalized = normalizeErrorResponse({
      response,
      preferredLocale: preferred,
      userLanguage,
    });

    return {
      status: normalized.status,
      message: normalized.message,
      errorCode: normalized.errorCode,
      errorParams: normalized.errorParams,
      httpStatus: normalized.httpStatus,
    };
  };

  const ensureSyncErrorShape = (response: { status: 'error'; errorCode?: string; errorParams?: { key: string; value: string | number | boolean; }[]; httpStatus?: number }) => {
    if (typeof response.errorCode === 'string' && response.errorCode.trim().length > 0) {
      return response;
    }

    return {
      ...response,
      errorCode: 'sync.clientRejected',
    };
  };

  try {
    if (!ioInstance) {
      return buildSyncError({
        response: { status: 'error', errorCode: 'sync.ioUnavailable' },
        preferred: preferredLocale,
        userLanguage: user?.language,
      });
    }

    if (!name || typeof name !== 'string') {
      return buildSyncError({
        response: { status: 'error', errorCode: 'sync.invalidRequest' },
        preferred: preferredLocale,
        userLanguage: user?.language,
      });
    }

    if (!receiver || typeof receiver !== 'string') {
      return buildSyncError({
        response: { status: 'error', errorCode: 'sync.missingReceiver' },
        preferred: preferredLocale,
        userLanguage: user?.language,
      });
    }

    const { syncObject, functionsObject } = await getRuntimeSyncMaps();
    const nameSegments = name.split('/').filter(Boolean);
    const syncBaseName = nameSegments[nameSegments.length - 2];
    const requestedVersion = nameSegments[nameSegments.length - 1];
    const callbackName = typeof cb === 'string' && cb.trim().length > 0
      ? cb.trim()
      : `${syncBaseName}/${requestedVersion}`;

    let resolvedName = name;
    if (!syncObject[`${name}_client`] && !syncObject[`${name}_server`] && syncBaseName && requestedVersion) {
      const rootKey = `sync/${syncBaseName}/${requestedVersion}`;
      if (syncObject[`${rootKey}_client`] || syncObject[`${rootKey}_server`]) {
        resolvedName = rootKey;
      }
    }

    if (!syncObject[`${resolvedName}_client`] && !syncObject[`${resolvedName}_server`]) {
      return buildSyncError({
        response: { status: 'error', errorCode: 'sync.notFound' },
        preferred: preferredLocale,
        userLanguage: user?.language,
      });
    }

    // Rate limiting for HTTP sync requests
    const effectiveSyncLimit = config.rateLimiting.defaultApiLimit;
    if (effectiveSyncLimit !== false && effectiveSyncLimit > 0) {
      const requesterIdentity = token ?? requesterIp ?? 'anonymous';
      const keyPrefix = token ? 'token' : 'ip';

      const { allowed, resetIn } = checkRateLimit({
        key: `${keyPrefix}:${requesterIdentity}:sync:${resolvedName}`,
        limit: effectiveSyncLimit,
        windowMs: config.rateLimiting.windowMs,
      });

      if (!allowed) {
        return buildSyncError({
          response: {
            status: 'error',
            errorCode: 'sync.rateLimitExceeded',
            errorParams: [{ key: 'seconds', value: resetIn }],
            httpStatus: 429,
          },
          preferred: preferredLocale,
          userLanguage: user?.language,
        });
      }
    }

    if (config.rateLimiting.defaultIpLimit !== false && config.rateLimiting.defaultIpLimit > 0) {
      const ipBucket = requesterIp ?? 'unknown';
      const { allowed, resetIn } = checkRateLimit({
        key: `ip:${ipBucket}:sync:all`,
        limit: config.rateLimiting.defaultIpLimit,
        windowMs: config.rateLimiting.windowMs,
      });

      if (!allowed) {
        return buildSyncError({
          response: {
            status: 'error',
            errorCode: 'sync.rateLimitExceeded',
            errorParams: [{ key: 'seconds', value: resetIn }],
            httpStatus: 429,
          },
          preferred: preferredLocale,
          userLanguage: user?.language,
        });
      }
    }

    let serverOutput = {};
    if (syncObject[`${resolvedName}_server`]) {
      const { auth, main: serverMain, inputType, inputTypeFilePath } = syncObject[`${resolvedName}_server`];

      const inputValidation = await validateInputByType({
        typeText: inputType,
        value: data,
        rootKey: 'clientInput',
        filePath: inputTypeFilePath,
      });
      if (inputValidation.status === 'error') {
        return buildSyncError({
          response: {
            status: 'error',
            errorCode: 'sync.invalidInputType',
            errorParams: [{ key: 'message', value: inputValidation.message }],
          },
          preferred: preferredLocale,
          userLanguage: user?.language,
        });
      }

      if (auth.login && !user?.id) {
        return buildSyncError({
          response: { status: 'error', errorCode: 'auth.required' },
          preferred: preferredLocale,
        });
      }

      const validationResult = validateRequest({ auth, user: user as SessionLayout });
      if (validationResult.status === 'error') {
        return buildSyncError({
          response: {
            status: 'error',
            errorCode: validationResult.errorCode || 'auth.forbidden',
            errorParams: validationResult.errorParams,
            httpStatus: validationResult.httpStatus,
          },
          preferred: preferredLocale,
          userLanguage: user?.language,
        });
      }

      const [serverSyncError, serverSyncResult] = await tryCatch(
        async () => await serverMain({ clientInput: data, user, functions: functionsObject, roomCode: receiver }),
        undefined,
        {
          handler: 'handleHttpSyncRequest',
          sync: resolvedName,
          stage: 'server',
          userId: user?.id,
          receiver,
          transport: 'http',
        },
      );
      if (serverSyncError) {
        return buildSyncError({
          response: { status: 'error', errorCode: 'sync.serverExecutionFailed' },
          preferred: preferredLocale,
          userLanguage: user?.language,
        });
      }

      if (serverSyncResult?.status == 'error') {
        return buildSyncError({
          response: serverSyncResult,
          preferred: preferredLocale,
          userLanguage: user?.language,
        });
      }

      if (serverSyncResult?.status !== 'success') {
        return buildSyncError({
          response: { status: 'error', errorCode: 'sync.invalidServerResponse' },
          preferred: preferredLocale,
          userLanguage: user?.language,
        });
      }

      serverOutput = serverSyncResult;
    }

    const sockets = receiver === 'all'
      ? ioInstance.sockets.sockets
      : ioInstance.sockets.adapter.rooms.get(receiver);

    if (!sockets) {
      return buildSyncError({
        response: { status: 'error', errorCode: 'sync.noReceiversFound' },
        preferred: preferredLocale,
        userLanguage: user?.language,
      });
    }

    for (const socketEntry of sockets) {
      const tempSocket = receiver === 'all'
        ? (socketEntry as [string, any])[1]
        : ioInstance.sockets.sockets.get(socketEntry as string);

      if (!tempSocket) continue;

      const tempToken = extractTokenFromSocket(tempSocket);

      if (ignoreSelf && token && token === tempToken) {
        continue;
      }

      if (syncObject[`${resolvedName}_client`]) {
        const [clientSyncError, clientSyncResult] = await tryCatch(
          async () => await syncObject[`${resolvedName}_client`]({ clientInput: data, token: tempToken, functions: functionsObject, serverOutput, roomCode: receiver }),
          undefined,
          {
            handler: 'handleHttpSyncRequest',
            sync: resolvedName,
            stage: 'client',
            sourceUserId: user?.id,
            targetToken: tempToken,
            receiver,
            transport: 'http',
          },
        );
        if (clientSyncError) {
          tempSocket.emit('sync', {
            cb: callbackName,
            fullName: resolvedName,
            ...buildSyncError({
              response: { status: 'error', errorCode: 'sync.clientExecutionFailed' },
              preferred: extractLanguageFromHeader(tempSocket.handshake.headers['accept-language'] || tempSocket.handshake.headers['x-language']),
            }),
          });
          continue;
        }

        if (clientSyncResult?.status === 'error') {
          tempSocket.emit('sync', {
            cb: callbackName,
            fullName: resolvedName,
            ...buildSyncError({
              response: ensureSyncErrorShape(clientSyncResult),
              preferred: extractLanguageFromHeader(tempSocket.handshake.headers['accept-language'] || tempSocket.handshake.headers['x-language']),
            }),
          });
          continue;
        }

        if (clientSyncResult?.status !== 'success') {
          tempSocket.emit('sync', {
            cb: callbackName,
            fullName: resolvedName,
            ...buildSyncError({
              response: { status: 'error', errorCode: 'sync.invalidClientResponse' },
              preferred: extractLanguageFromHeader(tempSocket.handshake.headers['accept-language'] || tempSocket.handshake.headers['x-language']),
            }),
          });
          continue;
        }

        tempSocket.emit('sync', {
          cb: callbackName,
          fullName: resolvedName,
          serverOutput,
          clientOutput: clientSyncResult,
          message: clientSyncResult.message || `${name} sync success`,
          status: 'success',
        });
        continue;
      }

      tempSocket.emit('sync', {
        cb: callbackName,
        fullName: resolvedName,
        serverOutput,
        clientOutput: {},
        message: `${name} sync success`,
        status: 'success',
      });
    }

    return { status: 'success', message: `sync ${name} success` };
  } finally {
    span?.end?.();
  }
}
