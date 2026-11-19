// A small .xlsx reader for the conformance corpus: the zip's central directory, inflated with
// Node's zlib, then each sheet's cells with their formula and the value the writer cached. No
// dependency: the corpus files come from Google Sheets' own export.
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

function unzip(bytes) {
  const files = new Map();
  let end = bytes.length - 22;
  while (end >= 0 && bytes.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error("not a zip file");
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    const method = bytes.readUInt16LE(at + 10);
    const size = bytes.readUInt32LE(at + 20);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const local = bytes.readUInt32LE(at + 42);
    const name = bytes.toString("utf8", at + 46, at + 46 + nameLength);
    const dataAt = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const data = bytes.subarray(dataAt, dataAt + size);
    files.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescape = (text) => text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, code) => {
  if (code[0] !== "#") return ENTITIES[code] ?? whole;
  return String.fromCodePoint(code[1] === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
});

const textOf = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescape(m[1])).join("");

const colIndexOf = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

const colName = (index) => {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
};

// A shared formula's text moved by rows and cols, as Sheets copies it down or across: each
// relative reference outside quoted text shifts.
function shifted(f, rows, cols) {
  return f
    .split(/("(?:[^"]|"")*")/)
    .map((part, k) =>
      k % 2 === 1
        ? part
        : part.replace(/(^|[^A-Za-z0-9_.])(\$?)([A-Z]{1,3})(\$?)([0-9]+)(?![0-9A-Za-z_(])/g, (whole, lead, absCol, letters, absRow, digits) =>
            `${lead}${absCol}${absCol ? letters : colName(colIndexOf(letters) + cols)}${absRow}${absRow ? digits : Number(digits) + rows}`,
          ),
    )
    .join("");
}

// Each sheet as { name, cells: [{ ref, row, col, f, value }] }: `row` and `col` from 0, `f` the
// formula with its "=" (Excel's `_xlfn.` prefixes dropped) or null, `value` the cached value: a
// number, a string, a boolean, `{ error }`, or null.
export function readXlsx(path) {
  const files = unzip(readFileSync(path));
  const shared = [];
  const sst = files.get("xl/sharedStrings.xml")?.toString("utf8");
  if (sst) for (const si of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(si[1]));
  const book = files.get("xl/workbook.xml").toString("utf8");
  const names = [...book.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => unescape(m[1]));
  return names.map((name, i) => {
    const xml = files.get(`xl/worksheets/sheet${i + 1}.xml`).toString("utf8");
    const cells = [];
    const masters = new Map();
    for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = m[1];
      const body = m[2] ?? "";
      const ref = /\br="([A-Z]+)([0-9]+)"/.exec(attrs);
      const type = /\bt="([a-zA-Z]+)"/.exec(attrs)?.[1] ?? "n";
      const row = Number(ref[2]) - 1;
      const col = colIndexOf(ref[1]);
      const written = /<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/.exec(body);
      const si = /<f\b[^>]*\bt="shared"[^>]*\bsi="([0-9]+)"/.exec(body)?.[1];
      let f = written ? unescape(written[1]) : null;
      // A formula copied down or across is written once, on its first cell; the others name it.
      if (si !== undefined && f !== null) masters.set(si, { f, row, col });
      else if (si !== undefined) {
        const master = masters.get(si);
        if (master === undefined) throw new Error(`${path}: shared formula ${si} at ${ref[1]}${ref[2]} has no first cell`);
        f = shifted(master.f, row - master.row, col - master.col);
      } else if (/<f\b/.test(body) && f === null) throw new Error(`${path}: a formula at ${ref[1]}${ref[2]} this reader cannot read`);
      const v = /<v>([\s\S]*?)<\/v>/.exec(body);
      const raw = v ? unescape(v[1]) : null;
      let value = null;
      if (type === "s" && raw !== null) value = shared[Number(raw)];
      else if (type === "inlineStr") value = textOf(body);
      else if (type === "b") value = raw === "1";
      else if (type === "e") value = { error: raw };
      else if (type === "str") value = raw !== null && /^#[A-Z0-9/!?]+$/.test(raw) ? { error: raw } : raw ?? "";
      else if (raw !== null) value = Number(raw);
      cells.push({
        ref: ref[1] + ref[2],
        row,
        col,
        f: f === null ? null : "=" + f.replace(/_xlfn\./g, ""),
        value,
      });
    }
    return { name, cells };
  });
}
