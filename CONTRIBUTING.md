# Developing Flowplan

[Back to README](README.md)

The source lives in `frontend/`. The distributable skill is `skills/diagram-plan/`, including the built web app and Python scripts. Development has been tested with Node.js 24 and Python 3.8 on macOS.

## Build and run

```sh
npm ci
npm run build

python3 skills/diagram-plan/scripts/diagram.py create \
  --project "$PWD" --title "Message processing" --mode agent \
  --graph "$PWD/examples/sample-flow.json"
```

The build writes to `skills/diagram-plan/web/`. Those assets are committed so people installing the skill don't need a JavaScript toolchain. Rebuild them whenever you change the frontend.

`npm run dev` starts a frontend-only Vite server. Use the Python-served build to test the complete editing, approval, and export flow; the Vite server has no backend proxy.

## Tests

```sh
npm test
```

This runs the graph model tests and Python backend tests. They cover revision conflicts, immutable snapshots, PNG validation, filesystem boundaries, and server lifecycle behavior.

The browser smoke test needs [agent-browser](https://github.com/vercel-labs/agent-browser) and its browser installed:

```sh
npm run build
npm run test:browser
npm run test:connections
npm run test:ui
```

It uses a temporary project to exercise drawing, connections, autosave, undo/redo, feedback, agent revision, approval, history, cancellation, restart, and conflicting edits. It also checks that the app loads no external resources. Artifacts are saved to the ignored `.test-artifacts/browser-smoke/` directory.

The connection smoke test checks arbitrary card-outline endpoints, reconnection, cancellation, persistence, nested tangent loops and shared-node dragging. It also uses an isolated temporary project; screenshots and complete PNG exports go to `.test-artifacts/connection-smoke/`.

The UI smoke test covers search, dialog focus and dismissal, navigation at five viewport widths, mobile dialog bounds, readable canvas zoom, persistent save status, stable dock hit areas, scope keyboard controls and atmospheric materials. Aurora checks cover bounded draw rate, pointer/wheel/edit/modal pause, persistent user control, real context loss and simulated GPU initialization failure; mobile and reduced-motion modes must allocate no background canvas. Each case starts an independent browser against a temporary project. Type checks assert the 13/14/16/20px roles, loaded same-origin Noto Sans SC subsets and 320px toolbar wrapping. Reduced motion is required, not skipped: startup checks use Chromium's `--force-prefers-reduced-motion`; live preference changes use the test-only `tools/emulate_reduced_motion.mjs` CDP bridge because the installed CLI's `set media` does not apply the preference. The live check also verifies that editing focus survives and hover springs resume when motion is re-enabled.

The interface uses `@fontsource-variable/noto-sans-sc` with bundled Unicode-range WOFF2 assets and visible system fallbacks. Do not replace this with a runtime font CDN. PNG export waits for layout/fonts and embeds only already-loaded subsets using `fontEmbedding.ts`; keep this path when changing fonts, and test real exported images rather than only screenshots. `exportLayout.ts` freezes the live note-column assignment before serialization to prevent CSS multicolumn overflow in the PNG; keep all note cards in the image. Browser smoke records actual embedded font rules and fixed-column/all-note evidence.

The visual system is documented in `DESIGN.md`, with implementation tokens in `frontend/src/tokens.css`. Development screenshots live in the ignored `.impeccable/review/` directory.

## Package the skill

```sh
npm run release
npm run test:release
```

Packaging builds the frontend, collects dependency and application-adapted source license texts, and writes a ZIP and SHA-256 file under `release/`. It does not upload a GitHub release. The release smoke test extracts that ZIP and checks startup, bundled assets, persistence, and restart with an empty `PATH`, so Node and npm cannot be used at runtime.

## Changes to the workflow

Read [docs/protocol.md](docs/protocol.md) before changing persistence, the CLI, or HTTP endpoints. Keep the [skill instructions](skills/diagram-plan/SKILL.md) and [references](skills/diagram-plan/references/cli.md) consistent with the implementation.

For UI changes, include a screenshot and inspect a real PNG export. A viewport screenshot is not enough: the export must include off-screen nodes, notes, tables, and constraints. Test a graph with a branch or retry loop, not just a straight line.

For persistence changes, add regression tests for failed writes, stale revisions, and recovery. Approval must only become visible after all required artifacts have been written. Never overwrite an approved snapshot to fix a newer draft.

Use synthetic data in screenshots and examples. Keep local task state, browser session URLs, and test artifacts out of commits.

## Dependencies and credits

The editor uses React Flow, Dagre, html-to-image, Phosphor icons, Motion and locally bundled Noto Sans SC Variable (SIL OFL-1.1). The UI adapts [React Bits](https://reactbits.dev) Dock, RubberSegment, Aurora, SpotlightCard and GlareHover; provenance and changes are documented in `frontend/src/ui/reactbits/README.md`. Diagram conventions are informed by [diagram-design](https://github.com/cathrynlavery/diagram-design).

Original project code is licensed under [MIT](LICENSE). Third-party code retains its own terms: the React Bits adaptations are **MIT + Commons Clause**, not plain MIT. The additional atmospheric components use native WebGL2/CSS and add no npm dependencies. Their full upstream license is in `skills/diagram-plan/licenses/react-bits-LICENSE.md`. Packaging copies the root `LICENSE` into the skill directory and regenerates `THIRD_PARTY_NOTICES.md` from bundled dependencies and retained source licenses; both the notices and license directory ship in the ZIP.
