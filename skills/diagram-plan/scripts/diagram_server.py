"""Authenticated, loopback-only HTTP service and safe per-project server lifecycle."""

import contextlib
import hashlib
import hmac
import http.client
import http.server
import mimetypes
import os
import secrets
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from diagram_core import (DiagramError, Directory, MAX_BODY_BYTES, MAX_STATE_BYTES,
                          PROTOCOL, Store, json_bytes, parse_json, require_object)

SCRIPT = Path(__file__).resolve().with_name("diagram.py")
WEB = Path(__file__).resolve().parent.parent / "web"
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
       "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; "
       "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")


class DiagramHTTPServer(http.server.ThreadingHTTPServer):
    # Non-daemon request threads are drained before descriptor removal, so shutdown
    # never interrupts an in-flight durable transaction.
    daemon_threads = False
    block_on_close = True
    allow_reuse_address = True

    def __init__(self, store, port=0, token=None, server_id=None, web_path=None):
        self.store = store
        self.token = token or secrets.token_urlsafe(32)
        self.server_id = server_id or secrets.token_hex(16)
        self.web_path = Path(web_path) if web_path is not None else WEB
        public_root = self.web_path.resolve()
        if store.project == public_root or public_root in store.project.parents:
            raise DiagramError("Project storage must be outside the bundled web directory", code="unsafe_project")
        self.header_timeout = 5.0
        self.slots = threading.BoundedSemaphore(24)
        super().__init__(("127.0.0.1", port), Handler)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            try:
                request.settimeout(1)
                request.sendall(b"HTTP/1.0 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
            except OSError:
                pass
            finally:
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()

    def handle_error(self, request, client_address):
        # Never put request contents or authorization credentials in a log.
        pass


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"  # Deliberately no persistent request/pipelining ambiguity.
    server_version = "DiagramPlan/1"
    sys_version = ""

    def setup(self):
        self.request.settimeout(5)
        super().setup()

    def parse_request(self):
        # The timer covers the request line AND all headers, not just socket inactivity.
        try:
            valid = super().parse_request()
        finally:
            with self._header_guard:
                self._reading_headers = False
            self._header_timer.cancel()
        return valid and not self._header_expired

    def expire_headers(self):
        with self._header_guard:
            if not self._reading_headers:
                return
            self._header_expired = True
            self._reading_headers = False
            with contextlib.suppress(OSError):
                self.connection.shutdown(socket.SHUT_RDWR)

    def log_message(self, format, *args):
        pass

    def end_headers(self):
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        super().end_headers()

    def send_error(self, code, message=None, explain=None):
        # Also make BaseHTTPRequestHandler's parse/method errors JSON, never HTML.
        self.respond(code, {"error": message or self.responses.get(code, ("Request failed",))[0]})

    def respond(self, status, value, content_type="application/json; charset=utf-8", filename=None):
        raw = value if isinstance(value, bytes) else json_bytes(value)
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(raw)))
        if status == 401:
            self.send_header("WWW-Authenticate", "Bearer")
        if filename:
            self.send_header("Content-Disposition", 'attachment; filename="%s"' % filename)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(raw)

    def security(self):
        hosts = self.headers.get_all("Host", [])
        port = self.server.server_address[1]
        allowed = ("127.0.0.1:%d" % port, "localhost:%d" % port)
        if len(hosts) != 1 or hosts[0] not in allowed:
            raise DiagramError("Invalid Host header", 403, "invalid_host")
        origins = self.headers.get_all("Origin", [])
        if origins and (len(origins) != 1 or origins[0] != "http://" + hosts[0]):
            raise DiagramError("Origin must match this local server", 403, "invalid_origin")
        if self.headers.get("Sec-Fetch-Site") not in (None, "none", "same-origin"):
            raise DiagramError("Cross-origin requests are not allowed", 403, "invalid_origin")

    def authorize(self):
        values = self.headers.get_all("Authorization", [])
        expected = "Bearer " + self.server.token
        # Compare bytes: a malformed non-ASCII header must not throw a TypeError.
        if len(values) != 1 or not hmac.compare_digest(values[0].encode("utf-8"), expected.encode("ascii")):
            raise DiagramError("A valid bearer token is required", 401, "unauthorized")
        # CLI probes additionally bind the token to the descriptor's exact instance
        # and project. These optional headers do not change browser API requests.
        identities = {"X-Diagram-Instance": self.server.server_id,
                      "X-Diagram-Project": hashlib.sha256(str(self.server.store.project).encode("utf-8")).hexdigest()}
        for name, expected in identities.items():
            values = self.headers.get_all(name, [])
            if values and (len(values) != 1 or values[0] != expected):
                raise DiagramError("Server instance does not match this project", 409, "server_conflict")

    def body(self):
        if self.headers.get_all("Transfer-Encoding", []):
            raise DiagramError("Transfer-Encoding is not supported")
        lengths = self.headers.get_all("Content-Length", [])
        if len(lengths) != 1 or not lengths[0].isdigit():
            raise DiagramError("A single Content-Length is required", 411, "length_required")
        if len(lengths[0]) > 10:
            raise DiagramError("Request body exceeds the 10 MiB limit", 413, "body_too_large")
        length = int(lengths[0])
        if length > MAX_BODY_BYTES:
            raise DiagramError("Request body exceeds the 10 MiB limit", 413, "body_too_large")
        content_types = self.headers.get_all("Content-Type", [])
        if len(content_types) != 1 or content_types[0].split(";", 1)[0].strip().lower() != "application/json":
            raise DiagramError("Content-Type must be application/json", 415, "unsupported_media_type")
        deadline = time.monotonic() + 15
        parts = []
        remaining = length
        while remaining:
            seconds = deadline - time.monotonic()
            if seconds <= 0:
                raise DiagramError("Request body timed out", 408, "request_timeout")
            self.connection.settimeout(min(5, seconds))
            part = self.rfile.read1(min(65536, remaining))
            if not part:
                raise DiagramError("Truncated request body")
            parts.append(part)
            remaining -= len(part)
        return require_object(parse_json(b"".join(parts)))

    def route(self):
        self.security()
        if not self.path.startswith("/") or self.path.startswith("//"):
            raise DiagramError("Invalid request path", code="unsafe_path")
        try:
            path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path, errors="strict")
        except (ValueError, UnicodeError):
            raise DiagramError("Invalid request path", code="unsafe_path")
        if path.startswith("//") or "\\" in path or any(ord(character) < 32 for character in path):
            raise DiagramError("Invalid request path", code="unsafe_path")
        parts = path.lstrip("/").split("/") if path != "/" else []
        if any(part in (".", "..", "") for part in parts):
            raise DiagramError("Invalid request path", code="unsafe_path")
        method = self.command
        if parts and parts[0] == "api":
            if parts == ["api", "health"] and method in ("GET", "HEAD"):
                self.respond(200, {"ok": True, "protocol": PROTOCOL})
                return
            self.authorize()
            store = self.server.store
            if parts == ["api", "shutdown"] and method == "POST":
                body = self.body()
                if body.get("serverId") != self.server.server_id:
                    raise DiagramError("Server instance no longer matches", 409, "server_conflict")
                self.respond(200, {"ok": True, "serverId": self.server.server_id})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return
            if parts == ["api", "tasks"]:
                if method == "GET":
                    self.respond(200, store.list_tasks())
                    return
                if method == "POST":
                    body = self.body()
                    self.respond(201, store.create(body.get("title", ""), body.get("mode", "manual"), body.get("graph")))
                    return
            if len(parts) >= 3 and parts[:2] == ["api", "tasks"]:
                task_id = parts[2]
                if len(parts) == 3 and method == "GET":
                    self.respond(200, store.get_task(task_id))
                    return
                if len(parts) == 4:
                    action = parts[3]
                    if ((method == "PUT" and action == "draft") or
                            (method == "POST" and action in ("checkpoint", "submit", "approve", "cancel", "resume", "restore", "revise"))):
                        self.respond(200, store.mutate(task_id, action, self.body()))
                        return
                if len(parts) == 5 and parts[3] == "versions" and method == "GET":
                    self.respond(200, store.get_version(task_id, parts[4]))
                    return
                if len(parts) == 6 and parts[3] == "versions" and method == "GET":
                    filename = parts[5]
                    raw = store.artifact(task_id, parts[4], filename)
                    mime = {"diagram.json": "application/json; charset=utf-8",
                            "diagram.md": "text/markdown; charset=utf-8", "diagram.png": "image/png"}[filename]
                    self.respond(200, raw, mime, filename)
                    return
            raise DiagramError("API endpoint not found", 404, "not_found")
        if method not in ("GET", "HEAD"):
            raise DiagramError("Method not allowed", 405, "method_not_allowed")
        self.static(parts or ["index.html"])

    def static(self, parts):
        # Public bundle routes only. Never expose state/credentials even if hidden
        # files accidentally appear inside the web tree after startup.
        if (any(part.startswith(".") for part in parts) or
                not (parts in (["index.html"], ["favicon.svg"]) or parts[0] == "assets")):
            raise DiagramError("Static resource not found", 404, "not_found")
        # Open each component separately using O_NOFOLLOW. No fallback to project files.
        with contextlib.ExitStack() as stack:
            root = stack.enter_context(Directory.open(self.server.web_path))
            for part in parts[:-1]:
                root = stack.enter_context(root.child(part))
            raw = root.read(parts[-1], 20 * 1024 * 1024)
        mime = mimetypes.guess_type(parts[-1])[0] or "application/octet-stream"
        if mime.startswith("text/") or mime in ("application/javascript", "application/json"):
            mime += "; charset=utf-8"
        self.respond(200, raw, mime)

    def handle(self):
        self._header_guard = threading.Lock()
        self._reading_headers = True
        self._header_expired = False
        self._header_timer = threading.Timer(self.server.header_timeout, self.expire_headers)
        self._header_timer.daemon = True
        self._header_timer.start()
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError, socket.timeout):
            pass
        finally:
            with self._header_guard:
                self._reading_headers = False
            self._header_timer.cancel()

    def dispatch(self):
        try:
            self.route()
        except DiagramError as exc:
            self.respond(exc.status, exc.payload())
        except socket.timeout:
            self.respond(408, {"error": "Request timed out", "code": "request_timeout"})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self.respond(500, {"error": "Internal server error", "code": "internal_error"})

    do_GET = dispatch
    do_HEAD = dispatch
    do_POST = dispatch
    do_PUT = dispatch
    do_DELETE = dispatch
    do_OPTIONS = dispatch
    do_PATCH = dispatch


