// docx document.xml -> ordered text lines (paragraphs, and each paragraph inside table cells).
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function paragraphText(p) {
  let out = '';
  const walk = (node) => {
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      const name = c.localName;
      if (name === 't') out += c.textContent;
      else if (name === 'tab') out += '\t';
      else if (name === 'br' || name === 'cr') out += '\n';
      else if (name !== 'pPr' && name !== 'rPr') walk(c);
    }
  };
  walk(p);
  return out;
}

function collect(node, lines) {
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.nodeType !== 1 || c.namespaceURI !== W) continue;
    if (c.localName === 'p') lines.push(paragraphText(c));
    else if (c.localName === 'tbl' || c.localName === 'tr' || c.localName === 'tc' || c.localName === 'sdt' || c.localName === 'sdtContent') collect(c, lines);
  }
}

export function docxXmlToLines(xml, DOMParserCtor) {
  const doc = new DOMParserCtor().parseFromString(xml, 'text/xml');
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  const lines = [];
  if (body) collect(body, lines);
  return lines;
}
