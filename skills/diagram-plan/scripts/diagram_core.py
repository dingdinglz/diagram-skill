"""Canonical diagram data, confined storage, and immutable transactions (stdlib only)."""

import base64
import binascii
import contextlib
import errno
import hashlib
import html
import json
import os
import re
import stat
import struct
import threading
import time
import uuid
import zlib
from datetime import datetime, timezone
from pathlib import Path

try:
    import fcntl
except ImportError:  # pragma: no cover - Windows
    fcntl = None

PROTOCOL = 1
MAX_GRAPH_BYTES = 2 * 1024 * 1024
MAX_STATE_BYTES = 16 * 1024 * 1024
MAX_PNG_BYTES = 5 * 1024 * 1024
MAX_BODY_BYTES = 10 * 1024 * 1024
MAX_PNG_DIMENSION = 8192
MAX_PNG_PIXELS = 16 * 1024 * 1024
MAX_PNG_RAW_BYTES = 64 * 1024 * 1024
MAX_NODES = 500
MAX_EDGES = 2000
MAX_FEEDBACK = 100000
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")
COMPONENT_RE = re.compile(r"^[A-Za-z0-9_.-]{1,160}$")
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
ARTIFACTS = ("diagram.json", "diagram.md", "diagram.png", "metadata.json")


class DiagramError(Exception):
    def __init__(self, message, status=400, code="invalid_request", details=None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.details = details

    def payload(self):
        result = {"error": str(self), "code": self.code}
        if self.details is not None:
            result["details"] = self.details
        return result


def now():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def parse_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("Duplicate JSON key: " + key)
            result[key] = value
        return result

    def constant(value):
        raise ValueError("Non-finite JSON number: " + value)

    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=pairs, parse_constant=constant)
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise DiagramError("Invalid JSON", details=str(exc))


def validate_id(value, label="id"):
    if not isinstance(value, str) or not ID_RE.fullmatch(value):
        raise DiagramError("Invalid " + label, code="invalid_id")
    return value


def require_object(value):
    if not isinstance(value, dict):
        raise DiagramError("Request must be a JSON object")
    return value


def text(value, name, limit=MAX_FEEDBACK):
    if not isinstance(value, str) or len(value) > limit:
        raise DiagramError("%s must be a string of at most %d characters" % (name, limit))
    try:
        value.encode("utf-8")
    except UnicodeError:
        raise DiagramError(name + " contains invalid Unicode")
    if any(ord(c) < 32 and c not in "\t\n\r" for c in value):
        raise DiagramError(name + " contains control characters")
    return value


