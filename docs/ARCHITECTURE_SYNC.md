# Sync Architecture

> Real-time event broadcasting between clients using rooms.

---

## Quick Reference

```typescript
// Client A sends sync event
await syncRequest({
  name: "examples/updateCounter",
  version: "v1",
  data: { amount: 5 },
  receiver: "game-room-123",
});

// Client B receives (via callback)
const { upsertSyncEventCallback } = useSyncEvents();
upsertSyncEventCallback({
  name: "examples/updateCounter",
  version: "v1",
  callback: ({ clientOutput, serverOutput }) => {
    console.log("Counter updated:", serverOutput.newValue);
  },
});

// Nested page sync
await syncRequest({
  name: "test/nestedTest/room",
  version: "v1",
  data: { step: 1, active: true },
  receiver: "game-room-123",
});
```

---

## File Structure

```
src/
├── {page}/_sync/
│   ├── {syncName}_server_v1.ts    # Runs on the server just once
│   ├── {syncName}_client_v1.ts    # Runs on the server for each client
│   └── ...
Versioned naming is required:

- `{syncName}_server_v1.ts`
- `{syncName}_client_v1.ts`

└── _sockets/
    ├── syncRequest.ts          # Client-side sync caller
    └── apiTypes.generated.ts   # Auto-generated types
```

---

## Creating a Sync Event

### 1. Server handler (optional)

```typescript
// src/examples/_sync/updateCounter_server_v1.ts
import { AuthProps, SessionLayout } from "../../../config";
import {
  Functions,
  SyncServerResponse,
} from "../../../src/_sockets/apiTypes.generated";

export const auth: AuthProps = {
  login: true,
  additional: [],
};

export interface SyncParams {
  clientInput: {
    // Define the data shape sent from the client e.g.
    amount: number;
  };
  user: SessionLayout; // session data of the user who called the sync event
  functions: Functions; // functions object
  roomCode: string; // room code
}

export const main = async ({
  clientInput,
  user,
  functions,
  roomCode,
}: SyncParams): Promise<SyncServerResponse> => {
  // THIS FILE RUNS JUST ONCE ON THE SERVER

  // Please validate clientInput here and dont just send the data back to the other clients
  // optional: database action or something else

  return {
    status: "success",
    newValue: clientInput.amount + 1,
    // Add any data you want to broadcast to clients
  };
};
```

### 2. Client handler (optional)

```typescript
import {
  Functions,
  SyncClientResponse,
  SyncClientInput,
  SyncServerOutput,
} from "../../../src/_sockets/apiTypes.generated";

// Types are imported from the generated file based on the _server.ts definition
type PagePath = "examples";
type SyncName = "updateCounter";
export interface SyncParams {
  clientInput: SyncClientInput<PagePath, SyncName>;

  serverOutput: SyncServerOutput<PagePath, SyncName>;
  // Note: No serverOutput in client-only syncs (no _server.ts file)
  token: string | null; // target client token (fetch session only when needed)
  functions: Functions; // contains functions available from server/functions
  roomCode: string; // room code
}

export const main = async ({
  token,
  clientInput,
  serverOutput,
  functions,
  roomCode,
}: SyncParams): Promise<SyncClientResponse> => {
  // CLIENT FILTER/RULE STAGE: runs on server for each target client in the room
  const targetUser = token ? await functions.session.getSession(token) : null;

  // Example: Only allow users on set page to receive the event
  // if (targetUser?.location?.pathName === '/your-page') {
  //   return { status: 'success' };
  // }

  return {
    status: "success",
    // Add any additional data to pass to the client
  };
};
```

Client sync handlers no longer receive `user` automatically. This avoids a Redis session lookup for every target socket. When you need target session data, call `functions.session.getSession(token)` inside `_client.ts`.

## Receiving Sync Events

```typescript
import { useSyncEvents } from "src/_sockets/syncRequest";

const { upsertSyncEventCallback } = useSyncEvents();

useEffect(() => {
  return upsertSyncEventCallback({
    name: "examples/updateCounter",
    version: "v1",
    callback: ({ clientOutput, serverOutput }) => {
      // clientOutput = result from _client.ts
      // serverOutput = result from _server.ts
      updateUI(serverOutput.newValue);
    },
  });
}, [upsertSyncEventCallback]);

// Register callback for a nested page sync
upsertSyncEventCallback({
  name: "test/nestedTest/room",
  version: "v1",
  callback: ({ serverOutput }) => {
    updateUI(serverOutput.step);
  },
});
```

## Offline Request Queue

When the socket is disconnected or the browser is offline, `syncRequest` queues requests in memory and flushes on reconnect or when the browser comes back online.

---

### Room-specific sync

```typescript
// Only users in 'game-room-123' receive this
await syncRequest({
  name: "chess/moveChessPiece",
  version: "v1",
  data: { from: "e2", to: "e4" },
  receiver: "game-room-123",
});
```

