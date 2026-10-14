#!/usr/bin/env python3
"""Diagram Plan: dependency-free local planning CLI. Requires Python 3.8+."""

import argparse
import json
import math
import os
import stat
import sys
import time
import webbrowser
from pathlib import Path

from diagram_core import DiagramError, MAX_GRAPH_BYTES, Store, normalize_graph, parse_json, require_object
from diagram_server import browser_url, request, serve, start_server, stop_server


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise DiagramError(message, code="usage_error")


def parser():
    result = Parser(description="Edit and approve versioned diagram plans locally.")
    result.add_argument("--project", default=".", help="Project directory (default: current directory)")
    commands = result.add_subparsers(dest="command", required=True)

    def command(name, help_text):
        child = commands.add_parser(name, help=help_text)
        child.add_argument("--project", default=argparse.SUPPRESS,
                           help="Project directory (may also precede the subcommand)")
        return child

    start = command("start", "Start or reuse this project's detached loopback server")
    start.add_argument("--port", type=int, default=0)
    start.add_argument("--no-open", action="store_true")
    foreground = command("serve", "Run the loopback server in the foreground")
    foreground.add_argument("--port", type=int, default=0)
    create = command("create", "Create a task and initial immutable JSON/Markdown snapshot")
    create.add_argument("--title", required=True)
    create.add_argument("--mode", choices=("manual", "agent"), default="manual")
    create.add_argument("--graph")
    create.add_argument("--no-open", action="store_true")
    command("list", "List task summaries")
    show = command("show", "Show full task state")
    show.add_argument("--task", required=True)
    wait = command("wait", "Wait a bounded time for a handoff, approval, or cancellation")
    wait.add_argument("--task", required=True)
    wait.add_argument("--timeout", type=float, default=25)
    revise = command("revise", "Apply agent changes to the matching human request")
    revise.add_argument("--task", required=True)
    revise.add_argument("--revision", type=int, required=True)
    revise.add_argument("--request-id", required=True)
    revise.add_argument("--graph", required=True)
    export = command("export", "Print immutable snapshot paths; report missing PNG explicitly")
    export.add_argument("--task", required=True)
    export.add_argument("--version")
    validate = command("validate", "Validate a canonical graph file without starting a server")
    validate.add_argument("file")
    # Optional stricter validation is useful before attempting browser approval.
    validate.add_argument("--approval", action="store_true")
    command("stop", "Gracefully stop only this project's authenticated server instance")
    return result


def graph_file(filename, project):
    path = Path(filename).expanduser()
    if not path.is_absolute():
        path = Path(project).expanduser() / path
    # CLI file inputs are explicitly user-selected, unlike HTTP and artifact paths.
    try:
        fd = os.open(str(path), os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                raise DiagramError("Graph input must be a regular file", code="file_error")
            raw = stream.read(MAX_GRAPH_BYTES + 1)
        if len(raw) > MAX_GRAPH_BYTES:
            raise DiagramError("Graph file exceeds the 2 MiB size limit", code="file_too_large")
        return parse_json(raw)
    except OSError as exc:
        raise DiagramError("Cannot read graph file: " + str(path), code="file_error") from exc


def open_browser(url):
    try:
        webbrowser.open(url)
    except Exception:
        # The printed URL is still usable when no GUI/browser is installed.
        pass


def wait_task(store, task_id, timeout=25):
    if not math.isfinite(timeout) or not 0 <= timeout <= 300:
        raise DiagramError("timeout must be finite and between 0 and 300 seconds")
    deadline = time.monotonic() + timeout
    while True:
        try:
            task = store.get_task(task_id, lock_timeout=max(0, min(1, deadline - time.monotonic())))
        except DiagramError as exc:
            if exc.code != "storage_busy":
                raise
            if time.monotonic() < deadline:
                continue
            return {"taskId": task_id, "status": None, "pending": True, "requestId": None,
                    "revision": None, "feedback": "", "approvedVersion": None,
                    "artifacts": None, "reason": "storage_busy"}
        pending = task["status"] not in ("awaiting_agent", "approved", "cancelled")
        remaining = deadline - time.monotonic()
        if not pending or remaining <= 0:
            # Specify the chosen version, so concurrent edits cannot change which
            # immutable artifact set accompanies the observed revision/requestId.
            candidates = [v for v in task["versions"] if v["kind"] in ("submitted", "approved")]
            version_id = (candidates or task["versions"])[-1]["id"]
            result = {"taskId": task["id"], "status": task["status"], "pending": pending,
                      "requestId": task["requestId"], "revision": task["revision"],
                      "feedback": task["feedback"], "approvedVersion": task["approvedVersion"]}
            try:
                result["artifacts"] = store.export(task_id, version_id,
                                                  lock_timeout=max(0, min(1, deadline - time.monotonic())))
            except DiagramError as exc:
                if exc.code != "storage_busy":
                    raise
                result.update(pending=True, artifacts=None, reason="storage_busy")
            return result
        time.sleep(min(0.2, remaining))


def run(args):
    if args.command == "validate":
        graph = normalize_graph(graph_file(args.file, args.project), approval=args.approval)
        return {"valid": True, "schemaVersion": 1, "nodes": len(graph["nodes"]), "edges": len(graph["edges"])}
    store = Store(args.project)
    if args.command == "serve":
        serve(store, args.port)
        return None
    if args.command == "start":
        descriptor, reused = start_server(store, args.port)
        url = browser_url(descriptor)
        if not args.no_open:
            open_browser(url)
        return {"url": url, "pid": descriptor["pid"], "port": descriptor["port"], "reused": reused}
    if args.command == "create":
        graph = None
        if args.graph:
            graph = require_object(graph_file(args.graph, args.project))
            graph.setdefault("title", args.title)
            graph = normalize_graph(graph)
        descriptor, _ = start_server(store)
        body = {"title": args.title, "mode": args.mode}
        if graph is not None:
            body["graph"] = graph
        task = request(descriptor, "POST", "/api/tasks", body, timeout=15)
        url = browser_url(descriptor, task["id"])
        if not args.no_open:
            open_browser(url)
        return {"task": task, "url": url}
    if args.command == "list":
        return store.list_tasks()
    if args.command == "show":
        return store.get_task(args.task)
    if args.command == "wait":
        return wait_task(store, args.task, args.timeout)
    if args.command == "revise":
        return store.mutate(args.task, "revise", {"revision": args.revision, "requestId": args.request_id,
                                                "graph": graph_file(args.graph, args.project)})
    if args.command == "export":
        return store.export(args.task, args.version)
    if args.command == "stop":
        return stop_server(store)
    raise DiagramError("Unknown command", code="usage_error")


def main(argv=None):
    try:
        args = parser().parse_args(argv)
        result = run(args)
        if result is not None:
            print(json.dumps(result, ensure_ascii=False, allow_nan=False))
        return 0
    except DiagramError as exc:
        print(json.dumps(exc.payload(), ensure_ascii=False), file=sys.stderr)
        return 2 if exc.code == "usage_error" else 1
    except (OSError, ValueError) as exc:
        print(json.dumps({"error": str(exc), "code": "runtime_error"}), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print(json.dumps({"error": "Interrupted", "code": "interrupted"}), file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
