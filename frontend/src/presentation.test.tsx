import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NodeBody } from './FlowNode';
import { GraphInspector } from './GraphInspector';
import { NODE_ICONS } from './icons';
import type { Graph, GraphNode } from './types';

const node: GraphNode = { id: 'step', type: 'step', position: { x: 0, y: 0 }, data: { label: '校验输入字段', executor: 'program', notes: '完整说明', expanded: false } };
const graph: Graph = { schemaVersion: 1, title: '输入校验', description: '检查输入，再处理消息。', constraints: '- 保留消息 ID\n- 不接受空字段', nodes: [node], edges: [] };

describe('shared presentation', () => {
  it('uses distinct, shared symbols for the four node meanings', () => {
    expect(new Set(Object.values(NODE_ICONS)).size).toBe(4);
    for (const type of Object.keys(NODE_ICONS) as (keyof typeof NODE_ICONS)[]) {
      const html = renderToStaticMarkup(<NodeBody node={{ ...node, type }} />);
      expect(html).toContain('node-symbol');
      expect(html).toContain('viewBox="0 0 256 256"');
    }
  });

  it('does not reserve an empty summary; preserves notes and branch controls', () => {
    const html = renderToStaticMarkup(<NodeBody node={node} branchCount={2} onBranches={() => {}} />);
    expect(html).not.toContain('node-summary');
    expect(html).toContain('node-note-indicator');
    expect(html).toContain('查看 校验输入字段 的分支');
    expect(html).toContain('node-branch-button');
    expect(renderToStaticMarkup(<NodeBody node={{ ...node, data: { ...node.data, summary: '检查消息格式' } }} />)).toContain('node-summary');
  });

  it('opens graph metadata as formatted reading content, with an explicit edit action', () => {
    const html = renderToStaticMarkup(<GraphInspector graph={graph} editable onEdit={() => {}} />);
    expect(html).toContain('<ul>');
    expect(html).toContain('保留消息 ID');
    expect(html).toContain('编辑流程说明');
    expect(html).not.toContain('<textarea');
  });

  it('keeps historical and approved graph reading available without editing controls', () => {
    const html = renderToStaticMarkup(<GraphInspector graph={graph} editable={false} onEdit={() => {}} />);
    expect(html).toContain('输入校验');
    expect(html).not.toContain('graph-edit-toggle');
    expect(html).not.toContain('<input');
  });
});
