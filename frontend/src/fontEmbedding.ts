const INTERFACE_FONT = 'noto sans sc variable';
const NO_FONTS = '/* No loaded self-hosted interface fonts to embed. */';
const fontDataURLs = new Map<string, Promise<string>>();

function unescapeCSS(value: string): string {
  return value.replace(/\\([\da-f]{1,6}\s?|\r\n|[\n\r\f]|.)/gi, (_, escape: string) => {
    if (/^[\da-f]/i.test(escape)) {
      const code = parseInt(escape.trim(), 16);
      return String.fromCodePoint(code > 0 && code <= 0x10ffff ? code : 0xfffd);
    }
    return /^[\n\r\f]/.test(escape) ? '' : escape;
  });
}

export function normalizeFontFamily(value: string): string {
  return unescapeCSS(value.trim().replace(/^(['"])([\s\S]*)\1$/, '$2')).trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Compare CSSOM and FontFace serializations, including wildcard/range equivalents. */
export function normalizeUnicodeRange(value: string): string {
  const ranges = (value.trim() || 'U+0-10FFFF').split(',').map(part => {
    const match = /^u\+([\da-f?]+)(?:-([\da-f]+))?$/i.exec(part.replace(/\s+/g, ''));
    if (!match) return null;
    return [parseInt(match[1].replace(/\?/g, '0'), 16), parseInt(match[2] || match[1].replace(/\?/g, 'f'), 16)];
  });
  // Invalid input cannot occur in valid CSSOM; keep it distinct rather than matching all glyphs.
  if (ranges.some(range => !range)) return value.replace(/\s+/g, '').toLowerCase();
  const sorted = (ranges as number[][]).sort((a, b) => a[0] - b[0]);
  const merged: number[][] = [];
  for (const [start, end] of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && start <= previous[1] + 1) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  return merged.map(([start, end]) => `u+${start.toString(16)}${end === start ? '' : `-${end.toString(16)}`}`).join(',');
}

/** Never fetch external resources, credentials in URLs, or non-HTTP schemes. */
export function resolveFontURL(value: string, baseURL: string, documentURL: string): string {
  const url = new URL(value, baseURL);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== new URL(documentURL).origin || url.username || url.password) {
    throw new Error('禁止导出跨域或不安全的字体资源');
  }
  return url.href;
}

function readDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('字体读取失败'));
    reader.onabort = () => reject(new Error('字体读取已取消'));
    reader.onload = () => typeof reader.result === 'string' && reader.result.startsWith('data:')
      ? resolve(reader.result) : reject(new Error('字体编码失败'));
    reader.readAsDataURL(blob);
  });
}

function fontDataURL(url: string): Promise<string> {
  const cached = fontDataURLs.get(url);
  if (cached) return cached;
  const pending = (async () => {
    const response = await fetch(url, { mode: 'same-origin', credentials: 'same-origin', cache: 'force-cache', redirect: 'error' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (!blob.size) throw new Error('字体文件为空');
    return readDataURL(blob);
  })().catch((cause: unknown) => {
    fontDataURLs.delete(url);
    throw new Error(`导出字体加载失败，未提交批准。请刷新页面后重试：${url}`, { cause });
  });
  fontDataURLs.set(url, pending);
  return pending;
}

interface FontRule {
  style: CSSStyleDeclaration;
  baseURL: string;
}

function matchingRules(doc: Document, loadedRanges: Set<string>): FontRule[] {
  const result: FontRule[] = [];
  const visited = new Set<CSSStyleSheet>();
  function visitSheet(sheet: CSSStyleSheet, parentURL: string) {
    if (visited.has(sheet)) return;
    visited.add(sheet);
    let baseURL = parentURL;
    if (sheet.href) {
      try { baseURL = resolveFontURL(sheet.href, parentURL, doc.URL); }
      catch { return; }
    }
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; }
    catch { return; } // Cross-origin / inaccessible CSSOM must not trigger stylesheet fetching.
    visitRules(rules, baseURL);
  }
  function visitRules(rules: CSSRuleList, baseURL: string) {
    for (const rule of Array.from(rules)) {
      if (rule.type === 3) { // CSSRule.IMPORT_RULE (no global DOM constants needed)
        const imported = (rule as CSSImportRule).styleSheet;
        if (imported) visitSheet(imported, baseURL);
      } else if (rule.type === 5) {
        const style = (rule as CSSFontFaceRule).style;
        if (normalizeFontFamily(style.getPropertyValue('font-family')) === INTERFACE_FONT &&
            loadedRanges.has(normalizeUnicodeRange(style.getPropertyValue('unicode-range')))) {
          result.push({ style, baseURL });
        }
      } else if ('cssRules' in rule) {
        let children: CSSRuleList;
        try { children = (rule as CSSGroupingRule).cssRules; }
        catch { continue; }
        visitRules(children, baseURL);
      }
    }
  }
  for (const sheet of Array.from(doc.styleSheets)) visitSheet(sheet, doc.baseURI);
  for (const sheet of Array.from(doc.adoptedStyleSheets || [])) visitSheet(sheet, doc.baseURI);
  return result;
}

async function embedRule({ style, baseURL }: FontRule, documentURL: string): Promise<string> {
  const src = style.getPropertyValue('src');
  // CSSOM gives serialized url() tokens; support quoted strings and CSS escapes.
  const urls = Array.from(src.matchAll(/url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|((?:\\.|[^)\\])*?))\s*\)/gi));
  if (!urls.length) return ''; // local()/system fonts require no embedding.
  const replacements = await Promise.all(urls.map(async match => {
    const value = unescapeCSS(match[1] ?? match[2] ?? match[3]).trim();
    if (/^data:/i.test(value)) return `url("${value}")`;
    let url: string;
    try { url = resolveFontURL(value, baseURL, documentURL); }
    catch (cause) { throw new Error('导出字体地址不安全，未提交批准。请使用同源字体资源。', { cause }); }
    return `url("${await fontDataURL(url)}")`;
  }));
  let embeddedSrc = '', end = 0;
  urls.forEach((match, index) => {
    embeddedSrc += src.slice(end, match.index) + replacements[index];
    end = match.index! + match[0].length;
  });
  embeddedSrc += src.slice(end);
  const declarations = Array.from(style).map(name => {
    const value = name === 'src' ? embeddedSrc : style.getPropertyValue(name);
    return `${name}: ${value}${style.getPropertyPriority(name) ? ' !important' : ''};`;
  });
  return `@font-face { ${declarations.join(' ')} }`;
}

/**
 * Call after mounting the complete visible export element, before toPng/toSvg.
 * Pass the result as fontEmbedCSS (even the nonempty no-font comment).
 * Only already-loaded interface-font subsets are embedded; no all-shard font load.
 */
export async function exportFontCSS(element: HTMLElement): Promise<string> {
  const doc = element.ownerDocument;
  // Read layout BEFORE accessing ready: export-only text may start additional font loads.
  element.getBoundingClientRect();
  await doc.fonts.ready;
  const loadedRanges = new Set<string>();
  doc.fonts.forEach(face => {
    if (normalizeFontFamily(face.family) !== INTERFACE_FONT) return;
    if (face.status === 'error') throw new Error('导出字体加载失败，未提交批准。请刷新页面后重试。');
    if (face.status === 'loaded') loadedRanges.add(normalizeUnicodeRange(face.unicodeRange));
  });
  if (!loadedRanges.size) return NO_FONTS;
  const css = await Promise.all(matchingRules(doc, loadedRanges).map(rule => embedRule(rule, doc.URL)));
  return [...new Set(css.filter(Boolean))].join('\n') || NO_FONTS;
}
