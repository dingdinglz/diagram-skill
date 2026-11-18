# `all`: draw the project's current core workflows

This is a skill argument, not a Python subcommand. It works on first use: no previous task, graph, or running server is required. Use the resolved `PROJECT` and `SCRIPT` from SKILL.md. The deliverable is documentation of current behavior, not a proposal to change it.

## Discover what to draw

1. Inspect the project read-only. Start with its README and manifests to identify first-party apps and services. Find their actual entry points (e.g. user actions, public APIs, CLI commands, scheduled jobs or event consumers). Skip dependencies, build outputs, secrets and the skill's own stored tasks as sources of project behavior.
2. Inventory distinct core journeys by **trigger → observable outcome**. Trace each through the handlers and state changes that implement it; check relevant tests for decisions, failures and retries. Combine entry points that implement the same journey, but don't sample just the first few routes or draw a directory tree. If the repository has only requirements, ask whether to diagram the intended behavior; if it has neither requirements nor code, ask for the core use cases rather than inventing flows.
3. For each evidenced journey, prepare one editable Graph v2 following [graph-schema.md](graph-schema.md), [design.md](design.md) and [writing.md](writing.md). Use subflows for detail and labelled branches for real alternatives. Give each graph a distinctive action title and cite the relevant project-relative paths and symbols in its notes. Mark unknown external behavior as a boundary, not a guessed implementation. Reconcile the graphs with the inventory; report anything unverified or not covered.

## Publish the diagrams

Use `list --project "$PROJECT"` before creating drafts. On a repeat or interrupted run, check likely matches with `show`; retain existing diagrams and user edits, create only missing flows, and ask before replacing or duplicating an existing map.

For each new flow, write its graph to a separate local planning file. Use the existing CLI, with the title and file for that flow:

```sh
python3 "$SCRIPT" validate --project "$PROJECT" "$GRAPH_FILE" &&
  python3 "$SCRIPT" create --project "$PROJECT" --mode agent --no-open \
    --title "$FLOW_TITLE" --graph "$GRAPH_FILE"
```

Keep the returned task IDs. Open the workspace **once** with `start --project "$PROJECT"`, so the user can switch between the flows in the sidebar. Return a short index of titles, task IDs and any coverage gaps. On partial failure, distinguish saved tasks from unfinished flows. Keep session URLs private as in SKILL.md.

Stop after delivering the diagrams. The user can submit feedback on an individual flow using the normal revision protocol. For `all`, approval records that the diagram was reviewed; it does not request implementation or authorize project source changes.
