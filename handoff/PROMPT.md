# Handoff prompt — paste this to your Claude Code agent

You are implementing a hi-fi UI redesign of an existing camera-control web app. Read this entire file before touching code.

## What you're given

1. **`src/`** — the existing codebase (Vite + React + TypeScript + Tailwind v4). You are editing this in place.
2. **`handoff/DESIGN_SPEC.md`** — full design system + per-page implementation notes. Treat this as the source of truth for visuals.
3. **`handoff/reference/`** — the reference designs as static HTML/JSX (these are mockups, not runnable in the app — read them for layout, spacing, copy and component structure, then re-implement using the real codebase's data hooks and components).
4. **`handoff/reference/screenshots/`** — PNG of every screen in the redesign. Match these pixel-for-pixel.

## Scope (in order — ship one page at a time, do not bulk-rewrite)

| # | Page in codebase | Reference artboard |
|---|---|---|
| 1 | `src/login/page.tsx` | `01-auth.png` + `artboard-auth.jsx` |
| 2 | `src/dashboard/page.tsx` | `02-dashboard.png` + `artboard-dashboard.jsx` |
| 3 | `src/cameras/page.tsx` | `03-monitor.png` + `artboard-monitor.jsx` |
| 4 | `src/admin/page.tsx` | `04-admin.png` + `artboard-admin.jsx` (top half — `AdminArtboard`) |
| 5 | `src/admin/camera-access/page.tsx` | `05-access.png` + `artboard-admin.jsx` (bottom half — `AccessArtboard`) |
| 6 | `src/settings/page.tsx` | `06-settings.png` + `artboard-settings.jsx` |
| 7 | Mobile reflows (responsive breakpoints on the same routes) | `07-mobile-*.png` + `artboard-mobile.jsx` |

## Hard rules

1. **Do not break data flow.** The reference files use seed data (`window.cameraSeed`, `window.userSeed`). The real pages use `apiRequest`, `useSyncEvents`, `joinRoom/leaveRoom`, and `useTranslator`. Keep all of that — only swap presentation.
2. **Preserve all i18n keys.** Every visible string must remain a `t('...')` call. If you need new copy, add keys to all four locale files (`src/_locales/{en,nl,de,fr}.json`) — never hardcode text.
3. **Tokens go in `src/index.css`.** The reference uses a parallel `tokens.css` (warmer neutrals, peach accent, calmer status colors). Migrate those values into `src/index.css`'s `@theme` block. Keep variable names identical so existing Tailwind classes still resolve.
4. **Add fonts via `<link>` in `index.html`** — Inter (sans), Instrument Serif (display), JetBrains Mono (mono), Material Symbols Outlined (icons). Do not bundle them.
5. **Permissions.** Don't render UI for cameras the session can't preview/control — use `canPreview` / `canControl` flags on each `CameraListItem`.
6. **Realtime.** Keep `useSyncEvents` subscriptions and the `joinRoom('cameras')` / `leaveRoom` lifecycle exactly as-is on every page that has them.
7. **Mobile is the same routes, not new ones.** Add Tailwind `md:` / `lg:` breakpoints. The mobile reference uses 360px-wide phone frames; treat that as the small-breakpoint layout.

## Workflow per page

1. Read the existing `page.tsx` end-to-end. List every state hook, API call, sync event, and i18n key.
2. Open the reference artboard JSX side-by-side. Identify which JSX block maps to which existing chunk.
3. Refactor the page's render tree to match the reference, reusing existing handlers and state. Do NOT introduce new state for things already tracked.
4. Pull repeated visual primitives (StatusDot, CameraThumb, SideRail, PageTopBar, chip, btn) into `src/_components/ui/` so subsequent pages reuse them.
5. Diff against the screenshot. Fix spacing, weight, and color before moving on.
6. Run `tsc --noEmit` and the dev server. Verify the page still loads with real data and that sockets reconnect cleanly.

## Definition of done (per page)

- Visual diff against screenshot is < 4px on any major element.
- All previous functionality works (record start/stop, PTZ, IR mode, permissions matrix, etc.).
- No new ESLint or TS errors.
- All strings translated; new keys added to all 4 locales.
- Dark mode still works (`.dark` class on root) — fall back to existing dark tokens for any new surface.

## Things to ASK the user about before implementing (do not assume)

- Whether to keep the existing `template = 'ops'` shell (Navbar, etc.) or replace it with the new SideRail from the reference.
- Whether the new peach `--color-accent` should fully replace any existing accent usage or be additive.
- Whether to ship the mobile reflow in the same PR as desktop, or a follow-up.
- Whether to add the new Recordings timeline page (it appears in the mobile reference but has no current desktop equivalent).

Stop and confirm before doing anything destructive (deleting components, renaming routes, changing the auth flow).