## HTTP Sync Endpoint

Sync can be triggered through HTTP:

- `POST /sync/{page}/{syncName}/{version}`

Body:

```json
{
  "data": { "some": "payload" },
  "receiver": "room-code",
  "ignoreSelf": false
}
```

Note: HTTP is only the trigger. Actual delivery still happens via Socket.io to users in the target room.

HTTP sync requests are rate-limited using global `config.rateLimiting` settings:

```typescript
rateLimiting: {
  defaultApiLimit: 60, // fallback per-sync-route limit
  defaultIpLimit: 100, // global per-IP cap across all sync routes
  windowMs: 60000,
}
```

When exceeded, handlers return `sync.rateLimitExceeded` with `seconds` in `errorParams`.

---

---

## Type System

| Property       | Source                         | Description              |
| -------------- | ------------------------------ | ------------------------ |
| `clientInput`  | `data` param in syncRequest    | What client sends        |
| `serverOutput` | `_server.ts` return            | Server processing result |
| `clientOutput` | `_client.ts` clientMain return | Client processing result |

Generated sync output typing preserves direct literal return values in object properties (for example `allowed: true` vs `allowed: false`) so TypeScript can narrow branch-specific shapes safely.

### Error Contract

- Sync errors should return `status: 'error'` with an `errorCode` (and optional `errorParams` / `httpStatus`).
- Server resolves the final `message` through i18n using `errorCode` + `errorParams`.
- Avoid hardcoded human-readable error messages in server sync handlers.

---

## Type Generation Pipeline (Timing-Aware)

In development, sync typing updates follow this sequence:

1. File save
2. Template injection (if applicable, only for new empty files in `_sync/`)
3. Hot reload trigger
4. Type-map regeneration
5. Typed helpers become accurate (`syncRequest`, callback payload inference for `serverOutput`/`clientOutput`)

Regeneration is asynchronous. After a save, there can be a short lag (typically hundreds of milliseconds) before generated helper types fully reflect the latest sync file state.

Generation is strict: unresolved sync type symbols now fail type-map generation instead of falling back to `any` aliases in generated artifacts.

For stable AI and CI inference, keep sync calls on the canonical typed helper signature and avoid local `any` wrappers or alternate loose signatures around `syncRequest` and callback payloads.

Do not add `unsafe*` wrapper aliases around `syncRequest` or `upsertSyncEventCallback`. If runtime-dynamic tooling code needs localized assertions, keep them at the call site and do not hide helper signatures behind wrapper types.

## Timing-Aware AI Workflow

Use a trust-first workflow for sync edits:

1. First pass: implement using the intended typed sync contract and trust server/client payload shapes.
2. Wait/re-check pass: after generation settles, re-open generated types and remove temporary casts/narrowing if no longer needed.

This avoids premature unsafe rewrites while the generator is still catching up.

Temporary exception note:

- If a short generator-lag window forces a cast, keep it local and minimal, then remove it once types refresh.

Good vs bad examples:

```typescript
// Bad: local wrapper erases sync route typing and callback payload inference
const onSyncLoose = (name: string, cb: (payload: any) => void) =>
  upsertSyncEventCallback({ name: name as any, version: "v1" as any, callback: cb as any });

// Good: direct typed callback payload usage
upsertSyncEventCallback({
  name: "examples/updateCounter",
  version: "v1",
  callback: ({ serverOutput, clientOutput }) => {
    console.log(serverOutput, clientOutput);
  },
});
```

AI self-check before finalizing changes:

- Did I rely on generated route/version types?
- Did I avoid adding new unsafe wrappers?
- If I used a temporary cast during generation lag, did I re-check and remove it after types refreshed?

---

## Runtime Function Reference

| File | Function | Purpose |
| ---- | -------- | ------- |
| `server/sockets/handleSyncRequest.ts` | `default export` | Handles socket sync requests (`sync` event), auth checks, executes `_server/_client`, emits responses. |
| `server/sockets/handleHttpSyncRequest.ts` | `default export` | HTTP-triggered sync entrypoint (`POST /sync/...`) that still delivers via Socket.io. |
| `server/utils/runtimeTypeValidation.ts` | `validateInputByType` | Validates sync `clientInput` payloads against extracted runtime types and returns path-first diagnostics. |
| `server/utils/runtimeTypeResolver.ts` | `resolveRuntimeTypeText` | Resolves local/imported/re-exported input type aliases and supported utility wrappers before sync validation. |
| `server/sockets/socket.ts` | `socket.on('sync', ...)` | Wires incoming sync events to the sync handler. |
| `src/_sockets/syncRequest.ts` | `syncRequest` | Typed client sender for sync events. |
| `src/_sockets/syncRequest.ts` | `useSyncEvents().upsertSyncEventCallback` | Typed callback registry for incoming sync events. |
