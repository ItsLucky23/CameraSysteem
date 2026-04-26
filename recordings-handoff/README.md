# Recordings handoff package

Hand this folder + your `src/` codebase to your Claude Code agent.

## Files

- **`PROMPT.md`** → paste as the agent's first message.
- **`DESIGN_SPEC.md`** → the only spec you need. Tokens, type ramp, primitives, desktop layout, mobile layout.
- **`reference/artboard-recordings.jsx`** → desktop mockup. Read for layout, do not import.
- **`reference/artboard-mobile.jsx`** → contains `MobileRecordings`, the mobile reflow.
- **`reference/primitives.jsx`** + **`tokens.css`** → shared primitives + tokens that the artboards depend on.
- **`reference/Camera System UI.html`** → open in a browser to see the live mockup. Focus the "07 · Recordings" artboard with the ⤢ button to see it full-size.

## Scope

**Single page** — `src/recordings/page.tsx`, both desktop and mobile (responsive breakpoints on the same route).
