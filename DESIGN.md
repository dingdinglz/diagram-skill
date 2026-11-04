---
name: Flowplan
description: A precise local plan-review workspace with pale-gray navigation, cool-white canvas, and blue focus.
colors:
  paper: "#ffffff"
  canvas: "#f6f8fc"
  ink: "#202a3c"
  muted: "#647086"
  reading-muted: "#5f6d82"
  accent: "#4263df"
  accent-hover: "#3451c6"
  accent-soft: "#edf1ff"
  nav: "#f8f9fc"
  nav-raised: "#edf0f6"
  nav-ink: "#344158"
  nav-muted: "#647086"
  line: "#e3e8f0"
  soft-surface: "#f0f3f8"
  success: "#1d755f"
  success-soft: "#eaf7f0"
  warning: "#956513"
  warning-soft: "#fff6e5"
  danger: "#b74450"
  danger-soft: "#fff0f1"
  node-surface: "#ffffff"
  node-border: "#d6deeb"
  flow-edge-main: "#8192af"
  flow-edge-loop: "#5c729a"
  flow-edge-support: "#9ba8bd"
  flow-edge-exception: "#9ba8bd"
  loop-surface: "#e8eefb99"
  decision-ink: "#9a6a18"
  executor-program: "#61728f"
  executor-llm: "#8461a7"
  executor-human: "#91651e"
typography:
  body:
    fontFamily: '"Noto Sans SC Variable", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.75
  ui:
    fontSize: "14px"
    lineHeight: 1.45
  meta:
    fontSize: "13px"
  small:
    fontSize: "12px"
  title:
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0"
  headline:
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0"
  section:
    fontSize: "18px"
    fontWeight: 600
  display:
    fontSize: "24px"
    fontWeight: 600
  export-title:
    fontSize: "28px"
    fontWeight: 600
  node-title:
    fontSize: "16px"
    fontWeight: 600
    lineHeight: "22px"
  node-summary:
    fontSize: "12px"
    lineHeight: "16px"
  reading:
    fontSize: "16px"
    lineHeight: 1.75
  label:
    fontSize: "14px"
    fontWeight: 500
  button:
    fontSize: "14px"
    fontWeight: 500
  notes:
    fontSize: "14px"
    lineHeight: 1.75
rounded:
  badge-small: "4px"
  badge: "5px"
  icon: "6px"
  button: "7px"
  field: "8px"
  node-radius: "10px"
  dock: "11px"
  dialog-mobile: "12px"
  dialog: "14px"
spacing:
  gap-small: "4px"
  gap: "8px"
  inset-small: "12px"
  inset: "16px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.paper}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: "9px 13px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "#45536b"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: "9px 13px"
  button-subtle:
    backgroundColor: "transparent"
    textColor: "{colors.reading-muted}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: "8px 9px"
  icon-button:
    textColor: "{colors.reading-muted}"
    rounded: "{rounded.icon}"
    width: "32px"
    height: "32px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "10px 12px"
  task-item-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-hover}"
    rounded: "{rounded.icon}"
    padding: "11px 10px"
  status-approved:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success}"
    rounded: "{rounded.icon}"
    padding: "5px 10px"
  flow-node:
    backgroundColor: "{colors.node-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.node-radius}"
    width: "248px"
    height: "116px"
    padding: "14px 16px"
  view-switch:
    backgroundColor: "{colors.soft-surface}"
    rounded: "{rounded.badge}"
    padding: "2px"
  dialog:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.dialog}"
    padding: "0"
    width: "min(464px, 100%)"
---

# Design System: Flowplan

## Overview

**Creative North Star: "The Architectural Review Set"**

Pale-gray navigation with a right separator sits beside a cool-white working document. Blue connects selection, focus, and primary actions; restrained executor and lifecycle colors help readers distinguish meaning without tinting entire cards. Conventional controls and compact chrome leave room for the graph and its full explanations.

This is a code-led record of the implemented refinement, not a shipping verdict. Sources: `frontend/src/tokens.css`, `styles.css`, `icons.ts`, `BrandMark.tsx`, `App.tsx`, `FlowNode.tsx`, `GraphInspector.tsx`, `Dialog.tsx`, and `NodeInspector.tsx`. Product and direction remain in `PRODUCT.md` and `.impeccable/surfaces/frontend.md`. Current type/icon captures belong in `.impeccable/review/type-icons/`; earlier atmosphere/motion captures are historical. Actual source remains the authority. Render review remains separate; this documentation asserts neither test results nor scope-wide shipping readiness.

