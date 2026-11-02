import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { dockProximity, NodeDock } from './reactbits/NodeDock';
import { FlowScope } from './reactbits/FlowScope';
import { ContentTransition } from './Motion';

describe('bounded workspace motion', () => {
  it('keeps dock influence symmetric, local and safe for a cleared pointer', () => {
    expect(dockProximity(100, 100)).toBe(1);
    expect(dockProximity(142, 100)).toBeCloseTo(0.5);
    expect(dockProximity(58, 100)).toBeCloseTo(0.5);
    expect(dockProximity(184, 100)).toBe(0);
    expect(dockProximity(1000, 100)).toBe(0);
    expect(dockProximity(Infinity, 100)).toBe(0);
    expect(dockProximity(NaN, 100)).toBe(0);
    expect(dockProximity(100, 100, 0)).toBe(0);
  });

  it('keeps all four creation actions as labeled native buttons', () => {
    const html = renderToStaticMarkup(<NodeDock disabled={false} onAdd={() => {}} />);
    expect(html.match(/<button /g)).toHaveLength(4);
    expect(html).toContain('aria-label="添加条件判断"');
    expect(html).toContain('aria-label="添加处理步骤"');
    expect(html).toContain('data-motion="static"');
    expect(html).not.toContain('opacity:0');
  });

  it('disables the complete dock for read-only states', () => {
    const html = renderToStaticMarkup(<NodeDock disabled onAdd={() => {}} />);
    expect(html.match(/disabled=""/g)).toHaveLength(4);
    expect(html).toContain('data-motion="static"');
  });

  it('renders the controlled scope with exactly one pressed native button', () => {
    for (const branches of [false, true]) {
      const html = renderToStaticMarkup(<FlowScope branches={branches} onChange={() => {}} />);
      expect(html.match(/<button /g)).toHaveLength(2);
      expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
      expect(html).toContain(`aria-label="显示分支" aria-pressed="${branches}"`);
      expect(html).toContain('aria-hidden="true"');
    }
  });

  it('never starts real reading content fully invisible', () => {
    const html = renderToStaticMarkup(<ContentTransition identity="node-a"><p>完整说明</p></ContentTransition>);
    expect(html).toContain('完整说明');
    expect(html).not.toMatch(/opacity:0(?:;|"|$)/);
  });
});