def normalize_graph(value, approval=False):
    """Validate and copy only contract fields; never persist React Flow internals."""
    errors = []
    if not isinstance(value, dict):
        raise DiagramError("Graph must be an object", code="invalid_graph")

    def fail(path, message):
        errors.append({"path": path, "message": message})

    def string(raw, path, limit, default=""):
        try:
            return text(raw, path, limit)
        except DiagramError as exc:
            fail(path, str(exc))
            return default

    if type(value.get("schemaVersion")) is not int or value["schemaVersion"] != 1:
        fail("schemaVersion", "must be 1")
    graph = {"schemaVersion": 1}
    for name, maximum in (("title", 500), ("description", 50000), ("constraints", 100000)):
        graph[name] = string(value.get(name, ""), name, maximum)
    nodes = value.get("nodes", [])
    edges = value.get("edges", [])
    if not isinstance(nodes, list) or len(nodes) > MAX_NODES:
        fail("nodes", "must be an array with at most %d nodes" % MAX_NODES)
        nodes = []
    if not isinstance(edges, list) or len(edges) > MAX_EDGES:
        fail("edges", "must be an array with at most %d edges" % MAX_EDGES)
        edges = []
    node_ids = set()
    edge_ids = set()
    graph["nodes"] = []
    graph["edges"] = []
    for index, node in enumerate(nodes):
        path = "nodes[%d]" % index
        if not isinstance(node, dict):
            fail(path, "must be an object")
            continue
        node_id = string(node.get("id", ""), path + ".id", 128)
        if not node_id.strip() or node_id in node_ids:
            fail(path + ".id", "must be nonempty and unique")
        node_ids.add(node_id)
        kind = node.get("type")
        if kind not in ("start", "step", "decision", "end"):
            fail(path + ".type", "must be start, step, decision, or end")
        position = node.get("position")
        if not isinstance(position, dict):
            fail(path + ".position", "must contain finite x and y coordinates")
            position = {}
        pos = {}
        for coordinate in ("x", "y"):
            number = position.get(coordinate)
            if type(number) not in (int, float) or not -1000000 <= number <= 1000000:
                fail(path + ".position." + coordinate, "must be finite and between -1000000 and 1000000")
                number = 0
            pos[coordinate] = number
        data = node.get("data", {})
        if not isinstance(data, dict):
            fail(path + ".data", "must be an object")
            data = {}
        label = string(data.get("label", ""), path + ".data.label", 2000)
        notes = string(data.get("notes", ""), path + ".data.notes", 50000)
        executor = data.get("executor", "program")
        if executor not in ("program", "llm", "human"):
            fail(path + ".data.executor", "must be program, llm, or human")
        expanded = data.get("expanded", False)
        if type(expanded) is not bool:
            fail(path + ".data.expanded", "must be boolean")
        if approval and not label.strip():
            fail(path + ".data.label", "is required for approval")
        graph["nodes"].append({"id": node_id, "type": kind, "position": pos,
                               "data": {"label": label, "notes": notes,
                                        "executor": executor, "expanded": expanded}})
    for index, edge in enumerate(edges):
        path = "edges[%d]" % index
        if not isinstance(edge, dict):
            fail(path, "must be an object")
            continue
        edge_id = string(edge.get("id", ""), path + ".id", 128)
        if not edge_id.strip() or edge_id in edge_ids:
            fail(path + ".id", "must be nonempty and unique")
        edge_ids.add(edge_id)
        endpoints = {}
        for name in ("source", "target"):
            endpoints[name] = string(edge.get(name, ""), path + "." + name, 128)
            if endpoints[name] not in node_ids:
                fail(path + "." + name, "must reference an existing node")
        label = string(edge.get("label", ""), path + ".label", 2000)
        source_handle = edge.get("sourceHandle", "bottom")
        target_handle = edge.get("targetHandle", "top")
        if source_handle not in ("bottom", "left", "right"):
            fail(path + ".sourceHandle", "must be bottom, left, or right")
        if target_handle not in ("top", "left-in", "right-in"):
            fail(path + ".targetHandle", "must be top, left-in, or right-in")
        graph["edges"].append(dict(endpoints, id=edge_id, label=label,
                                   sourceHandle=source_handle, targetHandle=target_handle))
    if approval:
        if not graph["title"].strip():
            fail("title", "is required for approval")
        if not graph["nodes"]:
            fail("nodes", "at least one node is required for approval")
        for index, node in enumerate(graph["nodes"]):
            if node["type"] == "decision":
                outgoing = [edge for edge in graph["edges"] if edge["source"] == node["id"]]
                if len(outgoing) < 2 or any(not edge["label"].strip() for edge in outgoing):
                    fail("nodes[%d]" % index, "decisions require at least two outgoing edges, each with a condition label")
    if not errors:
        try:
            if len(json_bytes(graph)) > MAX_GRAPH_BYTES:
                fail("graph", "exceeds the 2 MiB serialized size limit")
        except (ValueError, UnicodeError, RecursionError):
            fail("graph", "cannot be serialized")
    if errors:
        raise DiagramError("Graph validation failed", code="invalid_graph", details=errors)
    return graph


