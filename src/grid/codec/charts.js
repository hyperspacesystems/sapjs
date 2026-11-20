// A chart's saved drawing (GRAMMAR.md, "Charts' drawings"): after a tab's table, one <figure chart>
// per chart rule in rules order, holding the last <svg> the app drew for it, or nothing before its
// first drawing. The drawing is the app's output, never read back as data: the rule is the chart.

import { attrEscape } from "./write.js";

export const MAX_DRAWING = 1048576;
const ELEMENTS = new Set(["svg", "g", "title", "desc", "rect", "line", "polyline", "polygon", "path", "circle", "ellipse", "text", "tspan"]);
const TEXT_ONLY = new Set(["title", "desc"]);
const START = /<([a-z][a-zA-Z0-9]*)((?: [a-zA-Z_:][-a-zA-Z0-9_:.]*="[^"<]*")*)>/y;
const END = /<\/([a-z][a-zA-Z0-9]*)>/y;
const TEXT = /[^<]+/y;
const ATTR = / ([a-zA-Z_:][-a-zA-Z0-9_:.]*)="([^"<]*)"/g;
const ATTRIBUTES = new Set([
  "xmlns", "viewBox", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "d", "points",
  "fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-linecap", "stroke-linejoin",
  "opacity", "transform", "text-anchor", "dominant-baseline", "font-family", "font-size", "font-weight", "role", "aria-label", "aria-hidden",
]);
const ACTIVE_VALUE = /url\s*\(|\\|\/\*|&lt;|&gt;/i;
const ENTITY = /&(?!(?:amp|lt|gt|quot|nbsp);)/;
const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

// Why a chart's drawing may not be saved, or null. A drawing is one <svg> holding only the shapes
// and text a chart needs, every element closed by its own end tag (no "/>"), attributes only from a
// fixed list of shape and text attributes, in double quotes after one space, no value holding url(,
// \, /*, &lt; or &gt;, and & written only as &amp;, &lt;, &gt;, &quot; or &nbsp; (as a page's
// serializer writes them). So a browser and the codec end the figure at the same place, and the
// drawing holds no script, link, URL, comment or escape.
export function drawingProblem(html) {
  if (typeof html !== "string") return "a drawing is text";
  if (html === "") return "a drawing is one <svg> element";
  if (html.length > MAX_DRAWING) return `a drawing is at most ${MAX_DRAWING} characters`;
  if (/[\r\0]/.test(html) || LONE.test(html)) return "a drawing holds a carriage return, NUL or half a character";
  if (ENTITY.test(html)) return "a drawing writes & only as &amp;, &lt;, &gt;, &quot; or &nbsp;";
  const open = [];
  let at = 0;
  while (at < html.length) {
    if (at > 0 && open.length === 0) return "a drawing is one <svg> element with nothing after it";
    START.lastIndex = at;
    END.lastIndex = at;
    TEXT.lastIndex = at;
    let m;
    if ((m = START.exec(html))) {
      const name = m[1];
      if (!ELEMENTS.has(name)) return `a drawing holds <${name}>`;
      if ((name === "svg") !== (open.length === 0)) return "a drawing is one <svg> around everything else";
      if (TEXT_ONLY.has(open.at(-1))) return `<${open.at(-1)}> holds text only`;
      for (const [, attr, value] of m[2].matchAll(ATTR)) {
        if (!ATTRIBUTES.has(attr)) return `a drawing holds the attribute ${attr}`;
        if (ACTIVE_VALUE.test(value)) return `a drawing holds ${attr}="${value}"`;
      }
      open.push(name);
      at = START.lastIndex;
    } else if ((m = END.exec(html))) {
      if (open.at(-1) !== m[1]) return `a drawing closes <${m[1]}> where <${open.at(-1) ?? "nothing"}> is open`;
      open.pop();
      at = END.lastIndex;
    } else if ((m = TEXT.exec(html))) {
      if (open.length === 0) return "a drawing is one <svg> element";
      at = TEXT.lastIndex;
    } else {
      return `a drawing holds markup that is not a shape or text at ${at}`;
    }
  }
  return open.length === 0 ? null : "a drawing leaves an element open";
}

const drawable = (drawing) => typeof drawing === "string" && drawing !== "" && drawingProblem(drawing) === null;

export const figureHtml = (id, drawing) => `<figure chart="${attrEscape(id).replaceAll(" ", "&nbsp;")}" sap-ignore="">${drawing}</figure>`;

// The figures after a tab's table, one per chart rule in rules order that has a drawing:
// `drawingOf(id)` gives a chart's last drawing, or nothing, and a chart with none gets no figure.
export function chartsHtml(rules, drawingOf = () => undefined) {
  let out = "";
  for (const rule of rules ?? []) {
    if (rule.kind !== "chart") continue;
    const drawing = drawingOf(rule.id);
    if (drawable(drawing)) out += `\n${figureHtml(rule.id, drawing)}`;
  }
  return out;
}