**Key Characteristics:**
- Pale-gray navigation, white document surfaces, pale dotted canvas.
- Blue selection and action; labeled, restrained state colors.
- Compact controls with a separate full-text reading path.
- Local system typography, bundled Phosphor icons, and a routed-F brand mark; no remote assets.

## Colors

### Primary

Review blue (`accent`) marks primary actions, selected nodes and edges, focus, and active inspector tabs. `accent-hover` deepens interactive emphasis; `accent-soft` supports selected controls. Inline code uses neutral `soft-surface` at line-height 1, so it cannot stretch a prose line.

### Secondary

Executor labels use slate (`executor-program`), muted purple (`executor-llm`), and amber (`executor-human`). Success teal identifies approved states and start/end icons; warning amber identifies pending/recovery states; danger rose identifies failures and destructive hover. Decisions use `decision-ink`, not the primary action color.

### Neutral

Pale gray (`nav`) keeps navigation quiet; `nav-raised` marks hover, while `nav-ink` and `nav-muted` separate labels from secondary text. A `line` right separator divides navigation from the workspace. Paper surfaces sit above the cool canvas; `line` divides chrome and `node-border` defines graph cards. `ink`, `muted`, and `reading-muted` separate content from metadata. Main, loop, support, and exception edge colors remain subdued.

**The Meaning Before Color Rule.** Pair executor and lifecycle colors with text or icons; reserve blue for focus, selection, navigation, and actions rather than executor identity.

Frontmatter names without corresponding CSS variables identify extracted stylesheet values, not newly implemented custom properties. The legacy `--green` alias resolves to blue `--accent`; it is not a second green palette.

## Typography

Use the bundled **Noto Sans SC Variable** family for consistent Chinese/Latin metrics. `@fontsource-variable/noto-sans-sc@5.3.1` supplies unmodified WOFF2 Unicode-range subsets under SIL OFL-1.1; the browser requests only needed subsets from the local app. `font-display: swap` keeps fallback text visible. PingFang SC, Microsoft YaHei and system-ui remain fallbacks; there is no runtime Google Fonts/CDN dependency. Code, IDs and key hints retain monospace; prose-oriented Markdown editing uses the UI family.

The shared roles are metadata (`meta`, 13px), controls (`ui`, 14px), prose (`body`, 16px/28px), document title (`title`, 20px; 18px mobile), and reader/dialog heading (`headline`, 22px). Weights are 400 body, 500 controls and 600 headings. Header status/save, history counts, graph totals and palette labels no longer use 10–11px exceptions. Tabs and shortcuts are 14px. Node summaries/footers, keycaps and dense document metadata use the explicit 12px small role, constrained by shared 248×116 geometry. Mobile text inputs stay 16px.

The wider inspector offers a roughly 332px desktop reading column; English notes generally sit around 40–50 characters per line, with shorter measures accepted on compact panels. Paragraphs use 14px spacing; lists use 7px item spacing. Markdown headings are 20/18/16px, never smaller than the prose they organize. Chinese headings have neutral tracking. Long titles wrap in readers and ellipsize only in navigation/header chrome. Version timestamps and truncated code IDs have separate visual roles; full IDs remain in DOM/title and action data.

PNG export forces font layout/readiness, then embeds only already-loaded matching font subsets through `fontEmbedding.ts`. URL validation, promise caching and explicit failure handling avoid remote font fetches, all-subset downloads and approval with a failed required-font capture. `exportLayout.ts` preserves the live balanced note-column assignment as independent grid columns before SVG serialization; copied CSS heights must not push a final note into an off-image column.

**The Overview Is Not Reading Rule.** Below 65% zoom, adaptive node titles prioritize structure; use “100% 阅读” or the inspector for full text.

## Layout

A full-height (100dvh) flex shell keeps navigation, header, review footer, and scrollable inspector separate from canvas pan/zoom. Base navigation is (232px), inspector (380px), and header/review-footer minimum height (72px). The flush, full-width canvas toolbar and inspector tab strip align at a minimum toolbar height / tab height of (56px).

