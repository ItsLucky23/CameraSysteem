# Routing Architecture

> File-based routing for pages, APIs, and real-time sync events.

---

## Overview

LuckyStack uses file-based routing inspired by Next.js. There are three types of routes:

1. **Page routes** - React components that render at URL paths
2. **API routes** - Server-side functions callable via WebSocket or HTTP
3. **Sync routes** - Real-time event handlers for room-based broadcasting

All three follow the same convention: place files in the correct folder structure and they are automatically registered.

---

## Page Routing

### How It Works

`src/main.tsx` uses Vite's `import.meta.glob` to scan all `.tsx` files at build time. It finds files named `page.tsx` in non-underscore folders and registers them as routes with React Router.

### File Convention

```
src/{page}/page.tsx  -->  renders at /{page}
src/page.tsx         -->  renders at /
```

### Rules

- Only files named `page.tsx` become routes
- Folders starting with `_` are skipped (private folders for components, utilities, etc.)
- Each page can export a `template` constant to control its layout wrapper
- If no template is exported, defaults to `'plain'`

### Templates

```typescript
// src/settings/page.tsx
export const template = 'home';

export default function SettingsPage() {
  return <div>...</div>;
}
```

Available templates:

| Template    | Description                                                         |
| ----------- | ------------------------------------------------------------------- |
| `plain`     | Minimal wrapper, no UI chrome. Sets theme to `config.defaultTheme`. |
| `home`      | Top bar with user avatar, settings/home toggle, and logout button.  |
| `dashboard` | Side navigation bar with main content area.                         |

Both `home` and `dashboard` templates include `Middleware` for route authentication guards.

### Route Resolution Logic

From `main.tsx`:

1. Scan all `.tsx` files via `import.meta.glob('./**/*.tsx', { eager: true })`
2. For each file, split the path into segments
3. Skip if any segment starts with `_`
4. Check if the file ends with `page.tsx`
5. Extract the route path by removing `page` suffix
6. Register as a child route of the root `'/'` path

---

## API Routing

### File Convention

```
src/{page}/_api/{name}_v1.ts  -->  accessible as api/{page}/{name}/v1
```

### How It Works

**Development:** The server's `dev/loader.ts` scans `src/` recursively and registers files inside `_api/` as API handlers.

**Production:** The `scripts/generateServerRequests.ts` build script statically generates a route map that's bundled into `server/prod/generatedApis.ts`.

### Name Resolution

The API route sent from the client uses a full route name in `name` (`{page}/{apiName}` for page APIs or just `{apiName}` for root APIs):

```
Client calls apiRequest({ name: 'examples/publicApi', version: 'v1' })
  --> fullname = "api/examples/publicApi/v1"
  --> matches src/examples/_api/publicApi_v1.ts

Client calls apiRequest({ name: 'test/nestedTest/info', version: 'v1' })
  --> fullname = "api/test/nestedTest/info/v1"
  --> matches src/test/nestedTest/_api/info_v1.ts
```

For nested pages:

```
Client calls apiRequest({ name: 'games/chess/getGameState', version: 'v1' })
  --> fullname = "api/games/chess/getGameState/v1"
  --> matches src/games/chess/_api/getGameState_v1.ts
```

### Required Exports

Each API file must export:

```typescript
// Required
export const main = async ({
  data,
  user,
  functions,
}: ApiParams): Promise<ApiResponse> => {
  return {
    status: "success",
    result: {
      /* ... */
    },
  };
};

// Required
export const auth: AuthProps = {
  login: true, // Require authentication
  additional: [], // Extra checks (e.g., admin role)
};

// Required for type generation
export interface ApiParams {
  data: {
    /* typed input from client */
  };
  user: SessionLayout;
  functions: Functions;
}

// Optional
export const rateLimit: number | false = 60; // Requests per minute (false = use global config)
export const httpMethod: "GET" | "POST" | "PUT" | "DELETE" = "POST"; // Override HTTP method inference
```

### WebSocket Access

The primary way to call APIs. The client sends a socket event and gets a response:

```typescript
// Client
const result = await apiRequest({
  name: "examples/getUserData",
  version: "v1",
  data: { userId: "123" },
});
```

