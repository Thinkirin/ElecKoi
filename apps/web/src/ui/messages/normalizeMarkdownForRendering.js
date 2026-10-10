const STANDALONE_TAG = /^[ \t]{0,3}<\/?([\p{L}][\p{L}\p{N}:_-]*)(?:[ \t]+[^<>\r\n]*)?\/?>[ \t]*$/u;
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})([^\r\n]*)$/;
const TAG = /<\/?([\p{L}][\p{L}\p{N}:_-]*)(?:[ \t]+(?:[^"'<>]|"[^"]*"|'[^']*')*)?\/?>/gu;
const HTML_TAG_NAMES = new Set([
  "a", "abbr", "address", "area", "article", "aside", "audio", "b", "base", "bdi", "bdo",
  "blockquote", "body", "br", "button", "canvas", "caption", "cite", "code", "col", "colgroup",
  "data", "datalist", "dd", "del", "details", "dfn", "dialog", "div", "dl", "dt", "em", "embed",
  "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6",
  "head", "header", "hgroup", "hr", "html", "i", "iframe", "img", "input", "ins", "kbd", "label",
  "legend", "li", "link", "main", "map", "mark", "menu", "meta", "meter", "nav", "noscript",
  "object", "ol", "optgroup", "option", "output", "p", "picture", "pre", "progress", "q", "rp", "rt",
  "ruby", "s", "samp", "script", "search", "section", "select", "slot", "small", "source", "span",
  "strong", "style", "sub", "summary", "sup", "table", "tbody", "td", "template", "textarea",
  "tfoot", "th", "thead", "time", "title", "tr", "track", "u", "ul", "var", "video", "wbr",
]);

function linesWithEndings(source) {
  const lines = [];
  const pattern = /([^\r\n]*)(\r\n|\r|\n|$)/g;
  for (let match = pattern.exec(source); match && (match[0] || match.index < source.length); match = pattern.exec(source)) {
    lines.push({ text: match[1], ending: match[2] });
    if (!match[2]) break;
  }
  return lines;
}

function stripUnknownTagsOutsideInlineCode(line) {
  let output = "";
  let cursor = 0;
  while (cursor < line.length) {
    const codeStart = line.indexOf("`", cursor);
    TAG.lastIndex = cursor;
    const tag = TAG.exec(line);
    const tagIndex = tag?.index ?? Number.POSITIVE_INFINITY;

    if (codeStart >= 0 && codeStart <= tagIndex) {
      const delimiter = /`+/.exec(line.slice(codeStart))?.[0];
      if (!delimiter) break;
      const closeIndex = line.indexOf(delimiter, codeStart + delimiter.length);
      if (closeIndex < 0) {
        output += line.slice(cursor);
        break;
      }
      const end = closeIndex + delimiter.length;
      output += line.slice(cursor, end);
      cursor = end;
      continue;
    }

    if (!tag) {
      output += line.slice(cursor);
      break;
    }

    output += line.slice(cursor, tag.index);
    const tagName = tag[1]?.toLowerCase();
    if (tagName && HTML_TAG_NAMES.has(tagName)) output += tag[0];
    cursor = TAG.lastIndex;
  }
  return output;
}

/**
 * Normalizes only the render copy of roleplay Markdown.
 *
 * CommonMark keeps a standalone HTML-style tag open until a blank line. When a model places a
 * fenced block immediately after that tag, the fence is parsed as literal text. XML-style wrapper
 * names must also be removed before parsing so their body is still processed as Markdown. Unknown
 * wrappers are removed without executing authored HTML.
 */
export function normalizeMarkdownForRendering(markdown) {
  if (!markdown || !markdown.includes("<")) return markdown;

  const lines = linesWithEndings(markdown);
  let fenceCharacter = "";
  let fenceLength = 0;
  return lines.map((line, index) => {
    const fence = FENCE.exec(line.text);
    if (fenceCharacter) {
      if (
        fence
        && fence[1][0] === fenceCharacter
        && fence[1].length >= fenceLength
        && !fence[2].trim()
      ) {
        fenceCharacter = "";
        fenceLength = 0;
      }
      return line.text + line.ending;
    }

    if (fence) {
      fenceCharacter = fence[1][0];
      fenceLength = fence[1].length;
      return line.text + line.ending;
    }

    const wrapper = STANDALONE_TAG.exec(line.text);
    const normalized = stripUnknownTagsOutsideInlineCode(line.text);
    if (!wrapper) return normalized + line.ending;

    // Remove only unknown standalone wrapper lines. Standard HTML keeps its existing sanitized
    // behavior, while the wrapper body remains normal Markdown with source line breaks intact.
    if (!HTML_TAG_NAMES.has(wrapper[1].toLowerCase())) return normalized + line.ending;

    const nextFence = FENCE.exec(lines[index + 1]?.text || "");
    return line.text + line.ending + (line.ending && nextFence ? line.ending : "");
  }).join("");
}