def request(descriptor, method, path, body=None, timeout=3):
    """No proxy/environment routing: bearer credentials only reach IPv4 loopback."""
    url = "http://127.0.0.1:%d%s" % (descriptor["port"], path)
    headers = {"Authorization": "Bearer " + descriptor["token"],
               "X-Diagram-Instance": descriptor["serverId"],
               "X-Diagram-Project": hashlib.sha256(descriptor["project"].encode("utf-8")).hexdigest()}
    raw = None
    if body is not None:
        raw = json_bytes(body)
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=raw, headers=headers, method=method)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(req, timeout=timeout) as response:
            payload = response.read(MAX_STATE_BYTES + 1)
            if len(payload) > MAX_STATE_BYTES:
                raise DiagramError("Server response exceeds size limit", 502, "server_error")
            return parse_json(payload)
    except urllib.error.HTTPError as exc:
        try:
            payload = parse_json(exc.read(65536))
        except DiagramError:
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        raise DiagramError(str(payload.get("error", "Server rejected request")), exc.code,
                           payload.get("code", "server_error"), payload.get("details"))
    except (urllib.error.URLError, OSError, ValueError, http.client.HTTPException) as exc:
        raise DiagramError("Local server is unavailable", 503, "server_unavailable") from exc


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def descriptor_live(descriptor):
    if descriptor is None:
        return False
    try:
        health = request(descriptor, "GET", "/api/health", timeout=0.4)
        if health != {"ok": True, "protocol": PROTOCOL}:
            return False
        # Public health alone is insufficient: this must be the same bearer session.
        return isinstance(request(descriptor, "GET", "/api/tasks", timeout=1), list)
    except DiagramError:
        return False


