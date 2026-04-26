# Recordings — design spec (desktop + mobile)

A focused brief for the Recordings page only. Editorial-meets-operational: warm neutrals, serif headlines for calm, monospace for telemetry, calm status colors so red/green carry meaning.

## 1. Tokens you'll need

Make sure `src/index.css` `@theme` has these. Variable names match the existing codebase so Tailwind classes don't break.

```css
--font-sans:    'Inter', system-ui, sans-serif;
--font-display: 'Instrument Serif', Georgia, serif;
--font-mono:    'JetBrains Mono', ui-monospace, monospace;

--color-background:        #FAFAF8;
--color-container1:        #FFFFFF;
--color-container1-hover:  #F7F6F2;
--color-container1-border: #ECEBE5;
--color-container2:        #F2F1EC;
--color-container2-border: #E2E0D7;

--color-title:  #1A1A1A;
--color-common: #5A5A5A;
--color-muted:  #8C8B82;          /* needed for labels */

--color-primary:      #2D5BFF;
--color-primary-soft: #ECEFFF;    /* selected row tint */

--color-correct: #1F9D55; --color-correct-soft: #E8F5EC;
--color-warning: #C9912D; --color-warning-soft: #FBF3DF;
--color-wrong:   #C2342B; --color-wrong-soft:   #FAEAE8;  /* active-recording row tint */
```

Load fonts via `<link>` in `index.html`: Inter, Instrument Serif, JetBrains Mono, Material Symbols Outlined.

## 2. Type ramp

| Use | Family | Size / weight |
|---|---|---|
| Display H1 (page title) | Instrument Serif | 36px / 400, `letter-spacing: -0.015em` |
| Section heading (e.g. "6 clips", camera name in preview) | Instrument Serif | 20–22px / 400 |
| Body | Inter | 14px / 500 |
| Eyebrow / table header / "STORAGE" label | Inter | 10.5px / 600, uppercase, `letter-spacing: 0.12em`, color `--color-muted` |
| Telemetry (durations, sizes, slugs, timestamps, FPS) | JetBrains Mono | 12–13px / 500 |

Never use serif on numbers — that's mono territory.

## 3. Reusable primitives (lift from reference)

If not already in `src/_components/ui/`, add:

- **`<SideRail active="recordings">`** — 220px column, brand mark + nav.
- **`<PageTopBar eyebrow title subtitle actions>`** — 36px horizontal padding, eyebrow + serif title + muted subtitle on the left, action buttons on the right.
- **`<CameraThumb src status>`** — image with grayscale + 0.55 opacity when offline; small recording dot overlay when active.
- **`<StatusDot status pulse>`** — 6px dot, color from status, CSS pulse halo when `pulse`.
- **`<Chip variant>`** — `chip-correct/chip-wrong/chip-warning/chip-primary` (see `tokens.css`).

## 4. Desktop layout (≥md)

Reference: `artboard-recordings.jsx`. SideRail + main column.

### 4.1 PageTopBar
- Eyebrow `Archive`
- Title `Recordings`
- Subtitle `Scrub the day, replay any clip, and manage the storage that keeps it all.`
- Right actions: `Filter` (icon `filter_list`) and `Export day` (icon `download`).

### 4.2 Top row — 2-col grid (1.4fr / 1fr), 16px gap, 36px horizontal padding
- **Storage card:** `Storage` label · serif `23.4 TB` · muted `of 100 TB`. Right side: 8px progress bar at 23%; below, two mono lines split-justified: `2.3 GB written today` / `76.6 TB remaining`.
- **7-day picker:** horizontal row, 7 equal-width buttons. Each button: weekday short label (uppercase, mono, 9.5px), serif day number (18px), mono `N clips`. Active day = solid primary fill, white text. Inactive = outlined, title text.

### 4.3 24-hour timeline card
- Header: eyebrow `Tuesday · 24-hour timeline` left, mono `Playhead 14:22 · 2.3 GB` right.
- Hour markers row: `00:00 03:00 06:00 09:00 12:00 15:00 18:00 21:00 24:00`, 10px mono, muted, space-between.
- 4 lanes (one per top camera), each: 140px label column + 18px tall track. Track segments use:
  - `--color-primary` for manual recordings
  - `--color-correct` for motion-triggered
  - `--color-wrong` for currently active
- Vertical playhead spans all 4 lanes at the current time, 2px wide, `--color-title`.

### 4.4 Bottom — 2-col grid (1.4fr / 1fr), fills remaining height

**Left: clips table** (in a `surface` card)
- Header bar: serif `6 clips` left, filter pill group right (`All / Manual / Motion / Schedule`, segmented style).
- Column header row (`label` style): `Camera · Started | Duration | Size | By | Stop reason | (action)`.
- Row template:
  - 48×30 thumb with red dot overlay if active
  - Camera name (13px, 600) + mono `HH:MM · slug` below
  - Duration mono
  - Size mono
  - Started-by name
  - Stop reason text (or `chip-wrong` "Recording" with pulsing dot for active)
  - Play icon button right-aligned
- Selected row tint: `--color-primary-soft`. Active recording row tint: `--color-wrong-soft`.

**Right: preview pane** (in a `surface` card)
- Header: eyebrow `Selected clip`, then 16px name (camera), mono `slug · started HH:MM · in progress`.
- 16:9 player area, 12px radius, `#000` background, REC pill top-left when active (`rgba(194,52,43,0.85)` bg, white mono `REC 23:14`).
- Transport row centered: ghost `skip_previous`, 44px round primary `play_arrow` button, ghost `skip_next`.
- 2-col metadata grid, each tile is a 8px-radius pill on `--color-container2`: muted label left, mono value right. Tiles: Duration / Size / Started by / Reason.
- Footer row: `Download` button (icon `download`) and `Stop` button (icon `stop_circle`, `--color-wrong` text).

## 5. Mobile layout (<md)

Reference: `MobileRecordings` in `artboard-mobile.jsx`. Wrapped in `PhoneShell` with a 4-tab bottom bar (Home / Cameras / Recordings active / Settings).

- **Header (14/18 padding):** eyebrow `Today`, serif `Recordings` 28px.
- **Day picker:** horizontal scroll row, each pill 48px-min-width, two-line: weekday short / serif day number. Active = primary fill.
- **Compact timeline card:** hour markers `00:00 / 06:00 / 12:00 / 18:00 / 24:00`, single 28px tall track with 5 colored segments (primary / correct / primary / wrong / correct). Vertical playhead at 60%. Below: muted `4 clips · 2.3 GB` left, mono `14:22` right.
- **Clip list:** vertical stack of cards. Each row: 56×40 thumb (red dot overlay for active recording) + camera name + mono `time · duration · size` + play icon trailing. Active rows get a 1.5px `--color-wrong` border.
- Bottom tab bar: Home / Cameras / **Recordings** (active, primary color) / Settings.

## 6. Iconography (Material Symbols Outlined only)

`movie, play_arrow, skip_previous, skip_next, stop_circle, download, filter_list, fullscreen, more_horiz, arrow_back, chevron_right`.

No emoji. No custom SVGs.

## 7. Don'ts

- No gradient backgrounds on this page.
- No drop shadows on cards (border + token surface only).
- No serif on numbers / timestamps / sizes — those are always mono.
- No new colors outside the token set.
- No new client-side state for things already tracked (selected clip, recording status, day filter).