| Bounds | Implemented behavior |
| --- | --- |
| ≤1280px width | Navigation 212px; inspector 336px; header/footer horizontal padding 20px; checkpoint button and canvas label hidden. |
| ≤1100px width | Inspector overlays the canvas at 380px; initially closed at this width. |
| ≤760px width | Navigation becomes a dismissible 280px drawer capped at 88vw; inspector fills editor width. Toolbar stays in one row above 350px: layout is icon-only, scope labels are “主线” / “含分支”, and “100% 阅读” remains explicit. Minimap hides. Header stays at least 76px; review footer at least 92px with save/lifecycle metadata. Major toolbar, header, review, zoom, and close targets are 44px. |
| ≤380px width | Toolbar text-button gap reduces to 3px; header history button hides; review gaps tighten. |
| ≤350px width | Toolbar may use two rows rather than reducing text or 44px targets; “100% 阅读” remains explicit. |
| ≤560px height | Dialog backdrop vertical padding 10px; maximum height calc(100dvh - 20px); content vertical padding 24px. Hide the decorative icon, shorten textareas, and retain the separate action footer. |

Spacing is contextual rather than a strict grid: recurring gaps and insets are captured above, while controls retain their actual asymmetric padding. Canvas dots are (.8px) at (24px) intervals. The top toolbar is a flush paper strip with a bottom divider, no rounded floating container or shadow. The bottom-centered node dock, minimap, level bar and lower-right zoom controls are floating surfaces sharing `line-float`, `shadow-float` and a 10px corner (12px on the dock and selection bar). The dock label has a fixed 7.5em width so the dock does not shift with selection, and hides below 780px of canvas width.

Reading mode sets zoom to 1 around the selected node, falling back to the first node, below the measured toolbar. It does not enlarge node geometry. Canvas zoom spans 15–170%; fit caps at 100%. Ordinary selection does not explicitly recenter the graph. Inspector/window resizing preserves zoom and the graph point at the canvas center by adjusting viewport x/y by half the size delta, rather than refitting. Task/version initialization still fits the scene; reading, fit, and auto-layout remain explicit viewport commands.

Graph cards remain (248 × 116px), shared with export. Modal width is capped at (464px), height at (92dvh), with internal scrolling; mobile backdrop padding is (16px). Empty states use the same canvas, a small connected-node illustration, and one contextual primary action, not a separate marketing layout.

## Elevation & Depth

Borders and tonal separation do most of the work. `node-shadow` gives cards a quiet lift; `shadow-float` separates tools from the canvas; `shadow-modal` protects focused tasks. Exact shadow values, focus treatments, and motion live in `.impeccable/design.json`, not unsupported frontmatter groups.

**The Structural Depth Rule.** Use elevation to distinguish cards, floating tools, overlays, and dialogs; retain the thin separators between persistent document regions.

Control color/border transitions take (150ms); press feedback translates ordinary buttons by (1px). Inspector, reader-context and dialog entrances take (220ms), with content visible from the first frame. The backdrop reaches its final tint in (160ms). Drawer movement takes (220ms); its visibility delay allows closing to finish while `inert` takes effect immediately. Explicit reading/fit transitions remain (250ms), zoom steps (180ms).

## Motion

The focal interaction is the node-creation dock: a nearby icon gently enlarges and lifts to acknowledge pointer intent, while all button hit areas and labels stay fixed. `ui/reactbits/NodeDock.tsx` adapts React Bits Dock's cosine-squared proximity falloff with a bundled Motion spring (`stiffness: 420`, `damping: 34`, `mass: .55`). Icon bounds are (1–1.22×) and (0–4px) lift; no width animation, launch bounce or idle loop. Narrow/touch layouts, disabled controls and reduced motion remain static. Keyboard arrows/Home/End navigate without adding a node.

`FlowScope.tsx` adapts React Bits RubberSegment's clipped leading/trailing edges, using a (260ms) non-bouncy spring and a (25ms) handoff. The control stays native, controlled and non-draggable; click, Space, Enter and arrow/Home/End activation remain available. Task selection and inspector tabs use shared-layout indicators. Reader transitions are keyed to navigation identity, never keystrokes or autosave revisions.

The user's subsequent request explicitly expands React Bits into background materials. Aurora now provides a slow blue/teal light field behind the canvas only; navigation and reading panels remain solid and quiet. Graph cards, connection geometry and PNG exports do not inherit these effects. All assets and dependencies are bundled; no runtime CDN or animated text. The upstream license is **MIT + Commons Clause**; see `frontend/src/ui/reactbits/README.md` and the retained release license.

Reduced motion uses static selection indicators, direct scope jumps, stationary dock icons, zero-duration panel/dialog/viewport transitions, and the CSS fallback. A subscribed media-query hook responds to live OS changes, with CSS interrupting any entrance already in flight. `test:ui` launches dedicated Chromium sessions with `--force-prefers-reduced-motion` and exercises live preference changes through a test-only CDP bridge, asserting the real media query rather than skipping unsupported `set media` emulation. See the motion review record for runtime evidence; real-device verification is separate.