def browser_url(descriptor, task_id=None):
    fragment = {"token": descriptor["token"]}
    if task_id:
        fragment["task"] = task_id
    return "http://127.0.0.1:%d/#%s" % (descriptor["port"], urllib.parse.urlencode(fragment))


def validate_port(port):
    if type(port) is not int or not 0 <= port <= 65535:
        raise DiagramError("port must be between 0 and 65535")


def start_server(store, port=0):
    validate_port(port)
    current = store.read_descriptor()
    if descriptor_live(current):
        return current, True
    # serve takes the lifetime project lock before binding or publishing. Competing
    # launchers may create a short-lived losing child but can never start two servers.
    process = subprocess.Popen([sys.executable, str(SCRIPT), "serve", "--project", str(store.project),
                                "--port", str(port)], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, close_fds=True, start_new_session=True,
                               cwd=str(SCRIPT.parent))
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        descriptor = store.read_descriptor()
        if descriptor_live(descriptor):
            process.poll()  # Reap a losing child if another launcher won the lock.
            return descriptor, False
        process.poll()
        # An exited child may simply have lost the project lock. Give the winning
        # server the complete advertised publication window, not one extra second.
        time.sleep(0.05)
    raise DiagramError("Could not start server (project already locked or port unavailable)", 503, "start_failed")


