// Compares a live table with the table an HTML parser builds from the live table's own canonical
// bytes: the same elements in the same order, the same attribute names and values, and the same
// text in every cell. The line breaks the writer puts between rows are layout, so text outside
// cells is not compared. `sameTree` returns one line for each difference, and an empty list when
// the two trees are the same.

import { canonicalGrid, domAdapter } from "../../../src/grid/codec/canonical.js";

const MOST = 12;

const isCell = (node) => node.localName === "td" || node.localName === "th";

const attributesOf = (node) =>
  Array.from(node.attributes, (attribute) => `${attribute.name}=${JSON.stringify(attribute.value)}`).sort().join(" ") || "no attribute";

// The table a parser builds from these bytes, in a document of its own.
export function parseTable(bytes, doc = document) {
  const page = doc.implementation.createHTMLDocument("");
  page.body.innerHTML = bytes;
  return page.body.firstElementChild;
}

function compare(live, parsed, path, out) {
  if (out.length >= MOST) return;
  if (live.localName !== parsed.localName) {
    out.push(`${path}: <${live.localName}> where the bytes give <${parsed.localName}>`);
    return;
  }
  const mine = attributesOf(live);
  const theirs = attributesOf(parsed);
  if (mine !== theirs) out.push(`${path}: ${mine} where the bytes give ${theirs}`);
  if (isCell(parsed) && live.textContent !== parsed.textContent) {
    out.push(`${path}: text ${JSON.stringify(live.textContent)} where the bytes give ${JSON.stringify(parsed.textContent)}`);
  }
  const here = Array.from(live.children);
  const there = Array.from(parsed.children);
  if (here.length !== there.length) {
    out.push(`${path}: ${here.length} child elements where the bytes give ${there.length}`);
  }
  for (let i = 0; i < Math.min(here.length, there.length); i++) {
    compare(here[i], there[i], `${path} > ${there[i].localName}[${i}]`, out);
  }
}

export function sameTree(table, bytes = canonicalGrid(domAdapter, table)) {
  const out = [];
  compare(table, parseTable(bytes, table.ownerDocument), "table", out);
  return out;
}