Flow:

1. Client emits `apiRequest` event with `{ name, data, responseIndex }`
2. Server looks up handler in `devApis` (dev) or `apis` (prod)
3. Validates auth requirements
4. Checks rate limits
5. Executes `main()` function
6. Emits response on `apiResponse-{responseIndex}`

### HTTP Access

All APIs are also accessible via HTTP for testing, webhooks, or non-socket clients:

```
GET    /api/{page}/{name}?key=value
POST   /api/{page}/{name}  with JSON body
PUT    /api/{page}/{name}  with JSON body
DELETE /api/{page}/{name}
```

HTTP method is either explicitly exported from the API file or inferred from the name:

| Name Prefix                  | Inferred Method |
| ---------------------------- | --------------- |
| `get*`, `fetch*`, `list*`    | GET             |
| `delete*`, `remove*`         | DELETE          |
| `update*`, `edit*`, `patch*` | PUT             |
| Everything else              | POST            |

Authentication via HTTP: include token as cookie (`token=...`) or `Authorization: Bearer ...` header.

### Built-In APIs

Two APIs are handled internally without files:

| Name      | Purpose                          |
| --------- | -------------------------------- |
| `session` | Returns the current user session |
| `logout`  | Logs out the user                |

### Type Generation

Types are automatically generated by `server/dev/typeMapGenerator.ts`:

1. Watches `_api/` folders for file changes
2. Extracts `ApiParams` interface and `main` return type from each file
3. Applies configured route aliases during emission (example: `afas` also emits `timeregister2`)
4. Generates `src/_sockets/apiTypes.generated.ts`
5. Validates generated types and fails on unresolved identifiers before writing files
6. Provides full autocomplete for API names, input data, and output types

---

## Sync Routing

### File Convention

```
src/{page}/_sync/{name}_server_v1.ts  -->  Server-side validation (runs once)
src/{page}/_sync/{name}_client_v1.ts  -->  Client-side handler (runs per client in room)
```

At least one of the two files must exist. Both are optional individually.

### How It Works

**Development:** The server's `dev/loader.ts` scans `src/` recursively and registers files inside `_sync/` that end with `_server.ts` or `_client.ts`.

**Production:** Same build script generates static route maps.

### Name Resolution

Similar to APIs, sync uses a full route name in `name` (`{page}/{syncName}`):

```
Client calls syncRequest({ name: 'examples/updateCounter', version: 'v1', ... })
  --> fullname = "sync/examples/updateCounter/v1"
  --> server looks for sync/examples/updateCounter/v1_server and sync/examples/updateCounter/v1_client

Client calls syncRequest({ name: 'test/nestedTest/room', version: 'v1', ... })
  --> fullname = "sync/test/nestedTest/room/v1"
  --> server looks for sync/test/nestedTest/room/v1_server and sync/test/nestedTest/room/v1_client
```

### Sync Flow

```
1. Client A sends syncRequest({ name, data, receiver: roomCode })
   |
2. Server validates message format
   |
3. If _server.ts exists:
   |  a. Check auth requirements
   |  b. Run main() for validation/DB operations
   |  c. Get serverOutput
   |
4. Get all sockets in the target room
   |
5. For each socket in room:
  |  a. Resolve target token from socket
  |  b. If ignoreSelf and it's the sender, skip
  |  c. If _client.ts exists:
  |     - Run main() with { clientInput, serverOutput, token, functions, roomCode }
  |     - If returns { status: 'error' }, emit error to this client and continue
   |     - If returns { status: 'success' }, emit to this client
   |  d. If no _client.ts, emit serverOutput directly
   |
6. Confirm success back to sender via sync-{responseIndex}
```

### Required Exports

**Server file (`_server.ts`):**

```typescript
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: {
    /* data from sender */
  };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({
  clientInput,
  user,
  functions,
  roomCode,
}: SyncParams): Promise<SyncServerResponse> => {
  // Validate and transform data
  return { status: "success" /* additional data for clients */ };
};
```

**Client file (`_client.ts`):**