def serve(store, port=0):
    validate_port(port)
    with store.root() as root:
        with root.lock("server.lock", blocking=False):
            server = DiagramHTTPServer(store, port)
            descriptor = {"protocol": PROTOCOL, "project": str(store.project), "pid": os.getpid(),
                          "port": server.server_address[1], "token": server.token, "serverId": server.server_id}
            previous = {}

            def stop_signal(signum, frame):
                threading.Thread(target=server.shutdown, daemon=True).start()

            try:
                if threading.current_thread() is threading.main_thread():
                    for signum in (signal.SIGINT, signal.SIGTERM):
                        previous[signum] = signal.signal(signum, stop_signal)
                store.write_descriptor(descriptor)
                server.serve_forever(poll_interval=0.1)
            finally:
                server.server_close()
                store.remove_descriptor(descriptor)
                for signum, handler in previous.items():
                    signal.signal(signum, handler)


def stop_server(store):
    descriptor = store.read_descriptor()
    if descriptor is None:
        return {"stopped": False, "reason": "not_running"}
    try:
        result = request(descriptor, "POST", "/api/shutdown", {"serverId": descriptor["serverId"]})
        if not isinstance(result, dict) or result.get("serverId") != descriptor["serverId"] or result.get("ok") is not True:
            raise DiagramError("Server instance did not match", 409, "server_conflict")
    except DiagramError as exc:
        # An unresponsive port may have been recycled by another process. Never kill
        # the descriptor PID. Delete a stale descriptor only while holding its lock.
        if exc.code not in ("server_unavailable", "unauthorized", "server_error"):
            raise
        with store.root() as root:
            with root.lock("server.lock", blocking=False):
                store.remove_descriptor(descriptor)
        return {"stopped": False, "reason": "stale_descriptor"}
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        current = store.read_descriptor()
        if current is None or current["serverId"] != descriptor["serverId"]:
            return {"stopped": True}
        time.sleep(0.05)
    return {"stopped": True, "shuttingDown": True}
