import { useEffect, useMemo, useState } from 'react';

import { backendUrl, rateLimiting } from 'config';
import notify from 'src/_functions/notify';
import { useTranslator } from 'src/_functions/translator';
import { apiRequest } from 'src/_sockets/apiRequest';
import { joinRoom, leaveRoom } from 'src/_sockets/socketInitializer';
import { syncRequest, useSyncEvents } from 'src/_sockets/syncRequest';

import apiDocs from './apiDocs.generated.json';

interface ApiDoc {
  page: string;
  name: string;
  version: string;
  method: string;
  description?: string;
  input: string;
  output: string;
  auth: {
    login?: boolean;
    additional?: {
      key: string;
      value?: unknown;
      type?: string;
      nullish?: boolean;
      mustBeFalsy?: boolean;
    }[];
  };
  rateLimit: number | false | undefined;
  path: string;
}

interface SyncDoc {
  page: string;
  name: string;
  version: string;
  clientInput: string;
  serverOutput: string;
  clientOutput: string;
  path: string;
}

interface DocsResult {
  apis: Record<string, ApiDoc[]>;
  syncs: Record<string, SyncDoc[]>;
}

interface ApiRunResponse {
  status?: 'success' | 'error';
  message?: string;
  [key: string]: unknown;
}

interface ParsedObjectField {
  key: string;
  optional: boolean;
  type: string;
}
type AdditionalPermission = NonNullable<ApiDoc['auth']['additional']>[number];

type UnsafeUpsertSyncEventCallback = (params: {
  name: string;
  version: string;
  callback: (params: { clientOutput: unknown; serverOutput: unknown }) => void;
}) => void;

type UnsafeApiRequest = (params: {
  name: string;
  version: string;
  data?: Record<string, unknown>;
  abortable?: boolean;
  disableErrorMessage?: boolean;
}) => Promise<ApiRunResponse>;

type UnsafeSyncRequest = (params: {
  name: string;
  version: string;
  data?: Record<string, unknown>;
  receiver: string;
  ignoreSelf?: boolean;
}) => Promise<boolean>;

const methodBadgeClass = (method: string): string => {
  switch (method.toUpperCase()) {
    case 'GET': {
      return 'bg-correct text-title-primary';
    }
    case 'POST': {
      return 'bg-primary text-title-primary';
    }
    case 'PUT': {
      return 'bg-warning text-title';
    }
    case 'DELETE': {
      return 'bg-wrong text-title-primary';
    }
    case 'PATCH': {
      return 'bg-secondary text-title-secondary';
    }
    default: {
      return 'bg-container2 text-common';
    }
  }
};

const statusBadgeClass = (status: 'idle' | 'loading' | 'success' | 'error'): string => {
  if (status === 'success') return 'bg-correct/10 border-correct/30 text-correct';
  if (status === 'error') return 'bg-wrong/10 border-wrong/30 text-wrong';
  if (status === 'loading') return 'bg-primary/10 border-primary/30 text-primary';
  return 'bg-container2 border-container2-border text-common/50';
};

const statusDotClass = (status: 'idle' | 'loading' | 'success' | 'error'): string => {
  if (status === 'success') return 'bg-correct';
  if (status === 'error') return 'bg-wrong';
  if (status === 'loading') return 'bg-primary animate-pulse';
  return 'bg-common/30';
};

const parseObjectType = (typeText: string): ParsedObjectField[] => {
  const clean = typeText.trim();
  if (!clean.startsWith('{') || !clean.endsWith('}')) return [];

  const inner = clean.slice(1, -1);
  const rows: string[] = [];
  let token = '';
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;

  for (const char of inner) {
    if (char === '(') depthParen += 1;
    if (char === ')') depthParen -= 1;
    if (char === '{') depthBrace += 1;
    if (char === '}') depthBrace -= 1;
    if (char === '[') depthBracket += 1;
    if (char === ']') depthBracket -= 1;

    if ((char === ';' || char === ',') && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
      const trimmed = token.trim();
      if (trimmed.length > 0) rows.push(trimmed);
      token = '';
      continue;
    }

    token += char;
  }

  const final = token.trim();
  if (final.length > 0) rows.push(final);

  const result: ParsedObjectField[] = [];
  for (const row of rows) {
    const match = /^(\w+)(\?)?\s*:\s*(.+)$/.exec(row);
    if (!match) continue;
    result.push({
      key: match[1],
      optional: Boolean(match[2]),
      type: match[3].trim(),
    });
  }

  return result;
};

