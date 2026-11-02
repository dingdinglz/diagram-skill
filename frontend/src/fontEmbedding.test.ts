import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportFontCSS, normalizeFontFamily, normalizeUnicodeRange, resolveFontURL } from './fontEmbedding';

const origin = 'https://diagram.test';
const family = 'Noto Sans SC Variable';

// Tiny CSSOM / FontFaceSet doubles: these tests run in Node, without jsdom.
function fontRule(range: string, src: string, font = family): CSSRule {
  const values: Record<string, string> = {
    'font-family': `"${font}"`, 'font-style': 'normal', 'font-weight': '100 900',
    'font-display': 'swap', src, 'unicode-range': range,
  };
  const style = Object.assign(Object.keys(values), {
    getPropertyValue: (name: string) => values[name] || '',
    getPropertyPriority: () => '',
  });
  return { type: 5, style } as unknown as CSSRule;
}
function sheet(rules: CSSRule[], href: string | null = null): CSSStyleSheet {
  return { cssRules: rules, href } as unknown as CSSStyleSheet;
}
function face(unicodeRange: string, status = 'loaded', font = family) {
  return { family: font, unicodeRange, status } as FontFace;
}
function element(sheets: CSSStyleSheet[], faces: FontFace[]) {
  const fonts = { ready: Promise.resolve(), forEach: (fn: (face: FontFace) => void) => faces.forEach(fn) };
  return {
    getBoundingClientRect: vi.fn(),
    ownerDocument: { URL: `${origin}/app/`, baseURI: `${origin}/app/`, styleSheets: sheets, fonts },
  } as unknown as HTMLElement;
}

let reads = 0;
class FakeFileReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  readAsDataURL() {
    reads++;
    this.result = 'data:font/woff2;base64,Zm9udA==';
    queueMicrotask(() => this.onload?.());
  }
}
beforeEach(() => {
  reads = 0;
  vi.stubGlobal('FileReader', FakeFileReader);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['font'], { type: 'font/woff2' }) })));
});
afterEach(() => vi.unstubAllGlobals());

describe('font matching helpers', () => {
  it('normalizes family quotes, whitespace, case and CSS escapes', () => {
    expect(normalizeFontFamily("  'Noto Sans SC Variable' ")).toBe('noto sans sc variable');
    expect(normalizeFontFamily('Noto  Sans SC VARIABLE')).toBe('noto sans sc variable');
    expect(normalizeFontFamily('"Noto Sans SC Var\\69 able"')).toBe('noto sans sc variable');
  });
  it('normalizes reordered, overlapping and wildcard ranges', () => {
    expect(normalizeUnicodeRange('U+0041, U+0042-005A, U+20-0040')).toBe('u+20-5a');
    expect(normalizeUnicodeRange('u+4??, U+0600')).toBe(normalizeUnicodeRange('U+600,U+400-4FF'));
    expect(normalizeUnicodeRange('')).toBe('u+0-10ffff');
    expect(normalizeUnicodeRange('U+4E00')).not.toBe(normalizeUnicodeRange('U+4E01'));
  });
  it('resolves relative assets against their stylesheet, retaining queries', () => {
    expect(resolveFontURL('../fonts/a.woff2?v=1', `${origin}/assets/css/main.css`, `${origin}/app`))
      .toBe(`${origin}/assets/fonts/a.woff2?v=1`);
  });
  it.each(['https://external.test/a.woff2', '//external.test/a', 'http://diagram.test/a', 'data:font/woff2;base64,YQ==', 'blob:https://diagram.test/123', 'https://user:pass@diagram.test/a'])('rejects unsafe font URL %s', url => {
    expect(() => resolveFontURL(url, `${origin}/main.css`, origin)).toThrow();
  });
});

