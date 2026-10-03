// Minimal, dependency-free Markdown → HTML for the in-app user guide (README.md).
// Supports what the README uses: headings, paragraphs, fenced code, tables, lists,
// block quotes, rules, inline code, bold/italic and links. All text is HTML-escaped.
'use strict';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Anchor id for a heading, GitHub style. */
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

function inline(src) {
  // Protect code spans first so their content is not formatted.
  const codes = [];
  let s = src.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => {
    const safe = /^(https?:|mailto:|#)/i.test(href) ? href : '#';
    return `<a href="${safe}">${text}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^\w*])\*([^*\s][^*]*)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`);
}

const cells = (line) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

/** Convert Markdown text to an HTML fragment. */
function markdownToHtml(md) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }
    const fence = /^```(\w*)/.exec(line);
    if (fence) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code${fence[1] ? ` class="lang-${fence[1]}"` : ''}>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line);
    if (h) {
      const html = inline(h[2]);
      out.push(`<h${h[1].length} id="${slug(html)}">${html}</h${h[1].length}>`);
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`,
      );
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${markdownToHtml(buf.join('\n'))}</blockquote>`);
      continue;
    }
    const li = /^(\s*)([-*+]|\d+[.)])\s+/.exec(line);
    if (li) {
      const ordered = /\d/.test(li[2]);
      const items = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (m && /\d/.test(m[2]) === ordered) {
          items.push(m[3]);
          i++;
        } else if (items.length && /^\s{2,}\S/.test(lines[i])) {
          items[items.length - 1] += ' ' + lines[i++].trim(); // continuation line
        } else break;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`);
      continue;
    }
    const buf = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(```|#{1,6}\s|>|\s*([-*+]|\d+[.)])\s+|\s*\|)/.test(lines[i])) buf.push(lines[i++].trim());
    if (!buf.length) buf.push(lines[i++].trim()); // safety: always make progress
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return out.join('\n');
}

/** A complete, styled, script-free HTML page for the guide window. */
function guidePage(md, title = 'WarGamer — User guide') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>${esc(title)}</title><style>
:root{color-scheme:dark}
body{margin:0;background:#0f1418;color:#e6ebef;font:15px/1.6 'Segoe UI',Inter,system-ui,-apple-system,Roboto,Arial,sans-serif}
main{max-width:920px;margin:0 auto;padding:28px 32px 60px}
h1,h2,h3,h4{font-family:Bahnschrift,'DIN Alternate','Roboto Condensed','Arial Narrow',Arial,sans-serif;letter-spacing:.02em;line-height:1.25}
h1{font-size:28px;margin:0 0 12px}h2{font-size:21px;margin:34px 0 10px;padding-bottom:6px;border-bottom:1px solid #2c3a46}
h3{font-size:15px;color:#f2b84b;text-transform:uppercase;letter-spacing:.08em;margin:26px 0 8px}h4{color:#94a3af}
a{color:#4aa3ff}code{font-family:Consolas,'Courier New',monospace;font-size:.92em;background:#1a232b;border:1px solid #2c3a46;border-radius:4px;padding:1px 5px}
pre{background:#151c22;border:1px solid #2c3a46;border-radius:8px;padding:12px 14px;overflow:auto}pre code{background:none;border:0;padding:0}
table{border-collapse:collapse;width:100%;margin:10px 0}th,td{border:1px solid #2c3a46;padding:6px 10px;text-align:left;vertical-align:top}th{background:#1a232b}
blockquote{margin:10px 0;padding:4px 14px;border-left:3px solid #f2b84b;color:#c9d3da}hr{border:0;border-top:1px solid #2c3a46;margin:28px 0}
li{margin:3px 0}
</style></head><body><main>${markdownToHtml(md)}</main></body></html>`;
}

module.exports = { markdownToHtml, guidePage, slug };
