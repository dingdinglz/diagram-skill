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
```

It uses a temporary project to exercise drawing, connections, autosave, undo/redo, feedback, agent revision, approval, history, cancellation, restart, and conflicting edits. It also checks that the app loads no external resources. Artifacts are saved to the ignored `.test-artifacts/browser-smoke/` directory.

## Package the skill

```sh
npm run release
npm run test:release
```

Packaging builds the frontend, collects dependency license texts, and writes a ZIP and SHA-256 file under `release/`. It does not upload a GitHub release. The release smoke test extracts that ZIP and checks startup, bundled assets, persistence, and restart with an empty `PATH`, so Node and npm cannot be used at runtime.

## Changes to the workflow

Read [docs/protocol.md](docs/protocol.md) before changing persistence, the CLI, or HTTP endpoints. Keep the [skill instructions](skills/diagram-plan/SKILL.md) and [references](skills/diagram-plan/references/cli.md) consistent with the implementation.

For UI changes, include a screenshot and inspect a real PNG export. A viewport screenshot is not enough: the export must include off-screen nodes, notes, tables, and constraints. Test a graph with a branch or retry loop, not just a straight line.

For persistence changes, add regression tests for failed writes, stale revisions, and recovery. Approval must only become visible after all required artifacts have been written. Never overwrite an approved snapshot to fix a newer draft.

Use synthetic data in screenshots and examples. Keep local task state, browser session URLs, and test artifacts out of commits.

## Dependencies and credits

The editor uses React Flow, Dagre, and html-to-image. Diagram conventions are informed by [diagram-design](https://github.com/cathrynlavery/diagram-design).

`skills/diagram-plan/THIRD_PARTY_NOTICES.md` is generated from installed dependencies during packaging. Dependency licenses do not establish a license for this repository's own code.
