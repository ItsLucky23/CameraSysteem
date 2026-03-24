# Polyrepo + Packaging Architecture Plan

Last updated: 2026-03-24
Status: Working design draft based on current team decisions

## 1) Goal

Create one architecture that scales from small to very large deployments without changing the frontend contract.

Core idea:
- One public gateway endpoint for API and WebSocket traffic.
- Multiple domain services behind the gateway.
- Polyrepo source layout (main workspace folder + many independent Git repos).
- Framework shipped as npm packages with clear extension points.

## 2) Source Layout We Are Targeting

This reflects the current direction the team agreed on.

```txt
project/
  README.md
  .env.shared

  crm-service/                (independent git repo)
    .git/
    package.json
    node_modules/
    src/
      page.tsx
      dashboard/
        page.tsx
      crm/
        _api/
        _sync/
        _components/
    dist/
      server.js

  files-service/              (independent git repo)
    .git/
    package.json
    node_modules/
    src/
      page.tsx
      files/
        page.tsx
        _api/
        _sync/
    dist/
      server.js

  base-service/               (independent git repo)
    .git/
    package.json
    node_modules/
    src/
      page.tsx
      auth/
        _api/
      settings/
        page.tsx
    dist/
      server.js

  gateway-service/            (independent git repo)
    .git/
    package.json
    node_modules/
    src/
      server.ts
      socket.ts
      dispatch/
      adapters/
    dist/
      server.js

  workspace-orchestrator/     (optional small repo)
    .git/
    package.json
    vite.config.ts
    dist/
      index.html
      assets/
```

## 3) Why We Do It This Way

### 3.1 Feature ownership stays clear
- CRM code stays in CRM folder.
- Files code stays in Files folder.
- Teams can work in separate repos without stepping on each other.

### 3.2 Frontend contract stays stable
- Client always talks to one gateway URL.
- Frontend does not need to know service addresses.

### 3.3 Same architecture for all sizes
- Small: gateway can dispatch locally or to few services.
- Medium: multiple gateway instances + shared Redis.
- Large: many services, distributed gateway instances, stronger observability.

### 3.4 Better deployment flexibility
- Service-specific deploys are possible.
- One service can run locally while others proxy to staging.

## 4) Frontend Build Model

Current direction:
- Frontend build scans service folders for page files.
- Route discovery follows current rule style: non-private folders and page files.
- If a service has src folder, route path excludes src segment.

Expected URL examples:
- /crm-service -> crm-service/src/page.tsx
- /crm-service/dashboard -> crm-service/src/dashboard/page.tsx
- /files-service/files -> files-service/src/files/page.tsx

Important boundaries:
- Exclude server-only code from frontend bundle (_api, _sync server handlers, server-only imports).
- Keep frontend output as static assets in dist (index.html + JS/CSS chunks).

## 5) Backend Runtime Model

### 5.1 Gateway responsibilities
- Own all socket connections.
- Own room membership and fanout execution.
- Validate auth/session/rate limits at edge.
- Dispatch API and sync calls to local/remote services.

### 5.2 Domain service responsibilities
- Business logic and data access.
- Validation and response shaping.
- Return broadcasting instructions/policies to gateway when needed.

### 5.3 Broadcasting control for advanced games and realtime apps
- Do not require users to monkey-patch raw socket.emit.
- Provide broadcaster hook pipeline in framework.

Proposed hook points:
- onSyncReceived
- beforeRoomFanout
- beforeEmitToSocket
- afterEmitToSocket
- onEmitError

Hook actions:
- allow
- deny
- mutate payload
- skip socket
- reroute room

This preserves full user control while keeping transport stable.

## 6) Redis Strategy

### 6.1 Logical targets
- redis.session
- redis.rateLimiting
- redis.roomHandling

### 6.2 Default mode
- All three targets can point to same Redis endpoint.

### 6.3 Scale mode
- Split targets across different Redis instances/clusters.