const randomPrimitive = (type: string): unknown => {
  const trimmed = type.trim();

  if (trimmed.includes('|')) {
    const unionParts = trimmed.split('|').map((part) => part.trim()).filter(Boolean);
    const preferred = unionParts.find((part) => part !== 'undefined' && part !== 'null');
    const unionPart = unionParts[0] ?? 'string';
    return randomPrimitive(preferred ?? unionPart);
  }

  if (trimmed === 'string') return `text-${String(Math.floor(Math.random() * 1000))}`;
  if (trimmed === 'number') return Math.floor(Math.random() * 100);
  if (trimmed === 'boolean') return Math.random() > 0.5;
  if (trimmed === 'Date') return new Date().toISOString();
  if (trimmed.endsWith('[]')) {
    const innerType = trimmed.slice(0, -2);
    return [randomPrimitive(innerType), randomPrimitive(innerType)];
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }

  return null;
};

const generateRandomInput = (typeText: string): Record<string, unknown> => {
  const fields = parseObjectType(typeText);
  const result: Record<string, unknown> = {};

  for (const field of fields) {
    if (field.optional && Math.random() > 0.6) {
      continue;
    }
    result[field.key] = randomPrimitive(field.type);
  }

  return result;
};

const buildApiRoutePath = (api: ApiDoc): string => {
  if (api.page === 'root') {
    return `api/${api.name}/${api.version}`;
  }
  return `api/${api.page}/${api.name}/${api.version}`;
};

const buildApiRequestName = (api: ApiDoc): string => {
  if (api.page === 'root') {
    return api.name;
  }
  return `${api.page}/${api.name}`;
};

const buildSyncRoutePath = (sync: SyncDoc): string => {
  if (sync.page === 'root') {
    return `sync/${sync.name}/${sync.version}`;
  }
  return `sync/${sync.page}/${sync.name}/${sync.version}`;
};

const buildSyncRequestName = (sync: SyncDoc): string => {
  if (sync.page === 'root') {
    return sync.name;
  }
  return `${sync.page}/${sync.name}`;
};

const formatTypeText = (text: string): string => {
  const clean = text.trim();
  if (!clean) return '';

  let result = '';
  let indentLevel = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  const indent = () => {
    result += '  '.repeat(Math.max(indentLevel, 0));
  };

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    const previous = clean[index - 1];

    if (char === "'" && !inDoubleQuote && previous !== '\\') {
      inSingleQuote = !inSingleQuote;
      result += char;
      continue;
    }

    if (char === '"' && !inSingleQuote && previous !== '\\') {
      inDoubleQuote = !inDoubleQuote;
      result += char;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      result += char;
      continue;
    }

    if (char === '{' || char === '[' || char === '(') {
      result += char;
      indentLevel += 1;
      result += '\n';
      indent();
      continue;
    }

    if (char === '}' || char === ']' || char === ')') {
      indentLevel -= 1;
      if (!result.endsWith('\n')) {
        result += '\n';
      }
      indent();
      result += char;
      continue;
    }

    if (char === ';' || char === ',') {
      result += char;
      result += '\n';
      indent();
      continue;
    }

    if (char === ':') {
      result += ': ';
      continue;
    }

    result += char;
  }

  return result
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
};

const buildApiFetchExample = (api: ApiDoc, input: string): string => {
  const route = buildApiRoutePath(api);
  const method = api.method.toUpperCase();
  const data = input.trim() || '{}';

  return [
    `const data = ${data};`,
    '',
    `await fetch('${backendUrl}/${route}', {`,
    `  method: '${method}',`,
    `  headers: { 'Content-Type': 'application/json' },`,
    `  body: JSON.stringify(data),`,
    `});`,
  ].join('\n');
};

const buildApiSocketExample = (api: ApiDoc, input: string): string => {
  const routeName = buildApiRequestName(api);
  const data = input.trim() || '{}';

  return [
    `const data = ${data};`,
    '',
    `socket.emit('apiRequest', {`,
    `  name: 'api/${routeName}/${api.version}',`,
    `  data,`,
    `  responseIndex: 1,`,
    `});`,
  ].join('\n');
};

const buildSyncFetchExample = (sync: SyncDoc, input: string): string => {
  const route = buildSyncRoutePath(sync);
  const data = input.trim() || '{}';

  return [
    `const data = ${data};`,
    '',
    `await fetch('${backendUrl}/${route}', {`,
    `  method: 'POST',`,
    `  headers: { 'Content-Type': 'application/json' },`,
    `  body: JSON.stringify({`,
    `    data,`,
    `    receiver: 'room-code',`,
    `    ignoreSelf: false,`,
    `  }),`,
    `});`,
  ].join('\n');
};

