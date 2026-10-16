# Writing readable flow cards

Read when generating or rewriting labels, summaries, and notes. Write for someone who understands programming but is new to this project, unless the user specifies another reader. Use the user's language.

## Decide where the information belongs

- `label`: the action or concrete question. Prefer “选择本轮任务” to a module name or a vague heading such as “调度机制”.
- `summary`: one short sentence explaining what the step does or why it is needed. The card shows at most two lines; the inspector keeps the complete text. Do not repeat the label.
- `notes`: the explanation, followed by the technical details needed to assess or implement the behavior. Keep code names, values, limits, error codes, ordering, and concurrency accurate.
- Graph description and constraints: scope and requirements that apply across steps.

If a note explains several independent behaviors, consider a subflow before shortening the prose. A summary does not replace the complete note. Failure conditions and their consequences must remain in the graph or its notes.

## Explain the action before the implementation

Start with who does what and what happens next. Explain a specialized term when its meaning matters to the reader, then retain the exact identifier so they can find the code. Put file paths after the explanation rather than using a path as the opening sentence.

For a synthetic example, suppose a delivery step permits three attempts and sends an unsuccessful item to manual review:

> 发送失败后可以重试，总共最多尝试 3 次。仍未成功的任务转交人工检查，避免一直占用处理队列。

Use the source's actual attempt limit and failure outcome when writing a real plan.

Use short paragraphs, a small table, or code only when each helps explain that particular step. Do not force every note into the same input/output/rules template. Remove repeated introductions, decorative bold labels, empty emphasis such as “关键机制”, and conclusions that only repeat the preceding sentence.

## Review before saving

Read the complete draft, revise it, and compare it with the source. Check every number, name, error condition, outcome, and claim about sequence or parallel work. Do not invent a mechanism to make the text sound smoother. Keep code blocks, commands, paths, and inline identifiers intact when editing prose.

If the host offers the `humanizer` or `humanizer:humanizer` skill, load and apply it after drafting, then recheck technical meaning. Use the host's supported skill mechanism; some hosts expose a Skill tool, others expose readable skill files. Do not claim to have called a tool that is unavailable. If the skill is absent, complete the review using this guide without requiring installation.

The coding agent performs this review when authoring the graph. The editor does not call a model or rewrite text when the user saves a manual edit.