describe('exportFontCSS', () => {
  it('forces layout before reading ready, then matches newly loaded export glyphs only', async () => {
    const faces = [face('U+41', 'unloaded'), face('U+4E00', 'unloaded')];
    const node = element([sheet([
      fontRule('U+41', 'url(/unused.woff2)'),
      fontRule('U+4e00', 'url("/new-glyph.woff2") format("woff2-variations")'),
      fontRule('U+4e00', 'url(/other-family.woff2)', 'Other Font'),
    ])], faces);
    const order: string[] = [];
    vi.mocked(node.getBoundingClientRect).mockImplementation(() => {
      order.push('layout');
      return {} as DOMRect;
    });
    Object.defineProperty(node.ownerDocument.fonts, 'ready', { get() {
      order.push('ready');
      return Promise.resolve().then(() => { faces[1] = face('U+4E00'); });
    } });
    const css = await exportFontCSS(node);
    expect(order).toEqual(['layout', 'ready']);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(`${origin}/new-glyph.woff2`, {
      mode: 'same-origin', credentials: 'same-origin', cache: 'force-cache', redirect: 'error',
    });
    expect(css).toContain('src: url("data:font/woff2;base64,Zm9udA==") format("woff2-variations")');
    expect(css).toContain('font-weight: 100 900');
    expect(css).toContain('unicode-range: U+4e00');
    expect(css).not.toContain('unused');
    expect(css).not.toContain('Other Font');
  });

  it('walks imports and nested groups using each stylesheet URL', async () => {
    const imported = sheet([{ type: 4, cssRules: [fontRule('U+4??', "url('../fonts/nested.woff2')")] } as unknown as CSSRule], `${origin}/assets/css/nested.css`);
    const node = element([sheet([{ type: 3, styleSheet: imported } as unknown as CSSRule])], [face('U+400-4FF')]);
    expect(await exportFontCSS(node)).toContain('@font-face');
    expect(fetch).toHaveBeenCalledWith(`${origin}/assets/fonts/nested.woff2`, expect.anything());
  });

  it('does not fetch the other ~112 declared shards', async () => {
    const rules = Array.from({ length: 112 }, (_, i) => fontRule(`U+${(0x400 + i).toString(16)}`, `url(/shard-${i}.woff2)`));
    await exportFontCSS(element([sheet(rules)], [face('U+401'), face('U+40A')]));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('shares pending fetch/encoding across rules and concurrent exports', async () => {
    const node = element([sheet([
      fontRule('U+41', 'url(/shared-cache.woff2)'), fontRule('U+42', 'url(/shared-cache.woff2)'),
    ])], [face('U+41'), face('U+42')]);
    const [first, second] = await Promise.all([exportFontCSS(node), exportFontCSS(node)]);
    expect(first).toBe(second);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(reads).toBe(1);
    await exportFontCSS(node);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces required fetch failures in Chinese and evicts rejected promises', async () => {
    const node = element([sheet([fontRule('U+41', 'url(/retry-font.woff2)')])], [face('U+41')]);
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 503 } as Response);
    await expect(exportFontCSS(node)).rejects.toThrow('导出字体加载失败，未提交批准');
    expect(await exportFontCSS(node)).toContain('data:font/woff2');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('surfaces FileReader errors and permits retry', async () => {
    const node = element([sheet([fontRule('U+41', 'url(/retry-reader.woff2)')])], [face('U+41')]);
    vi.stubGlobal('FileReader', class {
      onerror: (() => void) | null = null;
      readAsDataURL() { queueMicrotask(() => this.onerror?.()); }
    });
    await expect(exportFontCSS(node)).rejects.toThrow('导出字体加载失败');
    vi.stubGlobal('FileReader', FakeFileReader);
    expect(await exportFontCSS(node)).toContain('data:font/woff2');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('skips inaccessible and external sheets without fetching CSS', async () => {
    const inaccessible = { get cssRules() { throw new Error('SecurityError'); } } as unknown as CSSStyleSheet;
    const external = sheet([fontRule('U+41', 'url(/never.woff2)')], 'https://external.test/main.css');
    const css = await exportFontCSS(element([inaccessible, external], [face('U+41')]));
    expect(css).toMatch(/^\/\*.+\*\/$/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses external URLs in selected rules instead of capturing fallback fonts', async () => {
    const node = element([sheet([fontRule('U+41', 'url(https://external.test/font.woff2)')])], [face('U+41')]);
    await expect(exportFontCSS(node)).rejects.toThrow('导出字体地址不安全');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns a nonempty comment for system fonts, no loaded faces, or local-only sources', async () => {
    for (const node of [
      element([], []),
      element([sheet([fontRule('U+41', 'url(/not-loaded.woff2)')])], [face('U+41', 'unloaded')]),
      element([sheet([fontRule('U+41', 'local("Noto Sans SC Variable")')])], [face('U+41')]),
      element([], [face('U+41', 'loaded', 'Arial')]),
    ]) expect(await exportFontCSS(node)).toMatch(/^\/\*.+\*\/$/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves existing data URLs without fetches', async () => {
    const node = element([sheet([fontRule('U+41', 'url("data:font/woff2;base64,YQ==")')])], [face('U+41')]);
    expect(await exportFontCSS(node)).toContain('data:font/woff2;base64,YQ==');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not silently capture a failed interface font', async () => {
    await expect(exportFontCSS(element([], [face('U+41', 'error')]))).rejects.toThrow('导出字体加载失败');
  });
});
