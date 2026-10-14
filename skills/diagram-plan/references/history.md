# Task state, handoffs, and history

Read when waiting, revising, implementing an approved plan, or recovering an interrupted session.

## State is authoritative

A task has `id`, `mode` (`manual`/`agent`), `status`, integer `revision`, canonical `graph`, `feedback`, `requestId`, `approvedVersion`, timestamps, and a `versions` summary list. `requestId` and `approvedVersion` can be `null`. Mode records how the task began; it is not approval or a restriction on who may later edit.

| Action | Required state | Result |
| --- | --- | --- |
| Create | New task | `draft`, revision 1; initial immutable JSON/Markdown snapshot. |
| Autosave draft | `draft` | Saves editable graph and advances revision; not approval. |
| Checkpoint | `draft` | Saves current graph and browser-rendered PNG as an immutable version; remains draft. |
| Submit feedback | `draft` | Requires nonblank feedback and current graph + PNG; enters `awaiting_agent` with a fresh `requestId`. |
| Agent revise | `awaiting_agent` | Requires matching revision **and** request ID; records `agent_revision`, clears request ID, enters `draft`. |
| Approve | `draft` | Validates approval requirements; saves graph + PNG durably before publishing `approved` and `approvedVersion`. |
| Cancel | `draft` or `awaiting_agent` | Preserves current graph, invalidates request ID, enters `cancelled`. Cannot cancel an approved task. |
| Resume | `cancelled` or `awaiting_agent` | Invalidates any outstanding request ID and returns to `draft`. |
| Restore a version | Any state | Copies that historical graph into a **new draft of the same task**, invalidates request ID, records a restore snapshot. |

Every mutation supplies the current revision and increments it on success. HTTP 409 means a conflict; it never authorizes overwriting newer state or unsaved browser edits. A feedback request is single-use. A new submission, resume, cancel, or restore can make a remembered request stale.

## Awaiting an agent revision

1. Run `show` and require `awaiting_agent`. Keep the exact task ID, revision, and request ID together.
2. Use `wait`/`export` to locate the current immutable handoff artifacts; compare the selected version's metadata/revision with the current handoff. Read feedback, JSON, derived Markdown, and PNG. Do not work from an old local graph file.
3. Change only what feedback requires, retaining the user's structure/layout and unaffected IDs/fields.
4. Submit the complete graph through `revise --revision … --request-id …`. The backend, not the agent's timing assumptions, checks concurrency.
5. If anything changed in the meantime, fetch state again. Do not automatically substitute a newer revision into an old proposal. Stop on cancellation/approval; on a new request, read that new handoff and reconcile anew.

Only a browser can supply this workflow's rendered handoff PNG. The agent-revision snapshot legitimately has JSON/Markdown without PNG. The user must review the returned draft and submit/approve it through the browser to produce a new visual handoff.

## Approval and version selection

Do not implement while status is `draft`, `awaiting_agent`, or `cancelled`. When status becomes `approved`, obtain `approvedVersion`, export **that explicit version**, and read its JSON, Markdown, and PNG before coding. Confirm status/version have not changed before beginning. An old approved version is not authority to implement a newer restored draft.

Snapshots are immutable. A correction to an approved plan requires restore → edit → fresh approval, not editing files under `versions/`. Approval artifacts are written before the task is marked approved; a partial/orphan snapshot is not approval. Missing or unreadable required artifacts are blockers to investigate, not permission to reconstruct them from memory.

## Local files

```text
<project>/.diagram-skill/
  server.json                         # private session descriptor, token, PID, port
  tasks/<task-id>/
    state.json                        # current mutable task state
    versions/<version-id>/
      diagram.json                    # canonical graph at this version
      diagram.md                      # derived, not separately editable
      diagram.png                     # present for browser handoffs/checkpoints
      metadata.json                   # version identity and metadata
```

Creation, agent revisions, and restores may omit PNG. Submit, checkpoint, and approval require PNG. `export` reports absent PNG explicitly; do not make a placeholder image to fill the gap. `versions` summaries include `id`, `kind`, `createdAt`, `revision`, `feedback`, `hasPng`, and `title`.

Keep earlier versions. Removing text from the current graph does not erase it from history. Do not manually modify `state.json`, inject approval flags, edit snapshot files, traverse to other projects, or bypass the API's locking with direct writes. Graph proposal files are separate inputs to the CLI, not hand-edited task state.

## Interrupted sessions and privacy

- `wait --timeout 25` returns a structured pending result when nothing terminal/handoff-ready happens. A host tool timeout may prevent seeing that result; either case leaves approval unproven.
- Tell the user the task ID and how to reopen it. Ask for a follow-up after submission/approval. There is no portable guarantee of automatic agent wake-up from browser events.
- Resume the agent conversation with `show` (and bounded `wait` if needed). This is distinct from the browser's **resume task** action, which invalidates a pending request.
- Closing a browser tab does not cancel, approve, or discard a task. Reopen with `start`, select the task, and inspect its current state.
- `stop` stops the matching project's local server; it does not delete history. Restart via `start` when needed. Treat freshly returned fragment URLs as private; old session URLs may no longer authenticate.
- Keep `.diagram-skill/` out of Git and shared logs. Files are local, not encrypted; normal OS access, backups, and a host agent's model/data policy still apply. Do not share `server.json` or token-bearing URLs.
