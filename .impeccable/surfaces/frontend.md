---
version: 1
slug: "frontend"
primary_target: "frontend"
related_targets: []
---

# Flowplan workspace

Scope: frontend/. Mode: Operate. Desktop-first local planning editor, usable on narrow viewports. User confirmed capability/interface preservation; the current refinement follows their explicit rejection of navy navigation and repetitive copy.

## Direction contract

THESIS: A precise plan-review workspace: the graph is the working document, not an illustration below marketing copy. Replace the washed-out sage interface and oversized instruction chrome.

OWN-WORLD: Architectural review-set discipline translated into a familiar web editor: pale-gray navigation with a right separator, cool-white work surface, blue selection and primary actions, restrained teal/amber/purple executor and state coding. Self-hosted Noto Sans SC Variable typography with 13px metadata, 14px UI, 16px body, 20px document titles and 22px reader headings; 7px button, 8px field, and 10px node corners. Bundled Phosphor icons and the separate routed-F brand mark carry identity without decorative imagery.

STORY: Find a plan, understand its main flow, inspect or edit a node, then return feedback or approve a frozen version. Preserve all existing workflow protections.

FIRST VIEWPORT: 232px pale-gray navigation with searchable plans; a 72px-minimum document header and review footer; dominant pale dotted canvas; a 380px white inspector. At ≤1280px, navigation/inspector narrow to 212px/336px; at ≤1100px the inspector overlays at 380px. The flush full-width canvas toolbar has a 56px minimum height, aligned with the inspector tabs; creation tools remain in a floating bottom dock. Mobile toolbar stays in one row above 350px, permitting two rows on very narrow screens rather than shrinking text, with icon-only layout, compact “主线” / “含分支” scope controls, and explicit “100% 阅读”; header/footer minima become 76px/92px. Signature interaction: node selection and its reader form a linked blue focus state; panel entry is a 220ms horizontal settle. Ordinary selection does not recenter; canvas resizing preserves zoom and the centered graph point rather than refitting. Navigation and inspector become dismissible overlays on narrow screens.

FORM: Candidate 4, architectural review sets, seed:9ddee78a6c5c52ff. Considered sources: Swiss wayfinding, industrial manuals, geological map legends, architectural review sets, release publications, transit timetables, scientific annotations. The original direction was delegated; the user's later rejection of navy navigation supersedes that palette choice. Challenger verdicts: split-flap declined (retain stable change placement); airport wayfinding declined (retain state legibility); catalog sleeve declined (retain disciplined identification); Japanese density competitive for compact controls only, not tiny text; boarding-pass board declined (retain persistent update status); reference setting declined (retain reading measure). Mode constraints keep all navigation and controls conventional. Raise: separate state meaning from ornamental color, reserve density for controls, preserve spatial continuity on selection.

FINISH: This records implemented refinement, not a completed review or scope-wide shipping verdict. Current typography/icon captures belong in `.impeccable/review/type-icons/`; earlier atmosphere/motion captures are historical. Actual source remains the authority; actual-render review remains separate.

## Implementation boundaries

Navigation uses `nav #f8f9fc`, `nav-raised #edf0f6`, `nav-ink #344158`, and `nav-muted #647086` (matching the existing muted token). Active rows retain `accent-soft` fill and `accent-hover` text on hover without a frame; task-row focus outlines use a -2px offset to avoid scroll-container clipping. Rows are single-line by default, minimum 44px; draft metadata and timestamps are removed from the visible list, while full title/status/time remain in each row's `title` and non-draft statuses remain visible. The 26px brand tile and 20px wordmark sit in a 72px row aligned with the desktop header. Sidebar content is limited to brand, search, new-flow action, flow list, and shortcuts; the fake workspace card and local-file footer are removed.

Decorative header breadcrumbs, “图先行再实现”, the default footer instruction, and repeated local-file/approval authorization copy are removed. Lifecycle, save, and error feedback remain; authorization details appear only in the confirmation dialog. Graph-reader tutorial and artifact promotional copy are removed, while quality warnings, full PNG export, and historical JSON/text/PNG downloads remain. Graph geometry and viewport behavior remain unchanged; the current typography pass replaces the previous platform-dependent font stack. The dock now supplies bounded icon-only proximity feedback without changing its footprint.

