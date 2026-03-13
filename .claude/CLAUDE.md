# LuckyStack - AI Development Rules

> These rules are automatically loaded by Claude Code on every prompt.
> Last updated: 2026-03-13

---

## Project Overview

**LuckyStack** is a socket-first fullstack framework built with React 19 + raw Node.js (no Express). All client-server communication happens via Socket.io WebSockets, with HTTP fallback. The project uses file-based routing for pages, APIs, and real-time sync events.

**Tech stack:** React 19, React Router 7, TailwindCSS 4, Socket.io, Prisma 6.5, TypeScript 5.7, Vite, Redis

**Database:** Configurable via Prisma - supports MongoDB, MySQL, PostgreSQL, and SQLite. Check `prisma/schema.prisma` for the currently active provider.

---

## Rules

### 1. Styling

- Use **TailwindCSS** exclusively for styling.
- Only use colors defined in `src/index.css` (the `@theme` block and `.dark` overrides). Never use arbitrary color values.
- Available color tokens: `background`, `container`, `container2`, `container3`, `container4` (each with `-border` and `-hover` variants), `title`, `common`, `muted`, `correct`, `correct-hover`, `wrong`, `wrong-hover`.
- Prefer `flex` and `gap` for layout. Avoid using `margin` unless absolutely necessary.
- Dark mode is handled via CSS class `.dark` on `<html>`. Colors auto-switch via CSS variables.
- Use existing Components like our Dropdown, MenuHandler, Avatar, ConfirmMenu, Icon, etc.
### 2. No Emojis

- Never add emojis in code, comments, UI text, debug output, documentation, or html (use fontawesome icons instead).

### 3. SOLID Principles

- Follow SOLID principles in all code:
  - **S**ingle Responsibility: each file/function does one thing.
  - **O**pen/Closed: extend behavior without modifying existing code.
  - **L**iskov Substitution: subtypes must be substitutable for their base types.
  - **I**nterface Segregation: prefer small, focused interfaces.
  - **D**ependency Inversion: depend on abstractions, not concretions.

### 4. Comments

- Write simple comments explaining **why** something is done, not what.
- Do not add long JSDoc blocks or examples at the start of functions if the function name is self-explanatory.
- No redundant comments on obvious code.

### 5. Error Handling

- Always use the custom `tryCatch` function for error handling:
  - **Client:** `import tryCatch from 'src/_functions/helper'` - returns `[error, result]` tuple.
  - **Server:** `import { tryCatch } from 'server/functions/helper'` - returns `[error, result]` tuple with automatic Sentry capture (in api and sync calls we get tryCatch in the function parameter ).
- Check the first value: if truthy, there's an error. If null, access the second value for the result.
- Never use raw `try/catch` blocks. Always wrap async operations in `tryCatch`.

### 6. Terminal Commands

- Do not run terminal commands automatically. Instead, tell the user what to run and explain why.
- Exception: reading files, searching code, and git operations are fine.

### 7. No Test Files

- Do not create test files to verify backend functionality.
- Instead, explain to the user how to test the feature (e.g., via browser console, curl, or the examples page) and why that approach works.

### 8. Use Existing Code and Patterns

- Always look at existing code before implementing something new.
- Match the coding style, patterns, and conventions already in the codebase.
- Reuse existing utilities (`tryCatch`, `notify`, `apiRequest`, `syncRequest`, etc.).
- Follow the established file-based routing pattern for new APIs and sync events.

### 9. Ask When Unsure

- If requirements are unclear or you're unsure about an approach, always ask the user before guessing.
- This applies to architecture decisions, feature scope, UI behavior, and anything ambiguous.

### 10. Suggest Next Steps

- After completing code, suggest what the user should do next (e.g., code review, testing approach, related changes).

### 11. Report Issues Without Auto-Fixing

- When analyzing code and you notice potential mistakes, unhandled errors, or improvement opportunities, report them to the user.
- Do not fix them automatically. Let the user decide.

### 12. Verify Code Flow Against Docs

- Before writing code, verify that the code flow you've analyzed matches what the docs describe.
- If the flow matches the docs, proceed with implementation.
- If the flow doesn't match the docs, re-analyze the code. If you're still confident the docs are wrong after a second look, tell the user so the docs can be updated. Otherwise, follow the docs.

### 13. Keep Documentation Updated

- After making significant code changes, update the relevant documentation files (`PROJECT_CONTEXT.md`, `docs/ARCHITECTURE_*.md`, etc.) to stay in sync with the codebase.
- After updating docs, tell the user to run `npx repomix` to regenerate the codebase summary.

### 14. Keep Design Updated

- when updating files that are listed in the .gitignore check if there is a template file for it and update that too. (e.g. .env -> envTemplate.txt or config.ts -> configTemplate.txt)

### 15. Type Generation and Template Injection Contract

- This file (`CLAUDE.md`) is the authoritative AI behavior contract for this repository.
- If AI adapter docs are added later (for example `copilot-instructions.md`, `AGENTS.md`, or mode-specific files), keep them thin and reference this contract instead of duplicating policy text.
- Preferred direction: rely on route literals + generated maps + inferred `serverOutput`/`clientOutput` typing.
- Avoid introducing local unsafe wrappers around `apiRequest`, `syncRequest`, or sync callback payloads (`unknown`/`any` narrowing layers) unless there is a proven temporary blocker.
- This is guidance for AI behavior, not a hard lint policy.

Timing-aware AI workflow:

1. First pass: implement against the intended typed API/sync contract and trust server/client payload shapes.
2. Wait/re-check pass: after generation settles, re-open generated types and remove temporary casts/narrowing if they are no longer needed.
3. Keep temporary exceptions small and local, then clean them up in the same change window whenever possible.

