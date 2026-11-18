import { createGrid } from "../../src/grid/grid.js";

const EMPTY = "<table grid><colgroup></colgroup>\n<tbody>\n</tbody></table>";

afterEach(() => {
  document.body.innerHTML = "";
});

function live(html) {
  document.body.innerHTML = html;
  let minted = 0;
  return createGrid(document.body.querySelector("table"), { today: () => 46095, newId: (prefix) => `${prefix}n${++minted}` });
}

const TEXT = [
  ["-5", "02134"],
  ["=SUM(A1)", "+44 20 7946"],
  ["'quoted", "@home"],
  ["plain", "'"],
];

test("an export with protect, imported into columns typed text, gives back the same text", () => {
  const source = live(EMPTY);
  source.setRange("A1", TEXT, { detect: false, grow: true });
  const csv = source.toDelimited(undefined, { protect: true });
  const target = live(EMPTY);
  target.importDelimited(csv, "A1", { types: ["text", "text"] });
  expect([csv, source.get("A1:B4"), target.get("A1:B4")]).toEqual([
    "'-5,02134\r\n'=SUM(A1),'+44 20 7946\r\n''quoted,'@home\r\nplain,''",
    TEXT,
    TEXT,
  ]);
});

test("an apostrophe our export did not write stays in a column typed text, so text exported without protect comes back the same", () => {
  const source = live(EMPTY);
  source.setRange("A1", [["'90s hits", "'tis"]], { detect: false, grow: true });
  const csv = source.toDelimited();
  const target = live(EMPTY);
  target.importDelimited(csv, "A1", { types: ["text", "text"] });
  expect([csv, target.get("A1:B1")]).toEqual(["'90s hits,'tis", [["'90s hits", "'tis"]]]);
});
