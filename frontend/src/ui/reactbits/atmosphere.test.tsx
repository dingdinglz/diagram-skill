import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Aurora } from './Aurora';
import { SpotlightCard, spotlightFalloff } from './SpotlightCard';
import { GlareHover, glareGradient } from './GlareHover';

describe('React Bits atmospheric surfaces', () => {
  it('renders an immediately visible decorative CSS fallback without allocating a canvas on the server', () => {
    const html = renderToStaticMarkup(<Aurora enabled paused={false} />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-state="static"');
    expect(html).not.toContain('<canvas');
  });
  it('keeps spotlight decoration out of the accessibility tree and forwards toolbar semantics', () => {
    const html = renderToStaticMarkup(<SpotlightCard role="toolbar" aria-label="创建" disabled><button>添加节点</button></SpotlightCard>);
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('data-spotlight="off"');
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(2);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(spotlightFalloff()).not.toMatch(/NaN|Infinity/);
  });
  it('keeps glare on a native disabled button, with an intact accessible label', () => {
    const html = renderToStaticMarkup(<GlareHover disabled aria-label="确认流程">确认流程</GlareHover>);
    expect(html).toMatch(/^<button /);
    expect(html).toContain('disabled=""');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="确认流程"');
    expect(html.match(/<button/g)).toHaveLength(1);
  });
  it('bounds the sheen profile and retains white-label contrast at its brightest point', () => {
    const alpha = [...glareGradient().matchAll(/255 \/ ([0-9.]+)\)/g)].map(match => Number(match[1]));
    expect(alpha).toHaveLength(33);
    expect(Math.min(...alpha)).toBe(0);
    expect(Math.max(...alpha)).toBeLessThanOrEqual(0.136);
    const brightest = [0x34, 0x51, 0xc6].map(c => (c + (255 - c) * Math.max(...alpha)) / 255);
    const linear = brightest.map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    expect(1.05 / (luminance + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
});