Good vs bad examples (docs-only):

```typescript
// Bad: local unsafe wrapper erases route/version typing
const unsafeApi = async (name: string, version: string, data: unknown): Promise<any> =>
  apiRequest({ name: name as any, version: version as any, data: data as any });

// Good: direct typed call with route/version literals
const response = await apiRequest({
  name: "examples/getUserData",
  version: "v1",
  data: { userId: "123" },
});

// Good: typed sync callback payload usage
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

## Project Structure

```
LuckyStack/
├── server/                    # Backend (raw Node.js + Socket.io)
│   ├── server.ts              # HTTP server entry point
│   ├── auth/                  # OAuth + credentials authentication
│   ├── sockets/               # Socket.io event handlers
│   │   ├── socket.ts          # Socket server setup
│   │   ├── handleApiRequest.ts
│   │   ├── handleHttpApiRequest.ts
│   │   └── handleSyncRequest.ts
│   ├── functions/             # Server utilities (session, db, redis, tryCatch)
│   ├── utils/                 # Helpers (rateLimiter, validateRequest, sentry)
│   └── dev/                   # Hot-reload & type generation
│
├── src/                       # Frontend (React 19)
│   ├── main.tsx               # Entry point + file-based router
│   ├── index.css              # Tailwind theme colors (ONLY color source)
│   ├── _sockets/              # apiRequest, syncRequest, socketInitializer
│   ├── _providers/            # SessionProvider, SocketStatusProvider
│   ├── _components/           # Shared UI (Navbar, Middleware, MenuHandler, etc.)
│   ├── _functions/            # Client utilities (tryCatch, notify, translator)
│   ├── _locales/              # i18n translations (nl, en, de, fr)
│   └── {page}/                # Feature pages
│       ├── page.tsx           # Page component (exports template)
│       ├── _components/       # Page-specific components
│       ├── _api/              # API endpoints for this page
│       └── _sync/             # Sync handlers for this page
│
├── docs/                      # Architecture documentation
│   ├── ARCHITECTURE_API.md    # API request system
│   ├── ARCHITECTURE_AUTH.md   # Authentication flows
│   ├── ARCHITECTURE_ROUTING.md # File-based routing (pages, APIs, syncs)
│   ├── ARCHITECTURE_SESSION.md # Session management
│   ├── ARCHITECTURE_SOCKET.md # Socket.io setup
│   ├── ARCHITECTURE_SYNC.md   # Real-time sync system
│   ├── DEVELOPER_GUIDE.md     # Getting started
│   └── HOSTING.md             # Deployment guide
│
├── prisma/schema.prisma       # Database schema (supports MongoDB, MySQL, PostgreSQL, SQLite)
├── config.ts                  # App config (gitignored, use configTemplate.txt)
├── .env                       # Environment vars (gitignored, use envTemplate.txt)
├── README.md                  # Framework overview
└── PROJECT_CONTEXT.md         # Detailed architecture reference
```

## Key Patterns

### File-Based Routing

- `src/{page}/page.tsx` renders at route `/{page}`
- `src/{page}/_api/{name}.ts` creates an API endpoint accessible as `api/{page}/{name}`
- `src/{page}/_sync/{name}_server.ts` + `{name}_client.ts` creates a sync event as `sync/{page}/{name}`
- Folders prefixed with `_` are private (not routes)
- For full routing details see `docs/ARCHITECTURE_ROUTING.md`

### API Pattern

```typescript
// src/{page}/_api/{name}.ts
export const rateLimit: number | false = 60;
export const method: "GET" | "POST" | "PUT" | "DELETE" = "POST";

export const auth: AuthProps = { 
  login: true, 
  additional: [] 
};

export interface ApiParams {
  data: { /* typed input */ };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  return { status: 'success', result: { /* data */ } };
};
```

### Sync Pattern

- `_server.ts` runs once on server for validation
- `_client.ts` runs on server for each client in the room
- Client sends: `syncRequest({ name, data, receiver: roomCode, ignoreSelf?: boolean })`
- Client receives: `upsertSyncEventCallback(name, ({ clientOutput, serverOutput }) => {})`

### Provider Hierarchy

```
SocketStatusProvider > SessionProvider > TranslationProvider > AvatarProvider > MenuHandlerProvider > Router
```

### Templates

Pages export `template` as `'plain'`, `'home'`, or a new template that you can create yourself. 

- `plain` - No UI chrome (login, register, docs)
- `home` - Top bar with avatar, settings toggle, logout

---

## Documentation Reference

For detailed architecture docs, read the files in `docs/`:
- Routing: `docs/ARCHITECTURE_ROUTING.md`
- API system: `docs/ARCHITECTURE_API.md`
- Auth flows: `docs/ARCHITECTURE_AUTH.md`
- Sessions: `docs/ARCHITECTURE_SESSION.md`
- Socket setup: `docs/ARCHITECTURE_SOCKET.md`
- Sync events: `docs/ARCHITECTURE_SYNC.md`
- Getting started: `docs/DEVELOPER_GUIDE.md`
- Deployment: `docs/HOSTING.md`
- Full context: `PROJECT_CONTEXT.md`


## JSX

- Always use self-closing tags for components that don't have children: `<MyComponent />` instead of `<MyComponent></MyComponent>`.
- Use div tags for basicly everything besides obvious cases like buttons or inputs, e.g. don't use header or footer tags.
- With text use our i18n implementation.
```tsx
import { useTranslator } from "src/_functions/translator";

const translate = useTranslator();
{translate({ key: 'settings.theme.light' })}
```
- always use `` in a className tag instead of '' or "".