# Design spec — Aperture Camera Control

Editorial-meets-operational redesign. Warm neutrals, serif headlines for editorial calm, monospace for telemetry, calm status colors so red/green actually mean something.

## 1. Design tokens

Replace the `@theme` block in `src/index.css` with these values (variable names match the existing ones so Tailwind classes don't break):

```css
@theme {
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-display: 'Instrument Serif', Georgia, serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;

  --color-background: #FAFAF8;
  --color-container1: #FFFFFF;
  --color-container1-hover: #F7F6F2;
  --color-container1-border: #ECEBE5;
  --color-container2: #F2F1EC;
  --color-container2-hover: #EAE9E2;
  --color-container2-border: #E2E0D7;

  --color-title: #1A1A1A;
  --color-common: #5A5A5A;
  --color-muted: #8C8B82;          /* NEW — needed for labels */

  --color-title-primary: #FFFFFF;
  --color-common-primary: #FFFFFF;

  --color-primary: #2D5BFF;
  --color-primary-hover: #1E47E0;
  --color-primary-border: #1736B8;
  --color-primary-soft: #ECEFFF;   /* NEW — used for chips, soft buttons */

  --color-accent: #E8A87C;          /* NEW — peach, used in auth + avatars */
  --color-accent-soft: #FAF1EA;

  /* Calmer status — replace the existing oklch values */
  --color-correct: #1F9D55;
  --color-correct-soft: #E8F5EC;
  --color-warning: #C9912D;
  --color-warning-soft: #FBF3DF;
  --color-wrong: #C2342B;
  --color-wrong-soft: #FAEAE8;
}
```

Dark mode (existing `.dark` class) — preserve identity but bump primary to `#8B5DFF`, accent to `#F1C4FD`, see `tokens.css` in the reference for full values.

## 2. Type ramp

| Use | Family | Size / weight |
|---|---|---|
| Display H1 (page title) | Instrument Serif | 36–44px / 400, `letter-spacing: -0.015em` |
| Section heading | Instrument Serif | 22px / 400 |
| Body | Inter | 14px / 500 |
| Button | Inter | 13px / 500 |
| Label (eyebrow, table header) | Inter | 10.5px / 600, uppercase, `letter-spacing: 0.12em`, `color: var(--color-muted)` |
| Telemetry / IP / FPS / timecodes | JetBrains Mono | 12–13px / 500 |

Never use the serif on running body. Never use mono for prose. Eyebrow labels go above every page title.

## 3. Reusable primitives

Create `src/_components/ui/` and lift these from `primitives.jsx`:

- **`<SideRail active="dashboard|monitor|admin|access|settings">`** — 240px column, brand mark + nav with subtle indicator pill on active item.
- **`<PageTopBar eyebrow title subtitle actions>`** — 36px horizontal padding, eyebrow + serif title + muted subtitle on the left, actions cluster on the right. 28px bottom padding.
- **`<CameraThumb src status height rounded>`** — image with grayscale + 0.55 opacity when `status==='offline'`, optional REC badge.
- **`<StatusDot status pulse>`** — 6px dot, color from status (`online`→correct, `idle`→warning, `offline`→wrong), CSS pulse halo when `pulse`.
- **`<Chip variant>`** — see `.chip-correct/.chip-wrong/.chip-warning/.chip-primary` in `tokens.css`.
- **`<Toggle on>`** — 36×20 pill, primary color when on.
- **`<Field label placeholder type trailingLabel>`** — 42px-tall input, label above, optional trailing link (e.g. "Forgot?").
- **`<BrandMark size color>`** — aperture-blade SVG, used in auth + mobile login.

## 4. Per-page notes

### Login (`src/login/page.tsx`)
Two-pane layout, dark gradient brand panel left (46% width), white form right.
- Left: `linear-gradient(155deg, #1A1A1A 0%, #2A2538 100%)`, large faint aperture SVG top-right at 0.18 opacity, brand mark + wordmark top, serif H2 mid, version line bottom.
- Right: top utility row "Don't have an account? · Create one", centered form (`max-width: 380px`). Email + password fields, primary CTA "Sign in →", divider, Google + Apple buttons.

### Dashboard (`src/dashboard/page.tsx`)
SideRail + main column.
- PageTopBar eyebrow "Live overview" / serif title / subtitle.
- 3-up health stat strip (Online / Recording / Offline) — large display numerals, label below.
- Cameras grid (2×2 on lg, 1-col on md): each card is a CameraThumb + name + chip + uptime.
- Right rail (320px): "Activity" feed with serif sub-heads, mono timestamps.

### Live monitor (`src/cameras/page.tsx`)
SideRail + 3-pane content.
- Left list (280px): camera nodes with thumb + status chip, click to focus.
- Center: large preview (16:9), REC pill top-left, fullscreen button top-right; PTZ joystick puck below; quick-action row (IR, Audio, Mic).
- Right (320px): camera metadata table (mono values), recording controls, timeline scrubber.

### Admin (`src/admin/page.tsx`)
SideRail + main.
- PageTopBar with primary "Add camera" CTA.
- Health row: storage bar (23.4 / 100 TB) + Cameras online + Nodes offline.
- Filter strip (All / Online / Offline) + Refresh button.
- Table with columns Camera (thumb + name + slug) | IP | Quality | FPS | Status | edit-button. Offline rows tinted `var(--color-wrong-soft)`.

### Access matrix (`src/admin/camera-access/page.tsx`)
SideRail + 2-pane (320px users left, matrix right).
- Left: search + scrollable user list, role chip on admins.
- Right: header card with selected user, then table — Camera | Preview toggle | Control toggle. Sticky Save / Reset in header.

### Settings (`src/settings/page.tsx`)
SideRail + secondary nav (220px) + content.
- Profile card with gradient avatar (peach→blue).
- Appearance: 2-up theme picker (Light / Dark Aperture).
- Language: 4-up (EN / NL / DE / FR), mono code + native name.
- Sticky save bar at bottom right.

### Mobile (all pages, `<md` breakpoint)
- Replace SideRail with a 4-tab bottom bar (Home / Cameras / Recordings / Settings).
- Page titles drop to 26–28px serif. Cards become full-width.
- Live monitor: PTZ joystick becomes a centered round pad (180px) with 4 chevrons + center recenter button.
- Recordings: horizontal day picker + 24-hour timeline scrubber + clip list.
- Admin / Access detail screens push from the list (back arrow + Save in header).

## 5. Iconography

Material Symbols Outlined only — load via `<link>`. Allowed names used in reference:
`videocam, dashboard, settings, admin_panel_settings, lock, person_add, edit, add_a_photo, refresh, download, filter_list, search, fullscreen, my_location, keyboard_arrow_{up,down,left,right}, flare, volume_up, mic_off, play_arrow, arrow_back, arrow_forward, more_horiz, chevron_right, check, check_circle, palette, language, notifications, devices, signal_cellular_alt, wifi, battery_full, movie`.

Do not draw custom SVGs except the BrandMark.

## 6. Don'ts

- No emoji.
- No gradient backgrounds except the auth brand panel and the avatar gradient.
- No drop shadows under 18px-deep cards (use border + token-defined `--shadow-md` for raised elements only).
- Never put the serif font on numeric telemetry — that's mono territory.
- Don't introduce a new color outside the token set without asking.