### 6.4 Connection management rule
- Deduplicate client connections when two logical targets use same endpoint.
- Exception: room handling adapter may require separate pub/sub clients even on same endpoint.

## 7) Package Strategy

Target package shape (user-facing):
- @luckystack/core
- @luckystack/gateway
- @luckystack/client-sdk
- @luckystack/react
- @luckystack/session
- @luckystack/observability

Practical rollout advice:
- Start with fewer public packages first.
- Keep internal modules separated before expanding public package surface.

## 8) Required Framework Changes

These are concrete changes needed from current codebase.

### 8.1 Route discovery and build abstraction
Current coupling examples:
- [server/dev/loader.ts](server/dev/loader.ts)
- [server/dev/typeMapGenerator.ts](server/dev/typeMapGenerator.ts)
- [scripts/generateServerRequests.ts](scripts/generateServerRequests.ts)
- [server/utils/paths.ts](server/utils/paths.ts)

Needed change:
- Replace single-root assumptions with configurable service-root discovery.
- Keep current behavior as default mode.

### 8.2 Unified loader contract for dev and prod
Current split:
- dev dynamic loader and prod generated map have separate logic paths.

Needed change:
- One route provider interface used by both environments.

### 8.3 Socket broadcast extensibility
Current coupling examples:
- [server/sockets/handleSyncRequest.ts](server/sockets/handleSyncRequest.ts)
- [server/sockets/socket.ts](server/sockets/socket.ts)
- [server/sockets/utils](server/sockets/utils)

Needed change:
- Central broadcaster pipeline with override hooks.
- Keep a safe default implementation.

### 8.4 Session/rate-limit/room adapter abstractions
Current storage/rate limit usage examples:
- [server/functions/session.ts](server/functions/session.ts)
- [server/utils/rateLimiter.ts](server/utils/rateLimiter.ts)

Needed change:
- Add provider interfaces and memory/redis implementations.
- Wire through gateway startup and config.

### 8.5 Gateway dispatch contract
Needed change:
- Formalize API/sync envelope between gateway and services.
- Include correlation id, timeout policy, and error mapping.

## 9) Git Model Decision

Both are possible:

1. Parent folder not Git
- Simplest pure polyrepo workflow.

2. Parent folder is Git + children as submodules
- Useful when platform-level scripts/config need version control.

Recommended default:
- Keep each service as independent repo.
- Add small orchestrator repo for build/proxy tooling.
- Use submodules only if parent-level versioning is needed.

## 10) Risks and Mitigations

### Risk: accidental client import of server code
Mitigation:
- Enforce strict import boundaries and build-time checks.

### Risk: too many packages too early
Mitigation:
- Ship minimum package set first, expand after interfaces stabilize.

### Risk: custom broadcast hooks causing latency
Mitigation:
- Timeouts, fallback behavior, and metrics per hook.

### Risk: distributed rate limits inconsistent across nodes
Mitigation:
- Redis-backed limiter in distributed mode.

## 11) Suggested Implementation Phases

1. Phase A
- Introduce provider interfaces (session, rate limit, room adapter).
- Keep current behavior as default.

2. Phase B
- Introduce route provider abstraction for multi-service roots.
- Align dev and prod loaders under one contract.

3. Phase C
- Add gateway dispatch envelope and service ownership map.
- Support local + remote dispatch modes.

4. Phase D
- Introduce broadcaster hook pipeline and default implementation.
- Add redis adapter for distributed room fanout.

5. Phase E
- Package extraction and external npm publishing.
- Keep migration guides and compatibility notes updated.

## 12) Final Thoughts

This architecture is more complex than current monolith mode, but it provides:
- one stable frontend contract,
- strong team ownership boundaries,
- controlled scaling path,
- safer customization points for advanced realtime behavior.

The most important design rule to keep:
- Gateway owns transport and room fanout.
- Services own business logic.
- Frontend always calls one public gateway endpoint.