### Atmospheric materials

- **Aurora:** native WebGL2 shader, two layers, OKLCH-interpolated `#829de2 / #81cbbb / #9daceb`, light mode at .26 opacity and .22 clock speed, with the wash starting higher and its fade spanning the full opacity range so no horizon band appears. Draws are capped at 30fps, DPR at 1 and buffer width at 1280px. The top wash dissolves into the existing dotted canvas; it is pointer-transparent and excluded from exports. No reveal or cursor-follow.
- **Background control:** the toolbar's sun button pauses the atmosphere; the preference persists locally. Drag/pointer hold, wheel activity, text editing, dialogs/busy states and hidden/offscreen pages suspend rendering. Mobile/coarse-pointer/reduced-motion and user-disabled modes use CSS without allocating WebGL. Context loss or failed initialization leaves the same CSS fallback.
- **SpotlightCard:** local radial fill (.12 peak opacity) and masked rim on the node dock and empty-state surface. It follows pointer/focus only; no idle loop. Labels, button targets and existing keyboard behavior remain unchanged.
- **GlareHover:** native approval and empty-state action buttons receive one 650ms sheen on hover/focus. Its brightest white band is limited to .136 opacity over the darker interactive blue; disabled/reduced-motion controls do not animate.

These three adaptations add no npm dependencies. Their palette is confined to the background/material layer, not new executor or status colors. Empty-state surfaces use a 480px maximum base width, 40px/32px padding and 18px corners; mobile uses 30px/20px padding and 14px corners.

## Shapes

Controls are gently rounded, not pill-shaped by default: button (7px), field/tool surface (8px), node (10px), dock (11px), dialog (14px; 12px mobile). Small badges use (4–5px); icon controls (6px). Most borders are (1px); selected nodes use (2px) with inset padding reduced by (1px), preserving outer geometry. Circular dots and broad elliptical loop regions retain their semantic roles.

## Components