const buildSyncSocketExample = (sync: SyncDoc, input: string, receiver: string, ignoreSelf: boolean): string => {
  const routeName = buildSyncRequestName(sync);
  const data = input.trim() || '{}';

  return [
    `const data = ${data};`,
    '',
    `socket.emit('sync', {`,
    `  name: 'sync/${routeName}/${sync.version}',`,
    `  cb: '${routeName}/${sync.version}',`,
    `  data,`,
    `  receiver: ${JSON.stringify(receiver)},`,
    `  ignoreSelf: ${String(ignoreSelf)},`,
    `  responseIndex: 1,`,
    `});`,
  ].join('\n');
};

const getRateLimitText = ({
  selectedApiRateLimit,
  defaultApiLimit,
  translate,
}: {
  selectedApiRateLimit: number | false | undefined;
  defaultApiLimit: number | false;
  translate: (params: { key: string }) => string;
}): string => {
  if (selectedApiRateLimit === false) return translate({ key: 'docs.unlimited' });
  if (typeof selectedApiRateLimit === 'number') return `${String(selectedApiRateLimit)} req/min`;
  if (defaultApiLimit === false) return translate({ key: 'docs.unlimited' });
  return `${String(defaultApiLimit)} req/min (default)`;
};

const getAdditionalPermissionLabel = (item: AdditionalPermission): string => {
  const formatUnknownValue = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return String(value);
    }
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';

    try {
      return JSON.stringify(value);
    } catch {
      return '[unserializable]';
    }
  };

  if (item.value !== undefined) {
    const value = formatUnknownValue(item.value);
    return `${item.key} = ${value}`;
  }

  if (item.type !== undefined) {
    return `${item.key}: ${item.type}`;
  }

  if (item.nullish !== undefined) {
    return item.nullish ? `${item.key} is nullish` : `${item.key} not nullish`;
  }

  if (item.mustBeFalsy !== undefined) {
    return item.mustBeFalsy ? `${item.key} is falsy` : `${item.key} is truthy`;
  }

  return item.key;
};


