"""Run with: python3 -m unittest discover -s tests -p test_backend.py -v"""

import base64
import binascii
import copy
import hashlib
import http.client
import json
import multiprocessing
import os
import socket
import stat
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import zlib
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[1] / "skills" / "diagram-plan" / "scripts"
sys.path.insert(0, str(SCRIPTS))
from diagram_core import (DiagramError, Directory, MAX_BODY_BYTES, MAX_PNG_BYTES,
                          PNG_SIGNATURE, Store, decode_png, graph_markdown,
                          normalize_graph, parse_json, validate_png)
from diagram_server import DiagramHTTPServer, request, start_server
from diagram import wait_task


def graph(title="A plan"):
    return {"schemaVersion": 1, "title": title, "description": "Process input", "constraints": "Keep history",
            "nodes": [
                {"id": "s", "type": "start", "position": {"x": 10, "y": 20}, "data": {"label": "Begin"}},
                {"id": "d", "type": "decision", "position": {"x": 10, "y": 120},
                 "data": {"label": "Valid?", "notes": "| field | requirement |\n| --- | --- |\n| input | nonempty |", "executor": "human"}},
                {"id": "e", "type": "end", "position": {"x": 10, "y": 220}, "data": {"label": "Finish"}}],
            "edges": [{"id": "a", "source": "s", "target": "d"},
                      {"id": "b", "source": "d", "target": "e", "label": "yes"},
                      {"id": "c", "source": "d", "target": "s", "label": "no", "sourceHandle": "left", "targetHandle": "left-in"}]}


def chunk(kind, data=b""):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", binascii.crc32(kind + data) & 0xffffffff)


def png(width=2, height=2, pixels=None, color=6, depth=8, interlace=0):
    if pixels is None:
        pixels = (b"\x00" + b"\x12\x34\x56\xff" * width) * height
    return (PNG_SIGNATURE + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, depth, color, 0, 0, interlace))
            + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND"))


def png_url(raw=None):
    return "data:image/png;base64," + base64.b64encode(png() if raw is None else raw).decode("ascii")


def concurrent_mutation(project, task_id, revision, gate, output):
    gate.wait(5)
    try:
        result = Store(project).mutate(task_id, "draft", {"revision": revision, "graph": graph("writer-%s" % os.getpid())})
        output.put(("ok", result["revision"]))
    except DiagramError as exc:
        output.put((exc.code, exc.status))


class ValidationTests(unittest.TestCase):
    def test_defaults_and_internal_field_removal(self):
        source = graph()
        source["selected"] = True
        source["nodes"][0]["measured"] = {"width": 300}
        source["nodes"][0]["data"]["private"] = "discard"
        source["edges"][0]["animated"] = True
        canonical = normalize_graph(source, approval=True)
        self.assertNotIn("selected", canonical)
        self.assertNotIn("measured", canonical["nodes"][0])
        self.assertNotIn("private", canonical["nodes"][0]["data"])
        self.assertEqual(canonical["nodes"][0]["data"]["executor"], "program")
        self.assertFalse(canonical["nodes"][0]["data"]["expanded"])
        self.assertEqual(canonical["edges"][0]["sourceHandle"], "bottom")
        self.assertEqual(canonical["edges"][0]["targetHandle"], "top")
        self.assertNotIn("executor", source["nodes"][0]["data"])

    def test_graph_errors_are_useful_and_strict(self):
        modifications = [
            lambda g: g.update(schemaVersion=True),
            lambda g: g.update(title=None),
            lambda g: g.update(title=123),
            lambda g: g.update(title="x" * 501),
            lambda g: g["nodes"].append(copy.deepcopy(g["nodes"][0])),
            lambda g: g["edges"].append(copy.deepcopy(g["edges"][0])),
            lambda g: g["edges"][0].update(target="missing"),
            lambda g: g["edges"][0].update(sourceHandle="top"),
            lambda g: g["edges"][0].update(targetHandle="bottom"),
            lambda g: g["nodes"][0].update(type="script"),
            lambda g: g["nodes"][0]["data"].update(executor="shell"),
            lambda g: g["nodes"][0]["data"].update(expanded=1),
            lambda g: g["nodes"][0]["data"].update(notes="\ud800"),
            lambda g: g["nodes"][0]["position"].update(x=float("nan")),
            lambda g: g["nodes"][0]["position"].update(y=float("inf")),
            lambda g: g["nodes"][0]["position"].update(x=True),
            lambda g: g["nodes"][0].update(id=""),
            lambda g: g.update(nodes=[{}] * 501),
            lambda g: g.update(edges=[{}] * 2001),
        ]
        for modify in modifications:
            with self.subTest(modify=modify):
                value = graph()
                modify(value)
                with self.assertRaises(DiagramError) as ctx:
                    normalize_graph(value)
                self.assertEqual(ctx.exception.code, "invalid_graph")
                self.assertTrue(ctx.exception.details)

    def test_drafts_incomplete_approval_strict(self):
        empty = {"schemaVersion": 1, "nodes": [], "edges": []}
        normalize_graph(empty)
        with self.assertRaises(DiagramError):
            normalize_graph(empty, approval=True)
        for modifier in (lambda g: g.update(title="  "),
                         lambda g: g["nodes"][0]["data"].update(label=" "),
                         lambda g: g["edges"].pop(),
                         lambda g: g["edges"][1].update(label="")):
            value = graph()
            modifier(value)
            normalize_graph(value)
            with self.assertRaises(DiagramError):
                normalize_graph(value, approval=True)

    def test_json_rejects_duplicates_nonfinite_and_invalid_encoding(self):
        for raw in (b'{"a": 1, "a": 2}', b'{"x": NaN}', b'{"x": Infinity}', b'\xff', b'{{'):
            with self.subTest(raw=raw), self.assertRaises(DiagramError):
                parse_json(raw)

    def test_markdown_includes_everything_without_embedded_resources(self):
        value = graph("Title | <img src=x> *bold*")
        value["nodes"][0]["data"]["label"] = "line1\n# injected | label"
        value["nodes"][0]["data"]["notes"] = "<script>alert(1)</script>\n![image](https://evil/x)\n[run](javascript:alert(1))\n```python\nprint(1)\n```"
        value["edges"][0]["label"] = "a | b\nc"
        result = graph_markdown(normalize_graph(value), "Human feedback **important**")
        for present in ("## Description", "Process input", "Keep history", "## Nodes", "## Edges", "## Feedback",
                        "Executor: human", "Human feedback **important**", "```python", "| field | requirement |", "a \\| b / c"):
            self.assertIn(present, result)
        self.assertNotIn("<script>", result)
        self.assertNotIn("<img", result)
        self.assertNotIn("![image]", result)
        self.assertNotIn("[run]", result)
        self.assertIn("&lt;script&gt;", result)
        self.assertIn("line1 / \\# injected \\| label", result)