No node dimension or backend API changes. Use bundled Noto Sans SC Variable (SIL OFL-1.1, Unicode-range WOFF2 subsets, font-display swap, system fallbacks) and consistent Phosphor regular linear icons (bold only on zoom-scaled graph cards): 20px standalone controls, 18px inline/tab/nav, 16px status, 14px graph metadata, 22px palette and 20px node symbols. Central `NODE_ICONS`: start `Play`, step `List`, decision `GitFork`, end `CheckCircle`; group `StackSimple`. Shortcuts use Command, the atmosphere control SunDim and fit CornersOut. The export pipeline embeds only loaded font subsets, never the entire font catalogue or remote resources. The routed-F brand mark is separate from node icons; no shipping raster imagery is needed.

Cards retain 248×116 geometry: main row / symbol / copy, optional summary, and a separate footer. At zoom <.65, overview titles use `clamp(24px, 14px / zoom, 34px)` with balanced wrapping. Summary, metadata, and footer hide; selecting the whole card opens full-sized subflow/branch actions in the reader. Direct card actions remain available at reading scale. Overview symbols are 40px with 28px icons. Full reading stays in 100% view and the inspector.

Graph-level description and constraints now read as Markdown by default. Explicit editing and return-to-reading use the existing revision-protected autosave; conflict-disabled editing stays visible. Dialogs separate scrollable content from a persistent action footer; short-height layouts omit the icon and shorten textareas so the action stays visible. Preserve modal focus, mobile navigation, lifecycle protection, and export geometry. The minimap receives explicit 112×72 dimensions so its SVG and container agree.

## Nested levels

Subflows are worked on the main canvas, one level at a time, never in a scaled preview: double-click, **进入** or Enter goes in; `Esc`, the up arrow or a breadcrumb crumb comes back and restores that level's viewport. The floating `level-bar` sits under the toolbar and collapses middle crumbs past three levels. With nothing selected inside a level, the inspector describes that level. `GroupPanel` replaces the mini diagram for groups with a readable outline and boundary connections; branch diagrams stay in the inspector. Group cards keep 248×116 with a two-layer stacked lower edge and a step count instead of an executor; external references are dashed, cannot be dragged, and jump on click. Multi-selection swaps the dock for `selection-bar` in the same place. New groups open with the name focused. The level change is a single 240ms scale/fade from the entered card, removed under reduced motion. `FlowScope` hides inside a level because every level shows all of its items.

## Direct authoring

Everything an agent can write has a direct path. The dock's label states what it will do: `添加节点`, `接在 X 后` (connected to the selected card) or `插入到连线` (splits the selected edge). New nodes and groups open with their name selected. `Esc` in a field blurs it first. Loops form from a selection along its real edges and never invent a connection silently: the closing edge is named on the action. Multi-selection adds `组成循环` and a role select to `selection-bar`.

## Interaction motion

Bundled Motion powers two local React Bits adaptations: Dock's cosine-squared proximity, limited to icon scale 1–1.22 and 0–4px lift; and RubberSegment's independently clipped thumb edges, reduced to a 260ms non-bouncy controlled scope switch with a 25ms trailing-edge handoff. No AnimatedList, scope dragging/momentum or graph-node choreography. The user's later request explicitly adds decorative backgrounds; the earlier no-background restriction is superseded for the canvas only. Labels and hit areas stay fixed; touch/narrow screens keep the dock static. Native buttons retain keyboard actions.

Shared task/tab indicators preserve selection continuity. Panel, reader-context and dialog entrances take 220ms, with content visible immediately; reader identity excludes edit/revision changes. The drawer closes over 220ms while becoming inert immediately. No delayed dialog exit or focus retention. A subscribed reduced-motion hook handles live preference changes; static replacements, direct jumps, zero-duration transitions and CSS interruption protect both initial and in-flight states. Application-adapted source retains MIT + Commons Clause text in release notices and `licenses/`.

Three additional React Bits adaptations now form the material layer: Aurora's native-WebGL2 light-mode shader behind the canvas, SpotlightCard's local radial/rim response on the dock and empty state, and GlareHover's one-shot sheen on native primary buttons. No extra npm dependencies. Aurora uses a slow blue/teal palette, a 30fps draw cap, DPR ≤1 and width ≤1280px. A persistent sun-button preference lets users pause it. It stops for canvas pointer/wheel interactions, typing, dialogs, busy state and hidden/offscreen pages. Mobile/coarse/reduced-motion/user-disabled modes allocate no WebGL; failed initialization/context loss retains a static CSS fallback. Navigation, reader surfaces, node geometry and exports remain unchanged.

Verification targets remain 1440×900, 1280×800 and 390×844 plus workflows and PNG exports. `test:ui` now requires actual reduced-motion matching at browser launch and in-session through a test-only CDP bridge, rather than silently skipping unsupported CLI emulation. See the separate typography/icon review summary for results and hardware/keyboard limitations.
