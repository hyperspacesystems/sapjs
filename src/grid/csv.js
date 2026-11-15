const DELIMITERS = [",", ";", "\t"];
const PROTECTED = /^[=+\-@\t\r']/;

export class DelimitedError extends Error {
  constructor(code, line) {
    super(`delimited text ${code} at line ${line}`);
    this.name = "DelimitedError";
    this.code = code;
    this.line = line;
  }
}

const withoutBom = (text) => String(text).replace(/^\uFEFF/, "");

function checkDelimiter(delimiter) {
  if (typeof delimiter !== "string" || delimiter.length !== 1 || /["\r\n]/.test(delimiter)) {
    throw new TypeError("the delimiter must be one character that is not a quote or a line break");
  }
}

export function detectDelimiter(text) {
  text = withoutBom(text);
  const counts = new Map(DELIMITERS.map((d) => [d, 0]));
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && (ch === "\r" || ch === "\n")) break;
    else if (!quoted && counts.has(ch)) counts.set(ch, counts.get(ch) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}

export function parseDelimited(text, { delimiter } = {}) {
  text = withoutBom(text);
  delimiter ??= detectDelimiter(text);
  checkDelimiter(delimiter);
  const records = [];
  let row = [], field = "", quoted = false, line = 1, startLine = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else if (ch === "\r" || ch === "\n") {
        field += ch;
        if (ch === "\r" && text[i + 1] === "\n") field += text[++i];
        line++;
      } else field += ch;
    } else if (ch === '"' && field === "") {
      quoted = true;
      startLine = line;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\r" || ch === "\n") {
      row.push(field);
      records.push(row);
      row = [];
      field = "";
      if (ch === "\r" && text[i + 1] === "\n") i++;
      line++;
    } else field += ch;
  }
  if (quoted) throw new DelimitedError("unterminated-quote", startLine);
  if (row.length || field !== "" || (text && !/[\r\n]$/.test(text))) records.push([...row, field]);
  let width = 0;
  for (const r of records) if (r.length > width) width = r.length;
  for (const r of records) while (r.length < width) r.push("");
  return records;
}

function writeField(field, delimiter, alone) {
  const text = String(field ?? "");
  if (text === "" && alone) return '""';
  if (text.includes(delimiter) || /^\uFEFF|["\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

export function writeDelimited(rows, { delimiter = ",", eol = "\r\n" } = {}) {
  checkDelimiter(delimiter);
  return rows.map((row, r) => {
    if (!row.length) throw new TypeError("a row needs at least one field");
    const alone = row.length === 1 && r === rows.length - 1;
    return row.map((field) => writeField(field, delimiter, alone)).join(delimiter);
  }).join(eol);
}

export function protectField(text) {
  return PROTECTED.test(text) ? "'" + text : text;
}
