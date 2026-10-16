# Diagram Plan implementation contract

The release is a portable skill in `skills/diagram-plan/`, containing SKILL.md, Python stdlib scripts, references and a prebuilt `web/` app. Frontend source is `frontend/`. Python 3.8+ is available in the development environment. First release supports macOS/Linux (POSIX file locking, not native Windows). No Node, network, CDN, MCP or model credentials are needed at runtime. Bind to loopback only.

## Graph (canonical editable data)

```json
{
  "schemaVersion": 1,
  "title": "A task",
  "description": "What this change is intended to accomplish",
  "constraints": "Requirements and acceptance criteria (Markdown)",
  "nodes": [{
    "id": "step-1",
    "type": "step",
    "position": {"x": 100, "y": 80},
    "data": {
      "label": "Validate input",
      "notes": "Markdown: descriptions, tables, code and constraints",
      "executor": "program",
      "expanded": false
    }
  }],
  "edges": [{"id": "edge-1", "source": "step-1", "target": "step-2", "label": "valid", "sourceHandle": "bottom", "targetHandle": "top"}]
}
```

Node types: `start`, `step`, `decision`, `end`. Executor: `program`, `llm`, `human`. Notes default empty, executor defaults program, expanded defaults false; title/description/constraints default to empty strings where appropriate. Only explicit graph fields persist; React Flow internal measurements/selection do not. Node/edge IDs are unique nonempty strings; validate lengths, finite positions, endpoint references, types, text, size limits. Edges have source handles bottom/left/right and target handles top/left-in/right-in (optional handles default bottom/top). Duplicate IDs and dangling edges are errors. Graph title required for approval. Approval requires at least one node, nonempty node labels, and each decision to have at least two outgoing edges with nonempty condition labels. Drafts can be incomplete. PNG must be a valid bounded PNG, not an arbitrary base64 string.

Markdown is derived, never a second writable source. No raw HTML, remote images or arbitrary embedded resources. Export PNG from dedicated browser-rendered main/branch/subflow diagrams followed by complete node notes and graph description/constraints, independent of viewport or current inspector selection.

## State

```text
Task = {
 id, mode: manual|agent,
 status: draft|awaiting_agent|approved|cancelled,
 revision: integer,
 graph: Graph,
 feedback: string,
 requestId: string|null,
 approvedVersion: string|null,
 createdAt, updatedAt,
 versions: [{id, kind, createdAt, revision, feedback, hasPng, title}]
}
```

All mutations require `revision` equal to current revision, then increment it; conflict = HTTP 409 and must never overwrite unsaved changes. `create` starts revision 1 with an initial immutable JSON/MD snapshot (PNG can be absent until browser handoff). Browser autosaves draft graph. Submit/approve/checkpoint atomically accept current graph + its rendered PNG and save immutable version (diagram.json, diagram.md, diagram.png, metadata.json) before publishing task state. Submit requires nonblank feedback, creates a fresh requestId and enters awaiting_agent. Revise requires BOTH matching requestId and revision, records agent_revision JSON/MD snapshot, clears requestId and enters draft. Agent revises graph but does not fabricate a PNG. Cancel/resume invalidates any requestId. Restore copies any historical graph to a NEW draft and records restore snapshot; approved snapshots never mutate. Keep all earlier versions.

`cancel` preserves current graph, enters cancelled; cannot cancel approved task. `resume` allowed only from cancelled/awaiting_agent -> draft. To edit an approved task use restore with its approvedVersion. Agent code must not start implementing until approved; this is a skill protocol, not a universal host permission sandbox.

## HTTP

Authorization: `Authorization: Bearer <random session token>` on every /api request except /api/health. UI receives token via URL fragment, stores in sessionStorage and removes it from visible URL. Strict Host validation and Origin validation on mutations; no permissive CORS. Static paths confined to bundled web directory. Body/PNG limits, atomic writes, thread/process concurrency protection, token file permissions, CSP and no-referrer. All JSON errors `{error: string, code?: string, details?: ...}`.

