"""Library client contracts: exercise the CLI and HTTP against the same project."""

import http.client
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

SCRIPT = Path(__file__).resolve().parents[1] / "skills" / "diagram-plan" / "scripts" / "diagram.py"


class LibraryAPITests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.project = temp.name
        self.addCleanup(temp.cleanup)
        self.addCleanup(self.cli, "stop")

    def cli(self, *args):
        result = subprocess.run([sys.executable, str(SCRIPT), "--project", self.project, *args],
                                capture_output=True, text=True, timeout=25)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def api(self, method, path, expected, body=None, authenticated=True):
        headers = {"Authorization": "Bearer " + self.token} if authenticated else {}
        if body is not None:
            headers["Content-Type"] = "application/json"
            body = json.dumps(body).encode()
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            connection.request(method, path, body, headers)
            response = connection.getresponse()
            payload = json.loads(response.read())
            self.assertEqual(response.status, expected, payload)
            return payload
        finally:
            connection.close()

    def test_cli_create_in_folder_and_reorder_mixed_siblings(self):
        folder = self.cli("folder-create", "--name", "Release plans")
        self.assertEqual((folder["kind"], folder["name"], folder["parentId"]), ("folder", "Release plans", None))
        parent = folder["id"]
        task = self.cli("create", "--title", "Deploy", "--parent", parent, "--no-open")["task"]
        nested = self.cli("folder-create", "--name", "Archive", "--parent", parent, "--index", "0")
        library = self.cli("library")
        self.assertEqual(library["tasks"], self.cli("list"))
        self.assertEqual([e["id"] for e in library["entries"] if e["parentId"] == parent],
                         [nested["id"], task["id"]])
        moved = self.cli("move", "--id", nested["id"], "--parent", parent, "--index", "1")
        self.assertEqual(moved, nested)
        self.assertEqual([e["id"] for e in self.cli("library")["entries"] if e["parentId"] == parent],
                         [task["id"], nested["id"]])
        self.assertIsNone(self.cli("move", "--id", task["id"])["parentId"])
        self.assertEqual([e["id"] for e in self.cli("library")["entries"] if e["parentId"] is None],
                         [parent, task["id"]])
        self.assertEqual(self.cli("show", "--task", task["id"]), task)

    def test_authenticated_http_library_routes(self):
        url = urlsplit(self.cli("start", "--no-open")["url"])
        self.port = url.port
        self.token = parse_qs(url.fragment)["token"][0]
        for method, path, body in (("GET", "/api/library", None), ("POST", "/api/folders", {"name": "Private"}),
                                   ("POST", "/api/library/move", {"id": "unused", "parentId": None})):
            with self.subTest(path=path):
                self.api(method, path, 401, body, authenticated=False)
        folder = self.api("POST", "/api/folders", 201, {"name": "Design"})
        task = self.api("POST", "/api/tasks", 201, {"title": "Design review", "parentId": folder["id"]})
        nested = self.api("POST", "/api/folders", 201, {"name": "Next", "parentId": folder["id"], "index": 0})
        self.api("POST", "/api/folders", 400, {})
        self.api("POST", "/api/library/move", 400, {"parentId": None})
        self.api("POST", "/api/library/move", 400, {"id": task["id"]})  # No implicit root on HTTP.
        library = self.api("GET", "/api/library", 200)
        self.assertEqual(library, self.cli("library"))
        self.assertEqual(library["tasks"], self.api("GET", "/api/tasks", 200))
        self.assertEqual([e["id"] for e in library["entries"] if e["parentId"] == folder["id"]],
                         [nested["id"], task["id"]])
        moved = self.api("POST", "/api/library/move", 200, {"id": task["id"], "parentId": None, "index": 0})
        self.assertEqual((moved["id"], moved["kind"], moved["parentId"]), (task["id"], "task", None))
        self.assertEqual([e["id"] for e in self.api("GET", "/api/library", 200)["entries"] if e["parentId"] is None],
                         [task["id"], folder["id"]])