```typescript
export interface SyncParams {
  clientInput: SyncClientInput<PagePath, SyncName>;
  serverOutput: SyncServerOutput<PagePath, SyncName>;
  token: string | null;
  functions: Functions;
  roomCode: string;
}

export const main = async ({
  clientInput,
  serverOutput,
  token,
  functions,
  roomCode,
}: SyncParams): Promise<SyncClientResponse> => {
  const targetUser = token ? await functions.session.getSession(token) : null;
  // Filter: return error to skip this client, success to deliver
  return { status: "success" /* additional client-specific data */ };
};
```

### Receiving Sync Events

On the client, register callbacks to handle incoming sync events:

```typescript
const { upsertSyncEventCallback } = useSyncEvents();

upsertSyncEventCallback({
  name: "examples/updateCounter",
  version: "v1",
  callback: ({ clientOutput, serverOutput }) => {
    // clientOutput = return from _client.ts (success only)
    // serverOutput = return from _server.ts
  },
});
```

### Data Flow Types

| Type           | Source                | Description                                           |
| -------------- | --------------------- | ----------------------------------------------------- |
| `clientInput`  | Sender's `data` param | Original data passed to `syncRequest({ data: ... })`  |
| `serverOutput` | `_server.ts` return   | Data returned from server-side handler                |
| `clientOutput` | `_client.ts` return   | Data returned from client-side handler (success only) |

---

## Template Injection and Generated Type Maps

Template injection is a development scaffold step, not the long-term type source of truth.

### Filename conventions that control injector behavior

- API files must end with `_v{number}.ts` (example: `getUser_v1.ts`)
- Sync files must end with `_server_v{number}.ts` or `_client_v{number}.ts`
- Invalid names get a guidance template instead of route registration

### Paired sync behavior

- Adding a new empty `_sync/*_client_v{n}.ts` while `_server_v{n}.ts` exists injects a paired client template that references generated sync types.
- Adding a new empty `_sync/*_server_v{n}.ts` while `_client_v{n}.ts` exists can migrate client input typing into the server scaffold, then update the client to use generated `SyncClientInput`/`SyncServerOutput` references.
- Deleting `_server_v{n}.ts` while `_client_v{n}.ts` remains can rewrite client typing to preserve standalone behavior.

Because this runs on file events, types may appear/disappear briefly as files are added/removed before regeneration settles.

### Source of truth

- Template output is scaffolding for fast authoring.
- Generated type maps (`src/_sockets/apiTypes.generated.ts`) are the contract source of truth for request/response typing.

---

## Private Folders

Any folder prefixed with `_` is private and excluded from routing:

| Folder         | Purpose                                  |
| -------------- | ---------------------------------------- |
| `_api/`        | API handlers (registered separately)     |
| `_sync/`       | Sync handlers (registered separately)    |
| `_components/` | Page-specific or shared React components |
| `_functions/`  | Utility functions                        |
| `_providers/`  | React context providers                  |
| `_sockets/`    | Socket.io client utilities               |
| `_locales/`    | i18n translation JSON files              |

---

## Hot Reload

In development mode, the server watches for file changes:

1. `server/dev/hotReload.ts` monitors `src/` for changes in `_api/` and `_sync/` folders
2. On change, `server/dev/loader.ts` re-imports the modified module
3. `server/dev/typeMapGenerator.ts` regenerates `apiTypes.generated.ts` and API docs only when generated content actually changes
4. No server restart needed for API/sync changes
5. Vite ignores `_api/`, `_sync/`, and generated server artifacts (`src/_sockets/apiTypes.generated.ts`, `src/docs/apiDocs.generated.json`) so server-side edits do not trigger client HMR
6. Vite HMR still handles frontend component changes

---

## Runtime Function Reference

| File | Function | Purpose |
| ---- | -------- | ------- |
| `src/main.tsx` | `getRoutes` | Builds page route tree from `page.tsx` modules. |
| `server/dev/loader.ts` | `initializeApis` | Loads `_api` handlers dynamically in development. |
| `server/dev/loader.ts` | `initializeSyncs` | Loads `_sync` handlers dynamically in development. |
| `scripts/generateServerRequests.ts` | script entry | Generates static API/sync maps for production. |
| `server/dev/hotReload.ts` | `setupWatchers` | Watches source changes, reloads modules, regenerates types/docs artifacts. |