- GET /api/health -> {ok:true, protocol:1} (public, no project data)
- GET /api/tasks -> task summary array (id,title,status,revision,updatedAt,mode)
- POST /api/tasks {title, mode, graph?} -> Task
- GET /api/tasks/{id} -> Task
- PUT /api/tasks/{id}/draft {revision, graph} -> Task (draft only)
- POST /api/tasks/{id}/checkpoint {revision, graph, png} -> Task (draft only)
- POST /api/tasks/{id}/submit {revision, graph, png, feedback} -> Task (draft only)
- POST /api/tasks/{id}/approve {revision, graph, png} -> Task (draft only)
- POST /api/tasks/{id}/cancel {revision, graph?} -> Task (draft or awaiting_agent)
- POST /api/tasks/{id}/resume {revision} -> Task (awaiting_agent or cancelled)
- POST /api/tasks/{id}/restore {revision, versionId} -> Task (any status, copies version into new draft, invalidates requestId)
- POST /api/tasks/{id}/revise {revision, requestId, graph} -> Task (awaiting_agent only)
- GET /api/tasks/{id}/versions/{versionId} -> {metadata fields..., graph}
- GET /api/tasks/{id}/versions/{versionId}/diagram.json|diagram.md|diagram.png -> bytes (authorized downloads)

`png` is a `data:image/png;base64,...` string. No API accepts arbitrary filesystem paths. No API executes user commands. API and UI share same origin; polling is sufficient (no websocket dependencies).

## Local storage

`<project>/.diagram-skill/tasks/<id>/state.json`, `versions/<version-id>/{diagram.json,diagram.md,diagram.png?,metadata.json}`. Session descriptor `<project>/.diagram-skill/server.json` (private token + pid + port). Single server per project; stale descriptors handled safely. Never access task/version paths containing traversal or follow symlinks outside the workspace. Durable writes use temp files + atomic rename; use a lock for each transaction. Approval artifacts must be durable before approved state. A partially written/orphan snapshot must never be advertised as approved.

## CLI (scripts/diagram.py)

Each subcommand accepts `--project PATH` (defaults cwd), where applicable:

- `start [--port 0] [--no-open]`: start/reuse detached server, print JSON URL; default opens browser.
- `serve [--port 0]`: internal foreground server entry point.
- `create --title TEXT [--mode manual|agent] [--graph FILE] [--no-open]`: auto-start server, create task, print task and URL including fragment token and task ID; open unless --no-open.
- `list`: summaries.
- `show --task ID`: full state.
- `wait --task ID [--timeout 25]`: bounded polling until awaiting_agent/approved/cancelled. Prints status, requestId, revision, feedback and handoff artifact paths where available; timeout returns a structured pending result, not authorization to proceed.
- `revise --task ID --revision N --request-id ID --graph FILE`: apply requested agent changes, optimistic concurrency.
- `export --task ID [--version ID]`: print selected immutable snapshot's artifact paths; default latest handoff/approved or latest snapshot, explicitly report absent PNG.
- `validate FILE`: validate graph, output useful errors without requiring a server.
- `stop`: gracefully shut down ONLY the matching project's server, without killing an unrelated PID. Implement via authenticated endpoint if appropriate (backend-only /api/shutdown).

CLI reads/wait/export/revise use the same confined Store and cross-process transaction lock as HTTP, and work without a running renderer/server. Startup/creation/shutdown use authenticated server coordination. CLI JSON output must not leak credentials into artifacts or log files. Browser PNG generation is required for submit/approve/checkpoint; initial/agent_revision/restore snapshots may lack PNG because no renderer is running. Browser failure to produce PNG means no handoff/approval and preserves draft.

## Version 2 presentation

Graph v2 adds node summaries, main/support/exception roles on nodes and edges, and validated hierarchical loop/subflow/branch groups. The exact format is maintained in [the graph schema](../skills/diagram-plan/references/graph-schema.md). HTTP task states, revision/request checks, immutable snapshots and PNG limits remain unchanged. Validation and derived Markdown support both graph versions. Read-only UI preferences remain separate from canonical data.
