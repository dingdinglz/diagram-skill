# Python CLI reference

The entry point is `scripts/diagram.py`, resolved relative to the directory containing `SKILL.md`. Python 3.8+ standard library and bundled `web/` are the runtime; Node.js is only for source development/building. No MCP server, CDN, or API key is needed to open or edit a diagram.

## Resolve two different paths

```sh
# Set these to actual absolute paths before running commands.
SKILL_DIR="/absolute/path/to/installed/diagram-plan"
PROJECT="/absolute/path/to/users/actual-workspace"
SCRIPT="$SKILL_DIR/scripts/diagram.py"
```

`SKILL_DIR` is where the code/assets are installed. `PROJECT` is where the user's task belongs and `.diagram-skill/` is stored. They are not interchangeable. Pass `--project "$PROJECT"` explicitly on each command even though the CLI defaults to the current working directory. Quote all filesystem paths. Obtain IDs, revisions, version IDs, and request IDs from actual CLI output; do not guess them.

## Commands

```sh
# Start/reuse one loopback server for this project and open the task list.
python3 "$SCRIPT" start --project "$PROJECT"

# Suppress automatic browser opening; still prints a private browser URL.
python3 "$SCRIPT" start --project "$PROJECT" --port 0 --no-open

# Manual blank graph. create auto-starts the server and opens the task.
python3 "$SCRIPT" create --project "$PROJECT" --title "Message behavior" --mode manual

# Validate a locally saved canonical Graph, then create an agent draft.
python3 "$SCRIPT" validate --project "$PROJECT" "$GRAPH_FILE"
python3 "$SCRIPT" create --project "$PROJECT" --title "Message behavior" \
  --mode agent --graph "$GRAPH_FILE" --no-open

python3 "$SCRIPT" list --project "$PROJECT"
python3 "$SCRIPT" show --project "$PROJECT" --task "$TASK_ID"

# Bounded polling: never interpret timeout/pending as approval.
python3 "$SCRIPT" wait --project "$PROJECT" --task "$TASK_ID" --timeout 25

# Only in awaiting_agent, with the exact revision and request ID just inspected.
python3 "$SCRIPT" revise --project "$PROJECT" --task "$TASK_ID" \
  --revision "$REVISION" --request-id "$REQUEST_ID" --graph "$GRAPH_FILE"

# Locate immutable artifacts; does not render a new image.
python3 "$SCRIPT" export --project "$PROJECT" --task "$TASK_ID"
python3 "$SCRIPT" export --project "$PROJECT" --task "$TASK_ID" --version "$VERSION_ID"

# Shut down only this project's matching server; leave tasks/history intact.
python3 "$SCRIPT" stop --project "$PROJECT"
```

`serve --project "$PROJECT" [--port 0]` is the internal foreground entry point. Prefer `start` for normal detached operation. Port `0` asks the OS for an available port; do not invent a fixed browser address or bind to a public interface.

There is **no `open` subcommand**. `start` opens the project's task list; select an existing task there. `create` opens the newly created task. With `--no-open`, open the exact returned URL manually. There are also no CLI `approve`, `submit`, `resume`, `cancel`, or `restore` subcommands in this protocol: use the browser actions, including its real PNG rendering for submit/approve/checkpoint.

## Results and recovery

- `start` prints JSON containing the session URL. `create` prints the task and a task-specific URL. URLs have fragment credentials; do not tee their output into project logs, attach it to issues, or put it into snapshots. Share only with the local user who is opening the editor.
- `list` returns summaries; `show` returns complete task state. Approval decisions need full state, not a guessed status from the browser tab's title.
- `wait` returns when status is `awaiting_agent`, `approved`, or `cancelled`. Its handoff result includes status, request ID, revision, feedback, and artifact paths where available. A timeout is structured pending output. Read returned data, not just process exit code.
- If the host tool times out before returning CLI output, ask the user to continue later and use `show` to recover. Do not launch an endless background wait or promise that submission automatically resumes the agent.
- `revise` is a complete graph replacement with optimistic concurrency, not a patch. A stale revision/request ID is an error: re-read state and reconcile without discarding user changes.
- `export` defaults to the latest handoff/approved snapshot or latest snapshot when appropriate, and explicitly reports missing PNG. For implementation always choose the explicit current `approvedVersion`. For feedback, verify that the selected handoff matches the request/revision being handled.
- `validate` checks the file without requiring a server. It checks graph shape and limits; browser approval also enforces the additional approval requirements. Errors are not permission to omit required graph fields or silently truncate notes.
- On invalid JSON, validation failure, missing web assets, permission problems, PNG export failure, or stale/conflicting state, report the specific blocker and preserve the draft. Do not claim the operation succeeded.

Read [history.md](history.md) for durable version/state rules and [graph-schema.md](graph-schema.md) for graph fields.

## Local HTTP boundary

The CLI and browser use a loopback-only Python server. API calls require the session bearer token except `/api/health`, which exposes only health/protocol information. The browser receives the token in the URL fragment, stores it in session storage, and removes it from the visible URL. Strict Host and mutation Origin validation and same-origin UI/API are intentional; do not weaken them to fix a browser problem.

No API accepts arbitrary filesystem paths or executes user commands. The CLI's `--graph` reads a local input file and sends validated graph content; it does not expose a general remote file reader. The server confines stored tasks to the actual project, validates identifiers, protects transactions, and bounds bodies/PNG. These controls protect the local app, not the entire agent host or other tools.
