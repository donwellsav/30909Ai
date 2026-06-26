# 3090Ai Design Guide

Telemetry is the source of truth for the app UI. New screens should feel like the Telemetry page: dense, local, operational, and built for a desktop workstation running a 3090.

## Design Intent

3090Ai is a local control surface, not a marketing site and not a mobile app. The UI should help the user launch, inspect, tune, and verify local AI services with as little wasted space as possible.

Use the 5-pass workflow for meaningful UI work:

1. Make the feature work.
2. Remove placeholders.
3. Improve controls and usability.
4. Tighten density and visual hierarchy.
5. Add telemetry, QA polish, and real edge-state handling.

## Layout

Use a desktop shell with a fixed left navigation rail, a compact top status bar, and dense content panels.

Telemetry establishes the layout standard:

- Top command/status panel: most important state first, actions on the right.
- Dense signal grid: label, value, small detail line.
- Secondary operational panels below: resources, scan tables, logs, raw details.
- Raw or verbose output belongs in collapsible drawers, not large always-open tiles.
- Prefer tables, rows, bars, and drawers over cards.
- Avoid repeated tiles that take space without adding information.

Panels use:

- `rounded-md`
- `border border-workflow-border`
- `bg-workflow-surface`
- Header: `border-b border-workflow-border px-3 py-2`
- Body rows: compact `px-3 py-2`, `text-xs`

## Density Rules

Default to compact desktop density.

- Labels: short, left aligned, muted.
- Values: monospace, high contrast, truncated when long.
- Detail lines: smaller muted text, one line when possible.
- Rows should scan vertically without forcing the user to open multiple pages.
- Keep controls close to the state they affect.
- Do not add explanatory marketing copy inside the app.

## Typography

Use the existing type system:

- App body: system sans via `Arial, Helvetica, sans-serif`.
- Values, labels, commands, and status: `font-mono`.
- Panel titles: `text-xs font-semibold uppercase tracking-wide`.
- Utility labels: `text-[10px] uppercase tracking-wide`.
- Row details: `text-[11px] text-workflow-text-subtle`.

Do not use large hero typography inside tool surfaces.

## Color Tokens

Use existing workflow tokens from `app/globals.css`.

Core surfaces:

- App background: `bg-workflow-bg`
- Panel surface: `bg-workflow-surface`
- Hover surface: `bg-workflow-surface-hover`
- Input/row surface: `bg-workflow-node-input`
- Border: `border-workflow-border`
- Text: `text-workflow-text`
- Muted text: `text-workflow-text-muted`
- Subtle text: `text-workflow-text-subtle`

Semantic status:

- Good: emerald
- Warning: amber
- Bad: rose
- Neutral/info: workflow text or sky only when a distinct neutral signal is needed

Use semantic color for state, not decoration.

## Components

Follow the Telemetry primitives before inventing new ones.

### TelemetryLine

Use for compact key/value state.

- Label column: fixed-width enough to scan.
- Value: monospace, truncated.
- Detail: optional, muted, one line.
- Tone: `neutral`, `good`, `warn`, or `bad`.

### TelemetryBar

Use for bounded numeric resources like VRAM, storage budget, context use, or queue capacity.

- One compact label/value header.
- One thin progress bar.
- One detail line.
- Color is semantic, not decorative.

### RawTelemetry

Use for verbose command output, JSON, Docker rows, WSL rows, logs, and diagnostics.

- Collapsed by default.
- Summary should reveal what is inside.
- Open state shows a scrollable monospace block.

### ActionButton

Use for direct commands.

- Primary action: emerald fill.
- Destructive action: rose border/background.
- Secondary action: workflow border/input background.
- Labels are verbs: `Refresh`, `Scan ports`, `Test API`, `Launch`, `Stop`.

## Controls

Use the most direct native control that fits the setting.

- Slider: continuous numeric tuning.
- Number input: exact numeric setting with step.
- Select: finite option set.
- Checkbox: binary setting.
- Text input: paths, URLs, model IDs, provider IDs.
- Button: explicit action only.

Every advanced setting should show the current value close to its control.

## Resize And Window Fit

The app is a desktop tool, so resizability is a feature.

- The app fills the host browser/native window; resizing the window resizes the app.
- Keep the app shell window-sized with internal content scrolling.
- A 16:9 window is a good default testing size, not a layout constraint.
- Use normal browser/window scaling; do not add an in-app scale slider.
- Wider windows should reveal more columns, wider panels, or longer rows.
- Major adjacent work areas should use draggable split panes: `PanelGroup`, `SplitPanel`, and `PanelResizeHandle`.
- Tiles, rows, tables, and telemetry groups should scale with the panel/window that owns them.
- Do not use CSS `resize` on app panels; it creates floating layout islands instead of real pane resizing.
- Rows, buttons, labels, and ordinary form fields should not have resize handles.
- Composer areas can resize through a vertical split pane; textareas should not resize independently unless there is a specific editing reason.
- Do not force telemetry, chat, logs, or settings panels into 16:9.
- Do not let resizing create empty visual dead zones.

## Data Truth

Telemetry must use real local data or say it is unavailable.

Do:

- Show real endpoint status from `/models`.
- Show real probe status from `/chat/completions`.
- Show real token usage when the backend returns `usage`.
- Show real GPU, Docker, WSL, disk, and repo data from local commands.
- Keep raw command output available for troubleshooting.

Do not:

- Invent token speed, context use, model health, or benchmark numbers.
- Hide failures behind friendly copy.
- Replace raw diagnostics with summaries only.

## Page Guidance

### Overview

Should feel like a control center, not a duplicate of Telemetry. Keep launch, provider connection, settings, and common actions tight.

### Telemetry

Canonical page. Match this page when unsure.

### Chat

Keep the conversation readable, but expose model settings and token usage nearby. Web search belongs here as a resizable browser preview plus chat context handoff. Do not turn chat into a marketing assistant UI.

### Web Search

Do not create a separate Web Search page unless search grows beyond chat-side preview, history, and open-external fallback.

### Canvas

Use panels and inspector rows, not decorative cards. Preserve dense tooling.

### Logs

Logs should use collapsible or scrollable monospace surfaces with job state nearby.

## QA Standard

For UI passes, verify the rendered app, not just the build.

Minimum check:

- `pnpm exec tsc --noEmit`
- `pnpm build`
- Browser check on `http://localhost:3090/`
- No framework overlay
- No relevant console errors
- At least one target interaction exercised

For Telemetry-like pages, also verify the local endpoint path:

- `Test API`
- `Scan ports`
- visible endpoint/model result
- raw diagnostics still reachable
