"""Run with: python3 -m unittest discover -s tests -p test_library.py -v"""

import json
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[1] / "skills" / "diagram-plan" / "scripts"
sys.path.insert(0, str(SCRIPTS))
from diagram_core import DiagramError, Directory, Store


class LibraryTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.project = Path(temp.name)
        self.store = Store(self.project)
        self.sidecar = self.store.root_path / "library.json"

    def children(self, parent=None):
        return [e["id"] for e in self.store.library()["entries"] if e["parentId"] == parent]

    def test_legacy_order_is_captured_once(self):
        first = self.store.create("first")
        second = self.store.create("second")
        self.sidecar.unlink()  # Simulate an existing project without library metadata.
        legacy = self.store.list_tasks()
        ids = [s["id"] for s in legacy]
        self.assertEqual(self.store.library(), {"tasks": legacy, "entries": [
            {"id": i, "kind": "task", "parentId": None} for i in ids]})
        older = {s["id"]: s for s in (first, second)}[ids[-1]]
        self.store.mutate(older["id"], "draft", {"revision": 1, "graph": older["graph"]})
        self.store = Store(self.project)
        self.assertEqual(self.children(), ids)
        self.assertEqual(self.store.library()["tasks"], self.store.list_tasks())
        self.assertEqual(self.store.list_tasks()[0]["id"], older["id"])

    def test_mixed_siblings_subtree_moves_and_immutable_history(self):
        task = self.store.create("root diagram")
        task_id = task["id"]
        files = self.store.root_path / "tasks" / task_id

        def history():
            return {p.relative_to(files): (p.stat().st_ino, p.read_bytes())
                    for p in files.rglob("*") if p.is_file()}

        before = history()
        folder = self.store.create_folder("design / v1", index=0)
        f = folder["id"]
        self.assertEqual(folder, {"id": f, "kind": "folder", "name": "design / v1", "parentId": None})
        sub = self.store.create_folder("nested", f)["id"]
        child = self.store.create("child diagram", parent_id=f)["id"]
        self.assertEqual(self.children(), [f, task_id])
        self.assertEqual(self.children(f), [sub, child])
        self.assertEqual(self.store.move_entry(task_id, f, 1), {"id": task_id, "kind": "task", "parentId": f})
        self.assertEqual(self.children(f), [sub, task_id, child])
        self.store.move_entry(sub, f, 2)
        self.assertEqual(self.children(f), [task_id, child, sub])
        self.store.move_entry(task_id, f)
        self.assertEqual(self.children(f), [child, sub, task_id])
        other = self.store.create_folder("other")["id"]
        self.store.move_entry(f, other)
        self.store = Store(self.project)
        self.assertEqual(self.children(other), [f])
        self.assertEqual(self.children(f), [child, sub, task_id])
        self.assertEqual(history(), before)
        self.assertEqual(set(p.name for p in files.parent.iterdir()), {task_id, child})

    def test_invalid_changes_do_not_publish(self):
        f = self.store.create_folder("folder")["id"]
        sub = self.store.create_folder("sub", f)["id"]
        task = self.store.create("diagram", parent_id=sub)["id"]
        before = self.store.library()
        invalid = [(self.store.create_folder, (name,)) for name in (None, " \t", "a\0", "x" * 501)]
        for parent in ("missing", task, "../bad", {}):
            invalid.extend([(self.store.create_folder, ("name", parent)),
                            (self.store.create, ("name", "manual", None, parent)),
                            (self.store.move_entry, (sub, parent))])
        for index in (True, -1, 2, 0.5, "0"):
            invalid.extend([(self.store.create_folder, ("name", f, index)),
                            (self.store.move_entry, (sub, f, index))])
        invalid.extend([(self.store.move_entry, (sub, f, 1)),  # zero siblings after removal
                        (self.store.move_entry, (f, f)), (self.store.move_entry, (f, sub)),
                        (self.store.move_entry, ("missing",)), (self.store.move_entry, ([],))])
        for call, args in invalid:
            with self.subTest(call=call.__name__, args=args), self.assertRaises(DiagramError):
                call(*args)
        self.assertEqual(self.store.library(), before)

    def test_flat_hierarchy_deeper_than_python_call_stack(self):
        self.store.library()
        entries = [{"id": str(i), "kind": "folder", "parentId": str(i - 1) if i else None, "name": "level"}
                   for i in range(sys.getrecursionlimit() + 10)]
        self.sidecar.write_text(json.dumps({"entries": entries[::-1]}))
        leaf = self.store.create_folder("leaf", entries[-1]["id"])["id"]
        with self.assertRaises(DiagramError):
            self.store.move_entry("0", leaf)
        self.assertEqual(self.children(entries[-1]["id"]), [leaf])

    def test_sidecar_fails_closed(self):
        self.store.create("safe")
        raw = self.sidecar.read_bytes()
        outside = self.project / "outside"
        outside.write_bytes(raw)
        self.sidecar.unlink()
        self.sidecar.symlink_to(outside)
        for operation in (self.store.library, lambda: self.store.create_folder("bad"), lambda: self.store.create("bad")):
            with self.assertRaises(DiagramError):
                operation()
        self.assertEqual(outside.read_bytes(), raw)
        self.sidecar.unlink()
        cycle = {"entries": [{"id": "f", "parentId": "f", "kind": "folder", "name": "folder"}]}
        for bad in (b"{", json.dumps(cycle).encode(), b'{"entries":[{}]}'):
            self.sidecar.write_bytes(bad)
            with self.assertRaises(DiagramError):
                self.store.create_folder("bad")
            self.assertEqual(self.sidecar.read_bytes(), bad)
        self.assertEqual(len(self.store.list_tasks()), 1)

    def test_create_failure_on_either_side_of_placement_write(self):
        f = self.store.create_folder("folder")["id"]
        before = self.store.library()
        original = Directory.atomic_write
        for failure in ("library.json", "state.json"):
            def write(directory, name, raw):
                if name == failure:
                    raise DiagramError("simulated failure", 500, "storage_error")
                original(directory, name, raw)

            with self.subTest(failure=failure), mock.patch.object(Directory, "atomic_write", write):
                with self.assertRaises(DiagramError):
                    self.store.create("unpublished", parent_id=f)
            self.store = Store(self.project)
            self.assertEqual(self.store.list_tasks(), [])
            self.assertEqual(self.store.library(), before)
            self.assertEqual(json.loads(self.sidecar.read_text())["entries"], before["entries"])
        self.assertEqual(self.children(f), [])
        created = self.store.create("published", parent_id=f)
        self.assertEqual(self.children(f), [created["id"]])

    def test_independent_store_transactions_do_not_lose_entries(self):
        f = self.store.create_folder("folder")["id"]

        def create(i):
            store = Store(self.project)
            if i % 2:
                return store.create(str(i), parent_id=f)["id"]
            entry = store.create_folder(str(i))
            return store.move_entry(entry["id"], f)["id"]

        with ThreadPoolExecutor(max_workers=4) as pool:
            ids = list(pool.map(create, range(12)))
        self.assertCountEqual(self.children(f), ids)
        self.assertEqual(self.children(), [f])
