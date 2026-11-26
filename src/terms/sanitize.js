// 사전 그림(SVG) 정화: 허용한 도형·속성만 남긴다
const ELEMENTS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'marker', 'title', 'desc']);
const ATTRS = new Set(['xmlns', 'viewBox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points',
  'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'font-size', 'font-weight', 'text-anchor',
  'dominant-baseline', 'transform', 'opacity', 'fill-opacity', 'id', 'marker-end', 'marker-start', 'refX', 'refY', 'markerWidth',
  'markerHeight', 'orient', 'dx', 'dy', 'class', 'role', 'aria-label']);

export function sanitizeSvg(svg, DOMParserCtor, XMLSerializerCtor) {
  if (!svg || !/^\s*<svg[\s>]/i.test(svg)) return null;
  let doc;
  try {
    let failed = false;
    const parser = new DOMParserCtor({ onError: () => { failed = true; } });
    doc = parser.parseFromString(svg, 'image/svg+xml');
    if (failed) return null;
  } catch { return null; }
  const root = doc && doc.documentElement;
  if (!root || root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) return null;
  const clean = (el) => {
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 1) {
        if (!ELEMENTS.has(child.localName)) { el.removeChild(child); continue; }
        clean(child);
      } else if (child.nodeType !== 3) el.removeChild(child);
    }
    for (const a of Array.from(el.attributes)) {
      const v = String(a.value);
      if (!ATTRS.has(a.name) || /javascript:|url\(\s*['"]?\s*(?!#)/i.test(v)) el.removeAttribute(a.name);
    }
  };
  clean(root);
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return new XMLSerializerCtor().serializeToString(root);
}
