# Designing a behavior flow

Read before generating the first graph. Revisit when a user requests a structural change; do not apply a fresh layout to every revision.

## Choose the right subject

A useful plan answers: what starts the behavior, what happens next, where a choice is made, and how the task ends. Follow an actual event or user's action through the system.

- Prefer “Receive message → Normalize fields → Valid? → Process → Publish result”.
- Avoid replacing the flow with directories, framework layers, a list of modules, or “write code → run tests → deploy”. Those describe implementation work rather than the behavior under review.
- Include boundaries that matter: an external input, durable write, human decision, model call, or externally visible result.
- Keep incidental implementation details in notes. Split a node only when doing so exposes a meaningful action, decision, or responsibility.
- Read relevant existing code before proposing an agent-generated flow. Distinguish observed behavior, requested changes, and unresolved requirements; ask only material questions the available context cannot answer.

Manual mode starts blank. Do not insert this example or silently replace the user's own drawing with your preferred flow.

## Labels, conditions, and notes

Use short verb phrases for actions and a concrete question for a decision. A label such as “Handle request” is usually too vague if several different outcomes matter. Start and end labels should identify the triggering event and final outcome.

Each decision needs at least two outgoing, condition-labelled edges before approval. State “valid / invalid”, “found / missing”, or actual thresholds instead of unexplained colors. Give failure branches a destination. A loop must say when it repeats and when it stops.

Use `executor` to communicate responsibility:

- `program`: deterministic application behavior or automation.
- `llm`: an intended model-assisted task; document expected inputs, output shape, and validation/fallback.
- `human`: a person must review or act; document what they see and what their choice changes.

These are labels, not requests to install a model provider or grant the agent new permissions. The diagram editor itself does not execute nodes.

Notes should supply only useful implementation context:

| Detail | Useful question |
| --- | --- |
| Input/output | What data crosses this step's boundary? |
| Rules | What must always hold; what is rejected? |
| Failure | Where does the next action go on failure? |
| Acceptance | How can someone tell the behavior is correct? |
| Example | Would a small table or code block remove ambiguity? |

Put task-wide scope and acceptance criteria in graph `description`/`constraints`; put local rules on the relevant node. Keep examples synthetic. A fenced code block is documentation, not an instruction to execute it.

## Initial layout

1. Use a top-to-bottom main path and align its nodes around one column.
2. Place alternative/error paths in a separate side column. Use side handles (`left`/`right`, `left-in`/`right-in`) when they clarify routing.
3. For collapsed nodes, start with roughly 160–190px between node tops (around 210px after a decision), and 350–420px between branch columns. Do not reserve the full note height in the main flow: export puts complete notes in a separate, nonoverlapping appendix. If the user expands notes on the canvas, they may explicitly rearrange the layout.
4. Set `expanded: false` for new nodes initially. Do not remove notes to make a graph appear smaller.
5. Avoid crossing an unrelated node or obscuring edge labels. Inspect the browser-rendered PNG to catch clipping, overlaps, and unreadable text.
6. If the graph becomes unwieldy, ask to narrow the reviewed behavior rather than hiding critical branches or reducing text to an unreadable scale.

The initial coordinates are a starting point for a person to edit, not a layout constraint imposed on later revisions. Do not silently auto-layout a graph the user has rearranged. Preserve unchanged node/edge IDs, positions, connections, notes, and expansion state; make the smallest changes consistent with feedback. If a revision needs broad restructuring, explain why and obtain agreement.

## Handoff review checklist

- Is this the current submitted/approved version, not an earlier draft?
- Can someone trace the main outcome without reading every note?
- Are decisions labelled and failures/retries bounded and understandable?
- Are notes, tables, and code visible in the full-graph PNG, including off-screen nodes?
- Are graph-level description and constraints present in that image?
- Do JSON, derived Markdown, and PNG refer to the same immutable snapshot?
- Did the revision preserve the user's intentional structure/layout?

If the image reveals a problem, return to the draft/review cycle. Do not edit an immutable approved image or claim visual review without opening it.

Design inspiration: [cathrynlavery/diagram-design](https://github.com/cathrynlavery/diagram-design). The guidance and sample here are written for this skill's behavior-planning workflow; the linked project is not a runtime dependency.