class PNGTests(unittest.TestCase):
    def test_valid_png_and_interlaced_single_pixel(self):
        self.assertEqual(decode_png(png_url()), png())
        self.assertEqual(validate_png(png(1, 1, interlace=1)), png(1, 1, interlace=1))
        # Indexed PNG with its required palette is also accepted.
        raw = (PNG_SIGNATURE + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 1, 3, 0, 0, 0))
               + chunk(b"PLTE", b"\x00\x00\x00\xff\xff\xff")
               + chunk(b"IDAT", zlib.compress(b"\0\0")) + chunk(b"IEND"))
        validate_png(raw)

    def test_compressed_or_malformed_metadata_rejected(self):
        valid = png()
        header_end = 8 + 12 + 13
        for kind, value in ((b"zTXt", b"note\0\x01" + zlib.compress(b"text")),
                            (b"zTXt", b"note\0\0" + zlib.compress(b"x" * 100000)),
                            (b"iTXt", b"note\0\x01\0\0\0" + zlib.compress(b"text")),
                            (b"iCCP", b"profile\0\0" + zlib.compress(b"profile")),
                            (b"gAMA", b"\0"), (b"sRGB", b"\x08"),
                            (b"pHYs", b"\0" * 8 + b"\x02")):
            with self.subTest(kind=kind), self.assertRaises(DiagramError):
                validate_png(valid[:header_end] + chunk(kind, value) + valid[header_end:])
        validate_png(valid[:header_end] + chunk(b"sRGB", b"\0") + valid[header_end:])
        validate_png(valid[:header_end] + chunk(b"pHYs", struct.pack(">IIB", 3780, 3780, 1)) + valid[header_end:])

    def test_invalid_pngs_rejected(self):
        valid = png()
        wrong_crc = valid[:29] + bytes([valid[29] ^ 1]) + valid[30:]
        header = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0))
        cases = [b"not an image", PNG_SIGNATURE, valid[:-1], valid[:-12], valid + b"extra", wrong_crc,
                 png(0, 2, pixels=b""), png(100000, 1, pixels=b""), png(8192, 8192, pixels=b""),
                 png(1, 1, pixels=b"\x05\0\0\0\0"), png(1, 1, pixels=b"\0"),
                 png(1, 1, pixels=b"\0" * 1000000), png(1, 1, color=3, pixels=b"\0\0"),
                 png(1, 1, depth=3),
                 PNG_SIGNATURE + header + chunk(b"IDAT", b"not zlib") + chunk(b"IEND"),
                 PNG_SIGNATURE + header + chunk(b"ABCD") + chunk(b"IDAT", zlib.compress(b"\0" * 5)) + chunk(b"IEND"),
                 PNG_SIGNATURE + header + chunk(b"IDAT", zlib.compress(b"\0" * 5)) + chunk(b"tEXt", b"a\0b") + chunk(b"IDAT") + chunk(b"IEND"),
                 PNG_SIGNATURE + header + header + chunk(b"IDAT", zlib.compress(b"\0" * 5)) + chunk(b"IEND"),
                 PNG_SIGNATURE + header + chunk(b"IDAT", zlib.compress(b"\0" * 5) + zlib.compress(b"x")) + chunk(b"IEND")]
        for index, raw in enumerate(cases):
            with self.subTest(index=index), self.assertRaises(DiagramError) as ctx:
                decode_png(png_url(raw))
            self.assertEqual(ctx.exception.code, "invalid_png")
        for data in ("eA==", "data:image/jpeg;base64,eA==", "data:image/png;base64,!", None,
                     "data:image/png;base64," + "A" * (4 * ((MAX_PNG_BYTES + 2) // 3) + 4)):
            with self.subTest(data=str(data)[:60]), self.assertRaises(DiagramError):
                decode_png(data)


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name)
        self.store = Store(self.project)
        self.task = self.store.create("Test", "agent", graph())
        self.task_id = self.task["id"]

    def mutate(self, action, **body):
        body.setdefault("revision", self.task["revision"])
        self.task = self.store.mutate(self.task_id, action, body)
        return self.task

    def test_full_lifecycle_snapshots_and_restore(self):
        self.assertEqual(self.task["revision"], 1)
        initial = self.task["versions"][0]["id"]
        initial_bytes = self.store.artifact(self.task_id, initial, "diagram.json")
        self.assertFalse(self.store.export(self.task_id)["hasPng"])
        self.assertIsNone(self.store.export(self.task_id)["paths"]["png"])
        with self.assertRaises(DiagramError) as ctx:
            self.store.artifact(self.task_id, initial, "diagram.png")
        self.assertEqual(ctx.exception.status, 404)
        self.mutate("draft", graph=graph("Edited"))
        self.assertEqual(len(self.task["versions"]), 1)
        self.mutate("checkpoint", graph=graph("Checkpoint"), png=png_url())
        checkpoint = self.task["versions"][-1]["id"]
        self.assertEqual(self.store.artifact(self.task_id, checkpoint, "diagram.png"), png())
        self.mutate("submit", graph=graph("Handoff"), png=png_url(), feedback="Please add retries")
        submitted = self.task["versions"][-1]["id"]
        request_id = self.task["requestId"]
        self.assertEqual(self.task["status"], "awaiting_agent")
        self.assertEqual(self.store.export(self.task_id)["versionId"], submitted)
        waiting = wait_task(self.store, self.task_id, 0)
        self.assertFalse(waiting["pending"])
        self.assertEqual(waiting["requestId"], request_id)
        self.mutate("revise", requestId=request_id, graph=graph("Agent changed plan"))
        self.assertEqual(self.task["status"], "draft")
        self.assertIsNone(self.task["requestId"])
        self.assertEqual(self.task["versions"][-1]["kind"], "agent_revision")
        self.assertFalse(self.task["versions"][-1]["hasPng"])
        self.mutate("approve", graph=self.task["graph"], png=png_url())
        approved = self.task["approvedVersion"]
        approved_bytes = self.store.artifact(self.task_id, approved, "diagram.json")
        self.assertEqual(self.task["status"], "approved")
        self.assertEqual(self.store.export(self.task_id)["versionId"], approved)
        with self.assertRaises(DiagramError):
            self.mutate("cancel")
        with self.assertRaises(DiagramError):
            self.mutate("draft", graph=graph())
        self.mutate("restore", versionId=initial)
        self.assertEqual(self.task["status"], "draft")
        self.assertIsNone(self.task["approvedVersion"])
        self.assertEqual(self.task["graph"]["title"], "A plan")
        self.assertEqual(self.task["versions"][-1]["kind"], "restore")
        self.assertFalse(self.task["versions"][-1]["hasPng"])
        self.assertEqual(self.store.artifact(self.task_id, approved, "diagram.json"), approved_bytes)
        self.assertEqual(self.store.artifact(self.task_id, initial, "diagram.json"), initial_bytes)
        self.assertEqual(len(self.task["versions"]), 6)
        self.assertEqual(Store(self.project).get_task(self.task_id), self.task)
        for entry in self.task["versions"]:
            version = self.store.get_version(self.task_id, entry["id"])
            self.assertEqual(version["graph"]["title"], entry["title"])
            for filename, digest in version["hashes"].items():
                raw = self.store.artifact(self.task_id, entry["id"], filename)
                self.assertEqual(hashlib.sha256(raw).hexdigest(), digest)
            markdown = self.store.artifact(self.task_id, entry["id"], "diagram.md").decode()
            self.assertEqual(markdown, graph_markdown(version["graph"], entry["feedback"]))

    def test_stale_revisions_and_request_ids_never_write(self):
        self.mutate("submit", graph=graph(), png=png_url(), feedback="Change it")
        old_request = self.task["requestId"]
        before = self.store.get_task(self.task_id)
        for revision, request_id, code in ((1, old_request, "revision_conflict"),
                                           (2, "wrong", "request_conflict"), (2, None, "request_conflict")):
            with self.subTest(code=code), self.assertRaises(DiagramError) as ctx:
                self.store.mutate(self.task_id, "revise", {"revision": revision, "requestId": request_id, "graph": graph("bad")})
            self.assertEqual(ctx.exception.status, 409)
            self.assertEqual(ctx.exception.code, code)
            self.assertEqual(self.store.get_task(self.task_id), before)
        self.mutate("resume")
        self.assertIsNone(self.task["requestId"])
        self.mutate("submit", graph=graph(), png=png_url(), feedback="New request")
        self.assertNotEqual(self.task["requestId"], old_request)
        with self.assertRaises(DiagramError) as ctx:
            self.mutate("revise", requestId=old_request, graph=graph())
        self.assertEqual(ctx.exception.code, "request_conflict")
        self.mutate("cancel")
        self.assertEqual(self.task["status"], "cancelled")
        self.assertIsNone(self.task["requestId"])
        self.mutate("resume")
        self.assertEqual(self.task["status"], "draft")
        with self.assertRaises(DiagramError):
            self.mutate("resume")

    def test_restore_awaiting_agent_invalidates_request(self):
        initial = self.task["versions"][0]["id"]
        self.mutate("submit", graph=graph("Changed"), png=png_url(), feedback="Review")
        self.mutate("restore", versionId=initial)
        self.assertEqual(self.task["graph"]["title"], "A plan")
        self.assertIsNone(self.task["requestId"])
        self.assertEqual(self.task["status"], "draft")

    def test_failed_handoffs_preserve_draft_and_history(self):
        before = self.store.get_task(self.task_id)
        for action, extra in (("approve", {}), ("checkpoint", {}), ("submit", {"feedback": "Please fix"})):
            with self.subTest(action=action), self.assertRaises(DiagramError):
                self.mutate(action, graph=graph(), png="data:image/png;base64,bm9wZQ==", **extra)
            self.assertEqual(self.store.get_task(self.task_id), before)
        with self.assertRaises(DiagramError):
            self.mutate("submit", graph=graph(), png=png_url(), feedback=" \n ")
        with self.assertRaises(DiagramError):
            self.mutate("approve", graph={"schemaVersion": 1}, png=png_url())
        self.assertEqual(self.store.get_task(self.task_id), before)

    def test_orphan_snapshot_not_published_on_state_write_failure(self):
        before = self.store.get_task(self.task_id)
        original = Directory.atomic_write

        def fail_state(directory, name, raw):
            if name == "state.json":
                raise DiagramError("Simulated disk error", 500, "storage_error")
            return original(directory, name, raw)

        with mock.patch.object(Directory, "atomic_write", fail_state):
            with self.assertRaises(DiagramError):
                self.mutate("approve", graph=graph(), png=png_url())
        self.assertEqual(self.store.get_task(self.task_id), before)
        versions = self.project / ".diagram-skill" / "tasks" / self.task_id / "versions"
        orphan = next(path.name for path in versions.iterdir() if path.name != before["versions"][0]["id"])
        with self.assertRaises(DiagramError) as ctx:
            self.store.get_version(self.task_id, orphan)
        self.assertEqual(ctx.exception.status, 404)
        self.mutate("approve", graph=graph(), png=png_url())
        self.assertEqual(len(self.task["versions"]), 2)
        self.assertNotEqual(self.task["approvedVersion"], orphan)

    def test_checksum_detects_artifact_tampering(self):
        export = self.store.export(self.task_id)
        Path(export["paths"]["json"]).write_text(json.dumps(graph("tampered")))
        with self.assertRaises(DiagramError) as ctx:
            self.store.get_version(self.task_id, export["versionId"])
        self.assertEqual(ctx.exception.code, "corrupt_snapshot")

    def test_process_and_thread_concurrency(self):
        context = multiprocessing.get_context("fork")
        gate = context.Event()
        output = context.Queue()
        processes = [context.Process(target=concurrent_mutation,
                                     args=(str(self.project), self.task_id, 1, gate, output)) for _ in range(2)]
        for process in processes:
            process.start()
        gate.set()
        for process in processes:
            process.join(8)
            self.assertFalse(process.is_alive())
            self.assertEqual(process.exitcode, 0)
        results = [output.get(timeout=1), output.get(timeout=1)]
        self.assertCountEqual(results, [("ok", 2), ("revision_conflict", 409)])
        output.close()
        outcomes = []

        def writer():
            try:
                self.store.mutate(self.task_id, "draft", {"revision": 2, "graph": graph()})
                outcomes.append("ok")
            except DiagramError as exc:
                outcomes.append(exc.code)

        threads = [threading.Thread(target=writer) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(5)
            self.assertFalse(thread.is_alive())
        self.assertCountEqual(outcomes, ["ok", "revision_conflict"])

    def test_wait_is_bounded_and_pending_not_approved(self):
        start = time.monotonic()
        result = wait_task(self.store, self.task_id, 0.05)
        self.assertLess(time.monotonic() - start, 1)
        self.assertTrue(result["pending"])
        self.assertEqual(result["status"], "draft")
        for value in (-1, float("inf"), float("nan"), 301):
            with self.assertRaises(DiagramError):
                wait_task(self.store, self.task_id, value)

    def test_wait_timeout_includes_process_lock_contention(self):
        # Independent Store objects have different thread locks but share flock.
        with self.store.transaction():
            start = time.monotonic()
            result = wait_task(Store(self.project), self.task_id, 0.05)
            self.assertLess(time.monotonic() - start, 0.5)
            self.assertTrue(result["pending"])
            self.assertEqual(result["reason"], "storage_busy")
            self.assertIsNone(result["artifacts"])

    def test_path_and_symlink_confinement(self):
        for task_id in ("../other", "/tmp/x", "a/b", ".", "..", "a\\b", "x\0"):
            with self.subTest(task_id=task_id), self.assertRaises(DiagramError):
                self.store.get_task(task_id)
        initial = self.task["versions"][0]["id"]
        for version_id in ("../x", "/tmp", ".", ".."):
            with self.assertRaises(DiagramError):
                self.store.get_version(self.task_id, version_id)
        outside = self.project / "outside.txt"
        outside.write_text("PRIVATE")
        task_dir = self.project / ".diagram-skill" / "tasks" / self.task_id
        artifact = task_dir / "versions" / initial / "diagram.md"
        artifact.unlink()
        artifact.symlink_to(outside)
        with self.assertRaises(DiagramError) as ctx:
            self.store.artifact(self.task_id, initial, "diagram.md")
        self.assertEqual(ctx.exception.code, "unsafe_path")
        state = task_dir / "state.json"
        state.unlink()
        state.symlink_to(outside)
        with self.assertRaises(DiagramError):
            self.store.get_task(self.task_id)
        self.assertEqual(outside.read_text(), "PRIVATE")

    def test_directory_symlinks_and_private_descriptor(self):
        with tempfile.TemporaryDirectory() as second:
            workspace = Path(second)
            (workspace / ".diagram-skill").symlink_to(self.project / ".diagram-skill", target_is_directory=True)
            with self.assertRaises(DiagramError):
                Store(workspace).list_tasks()
        task_root = self.project / ".diagram-skill" / "tasks"
        (task_root / "other").symlink_to(task_root / self.task_id, target_is_directory=True)
        with self.assertRaises(DiagramError):
            self.store.get_task("other")
        descriptor = self.project / ".diagram-skill" / "server.json"
        descriptor.symlink_to(self.project / "external")
        with self.assertRaises(DiagramError):
            self.store.read_descriptor()
        descriptor.unlink()
        descriptor.write_text("{}")
        descriptor.chmod(0o644)
        with self.assertRaises(DiagramError):
            self.store.read_descriptor()


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.project = Path(self.temp.name)
        self.store = Store(self.project)
        self.web = self.project / "web"
        self.web.mkdir()
        (self.web / "index.html").write_text("<!doctype html><title>Local UI</title>")
        (self.web / "assets").mkdir()
        (self.web / "assets" / "main.js").write_text("console.log('local')")
        self.server = DiagramHTTPServer(self.store, web_path=self.web)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.02})
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(5)
        self.temp.cleanup()

    def api(self, method, path, body=None, authenticated=True, headers=None, raw=False):
        request_headers = {}
        if authenticated:
            request_headers["Authorization"] = "Bearer " + self.server.token
        if body is not None:
            request_headers["Content-Type"] = "application/json"
            body = body if isinstance(body, bytes) else json.dumps(body).encode()
        request_headers.update(headers or {})
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            connection.request(method, path, body=body, headers=request_headers)
            response = connection.getresponse()
            payload = response.read()
            result = payload if raw else json.loads(payload)
            return response.status, result, dict(response.getheaders())
        finally:
            connection.close()

    def test_auth_host_origin_and_security_headers(self):
        status, value, headers = self.api("GET", "/api/health", authenticated=False)
        self.assertEqual((status, value), (200, {"ok": True, "protocol": 1}))
        self.assertEqual(headers["Referrer-Policy"], "no-referrer")
        self.assertIn("object-src 'none'", headers["Content-Security-Policy"])
        self.assertNotIn("Access-Control-Allow-Origin", headers)
        for path in ("/api/tasks", "/api/unknown", "/api/tasks/t-x/versions/v-x/diagram.json"):
            self.assertEqual(self.api("GET", path, authenticated=False)[0], 401)
        self.assertEqual(self.api("GET", "/api/tasks", headers={"Authorization": "Bearer wrong"})[0], 401)
        self.assertEqual(self.api("GET", "/api/health", headers={"Host": "evil.example"})[0], 403)
        self.assertEqual(self.api("POST", "/api/tasks", {}, headers={"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.api("POST", "/api/tasks", {}, headers={"Origin": "null"})[0], 403)
        self.assertEqual(self.api("POST", "/api/tasks", {}, headers={"Sec-Fetch-Site": "cross-site"})[0], 403)
        origin = "http://127.0.0.1:%s" % self.port
        self.assertEqual(self.api("POST", "/api/tasks", {"title": "Local"}, headers={"Origin": origin})[0], 201)

    def test_all_snapshot_and_mutation_routes(self):
        status, task, _ = self.api("POST", "/api/tasks", {"title": "Task", "mode": "agent", "graph": graph()})
        self.assertEqual(status, 201)
        base = "/api/tasks/" + task["id"]
        self.assertEqual(self.api("GET", base)[1], task)
        self.assertEqual(self.api("GET", "/api/tasks")[1][0]["id"], task["id"])
        status, task, _ = self.api("PUT", base + "/draft", {"revision": 1, "graph": graph("Saved")})
        self.assertEqual((status, task["revision"]), (200, 2))
        self.assertEqual(self.api("PUT", base + "/draft", {"revision": 1, "graph": graph()})[0], 409)
        status, task, _ = self.api("POST", base + "/checkpoint", {"revision": 2, "graph": graph(), "png": png_url()})
        self.assertEqual(status, 200)
        version = task["versions"][-1]["id"]
        route = base + "/versions/" + version
        status, snapshot, _ = self.api("GET", route)
        self.assertEqual((status, snapshot["kind"]), (200, "checkpoint"))
        self.assertEqual(snapshot["graph"], task["graph"])
        for name in ("diagram.json", "diagram.md", "diagram.png"):
            status, raw, headers = self.api("GET", route + "/" + name, raw=True)
            self.assertEqual(status, 200)
            self.assertEqual(hashlib.sha256(raw).hexdigest(), snapshot["hashes"][name])
            self.assertIn(name, headers["Content-Disposition"])
            self.assertEqual(self.api("GET", route + "/" + name, authenticated=False)[0], 401)
        self.assertEqual(self.api("GET", route + "/metadata.json")[0], 404)
        status, task, _ = self.api("POST", base + "/submit", {"revision": 3, "graph": graph(), "png": png_url(), "feedback": "Change"})
        self.assertEqual((status, task["status"]), (200, "awaiting_agent"))
        status, task, _ = self.api("POST", base + "/revise", {"revision": 4, "requestId": task["requestId"], "graph": graph("Agent")})
        self.assertEqual((status, task["status"]), (200, "draft"))
        status, task, _ = self.api("POST", base + "/approve", {"revision": 5, "graph": graph("Approved"), "png": png_url()})
        self.assertEqual((status, task["status"]), (200, "approved"))
        approved = task["approvedVersion"]
        status, task, _ = self.api("POST", base + "/restore", {"revision": 6, "versionId": approved})
        self.assertEqual((status, task["status"]), (200, "draft"))
        status, task, _ = self.api("POST", base + "/cancel", {"revision": 7})
        self.assertEqual((status, task["status"]), (200, "cancelled"))
        status, task, _ = self.api("POST", base + "/resume", {"revision": 8})
        self.assertEqual((status, task["revision"]), (200, 9))

    def test_static_confinement(self):
        status, raw, _ = self.api("GET", "/", authenticated=False, raw=True)
        self.assertEqual(status, 200)
        self.assertIn(b"Local UI", raw)
        self.assertEqual(self.api("GET", "/assets/main.js", raw=True)[0], 200)
        outside = self.project / "private.txt"
        outside.write_text("TOP_SECRET")
        (self.web / "leak.txt").symlink_to(outside)
        (self.web / "outside").symlink_to(self.project, target_is_directory=True)
        for route in ("/../private.txt", "/%2e%2e/private.txt", "/assets/%2e%2e/%2e%2e/private.txt",
                      "/leak.txt", "/outside/private.txt", "/%00", "/%5c..%5cprivate.txt", "/private.txt"):
            with self.subTest(route=route):
                status, raw, _ = self.api("GET", route, raw=True)
                self.assertGreaterEqual(status, 400)
                self.assertNotIn(b"TOP_SECRET", raw)
        self.assertEqual(self.api("GET", "/api/tasks/%2e%2e")[0], 400)

    def test_static_storage_overlap_and_hidden_credentials_rejected(self):
        for project in (self.web, self.web / "assets"):
            with self.subTest(project=project), self.assertRaises(DiagramError) as ctx:
                DiagramHTTPServer(Store(project), web_path=self.web)
            self.assertEqual(ctx.exception.code, "unsafe_project")
        for relative in (".diagram-skill", "assets/.diagram-skill"):
            private = self.web / relative
            private.mkdir()
            (private / "server.json").write_text('{"token":"DO_NOT_SERVE"}')
            status, raw, _ = self.api("GET", "/" + relative + "/server.json", authenticated=False, raw=True)
            self.assertEqual(status, 404)
            self.assertNotIn(b"DO_NOT_SERVE", raw)

    def test_slow_headers_cannot_hold_shutdown_open(self):
        self.server.header_timeout = 0.3
        connection = socket.create_connection(("127.0.0.1", self.port))
        connection.sendall(("GET / HTTP/1.0\r\nHost: 127.0.0.1:%d\r\nX-Slow: " % self.port).encode())
        stopped = threading.Event()
        def drip():
            while not stopped.wait(0.04):
                try:
                    connection.sendall(b"x")
                except OSError:
                    return
        writer = threading.Thread(target=drip)
        writer.start()
        def close_server():
            self.server.shutdown()
            self.server.server_close()
        closer = threading.Thread(target=close_server)
        closer.start()
        try:
            closer.join(1.5)
            self.assertFalse(closer.is_alive(), "Incomplete headers blocked graceful shutdown")
        finally:
            stopped.set()
            connection.close()
            writer.join(2)
            closer.join(3)

    def test_header_deadline_does_not_interrupt_complete_transactions(self):
        self.server.header_timeout = 0.1
        original = self.store.create
        def delayed(*args, **kwargs):
            time.sleep(0.25)
            return original(*args, **kwargs)
        with mock.patch.object(self.store, "create", side_effect=delayed):
            status, task, _ = self.api("POST", "/api/tasks", {"title": "Durable"})
        self.assertEqual(status, 201)
        self.assertEqual(self.store.get_task(task["id"])["graph"]["title"], "Durable")

    def test_bounded_body_and_bad_json(self):
        for body in (b'[]', b'{bad}', b'{"title": NaN}', b'{"title":"a","title":"b"}'):
            with self.subTest(body=body):
                self.assertEqual(self.api("POST", "/api/tasks", body)[0], 400)
        self.assertEqual(self.api("POST", "/api/tasks", b"{}", headers={"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.api("POST", "/api/tasks", b"{}", headers={"Content-Length": str(MAX_BODY_BYTES + 1)})[0], 413)
        self.assertEqual(self.api("POST", "/api/tasks", b"{}", headers={"Transfer-Encoding": "chunked"})[0], 400)

    def test_shutdown_requires_exact_instance(self):
        self.assertEqual(self.api("POST", "/api/shutdown", {"serverId": "other"})[0], 409)
        self.assertEqual(self.api("POST", "/api/shutdown", {"serverId": self.server.server_id}, authenticated=False)[0], 401)
        self.assertEqual(self.api("GET", "/api/health")[0], 200)
        status, result, _ = self.api("POST", "/api/shutdown", {"serverId": self.server.server_id})
        self.assertEqual(status, 200)
        self.assertEqual(result["serverId"], self.server.server_id)
        self.thread.join(3)
        self.assertFalse(self.thread.is_alive())


class CLITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.project = Path(self.temp.name)
        self.store = Store(self.project)

    def tearDown(self):
        try:
            self.cli("stop")
        finally:
            self.temp.cleanup()

    def cli(self, *args, **kwargs):
        expected = kwargs.get("expected", 0)
        result = subprocess.run([sys.executable, str(SCRIPTS / "diagram.py")] + list(args) +
                                ["--project", str(self.project)], stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=25, cwd=str(self.project))
        self.assertEqual(result.returncode, expected, result.stderr.decode())
        return json.loads((result.stdout if expected == 0 else result.stderr).decode())

    def test_cli_validation_show_export_wait_and_revise_without_server(self):
        file = self.project / "input.json"
        file.write_text(json.dumps(graph()))
        self.assertTrue(self.cli("validate", "input.json", "--approval")["valid"])
        self.assertFalse((self.project / ".diagram-skill").exists())
        task = self.store.create("Offline", "agent", graph())
        task_id = task["id"]
        self.assertEqual(self.cli("show", "--task", task_id), task)
        self.assertEqual(self.cli("list")[0]["id"], task_id)
        self.assertFalse(self.cli("export", "--task", task_id)["hasPng"])
        self.assertTrue(self.cli("wait", "--task", task_id, "--timeout", "0")["pending"])
        self.assertEqual(self.cli("wait", "--task", task_id, "--timeout", "nan", expected=1)["code"], "invalid_request")
        task = self.store.mutate(task_id, "submit", {"revision": 1, "graph": graph(), "png": png_url(), "feedback": "Revise"})
        result = self.cli("revise", "--task", task_id, "--revision", "2", "--request-id", task["requestId"], "--graph", "input.json")
        self.assertEqual(result["status"], "draft")
        self.assertEqual(result["versions"][-1]["kind"], "agent_revision")
        error = self.cli("revise", "--task", task_id, "--revision", "2", "--request-id", task["requestId"], "--graph", "input.json", expected=1)
        self.assertEqual(error["code"], "revision_conflict")
        file.write_text('{"schemaVersion":1,"nodes":[{}]}')
        self.assertEqual(self.cli("validate", "input.json", expected=1)["code"], "invalid_graph")
        self.assertFalse((self.project / ".diagram-skill" / "server.json").exists())

    def test_concurrent_launcher_waits_for_winner_publication(self):
        clock = [0.0]
        descriptor = {"serverId": "winner"}
        child = mock.Mock()
        child.poll.return_value = 1  # This launcher's child lost the lifetime lock.
        def advance(seconds):
            clock[0] += seconds
        with mock.patch.object(self.store, "read_descriptor", return_value=descriptor), \
                mock.patch("diagram_server.descriptor_live", side_effect=lambda value: clock[0] >= 2), \
                mock.patch("diagram_server.subprocess.Popen", return_value=child), \
                mock.patch("diagram_server.time.monotonic", side_effect=lambda: clock[0]), \
                mock.patch("diagram_server.time.sleep", side_effect=advance):
            actual, reused = start_server(self.store)
        self.assertEqual(actual, descriptor)
        self.assertFalse(reused)
        self.assertGreaterEqual(clock[0], 2)
        self.assertLess(clock[0], 10)

    def test_auto_start_reuse_stop_restart_and_private_descriptor(self):
        file = self.project / "input.json"
        file.write_text(json.dumps(graph()))
        created = self.cli("create", "--title", "CLI task", "--mode", "agent", "--graph", "input.json", "--no-open")
        task = created["task"]
        descriptor = self.store.read_descriptor()
        self.assertIn("#token=", created["url"])
        self.assertIn("&task=" + task["id"], created["url"])
        self.assertEqual(stat.S_IMODE((self.project / ".diagram-skill" / "server.json").stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE((self.project / ".diagram-skill").stat().st_mode), 0o700)
        reused = self.cli("start", "--no-open")
        self.assertTrue(reused["reused"])
        self.assertEqual(reused["pid"], descriptor["pid"])
        duplicate = self.cli("serve", expected=1)
        self.assertEqual(duplicate["code"], "server_busy")
        for path in (self.project / ".diagram-skill" / "tasks").rglob("*"):
            if path.is_file():
                self.assertNotIn(descriptor["token"].encode(), path.read_bytes())
        # A PID is informational, never used as shutdown authority or a kill target.
        self.store.write_descriptor(dict(descriptor, pid=os.getpid()))
        self.assertTrue(self.cli("stop")["stopped"])
        self.assertIsNone(self.store.read_descriptor())
        with self.assertRaises(DiagramError):
            request(descriptor, "GET", "/api/tasks", timeout=0.2)
        restarted = self.cli("start", "--no-open")
        new_descriptor = self.store.read_descriptor()
        self.assertFalse(restarted["reused"])
        self.assertNotEqual(new_descriptor["token"], descriptor["token"])
        self.assertEqual(self.cli("show", "--task", task["id"]), task)
        stale_auth = dict(new_descriptor, token=descriptor["token"])
        with self.assertRaises(DiagramError) as ctx:
            request(stale_auth, "GET", "/api/tasks")
        self.assertEqual(ctx.exception.status, 401)
        self.assertTrue(self.cli("stop")["stopped"])
        self.assertFalse(self.cli("stop")["stopped"])

    def test_descriptor_cannot_target_another_project_instance(self):
        self.cli("start", "--no-open")
        descriptor = self.store.read_descriptor()
        with tempfile.TemporaryDirectory() as other:
            other_store = Store(other)
            copied = dict(descriptor, project=str(other_store.project))
            other_store.write_descriptor(copied)
            with self.assertRaises(DiagramError) as ctx:
                request(copied, "POST", "/api/shutdown", {"serverId": copied["serverId"]})
            self.assertEqual(ctx.exception.code, "server_conflict")
        self.assertIsInstance(request(descriptor, "GET", "/api/tasks"), list)

    def test_stale_descriptor_never_kills_unrelated_pid(self):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        stale = {"protocol": 1, "project": str(self.store.project), "pid": os.getpid(), "port": port,
                 "token": "x" * 43, "serverId": "stale-instance"}
        self.store.write_descriptor(stale)
        result = self.cli("stop")
        self.assertEqual(result, {"stopped": False, "reason": "stale_descriptor"})
        self.assertIsNone(self.store.read_descriptor())
        self.store.write_descriptor(stale)
        self.cli("start", "--no-open")
        self.assertNotEqual(self.store.read_descriptor()["serverId"], stale["serverId"])
        self.assertTrue(self.cli("stop")["stopped"])


if __name__ == "__main__":
    unittest.main()
