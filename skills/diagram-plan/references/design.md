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

Use short verb phrases for actions and a concrete question for a decision. Add a short summary that explains the action instead of repeating its title. Follow [writing.md](writing.md) for plain-language notes and optional humanizer review. Start and end labels should identify the triggering event and final outcome.

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

## Main flow and grouped views

Graph v2 explicitly marks node and edge roles. Use `main` for the principal behavior, `support` for secondary work and `exception` for failure handling. Roles describe relevance in this plan, not whether the operation is optional at runtime. Meaningful decisions and externally visible alternate outcomes must still be apparent from the main flow. Do not classify by matching words such as “error” in labels.

The main view keeps primary loops and their nested loops visible, shows ordinary subflows as cards, and exposes omitted outgoing paths through branch buttons. The right inspector opens subflow and branch diagrams with their real entry and exit connections. Complete exports include these diagrams and all original data.

Use `subflow` groups for complicated internal behavior and `branch` groups for secondary paths. Nested groups explicitly declare their parent; this does not require visual containment. Peer groups may share a real node. Reuse its ID so it remains one card with one position. Groups reference original nodes; they do not add execution steps or new edges.

## Initial layout

1. Align the main path top-down. Cards are 248 × 116 pixels; leave roughly 100 pixels between ordinary rows and enough space for condition labels.
2. For a real loop, place the nodes on its closed route around a circle, with text upright. The `order` can include real shared nodes or nonoverlapping child-group slots. Each step around the ring must follow an existing edge, including the closing edge. A group of mutually reachable nodes is not by itself a valid circular ordering.
3. A useful starting radius is `max(205, 328 / (2 * sin(pi / max(3, item_count))))`. Place card centers at angles starting at `-pi/2`, advancing clockwise. Card top-left coordinates subtract `(124, 58)` from each center. Put entrances and exits outside the ring.
4. Place a nested loop outside or alongside its parent. If the loops share one real node, place that card at the external tangency. Preserve separate entry and exit nodes when the behavior requires them. Multiple shared nodes may prevent exact tangency; keep each card once and favor clear connections. Keep parallel work inside an appropriate subflow with its real branch relationships.
5. Place secondary paths away from the main path so the “show branches” view can display them without moving surviving nodes. Set `expanded: false`; note reading is local UI state and does not change card size or positions.
6. Inspect the browser-rendered full PNG. Check card bounds, condition labels, arrow directions and coverage of all branches. Do not remove notes or meaningful failures to shrink the image.

When generating circular coordinates, save the matching `group.circle` center and radius. Leave edge anchors absent to use automatic circle intersections. Set `sourceAnchor` or `targetAnchor` only when a particular point on the card outline improves the route; all outline positions are available. Preserve manually adjusted anchors on later revisions.

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