- **Buttons:** Blue primary, bordered paper secondary, and unfilled subtle variants share compact type and a minimum (36px) desktop height. Primary hover deepens blue and shadow; secondary hover cools the surface; subtle hover gains a soft fill. Destructive actions use rose on hover. Disabled buttons retain their shape at opacity (.42). Primary carries a 1px top highlight; secondary a hairline `shadow-control`. Keyboard focus is a (2px) accent outline offset (3px).
- **Fields:** Paper fill, line border, field radius, and (10px 12px) padding. Hover darkens the border; focus uses an accent border with the 3px translucent `focus-ring`. Selects drop the native control for a shared drawn caret. Disabled fields stay opaque on canvas fill. Textareas resize vertically and start at (72px) minimum height.
- **Navigation:** Only brand, search, new-flow action, flow list, and shortcuts remain; the fake workspace card and local-file footer are removed. Rows are single-line by default with a (44px) minimum height. Draft metadata and timestamps are hidden from the visible list; each row's `title` retains full title, status, and time. Non-draft statuses remain visible. Active rows retain `accent-soft` fill and `accent-hover` text on hover, without a frame; a shared-layout background carries the selection between rows. Task-row focus outlines use a (-2px) offset to avoid scroll-container clipping. The mobile drawer moves focus to search, traps Tab, closes with Escape, and makes the underlying workspace inert.
- **Status and kind badges:** Compact text and dots identify lifecycle states; kind badges describe node type. They are informational, not toggle controls. Color does not substitute for a label.
- **Icons and brand:** Bundled `@phosphor-icons/react` is the single UI family, centralized through `icons.ts`: one regular linear weight through `UI_ICON_STYLE`, with bold kept for graph-card symbols because they scale down with zoom,, at (20px) for standalone controls, (18px) for inline/nav/tab icons, (16px) for status, and (14px) for compact graph metadata. Palette symbols are (22px); node symbols (20px), increasing to (28px) in overview. Selected icons do not switch to duotone. `NODE_ICONS` maps start → `Play`, step → `List`, decision → `GitFork`, end → `CheckCircle`; grouped nodes use `StackSimple`. Shortcuts use `Command`, ambient control `SunDim`, fit `CornersOut`. `BrandMark.tsx` is a separate routed white F on a blue rounded square, displayed at (26px) beside a (20px) wordmark in a (72px) brand row aligned with the desktop header, not a node glyph.
- **Graph cards:** A main row contains a (32px) symbol tile and a copy column with ellipsized title and optional two-line summary; a separate footer carries executor, notes, and subflow/branch actions. Below zoom (.65), title size is `clamp(24px, 14px / zoom, 34px)` with balanced two-line wrapping. Overview symbols grow to (40px) with (28px) icons; summary, executor, and note indicator hide. The footer and its grid row hide in overview. Clicking the card opens its full-sized inspector, including subflows and branches; direct card actions remain available at reading scale. Connector labels adapt to `clamp(18px, 12px / zoom, 30px)`. Loop captions retain `clamp(22px, 12px / zoom, 32px)` and hide the secondary instruction. The card remains (248 × 116px) in every mode. Selection uses blue plus `focus-ring` without recoloring executor identity; arbitrary-outline connection gestures preserve geometry.
- **Inspector:** Read first, edit explicitly. `GraphInspector.tsx` renders graph title, counts, Markdown goal/scope and constraints, with an explicit edit toggle and return-to-reading action. Edits call the existing revision-protected autosave; a conflict leaves the disabled editor visible, with no backend API change. Node Markdown, code, branches, and nested diagrams remain available outside the card. Editing focuses the title field; returning focuses the reader heading. Mobile opening focuses the panel and makes the canvas inert; closing restores focus.
- **Workspace copy:** Decorative header breadcrumbs, “图先行再实现”, the default footer instruction, and repeated local-file/approval authorization copy are removed. Lifecycle, save, and error feedback remain; authorization details appear only in the confirmation dialog. The graph-reader tutorial callout and artifact promotion are removed; quality warnings, full PNG export, and historical JSON/text/PNG downloads remain.
- **Edge routing:** An automatic detour that would run along a card's edge is re-routed to enter or leave through the side it arrives from; explicit anchors are untouched. Editor and export share this geometry.
- **Canvas controls:** Main/branch scope buttons use a soft segmented track with a gliding paper thumb and blue pressed text. The node dock separates creation from view controls. Reading and fitting are separate commands.
- **Dialogs:** Labeled modal surface, dimmed backdrop, scrollable `.modal-content` (34px padding; 30px 24px on mobile) and a separate, non-scrolling `.modal-actions` footer. The close control and primary action stay visible at short heights. Preserve initial/return focus. Tab cycles current enabled controls; shortcuts stop at the dialog. Busy state blocks close, Escape, and backdrop dismissal. Sidecar snippets illustrate appearance only; use `Dialog.tsx` for this behavior.

### Nested levels

`level-bar` is a floating `paper` breadcrumb with `shadow-float`, placed under the canvas toolbar. Group cards use `.is-group`: the 248×116 card plus two inset lower layers (`node-surface`, then `soft-surface`) that take `accent` when selected. `.reference-node` is a translucent dashed card with no filled icon tile and a blue jump label. `.is-drop-target` uses `accent-soft` with a 2px `accent` outline. `selection-bar` takes the dock's exact position and surface. The inspector outline uses 32px rows, 16px node icons and a 1px `line` guide per depth.

`level-map` is a 248px floating `paper` frame under `level-bar`, sharing its surface. Each row is one level, main flow first: a 72×50 thumbnail of that level's real geometry beside its name and position. Thumbnails use `accent` for the card leading to the next level, `flow-edge-main` for other group cards and a muted `flow-edge-support` for steps; the current row takes `accent-soft` and marks the selected card. Enclosing loops are context in the position text, not levels. The `第 N 层` toggle at the end of `level-bar` shows or hides the frame; the preference is remembered on desktop, and at ≤760px the frame starts closed and closes after a jump. Fitting a level shifts the graph clear of the frame only when they would overlap.

## Do's and Don'ts

### Do:
- Do keep blue selection distinct from executor and lifecycle color.
- Do preserve shared node geometry and provide 100% reading plus full inspector text.
- Do keep save and lifecycle state visible on narrow screens; keep authorization details in the confirmation dialog.
- Do retain keyboard focus, reduced-motion handling, and bundled fonts with system fallbacks.

### Don't:
- Don't restore the rejected navy navigation, repetitive instructional chrome, or executor-tinted cards.
- Don't treat fit-to-canvas text as the reading experience or reuse tiny metadata sizes for body copy.
- Don't load remote fonts, CDN assets, or external imagery for this workspace.
- Don't infer a passed design review or test run from this documentation.
