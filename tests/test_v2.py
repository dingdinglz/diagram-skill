import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'skills/diagram-plan/scripts'))
from diagram_core import DiagramError, Store, graph_markdown, normalize_graph


def shared_loops():
    names = ['shared', 'left-a', 'left-b', 'right-a', 'right-b']
    orders = [names[:3], [names[0], *names[3:]]]
    return dict(schemaVersion=2, title='Shared loop steps', description='', constraints='',
                nodes=[dict(id=name, type='step', position={'x': i * 100, 'y': 0}, data={'label': name})
                       for i, name in enumerate(names)],
                edges=[dict(id='%s-%s' % (a, b), source=a, target=b)
                       for order in orders for a, b in zip(order, order[1:] + order[:1])],
                groups=[dict(id=name, label=name, kind='loop', summary='', parentId=None,
                             nodeIds=order, order=order, position={'x': i * 400, 'y': 0})
                        for i, (name, order) in enumerate(zip(['left', 'right'], orders))])


class PresentationContractTests(unittest.TestCase):
    def setUp(self):
        self.graph = json.loads((ROOT / 'examples/loop-flow.json').read_text())

    def test_v2_round_trip_preserves_behavior_and_nested_groups(self):
        normalized = normalize_graph(self.graph, approval=True)
        self.assertEqual(normalize_graph(normalized), normalized)
        self.assertEqual(normalized['groups'], self.graph['groups'])
        self.assertEqual(normalized['nodes'], self.graph['nodes'])
        self.assertEqual([e['id'] for e in normalized['edges']], [e['id'] for e in self.graph['edges']])
        markdown = graph_markdown(normalized)
        for item in normalized['groups']:
            self.assertIn(item['label'], markdown)
        self.assertIn('exception', markdown)

    def test_invalid_presentation_is_rejected_before_it_can_be_saved(self):
        changes = [
            lambda g: g['nodes'][0]['data'].update(role='hidden'),
            lambda g: g['edges'][0].update(role='hidden'),
            lambda g: g['groups'][0].update(parentId='work'),
            lambda g: g['groups'][1].update(parentId='missing'),
            lambda g: g['groups'][1]['nodeIds'].append('missing'),
            lambda g: g['groups'][1].update(parentId=None),
            lambda g: g['groups'][0].update(order=['choose', 'check', 'work']),
            lambda g: g['groups'][0].update(order=['choose', 'generate', 'check']),
            lambda g: g['groups'][0].update(order=[]),
            lambda g: g['groups'][0].update(position={'x': float('nan'), 'y': 0}),
        ]
        for change in changes:
            with self.subTest(change=change):
                graph = copy.deepcopy(self.graph)
                change(graph)
                with self.assertRaises(DiagramError):
                    normalize_graph(graph)

    def test_disconnected_subflow_does_not_invent_a_cycle(self):
        # Projected boundaries look circular, but the send path is unreachable
        # from generate. A circular picture would assert behavior that does not exist.
        next(e for e in self.graph['edges'] if e['id'] == 'generated')['target'] = 'choose'
        with self.assertRaisesRegex(DiagramError, 'validation'):
            normalize_graph(self.graph)

    def test_hidden_decision_still_needs_all_conditions_for_approval(self):
        check = next(n for n in self.graph['nodes'] if n['id'] == 'check')
        check['data']['role'] = 'exception'
        next(e for e in self.graph['edges'] if e['id'] == 'done')['label'] = ''
        normalize_graph(self.graph)
        with self.assertRaises(DiagramError):
            normalize_graph(self.graph, approval=True)

    def test_v1_is_not_upgraded_on_read_and_cannot_silently_drop_v2_fields(self):
        old = json.loads((ROOT / 'examples/sample-flow.json').read_text())
        canonical = normalize_graph(old)
        self.assertEqual(canonical['schemaVersion'], 1)
        self.assertNotIn('groups', canonical)
        self.assertNotIn('summary', canonical['nodes'][0]['data'])
        old['nodes'][0]['data']['summary'] = 'Needs an explicit upgrade'
        with self.assertRaises(DiagramError):
            normalize_graph(old)

    def test_peer_membership_is_shared_for_every_group_kind(self):
        for first in ('loop', 'subflow', 'branch'):
            for second in ('loop', 'subflow', 'branch'):
                with self.subTest(first=first, second=second):
                    graph = shared_loops()
                    graph['groups'][0]['kind'] = first
                    graph['groups'][1]['kind'] = second
                    canonical = normalize_graph(graph, approval=True)
                    self.assertEqual(normalize_graph(canonical), canonical)
                    self.assertEqual(canonical['groups'][0]['nodeIds'][0], 'shared')
                    self.assertEqual(canonical['groups'][1]['nodeIds'][0], 'shared')
                    self.assertEqual(sum(n['id'] == 'shared' for n in canonical['nodes']), 1)

    def test_parent_can_order_child_members_and_omit_other_logical_members(self):
        graph = shared_loops()
        graph['groups'][0]['nodeIds'] = [n['id'] for n in graph['nodes']]
        graph['groups'][1]['parentId'] = 'left'
        graph['groups'][0]['circle'] = {'x': 100, 'y': 200, 'radius': 300}
        graph['groups'][1]['circle'] = {'x': 700, 'y': 200, 'radius': 300}
        canonical = normalize_graph(graph, approval=True)
        self.assertEqual(canonical['groups'], graph['groups'])
        self.assertEqual(canonical['groups'][0]['order'], ['shared', 'left-a', 'left-b'])

    def test_overlapping_ordered_child_slots_cannot_invent_a_route(self):
        graph = shared_loops()
        graph['groups'].append(dict(id='outer', label='Outer', kind='loop', summary='', parentId=None,
                                    nodeIds=[n['id'] for n in graph['nodes']], order=['left', 'right'],
                                    position={'x': 0, 'y': 0}))
        for group in graph['groups'][:2]:
            group['parentId'] = 'outer'
        with self.assertRaises(DiagramError) as caught:
            normalize_graph(graph)
        self.assertTrue(any('must not overlap' in error['message'] for error in caught.exception.details))
        graph['groups'][-1]['order'] = ['shared', 'left']
        with self.assertRaises(DiagramError):
            normalize_graph(graph)

    def test_shared_membership_does_not_relax_identity_or_parent_checks(self):
        changes = [
            lambda g: g['groups'][0]['nodeIds'].append('shared'),
            lambda g: g['groups'][0].update(id='shared'),
            lambda g: g['groups'][1].update(id='left'),
            lambda g: g['groups'][0].update(parentId='missing'),
            lambda g: g['groups'][0].update(parentId='right'),
            lambda g: g['groups'][0].update(order=['shared', 'shared']),
            lambda g: g['groups'][0].update(order=['shared', 'left-b', 'left-a']),
        ]
        for change in changes:
            with self.subTest(change=change):
                graph = shared_loops()
                change(graph)
                with self.assertRaises(DiagramError):
                    normalize_graph(graph)

    def test_precise_anchors_and_circles_round_trip_without_implicit_defaults(self):
        graph = shared_loops()
        graph['edges'][0].update(sourceAnchor={'x': .125, 'y': 1}, targetAnchor={'x': .8, 'y': 0})
        graph['groups'][0]['circle'] = {'x': -50.5, 'y': 240, 'radius': 360.25}
        canonical = normalize_graph(graph)
        self.assertEqual(canonical['edges'][0]['sourceAnchor'], graph['edges'][0]['sourceAnchor'])
        self.assertEqual(canonical['edges'][0]['targetAnchor'], graph['edges'][0]['targetAnchor'])
        self.assertEqual(canonical['groups'][0]['circle'], graph['groups'][0]['circle'])
        self.assertNotIn('sourceAnchor', canonical['edges'][1])
        self.assertNotIn('circle', canonical['groups'][1])
        self.assertEqual(normalize_graph(canonical), canonical)
        markdown = graph_markdown(canonical)
        self.assertIn('sourceAnchor: x=0.125, y=1', markdown)
        self.assertIn('radius=360.25', markdown)

    def test_anchor_and_circle_coordinates_are_strict_and_v2_only(self):
        invalid_anchors = [None, [], {}, {'x': True, 'y': 0}, {'x': 0, 'y': '1'},
                           {'x': -.01, 'y': 0}, {'x': 1.01, 'y': 0},
                           {'x': float('nan'), 'y': 0}, {'x': 0, 'y': float('inf')}]
        for anchor in invalid_anchors:
            for field in ('sourceAnchor', 'targetAnchor'):
                with self.subTest(field=field, anchor=anchor):
                    graph = shared_loops()
                    graph['edges'][0][field] = anchor
                    with self.assertRaises(DiagramError):
                        normalize_graph(graph)
        invalid_circles = [None, [], {}, {'x': 0, 'y': 0, 'radius': 0}, {'x': 0, 'y': 0, 'radius': -1},
                           {'x': 0, 'y': 0, 'radius': True}, {'x': 0, 'y': 0, 'radius': float('nan')},
                           {'x': float('inf'), 'y': 0, 'radius': 100}, {'x': 0, 'y': 0, 'radius': 1000001}]
        for circle in invalid_circles:
            with self.subTest(circle=circle):
                graph = shared_loops()
                graph['groups'][0]['circle'] = circle
                with self.assertRaises(DiagramError):
                    normalize_graph(graph)
        for field in ('sourceAnchor', 'targetAnchor'):
            old = json.loads((ROOT / 'examples/sample-flow.json').read_text())
            old['edges'][0][field] = {'x': .5, 'y': 0}
            with self.assertRaises(DiagramError):
                normalize_graph(old)

    def test_old_versions_restore_without_rewriting_artifacts_or_adding_geometry(self):
        for filename in ('sample-flow.json', 'loop-flow.json'):
            with self.subTest(filename=filename), tempfile.TemporaryDirectory() as project:
                store = Store(Path(project))
                graph = json.loads((ROOT / 'examples' / filename).read_text())
                task = store.create(graph['title'], graph=graph)
                initial = task['versions'][0]['id']
                artifacts = {name: store.artifact(task['id'], initial, name) for name in ('diagram.json', 'diagram.md')}
                changed = copy.deepcopy(task['graph'])
                changed['title'] = 'Edited draft'
                task = store.mutate(task['id'], 'draft', {'revision': task['revision'], 'graph': changed})
                restored = store.mutate(task['id'], 'restore', {'revision': task['revision'], 'versionId': initial})
                self.assertEqual(restored['graph'], normalize_graph(graph))
                for name, data in artifacts.items():
                    self.assertEqual(store.artifact(task['id'], initial, name), data)
                self.assertTrue(all('sourceAnchor' not in e and 'targetAnchor' not in e for e in restored['graph']['edges']))
                self.assertTrue(all('circle' not in g for g in restored['graph'].get('groups', [])))


if __name__ == '__main__':
    unittest.main()
