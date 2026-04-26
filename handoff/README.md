# Aperture · Camera Control — Handoff package

Hand this entire folder to your Claude Code (or other coding agent) along with the live `src/` codebase.

## Files

- **`PROMPT.md`** → paste this as the agent's task prompt. Tells it where everything lives, the order of work, hard rules, and the per-page workflow.
- **`DESIGN_SPEC.md`** → the design system (tokens, type ramp, primitives) and per-page implementation notes. Source of truth for visuals.
- **`reference/`** → the static mockup files (HTML + JSX). Read for layout, copy and component shape — do NOT copy seed data, the real pages already have hooks/sockets.
- **Screenshots** → open `reference/Camera System UI.html` in a browser, focus each artboard with the ⤢ button, and save the PNG. Drop them into `reference/screenshots/` if you want the agent to diff against pixels — otherwise the live HTML reference is enough.

## How to use it

1. Open a fresh chat with your Claude Code agent in the project root.
2. Paste the contents of `handoff/PROMPT.md` as your first message.
3. Attach `handoff/DESIGN_SPEC.md` and a screenshot of the page you want to start with.
4. Tell it which page to ship first (recommended order in `PROMPT.md`).
5. Review the diff, then move to the next page.

## Order of implementation (recommended)

1. Tokens + global styles + fonts → `src/index.css` and `index.html`
2. Shared primitives → `src/_components/ui/`
3. Login → smallest, isolated page
4. Dashboard → uses most primitives
5. Live monitor → biggest payoff
6. Admin → table-heavy
7. Access matrix
8. Settings
9. Mobile reflows