def decode_png(value):
    """Validate PNG framing, CRCs, image parameters and the complete scanline stream."""
    def invalid(reason):
        raise DiagramError("Invalid PNG: " + reason, code="invalid_png")

    prefix = "data:image/png;base64,"
    if not isinstance(value, str) or not value.startswith(prefix):
        invalid("expected a data:image/png;base64 URL")
    encoded = value[len(prefix):]
    if len(encoded) > 4 * ((MAX_PNG_BYTES + 2) // 3):
        invalid("exceeds the 5 MiB size limit")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        invalid("malformed base64")
    validate_png(raw)
    return raw


def validate_png(raw):
    def invalid(reason):
        raise DiagramError("Invalid PNG: " + reason, code="invalid_png")

    if not isinstance(raw, bytes) or len(raw) > MAX_PNG_BYTES or not raw.startswith(PNG_SIGNATURE):
        invalid("wrong signature or excessive size")
    offset = len(PNG_SIGNATURE)
    chunks = 0
    header = None
    palette = None
    transparency = False
    idat = []
    idat_finished = False
    ended = False
    ancillary_seen = set()
    while offset < len(raw):
        if len(raw) - offset < 12:
            invalid("truncated chunk")
        length = struct.unpack_from(">I", raw, offset)[0]
        kind = raw[offset + 4:offset + 8]
        end = offset + 12 + length
        if end > len(raw) or not re.fullmatch(b"[A-Za-z]{4}", kind) or kind[2] & 32:
            invalid("invalid chunk framing")
        data = raw[offset + 8:offset + 8 + length]
        crc = struct.unpack_from(">I", raw, offset + 8 + length)[0]
        if binascii.crc32(kind + data) & 0xffffffff != crc:
            invalid("chunk CRC mismatch")
        if chunks == 0 and kind != b"IHDR":
            invalid("IHDR must be first")
        if kind == b"IHDR":
            if header is not None or length != 13:
                invalid("invalid IHDR")
            header = struct.unpack(">IIBBBBB", data)
            width, height, depth, color, compression, filtering, interlace = header
            depths = {0: (1, 2, 4, 8, 16), 2: (8, 16), 3: (1, 2, 4, 8), 4: (8, 16), 6: (8, 16)}
            if (not width or not height or width > MAX_PNG_DIMENSION or height > MAX_PNG_DIMENSION
                    or width * height > MAX_PNG_PIXELS):
                invalid("unreasonable dimensions")
            if color not in depths or depth not in depths[color] or compression or filtering or interlace not in (0, 1):
                invalid("unsupported image parameters")
        elif kind == b"PLTE":
            if palette is not None or idat or length == 0 or length % 3 or length > 768 or header[3] in (0, 4):
                invalid("invalid palette")
            palette = length // 3
            if header[3] == 3 and palette > 2 ** header[2]:
                invalid("palette exceeds bit depth")
        elif kind == b"tRNS":
            color = header[3]
            if (transparency or idat or color in (4, 6)
                    or (color == 0 and length != 2) or (color == 2 and length != 6)
                    or (color == 3 and (palette is None or not 1 <= length <= palette))):
                invalid("invalid transparency chunk")
            transparency = True
        elif kind == b"IDAT":
            if idat_finished or (header[3] == 3 and palette is None):
                invalid("invalid IDAT sequence")
            idat.append(data)
        elif kind == b"IEND":
            if length or not idat or end != len(raw):
                invalid("invalid IEND or trailing data")
            ended = True
        elif kind in (b"sRGB", b"gAMA", b"cHRM", b"pHYs"):
            # A bounded subset used by browser PNG encoders. Compressed metadata
            # is never needed for a rendered diagram and can expand catastrophically
            # in a downstream image reader even when the pixel stream is tiny.
            sizes = {b"sRGB": 1, b"gAMA": 4, b"cHRM": 32, b"pHYs": 9}
            if idat or kind in ancillary_seen or length != sizes[kind]:
                invalid("invalid or misplaced color/physical metadata")
            if ((kind == b"sRGB" and data[0] > 3) or
                    (kind == b"gAMA" and struct.unpack(">I", data)[0] == 0) or
                    (kind == b"pHYs" and data[-1] > 1)):
                invalid("invalid color/physical metadata")
            ancillary_seen.add(kind)
        elif not kind[0] & 32:
            invalid("unknown critical chunk")
        else:
            invalid("unsupported ancillary metadata; use the browser's PNG export")
        if idat and kind not in (b"IDAT", b"IEND"):
            idat_finished = True
        offset = end
        chunks += 1
        if chunks > 10000:
            invalid("too many chunks")
    if not ended or header is None:
        invalid("missing complete IEND")
    width, height, depth, color, _, _, interlace = header
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color]
    passes = [(0, 0, 1, 1)] if not interlace else [
        (0, 0, 8, 8), (4, 0, 8, 8), (0, 4, 4, 8), (2, 0, 4, 4),
        (0, 2, 2, 4), (1, 0, 2, 2), (0, 1, 1, 2)]
    rows = []
    for x, y, dx, dy in passes:
        w = max(0, (width - x + dx - 1) // dx)
        h = max(0, (height - y + dy - 1) // dy)
        if w and h:
            rows.append((h, (w * channels * depth + 7) // 8 + 1))
    expected = sum(count * size for count, size in rows)
    if expected > MAX_PNG_RAW_BYTES:
        invalid("decompressed image exceeds the size limit")
    try:
        decoder = zlib.decompressobj()
        scanlines = decoder.decompress(b"".join(idat), expected + 1)
        if (len(scanlines) != expected or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail):
            invalid("incomplete or oversized compressed pixel stream")
    except zlib.error:
        invalid("invalid compressed pixel stream")
    offset = 0
    for count, size in rows:
        for _ in range(count):
            if scanlines[offset] > 4:
                invalid("invalid scanline filter")
            offset += size
    return raw


def markdown_inline(value):
    # Escape structure as well as HTML. Newlines cannot create extra table rows/headings.
    value = html.escape(str(value), quote=False).replace("\r\n", "\n").replace("\r", "\n")
    value = value.replace("\n", " / ")
    return re.sub(r"([\\`*_{}\[\]()#+.!|>~-])", r"\\\1", value)


def markdown_notes(value):
    # Preserve tables, lists, emphasis and fenced code, but disable HTML, image/link
    # syntax and reference resources. Entities are resolved *after* Markdown parsing.
    return html.escape(value, quote=False).replace("[", "&#91;").replace("]", "&#93;")


def graph_markdown(graph, feedback=""):
    lines = ["# " + markdown_inline(graph["title"] or "Untitled diagram"), "",
             "## Description", "", markdown_notes(graph["description"]) or "_None._", "",
             "## Constraints", "", markdown_notes(graph["constraints"]) or "_None._", "",
             "## Nodes", ""]
    for index, node in enumerate(graph["nodes"], 1):
        data = node["data"]
        lines.extend(["### %d. %s" % (index, markdown_inline(data["label"] or "Untitled node")), "",
                      "- ID: " + markdown_inline(node["id"]),
                      "- Type: " + node["type"], "- Executor: " + data["executor"],
                      "- Position: (%s, %s)" % (node["position"]["x"], node["position"]["y"]),
                      "- Expanded in editor: " + str(data["expanded"]).lower(), "",
                      markdown_notes(data["notes"]) or "_No notes._", ""])
    if not graph["nodes"]:
        lines.extend(["_No nodes._", ""])
    lines.extend(["## Edges", "", "| ID | Source | Target | Condition / label | Source handle | Target handle |",
                  "| --- | --- | --- | --- | --- | --- |"])
    for edge in graph["edges"]:
        lines.append("| " + " | ".join(markdown_inline(edge[name]) for name in
                     ("id", "source", "target", "label", "sourceHandle", "targetHandle")) + " |")
    lines.extend(["", "## Feedback", "", markdown_notes(feedback) or "_None._", ""])
    return "\n".join(lines)


def _fs_error(exc):
    if exc.errno in (errno.ELOOP, errno.ENOTDIR):
        return DiagramError("Symlink or non-directory in a confined storage path", 400, "unsafe_path")
    if exc.errno in (errno.EACCES, errno.EPERM):
        return DiagramError("Storage permission denied", 403, "storage_permission")
    return DiagramError("Storage operation failed", 500, "storage_error")


class Directory:
    """Directory-FD-relative I/O: components never follow symlinks, even in races."""
    def __init__(self, fd):
        self.fd = fd

    def __enter__(self):
        return self

    def __exit__(self, *args):
        os.close(self.fd)

    @staticmethod
    def component(name):
        if not isinstance(name, str) or name in (".", "..") or not COMPONENT_RE.fullmatch(name):
            raise DiagramError("Unsafe filesystem component", code="unsafe_path")
        return name

    @classmethod
    def open(cls, path):
        try:
            fd = os.open(str(path), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            return cls(fd)
        except OSError as exc:
            raise _fs_error(exc)

    def child(self, name, create=False):
        self.component(name)
        try:
            if create:
                try:
                    os.mkdir(name, 0o700, dir_fd=self.fd)
                    os.fsync(self.fd)
                except FileExistsError:
                    pass
            return Directory(os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=self.fd))
        except FileNotFoundError:
            raise DiagramError("Not found", 404, "not_found")
        except OSError as exc:
            raise _fs_error(exc)

    def names(self):
        return os.listdir(self.fd)

    def read(self, name, limit=MAX_STATE_BYTES, private=False):
        self.component(name)
        try:
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=self.fd)
            with os.fdopen(fd, "rb") as stream:
                info = os.fstat(stream.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                    raise DiagramError("Unsafe storage file", code="unsafe_path")
                if private and ((info.st_mode & 0o077) or (hasattr(os, "getuid") and info.st_uid != os.getuid())):
                    raise DiagramError("Server descriptor must be private and owned by the current user", code="unsafe_path")
                if info.st_size > limit:
                    raise DiagramError("Stored file exceeds size limit", code="file_too_large")
                raw = stream.read(limit + 1)
                if len(raw) > limit:
                    raise DiagramError("Stored file exceeds size limit", code="file_too_large")
                return raw
        except FileNotFoundError:
            raise DiagramError("Not found", 404, "not_found")
        except OSError as exc:
            raise _fs_error(exc)

    def atomic_write(self, name, raw):
        self.component(name)
        temporary = ".tmp-" + uuid.uuid4().hex
        try:
            try:
                info = os.stat(name, dir_fd=self.fd, follow_symlinks=False)
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                    raise DiagramError("Unsafe storage destination", code="unsafe_path")
            except FileNotFoundError:
                pass
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=self.fd)
            with os.fdopen(fd, "wb") as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, name, src_dir_fd=self.fd, dst_dir_fd=self.fd)
            os.fsync(self.fd)
        except OSError as exc:
            raise _fs_error(exc)
        finally:
            try:
                os.unlink(temporary, dir_fd=self.fd)
            except FileNotFoundError:
                pass

    def unlink(self, name):
        self.component(name)
        try:
            os.unlink(name, dir_fd=self.fd)
            os.fsync(self.fd)
        except FileNotFoundError:
            pass
        except OSError as exc:
            raise _fs_error(exc)

    @contextlib.contextmanager
    def lock(self, name, blocking=True, timeout=10):
        self.component(name)
        fd = None
        acquired = False
        try:
            fd = os.open(name, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600, dir_fd=self.fd)
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise DiagramError("Unsafe lock file", code="unsafe_path")
            os.fchmod(fd, 0o600)
            if fcntl is None:
                raise DiagramError("This platform lacks secure directory locking support", 500, "unsupported_platform")
            deadline = time.monotonic() + timeout
            while True:
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    acquired = True
                    break
                except BlockingIOError:
                    if not blocking:
                        raise DiagramError("A server is already running for this project", 409, "server_busy")
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise DiagramError("Project storage is busy; retry shortly", 503, "storage_busy")
                    time.sleep(min(0.02, remaining))
            yield
        except OSError as exc:
            raise _fs_error(exc)
        finally:
            if fd is not None:
                if acquired:
                    fcntl.flock(fd, fcntl.LOCK_UN)
                os.close(fd)


class Store:
    def __init__(self, project):
        self.project = Path(project).expanduser().resolve()
        if not self.project.is_dir():
            raise DiagramError("Project must be an existing directory", code="invalid_project")
        self.root_path = self.project / ".diagram-skill"
        self._thread_lock = threading.RLock()

    @contextlib.contextmanager
    def root(self):
        with Directory.open(self.project) as project:
            with project.child(".diagram-skill", create=True) as root:
                info = os.fstat(root.fd)
                if hasattr(os, "getuid") and info.st_uid != os.getuid():
                    raise DiagramError("Storage directory is not owned by the current user", code="unsafe_path")
                os.fchmod(root.fd, 0o700)
                yield root

    @contextlib.contextmanager
    def transaction(self, lock_timeout=10):
        started = time.monotonic()
        if not self._thread_lock.acquire(timeout=lock_timeout):
            raise DiagramError("Project storage is busy; retry shortly", 503, "storage_busy")
        try:
            with self.root() as root:
                with root.lock("transaction.lock", timeout=max(0, lock_timeout - (time.monotonic() - started))):
                    with root.child("tasks", create=True) as tasks:
                        yield root, tasks
        finally:
            self._thread_lock.release()

    def _state(self, task):
        value = parse_json(task.read("state.json"))
        if (not isinstance(value, dict) or not isinstance(value.get("versions"), list)
                or type(value.get("revision")) is not int or value["revision"] < 1
                or value.get("status") not in ("draft", "awaiting_agent", "approved", "cancelled")):
            raise DiagramError("Corrupt task state", 500, "corrupt_state")
        validate_id(value.get("id"), "stored task id")
        for version in value["versions"]:
            if not isinstance(version, dict):
                raise DiagramError("Corrupt version metadata", 500, "corrupt_state")
            validate_id(version.get("id"), "stored version id")
        return value

    def _publish(self, task, state):
        raw = json_bytes(state)
        if len(raw) > MAX_STATE_BYTES:
            raise DiagramError("Task history exceeds the storage limit", 409, "history_full")
        task.atomic_write("state.json", raw)

    def _snapshot(self, task, state, kind, png=None):
        version_id = "v-" + uuid.uuid4().hex
        metadata = {"id": version_id, "kind": kind, "createdAt": state["updatedAt"],
                    "revision": state["revision"], "feedback": state["feedback"],
                    "hasPng": png is not None, "title": state["graph"]["title"]}
        artifacts = {"diagram.json": json_bytes(state["graph"]),
                     "diagram.md": graph_markdown(state["graph"], state["feedback"]).encode("utf-8")}
        if png is not None:
            artifacts["diagram.png"] = png
        manifest = dict(metadata, hashes={name: hashlib.sha256(raw).hexdigest()
                                          for name, raw in artifacts.items()})
        pending = ".pending-" + uuid.uuid4().hex
        with task.child("versions", create=True) as versions:
            with versions.child(pending, create=True) as snapshot:
                for name, raw in artifacts.items():
                    snapshot.atomic_write(name, raw)
                snapshot.atomic_write("metadata.json", json_bytes(manifest))
            os.rename(pending, version_id, src_dir_fd=versions.fd, dst_dir_fd=versions.fd)
            os.fsync(versions.fd)
        state["versions"].append(metadata)
        return version_id

    def create(self, title, mode="manual", graph=None):
        title = text(title, "title", 500)
        if mode not in ("manual", "agent"):
            raise DiagramError("mode must be manual or agent")
        if graph is None:
            graph = {"schemaVersion": 1, "title": title, "nodes": [], "edges": []}
        else:
            require_object(graph)
            graph = dict(graph)
            graph.setdefault("title", title)
        graph = normalize_graph(graph)
        timestamp = now()
        task_id = "t-" + uuid.uuid4().hex
        state = {"id": task_id, "mode": mode, "status": "draft", "revision": 1,
                 "graph": graph, "feedback": "", "requestId": None, "approvedVersion": None,
                 "createdAt": timestamp, "updatedAt": timestamp, "versions": []}
        with self.transaction() as (_, tasks):
            pending = ".pending-" + uuid.uuid4().hex
            with tasks.child(pending, create=True) as task:
                self._snapshot(task, state, "initial")
                self._publish(task, state)
            os.rename(pending, task_id, src_dir_fd=tasks.fd, dst_dir_fd=tasks.fd)
            os.fsync(tasks.fd)
        return state

    def list_tasks(self):
        result = []
        with self.transaction() as (_, tasks):
            for task_id in tasks.names():
                if not ID_RE.fullmatch(task_id):
                    continue
                with tasks.child(task_id) as task:
                    state = self._state(task)
                    result.append({"id": state["id"], "title": state["graph"]["title"],
                                   "status": state["status"], "revision": state["revision"],
                                   "updatedAt": state["updatedAt"], "mode": state["mode"]})
        return sorted(result, key=lambda item: (item["updatedAt"], item["id"]), reverse=True)

    def get_task(self, task_id, lock_timeout=10):
        validate_id(task_id, "task id")
        with self.transaction(lock_timeout) as (_, tasks):
            with tasks.child(task_id) as task:
                return self._state(task)

    def _version(self, task, state, version_id):
        validate_id(version_id, "version id")
        entry = next((item for item in state["versions"] if item["id"] == version_id), None)
        if entry is None:
            raise DiagramError("Version not found", 404, "not_found")
        with task.child("versions") as versions:
            with versions.child(version_id) as snapshot:
                metadata = parse_json(snapshot.read("metadata.json"))
                if not isinstance(metadata, dict) or any(metadata.get(key) != val for key, val in entry.items()):
                    raise DiagramError("Version metadata does not match published state", 500, "corrupt_snapshot")
                raw = snapshot.read("diagram.json", MAX_GRAPH_BYTES)
                self._verify_hash(metadata, "diagram.json", raw)
                graph = normalize_graph(parse_json(raw))
                return dict(metadata, graph=graph)

    @staticmethod
    def _verify_hash(metadata, name, raw):
        hashes = metadata.get("hashes")
        if not isinstance(hashes, dict) or hashes.get(name) != hashlib.sha256(raw).hexdigest():
            raise DiagramError("Snapshot artifact checksum mismatch", 500, "corrupt_snapshot")

    def get_version(self, task_id, version_id):
        validate_id(task_id, "task id")
        with self.transaction() as (_, tasks):
            with tasks.child(task_id) as task:
                return self._version(task, self._state(task), version_id)

    def artifact(self, task_id, version_id, filename):
        validate_id(task_id, "task id")
        validate_id(version_id, "version id")
        if filename not in ("diagram.json", "diagram.md", "diagram.png"):
            raise DiagramError("Artifact not found", 404, "not_found")
        with self.transaction() as (_, tasks):
            with tasks.child(task_id) as task:
                state = self._state(task)
                entry = next((v for v in state["versions"] if v["id"] == version_id), None)
                if entry is None or (filename == "diagram.png" and not entry["hasPng"]):
                    raise DiagramError("Artifact not found", 404, "not_found")
                metadata = self._version(task, state, version_id)
                with task.child("versions") as versions:
                    with versions.child(version_id) as snapshot:
                        raw = snapshot.read(filename, MAX_STATE_BYTES)
                        self._verify_hash(metadata, filename, raw)
                        return raw

    def mutate(self, task_id, action, body):
        validate_id(task_id, "task id")
        require_object(body)
        revision = body.get("revision")
        if type(revision) is not int or revision < 1:
            raise DiagramError("revision must be a positive integer")
        allowed = {"draft": ("draft",), "checkpoint": ("draft",), "submit": ("draft",),
                   "approve": ("draft",), "cancel": ("draft", "awaiting_agent"),
                   "resume": ("awaiting_agent", "cancelled"), "revise": ("awaiting_agent",),
                   "restore": ("draft", "awaiting_agent", "approved", "cancelled")}
        if action not in allowed:
            raise DiagramError("Unknown mutation", 404, "not_found")
        with self.transaction() as (_, tasks):
            with tasks.child(task_id) as task:
                state = self._state(task)
                if revision != state["revision"]:
                    raise DiagramError("Revision conflict; reload the current task before retrying", 409,
                                       "revision_conflict", {"revision": state["revision"]})
                if state["status"] not in allowed[action]:
                    raise DiagramError("Cannot %s a task in status %s" % (action, state["status"]),
                                       409, "invalid_state")
                if action == "revise":
                    request_id = body.get("requestId")
                    if not isinstance(request_id, str) or not request_id or request_id != state["requestId"]:
                        raise DiagramError("Agent request is no longer current", 409, "request_conflict")
                png = None
                kind = None
                if action in ("draft", "checkpoint", "submit", "approve", "revise"):
                    state["graph"] = normalize_graph(body.get("graph"), approval=(action == "approve"))
                if action == "cancel" and "graph" in body:
                    state["graph"] = normalize_graph(body["graph"])
                if action in ("checkpoint", "submit", "approve"):
                    png = decode_png(body.get("png"))
                    kind = {"checkpoint": "checkpoint", "submit": "submitted", "approve": "approved"}[action]
                if action == "submit":
                    feedback = text(body.get("feedback"), "feedback")
                    if not feedback.strip():
                        raise DiagramError("Submission requires nonblank feedback")
                    state["feedback"] = feedback
                    state["requestId"] = "req-" + uuid.uuid4().hex
                    state["status"] = "awaiting_agent"
                elif action in ("resume", "revise", "restore"):
                    if action == "restore":
                        restored = self._version(task, state, body.get("versionId"))
                        state["graph"] = restored["graph"]
                        kind = "restore"
                    elif action == "revise":
                        kind = "agent_revision"
                    state["status"] = "draft"
                    state["requestId"] = None
                    state["approvedVersion"] = None
                elif action == "cancel":
                    state["status"] = "cancelled"
                    state["requestId"] = None
                elif action == "approve":
                    state["status"] = "approved"
                    state["requestId"] = None
                state["revision"] += 1
                state["updatedAt"] = now()
                if kind:
                    version_id = self._snapshot(task, state, kind, png)
                    if action == "approve":
                        state["approvedVersion"] = version_id
                self._publish(task, state)
                return state

    def export(self, task_id, version_id=None, lock_timeout=10):
        validate_id(task_id, "task id")
        with self.transaction(lock_timeout) as (_, tasks):
            with tasks.child(task_id) as task:
                state = self._state(task)
                if version_id is None:
                    handoffs = [v for v in state["versions"] if v["kind"] in ("submitted", "approved")]
                    version_id = (handoffs or state["versions"])[-1]["id"]
                version = self._version(task, state, version_id)
                base = self.root_path / "tasks" / task_id / "versions" / version_id
                paths = {"json": str(base / "diagram.json"), "markdown": str(base / "diagram.md"), "png": None}
                with task.child("versions") as versions:
                    with versions.child(version_id) as snapshot:
                        markdown = snapshot.read("diagram.md")
                        self._verify_hash(version, "diagram.md", markdown)
                        if version["hasPng"]:
                            png = snapshot.read("diagram.png", MAX_PNG_BYTES)
                            self._verify_hash(version, "diagram.png", png)
                            validate_png(png)
                            paths["png"] = str(base / "diagram.png")
                return {"taskId": task_id, "versionId": version_id, "kind": version["kind"],
                        "revision": version["revision"], "hasPng": version["hasPng"], "paths": paths}

    def read_descriptor(self):
        with self.transaction() as (root, _):
            try:
                value = parse_json(root.read("server.json", 8192, private=True))
            except DiagramError as exc:
                if exc.status == 404:
                    return None
                if exc.code == "invalid_request":
                    return None  # A malformed non-symlink descriptor can be replaced under the server lock.
                raise
            if not isinstance(value, dict):
                return None
            if not isinstance(value.get("project"), str):
                return None
            if value["project"] != str(self.project):
                raise DiagramError("Server descriptor belongs to a different project", code="unsafe_descriptor")
            if (value.get("protocol") != PROTOCOL or type(value.get("port")) is not int
                    or not 1 <= value["port"] <= 65535 or type(value.get("pid")) is not int
                    or not isinstance(value.get("token"), str)
                    or not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", value["token"])
                    or not isinstance(value.get("serverId"), str)
                    or not ID_RE.fullmatch(value["serverId"])):
                return None
            return value

    def write_descriptor(self, value):
        with self.transaction() as (root, _):
            root.atomic_write("server.json", json_bytes(value))

    def remove_descriptor(self, expected):
        with self.transaction() as (root, _):
            try:
                current = parse_json(root.read("server.json", 8192, private=True))
            except DiagramError as exc:
                if exc.status == 404:
                    return
                raise
            identity = ("project", "port", "token", "serverId")
            if isinstance(current, dict) and all(current.get(key) == expected.get(key) for key in identity):
                root.unlink("server.json")
