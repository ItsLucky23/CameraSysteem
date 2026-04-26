# Handoff prompt — Recordings page (desktop + mobile)

You are implementing the **Recordings** page redesign in an existing camera-control web app. Scope: this single route on both desktop and mobile. Do not touch other pages.

## What you're given

1. **`src/`** — existing codebase (Vite + React + TypeScript + Tailwind v4). Edit in place.
2. **`recordings-handoff/DESIGN_SPEC.md`** — the only spec you need.
3. **`recordings-handoff/reference/artboard-recordings.jsx`** — desktop mockup (static JSX with seed data — read for layout, do not import).
4. **`recordings-handoff/reference/artboard-mobile.jsx`** — contains `MobileRecordings` component, the mobile reflow.
5. **`recordings-handoff/reference/primitives.jsx`** + **`tokens.css`** — shared primitives (SideRail, PageTopBar, CameraThumb, StatusDot, Icon, chip/btn classes) and design tokens.
6. **`recordings-handoff/reference/Camera System UI.html`** — open in browser to see the artboard live; focus the "07 · Recordings" card with the ⤢ button to view full-size.

## Single target file

- **`src/recordings/page.tsx`** — replace its render output to match the reference. Keep all hooks, sockets, and i18n calls intact.

## Hard rules

1. **Do not break data flow.** The reference uses `window.cameraSeed` and a hand-written `clips` array. The real page uses `apiRequest`, `useSyncEvents` (`recordingStatus_server_v1`, `cameraStateUpdated_server_v1`), and `joinRoom('cameras')` / `leaveRoom`. Keep all of that — only swap presentation.
2. **Preserve all i18n keys.** Every visible string must remain a `t('...')` call. New strings → add keys to all four locale files (`src/_locales/{en,nl,de,fr}.json`).
3. **Tokens.** Make sure `src/index.css` has `--color-muted`, `--color-primary-soft`, `--color-wrong-soft`, `--color-correct-soft`, the three font families, and the warmer neutral surfaces from `tokens.css`. If they aren't there yet, add them — variable names match existing ones.
4. **Permissions.** Don't render Stop/Download for clips on cameras the session can't control.
5. **Realtime.** Keep `useSyncEvents` subscriptions and `joinRoom` lifecycle exactly as-is. Active recordings (no `stoppedAt`) must update live.
6. **Mobile = same route, not a new one.** Use Tailwind `md:` breakpoints. Below `md`, render the mobile layout; at and above, render desktop.
7. **Re-use primitives if they exist.** The codebase already has `src/_components/ui/{Chip, MaterialIcon, PageTopBar, StatusDot}` (per `src/recordings/page.tsx` imports). Reuse them. Add `SideRail` and `CameraThumb` to `src/_components/ui/` if missing.

## Workflow

1. Read `src/recordings/page.tsx` end-to-end. List every state hook, API call, sync event, and i18n key.
2. Open both reference files. Identify which JSX block maps to which existing chunk (storage card, timeline, clip table, preview pane).
3. Refactor the page to match the reference, reusing existing handlers and state. Do NOT introduce new state for things already tracked (selected clip, day filter, recording status are existing concerns).
4. Diff against the reference visually.
5. Run `tsc --noEmit` and the dev server. Verify the page still loads with real data, sockets reconnect, active recordings update live, stop/download work.

## Definition of done

- Visual match to reference within ~4px on major elements.
- All previous functionality works (start/stop, download, day filter, selection).
- No new ESLint or TS errors.
- All strings translated; new keys in all 4 locales.
- Dark mode still works (`.dark` root class).
- Mobile layout renders below `md` breakpoint and is fully usable on a 360px-wide viewport.

## Things to ASK before implementing

- Whether to keep the existing `template = 'aperture'` shell or replace with the new SideRail.
- Whether the new tokens should fully replace existing values or be added alongside.

Stop and confirm before doing anything destructive.
