// Cut and join: swap every region that fits the grammar for a hole, so a host can
// parse the rest of the document cheaply, then put the regions (or new bytes) back.

import { CodecMiss, scanGrid } from "./scan.js";

const MARKER = /^[A-Za-z0-9_-]+$/;

export const holeHtml = (marker, n) => `<table grid data-hole="${marker}-${n}"></table>`;

// A per-call random marker that does not occur in src, so no document can forge a hole.
export function holeMarker(src) {
  for (;;) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const marker = `h${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
    if (!src.includes(marker)) return marker;
  }
}

function checkMarker(marker, src) {
  if (!MARKER.test(marker)) throw new Error("grid codec: a hole marker is letters, digits, - and _ only");
  if (src.includes(marker)) throw new Error("grid codec: the hole marker occurs in the document");
}

// Returns { rest, regions }: rest is src with each region replaced by holeHtml(marker, n),
// and regions[n] = { start, end } are offsets into src.
export function cutGrids(src, marker) {
  checkMarker(marker, src);
  const regions = [];
  const parts = [];
  let from = 0;
  let at = 0;
  for (;;) {
    const start = src.indexOf("<table grid", at);
    if (start === -1) break;
    let end;
    try {
      end = scanGrid(src, start);
    } catch (error) {
      if (!(error instanceof CodecMiss)) throw error;
      at = start + 1;
      continue;
    }
    parts.push(src.slice(from, start), holeHtml(marker, regions.length));
    regions.push({ start, end });
    from = end;
    at = end;
  }
  parts.push(src.slice(from));
  return { rest: parts.join(""), regions };
}

// The inverse of cutGrids: puts bytes[n], or the original region when bytes[n] is
// undefined, back in place of each hole.
export function joinGrids(rest, marker, src, regions, bytes = []) {
  const parts = [];
  let from = 0;
  regions.forEach((region, n) => {
    const hole = holeHtml(marker, n);
    const at = rest.indexOf(hole, from);
    if (at === -1) throw new Error(`grid codec: hole ${n} is missing`);
    parts.push(rest.slice(from, at), bytes[n] ?? src.slice(region.start, region.end));
    from = at + hole.length;
  });
  parts.push(rest.slice(from));
  return parts.join("");
}