export default function DocsPage() {
  const translate = useTranslator();
  const { upsertSyncEventCallback } = useSyncEvents();
  const unsafeUpsertSyncEventCallback = upsertSyncEventCallback as unknown as UnsafeUpsertSyncEventCallback;
  const unsafeApiRequest = apiRequest as unknown as UnsafeApiRequest;
  const unsafeSyncRequest = syncRequest as unknown as UnsafeSyncRequest;
  const [docs] = useState<DocsResult | null>(apiDocs as unknown as DocsResult);
  const [selectedApi, setSelectedApi] = useState<ApiDoc | null>(null);
  const [selectedSync, setSelectedSync] = useState<SyncDoc | null>(null);
  const [inputData, setInputData] = useState('{}');
  const [receiver, setReceiver] = useState("");
  const [joinedRoom, setJoinedRoom] = useState("");
  const [roomToLeave, setRoomToLeave] = useState("");
  const [joinedRooms, setJoinedRooms] = useState<string[]>([]);
  const [ignoreSelf, setIgnoreSelf] = useState(false);
  const [apiResult, setApiResult] = useState<ApiRunResponse | null>(null);
  const [syncResult, setSyncResult] = useState<ApiRunResponse | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  const selectedPath = useMemo(() => {
    if (selectedApi) return selectedApi.path;
    if (selectedSync) return selectedSync.path;
    return null;
  }, [selectedApi, selectedSync]);

  const selectedApiAdditional = selectedApi?.auth.additional ?? [];
  const selectedApiNeedsLogin = selectedApi?.auth.login === true;
  const defaultApiLimit = rateLimiting.defaultApiLimit;

  useEffect(() => {
    if (!selectedSync) return;

    const name = buildSyncRequestName(selectedSync);

    unsafeUpsertSyncEventCallback({
      name,
      version: selectedSync.version,
      callback: ({ clientOutput, serverOutput }: { clientOutput: unknown; serverOutput: unknown }) => {
        setSyncResult({
          status: 'success',
          clientOutput,
          serverOutput,
        });
        setStatus('success');
      }
    });
  }, [selectedSync, unsafeUpsertSyncEventCallback])

  const normalizeInputData = () => {
    setInputData((previous) => {
      const clean = previous.trim();
      if (clean === '') return '{}';
      try {
        return JSON.stringify(JSON.parse(clean), null, 2);
      } catch {
        return previous;
      }
    });
  };

  const parseInput = (): Record<string, unknown> | null => {
    try {
      return JSON.parse(inputData) as Record<string, unknown>;
    } catch {
      notify.error({ key: 'docs.invalidJsonInput' });
      return null;
    }
  };

  const parseHttpResponse = async (response: Response): Promise<ApiRunResponse> => {
    const responseText = await response.text();

    if (!responseText) {
      return {
        status: response.ok ? 'success' : 'error',
        message: response.ok ? 'docs.emptyResponseBody' : 'docs.emptyErrorResponseBody',
        httpStatus: response.status,
      };
    }

    try {
      const parsed: unknown = JSON.parse(responseText);
      return {
        ...(parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}),
        httpStatus: response.status,
      };
    } catch {
      return {
        status: 'error',
        message: 'docs.invalidJsonResponse',
        rawResponse: responseText,
        httpStatus: response.status,
      };
    }
  };

  const runApiWithSocket = () => {
    if (!selectedApi) return;
    const parsedInput = parseInput();
    if (!parsedInput) {
      setStatus('error');
      setApiResult({ status: 'error', message: 'docs.invalidJsonInput' });
      return;
    }

    setStatus('loading');
    setApiResult(null);

    void (async () => {
      try {
        const name = buildApiRequestName(selectedApi);
        const response = await unsafeApiRequest({
          name,
          version: selectedApi.version,
          data: parsedInput,
          disableErrorMessage: true,
        });

        setApiResult(response);
        setStatus(response.status === 'success' ? 'success' : 'error');
      } catch {
        setApiResult({ status: 'error', message: 'docs.httpApiRequestFailed' });
        setStatus('error');
      }
    })();
  };

  const runApiWithHttp = async () => {
    if (!selectedApi) return;
    const parsedInput = parseInput();
    if (!parsedInput) {
      setStatus('error');
      setApiResult({ status: 'error', message: 'docs.invalidJsonInput' });
      return;
    }

    setStatus('loading');
    setApiResult(null);

    try {
      const routePath = buildApiRoutePath(selectedApi);
      const method = selectedApi.method.toUpperCase();

      let url = `${backendUrl}/${routePath}`;
      const requestInit: RequestInit = {
        method,
        credentials: 'include',
      };

      if (method === 'GET') {
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(parsedInput)) {
          query.set(key, typeof value === 'string' ? value : JSON.stringify(value));
        }

        const queryString = query.toString();
        if (queryString) {
          url = `${url}?${queryString}`;
        }
      } else {
        requestInit.headers = { 'Content-Type': 'application/json' };
        requestInit.body = JSON.stringify(parsedInput);
      }

      const response = await fetch(url, requestInit);
      const parsedResponse = await parseHttpResponse(response);

      setApiResult(parsedResponse);
      setStatus(response.ok ? 'success' : 'error');
    } catch (error) {
      setApiResult({ status: 'error', message: 'docs.httpApiRequestFailed' });
      setStatus('error');
      console.error('docs http api request failed:', error);
    }
  };

  const runSyncWithSocket = () => {
    if (!selectedSync) return;
    const parsedInput = parseInput();
    if (!parsedInput) {
      setStatus('error');
      setSyncResult({ status: 'error', message: 'docs.invalidJsonInput' });
      return;
    }

    setStatus('loading');
    setSyncResult(null);

    const name = buildSyncRequestName(selectedSync);

    void (async () => {
      const success = await unsafeSyncRequest({
        name,
        version: selectedSync.version,
        data: parsedInput,
        receiver,
        ignoreSelf,
      });

      if (!success) {
        setSyncResult({
          status: 'error',
          message: 'docs.httpSyncRequestFailed',
        });
        setStatus('error');
      }
    })();
  };

  const runSyncWithHttp = async () => {
    if (!selectedSync) return;
    const parsedInput = parseInput();
    if (!parsedInput) {
      setStatus('error');
      setSyncResult({ status: 'error', message: 'docs.invalidJsonInput' });
      return;
    }

    setStatus('loading');
    setSyncResult(null);

    const name = buildSyncRequestName(selectedSync);

    try {
      const response = await fetch(`${backendUrl}/sync/${name}/${selectedSync.version}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: parsedInput,
          receiver,
          ignoreSelf,
        }),
      });

      const parsedResponse = await parseHttpResponse(response);
      setSyncResult(parsedResponse);

      setStatus(response.ok ? 'success' : 'error');
    } catch (error) {
      setSyncResult({
        status: 'error',
        message: 'docs.httpSyncRequestFailed',
      });
      setStatus('error');
      console.error('docs http sync request failed:', error);
    }
  };

  const applyRandomPreset = () => {
    if (selectedApi) {
      setInputData(JSON.stringify(generateRandomInput(selectedApi.input), null, 2));
      return;
    }

    if (selectedSync) {
      setInputData(JSON.stringify(generateRandomInput(selectedSync.clientInput), null, 2));
    }
  };

  const joinSelectedRoom = async () => {
    const room = joinedRoom.trim();
    if (room === '') {
      notify.error({ key: 'docs.roomCodeRequired' });
      return;
    }

    const joined = await joinRoom(room);
    console.log(joined)
    if (joined) {
      setJoinedRooms((previous) => previous.includes(room) ? previous : [...previous, room]);
      setRoomToLeave(room);
      notify.success({ key: 'docs.joinedRoom' });
    } else {
      notify.error({ key: 'docs.failedToJoinRoom' });
    }
  };

  const leaveSelectedRoom = async () => {
    const room = roomToLeave.trim();
    if (!room) {
      notify.error({ key: 'docs.roomCodeRequired' });
      return;
    }

    const left = await leaveRoom(room);
    if (left) {
      setJoinedRooms((previous) => previous.filter((r) => r !== room));
      notify.success({ key: 'docs.leftRoom' });
    } else {
      notify.error({ key: 'docs.failedToLeaveRoom' });
    }
  };

  if (!docs) return <div className="p-8 text-wrong">{translate({ key: 'docs.failedToLoadDocumentation' })}</div>;

  const rateLimitText = selectedApi
    ? getRateLimitText({
      selectedApiRateLimit: selectedApi.rateLimit,
      defaultApiLimit,
      translate,
    })
    : '';

  return (
    <div className="flex h-full min-h-screen bg-background text-common overflow-hidden">
      {/* ── Sidebar ── */}
      <div className="w-72 flex-shrink-0 flex flex-col bg-container1 border-r border-container1-border">
        {/* Sticky sidebar header */}
        <div className="sticky top-0 z-10 bg-container1 border-b border-container1-border px-5 py-4">
          <h2 className="text-base font-bold tracking-tight text-title">{translate({ key: 'docs.documentation' })}</h2>
          <div className="mt-2 flex flex-col gap-1.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-common/40">{translate({ key: 'docs.joinedRooms' })}</div>
            <div className="flex flex-wrap gap-1.5">
              {joinedRooms.length === 0 && (
                <div className="text-[10px] px-2 py-0.5 rounded-full bg-container2 border border-container2-border text-common/60 font-medium">
                  {translate({ key: 'docs.noRoomsJoined' })}
                </div>
              )}
              {joinedRooms.map((room) => (
                <div key={room} className="text-[10px] px-2 py-0.5 rounded-full bg-secondary/20 text-secondary border border-secondary/30 font-semibold">
                  {room}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          {/* APIs section */}
          <div>
            <div className="flex items-center gap-2 px-2 mb-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-primary">{translate({ key: 'docs.apisSmall' })}</span>
              <div className="flex-1 h-px bg-primary/20" />
            </div>
            {Object.entries(docs.apis).map(([page, apis]) => (
              <div key={page} className="mb-3">
                <div className="text-[10px] font-semibold text-common/40 mb-1 px-2 uppercase tracking-wider">{page}</div>
                <div className="space-y-0.5">
                  {apis.map((api) => (
                    <button
                      key={api.path}
                      onClick={() => {
                        setSelectedApi(api);
                        setSelectedSync(null);
                        setInputData('{}');
                        setApiResult(null);
                        setSyncResult(null);
                        setStatus('idle');
                      }}
                      className={`w-full text-left px-3 py-2 rounded-md text-xs transition-all duration-150 ${selectedApi?.path === api.path
                        ? 'bg-primary text-title-primary font-semibold shadow-sm'
                        : 'hover:bg-container2 text-common'
                        }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate">{api.name}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${selectedApi?.path === api.path ? 'bg-white/20 text-title-primary' : 'bg-container2 text-common/60'}`}>
                          {api.version}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Syncs section */}
          <div>
            <div className="flex items-center gap-2 px-2 mb-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-secondary">{translate({ key: 'docs.syncsSmall' })}</span>
              <div className="flex-1 h-px bg-secondary/20" />
            </div>
            {Object.entries(docs.syncs).map(([page, syncs]) => (
              <div key={page} className="mb-3">
                <div className="text-[10px] font-semibold text-common/40 mb-1 px-2 uppercase tracking-wider">{page}</div>
                <div className="space-y-0.5">
                  {syncs.map((sync) => (
                    <button
                      key={sync.path}
                      onClick={() => {
                        setSelectedSync(sync);
                        setSelectedApi(null);
                        setInputData('{}');
                        setApiResult(null);
                        setSyncResult(null);
                        setStatus('idle');
                      }}
                      className={`w-full text-left px-3 py-2 rounded-md text-xs transition-all duration-150 ${selectedSync?.path === sync.path
                        ? 'bg-secondary text-title-secondary font-semibold shadow-sm'
                        : 'hover:bg-container2 text-common'
                        }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate">{sync.name}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${selectedSync?.path === sync.path ? 'bg-white/20 text-title-secondary' : 'bg-container2 text-common/60'}`}>
                          {sync.version}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 overflow-y-auto bg-background">
        {!selectedPath && (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-common/40 select-none">
            <div className="text-5xl">{translate({ key: 'docs.doc' })}</div>
            <div className="text-sm font-medium">{translate({ key: 'docs.selectApiOrSync' })}</div>
          </div>
        )}

        {selectedApi && (
          <div className="max-w-4xl mx-auto px-8 py-8 flex flex-col gap-5">
            {/* Header card */}
            <div className="bg-container1 border border-container1-border rounded-xl px-6 py-5 flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1.5 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full shrink-0 ${methodBadgeClass(selectedApi.method)}`}>
                    {selectedApi.method}
                  </span>
                  <h1 className="text-xl font-bold text-title">{selectedApi.name}</h1>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                  <div className="flex flex-col gap-1.5 min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-common/40">{translate({ key: 'docs.fetchRequestExample' })}</div>
                    <pre className="text-[11px] font-mono leading-5 overflow-auto whitespace-pre bg-container2 border border-container2-border rounded-lg p-3 text-common">{buildApiFetchExample(selectedApi, inputData)}</pre>
                  </div>
                  <div className="flex flex-col gap-1.5 min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-common/40">{translate({ key: 'docs.socketRequestExample' })}</div>
                    <pre className="text-[11px] font-mono leading-5 overflow-auto whitespace-pre bg-container2 border border-container2-border rounded-lg p-3 text-common">{buildApiSocketExample(selectedApi, inputData)}</pre>
                  </div>
                </div>
                {selectedApi.description && (
                  <div className="text-xs text-common/70">{selectedApi.description}</div>
                )}
                {/* Status badge — inline in header */}
                <div className="flex items-center gap-2 pt-0.5">
                  <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${statusBadgeClass(status)}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${statusDotClass(status)}`} />
                    {translate({ key: 'docs.status' })} {status}
                  </span>
                </div>
              </div>
            </div>

            {/* Meta row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Rate limit */}
              <div className="bg-container1 border border-container1-border rounded-xl p-4 flex flex-col gap-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-common/40">{translate({ key: 'docs.rateLimit' })}</div>
                <div className="text-sm font-semibold text-title">{rateLimitText}</div>
              </div>

              {/* Auth */}
              <div className="bg-container1 border border-container1-border rounded-xl p-4 flex flex-col gap-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-common/40">{translate({ key: 'docs.auth' })}</div>
                <div className="flex items-center gap-2">
                  <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${selectedApiNeedsLogin ? 'bg-warning' : 'bg-correct'}`} />
                  <span className="text-sm font-semibold text-title">
                    {selectedApiNeedsLogin ? translate({ key: 'docs.loginRequired' }) : translate({ key: 'docs.loginOptional' })}
                  </span>
                </div>
              </div>

              {/* Additional permissions */}
              <div className="bg-container1 border border-container1-border rounded-xl p-4 flex flex-col gap-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-common/40">{translate({ key: 'docs.additionalPermissions' })}</div>
                {selectedApiAdditional.length === 0
                  ? <div className="text-xs text-common/50">{translate({ key: 'docs.none' })}</div>
                  : (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedApiAdditional.map((item) => {
                        const label = getAdditionalPermissionLabel(item);
                        return (
                          <div key={`${item.key}-${label}`} className="text-[10px] px-2 py-0.5 rounded-full bg-warning/20 text-warning border border-warning/30 font-semibold">
                            {label}
                          </div>
                        );
                      })}
                    </div>
                  )}
              </div>
            </div>

            {/* Type schema cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="bg-container1 border border-container1-border rounded-xl p-4 flex flex-col gap-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-common/40">{translate({ key: 'docs.input' })}</div>
                <pre className="text-[11px] font-mono leading-5 overflow-auto whitespace-pre-wrap break-words text-common bg-container2 rounded-lg p-3">{formatTypeText(selectedApi.input)}</pre>
              </div>
              <div className="bg-container1 border border-container1-border rounded-xl p-4 flex flex-col gap-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-common/40">{translate({ key: 'docs.output' })}</div>
                <pre className="text-[11px] font-mono leading-5 overflow-auto whitespace-pre-wrap break-words text-common bg-container2 rounded-lg p-3">{formatTypeText(selectedApi.output)}</pre>
              </div>
            </div>

            {/* Run panel */}
            <div className="bg-container1 border border-container1-border rounded-xl p-5 flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <button className="text-xs px-3 py-1.5 rounded-md bg-container2 text-common hover:bg-container2-hover transition-colors font-medium border border-container2-border" onClick={applyRandomPreset}>{translate({ key: 'docs.randomPreset' })}</button>
                <button className="text-xs px-3 py-1.5 rounded-md bg-correct text-title-primary hover:bg-correct-hover transition-colors font-semibold" onClick={runApiWithSocket}>{translate({ key: 'docs.runSocket' })}</button>
                <button className="text-xs px-3 py-1.5 rounded-md bg-primary text-title-primary hover:bg-primary-hover transition-colors font-semibold" onClick={() => { void runApiWithHttp(); }}>{translate({ key: 'docs.runHttp' })}</button>
              </div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-common/40">{translate({ key: 'docs.requestPayload' })}</div>
              <textarea
                value={inputData}
                onChange={(event) => { setInputData(event.target.value); }}
                onBlur={normalizeInputData}
                spellCheck={false}
                className="w-full h-36 bg-container2 border border-container2-border rounded-lg p-3 text-[11px] font-mono leading-5 text-common resize-y focus:outline-none focus:border-primary/50"
              />
              {apiResult && (
                <div className="flex flex-col gap-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-common/40">{translate({ key: 'docs.responsePayload' })}</div>
                  <pre className="text-[11px] font-mono leading-5 overflow-auto whitespace-pre bg-container2 border border-container2-border rounded-lg p-3 text-common">{JSON.stringify(apiResult, null, 2)}</pre>
                </div>
              )}
            </div>
          </div>
        )}

        {selectedSync && (
          <div className="max-w-4xl mx-auto px-8 py-8 flex flex-col gap-5">
            {/* Header card */}
            <div className="bg-container1 border border-container1-border rounded-xl px-6 py-5 flex flex-col gap-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full shrink-0 bg-secondary text-title-secondary">{translate({ key: 'docs.syncSmall' })}</span>
                <h1 className="text-xl font-bold text-title">{selectedSync.name}</h1>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                <div className="flex flex-col gap-1.5 min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-common/40">{translate({ key: 'docs.fetchRequestExample' })}</div>
                  <pre className="text-[11px] font-mono leading-5 overflow-auto whitespace-pre bg-container2 border border-container2-border rounded-lg p-3 text-common">{buildSyncFetchExample(selectedSync, inputData)}</pre>
                </div>
                <div className="flex flex-col gap-1.5 min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-common/40">{translate({ key: 'docs.socketRequestExample' })}</div>
                  <pre className="text-[11px] font-mono leading-5 overflow-auto whitespace-pre bg-container2 border border-container2-border rounded-lg p-3 text-common">{buildSyncSocketExample(selectedSync, inputData, receiver, ignoreSelf)}</pre>
                </div>
              </div>
            </div>

            {/* Schema cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="bg-container1 border border-container1-border rounded-xl p-4 flex flex-col gap-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-common/40">{translate({ key: 'docs.clientInput' })}</div>
                <pre className="text-[11px] font-mono leading-5 overflow-auto whitespace-pre-wrap break-words text-common bg-container2 rounded-lg p-3">{formatTypeText(selectedSync.clientInput)}</pre>
              </div>
              <div className="bg-container1 border border-container1-border rounded-xl p-4 flex flex-col gap-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-common/40">{translate({ key: 'docs.serverOutput' })}</div>
                <pre className="text-[11px] font-mono leading-5 overflow-auto whitespace-pre-wrap break-words text-common bg-container2 rounded-lg p-3">{formatTypeText(selectedSync.serverOutput)}</pre>
              </div>
              <div className="bg-container1 border border-container1-border rounded-xl p-4 flex flex-col gap-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-common/40">{translate({ key: 'docs.clientOutput' })}</div>
                <pre className="text-[11px] font-mono leading-5 overflow-auto whitespace-pre-wrap break-words text-common bg-container2 rounded-lg p-3">{formatTypeText(selectedSync.clientOutput)}</pre>
              </div>
            </div>

            {/* Run panel */}
            <div className="bg-container1 border border-container1-border rounded-xl p-5 flex flex-col gap-3">
              <div className="flex flex-wrap gap-2 items-center">
                <button className="text-xs px-3 py-1.5 rounded-md bg-container2 text-common hover:bg-container2-hover transition-colors font-medium border border-container2-border" onClick={applyRandomPreset}>{translate({ key: 'docs.randomPreset' })}</button>
                <button className="text-xs px-3 py-1.5 rounded-md bg-correct text-title-primary hover:bg-correct-hover transition-colors font-semibold" onClick={runSyncWithSocket}>{translate({ key: 'docs.runSocket' })}</button>
                <button className="text-xs px-3 py-1.5 rounded-md bg-primary text-title-primary hover:bg-primary-hover transition-colors font-semibold" onClick={() => { void runSyncWithHttp(); }}>{translate({ key: 'docs.runHttp' })}</button>
              </div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-common/40">{translate({ key: 'docs.syncReceiverHeader' })}</div>
              <div className="flex flex-wrap gap-2 items-center">
                <input
                  value={receiver}
                  onChange={(event) => { setReceiver(event.target.value); }}
                  className="bg-container2 border border-container2-border rounded-lg px-3 py-1.5 text-[11px] font-mono flex-1 text-common focus:outline-none focus:border-secondary/50"
                  placeholder={translate({ key: 'docs.roomCode' })}
                />
                <label className="text-xs flex items-center gap-2 text-common/70 cursor-pointer select-none">
                  <input type="checkbox" checked={ignoreSelf} onChange={(event) => { setIgnoreSelf(event.target.checked); }} />
                  {translate({ key: 'docs.ignoreSelf' })}
                </label>
              </div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-common/40">{translate({ key: 'docs.syncJoinHeader' })}</div>
              <div className="flex flex-wrap gap-2 items-center">
                <input
                  value={joinedRoom}
                  onChange={(event) => { setJoinedRoom(event.target.value); }}
                  className="bg-container2 border border-container2-border rounded-lg px-3 py-1.5 text-[11px] font-mono flex-1 text-common focus:outline-none focus:border-secondary/50"
                  placeholder={translate({ key: 'docs.roomToJoin' })}
                />
                <button
                  className="text-xs px-3 py-1.5 rounded-md bg-secondary text-title-secondary hover:bg-secondary-hover transition-colors font-semibold"
                  onClick={() => { void joinSelectedRoom(); }}
                >
                  {translate({ key: 'docs.joinRoom' })}
                </button>
              </div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-common/40">{translate({ key: 'docs.syncLeaveHeader' })}</div>
              <div className="flex flex-wrap gap-2 items-center">
                <input
                  value={roomToLeave}
                  onChange={(event) => { setRoomToLeave(event.target.value); }}
                  className="bg-container2 border border-container2-border rounded-lg px-3 py-1.5 text-[11px] font-mono flex-1 text-common focus:outline-none focus:border-secondary/50"
                  placeholder={translate({ key: 'docs.roomToLeave' })}
                />
                <button
                  className="text-xs px-3 py-1.5 rounded-md bg-wrong text-title-primary hover:bg-wrong-hover transition-colors font-semibold"
                  onClick={() => { void leaveSelectedRoom(); }}
                >
                  {translate({ key: 'docs.leaveRoom' })}
                </button>
              </div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-common/40">{translate({ key: 'docs.requestPayload' })}</div>
              <textarea
                value={inputData}
                onChange={(event) => { setInputData(event.target.value); }}
                onBlur={normalizeInputData}
                spellCheck={false}
                className="w-full h-36 bg-container2 border border-container2-border rounded-lg p-3 text-[11px] font-mono leading-5 text-common resize-y focus:outline-none focus:border-secondary/50"
              />
              {syncResult && (
                <div className="flex flex-col gap-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-common/40">{translate({ key: 'docs.responsePayload' })}</div>
                  <pre className="text-[11px] font-mono leading-5 overflow-auto whitespace-pre bg-container2 border border-container2-border rounded-lg p-3 text-common">{JSON.stringify(syncResult, null, 2)}</pre>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
