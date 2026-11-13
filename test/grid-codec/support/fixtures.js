import { rng } from "./rng.js";
import { keysBetween } from "./order-keys.js";
import { shown } from "../../../src/grid/codec/value.js";
import { tableHtml, textEscape, attrEscape } from "../../../src/grid/codec/write.js";

const COL_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const COLUMNS = 20;

const VENDORS = ["Acme", "Borealis", "Cedar", "Delta", "Ember", "Fable", "Grove", "Harbor"];
const REGIONS = ["North", "South", "East", "West"];
const OWNERS = ["Ana", "Ben", "Cara", "Dev", "Eli", "Fay", "Gus", "Hana"];
const STATUSES = ["open", "closed", "pending", "review"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const HEADERS = [
  "Account",
  "Units",
  "Rate",
  "Qty",
  "Price",
  "Cost",
  "Tax",
  "Fee",
  "Margin",
  "Region",
  "Owner",
  "Status",
  "Budget",
  "Actual",
  "Share",
  "Date",
  "Sum",
  "Product",
  "Flag",
  "Ratio",
];

const cell = (text, attrs = {}) => ({ text, ...attrs });

const nBetween = (random, min, max) => min + Math.floor(random() * (max - min + 1));

const grouping = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const moneyText = (value) => `$${grouping(value.toFixed(2))}`;

const percentText = (ratio) => `${Math.round(ratio * 100)}%`;

export function serial(iso) {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
}

function dateParts(offset) {
  const d = new Date(Date.UTC(2024, 0, 1 + offset));
  const iso = d.toISOString().slice(0, 10);
  const text = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  return { iso, text };
}

const dateCell = (date) => ({ text: date.text, n: true, v: shown(serial(date.iso)), fmt: "mmm d, yyyy" });

function numberFormula(text, result, attrs = {}) {
  const value = shown(result);
  const formulaCell = { text, n: true, ...attrs };
  if (text !== value) formulaCell.v = value;
  return formulaCell;
}

function tiny() {
  const sheetKeys = keysBetween(null, null, 2);
  const budgetCols = keysBetween(null, null, 3);
  const budgetRows = keysBetween(null, null, 6);
  const tripCols = keysBetween(null, null, 2);
  const tripRows = keysBetween(null, null, 2);

  const budget = {
    id: "s1",
    pos: sheetKeys[0],
    name: "Budget",
    freezeCols: 1,
    cols: [
      { id: "ca", pos: budgetCols[0], width: 180 },
      { id: "cb", pos: budgetCols[1], fmt: "$#,##0.00" },
      { id: "cc", pos: budgetCols[2], fmt: "0%" },
    ],
    rows: [
      {
        id: "r1",
        pos: budgetRows[0],
        frozen: true,
        cells: [
          cell("Item", { style: "font-weight:bold" }),
          cell("Cost"),
          cell("Share"),
        ],
      },
      {
        id: "r2",
        pos: budgetRows[1],
        cells: [
          cell("Rent"),
          cell("$1,200.00", { n: true, v: "1200" }),
          cell("80%", { n: true, f: "=B2/B$5", v: "0.8" }),
        ],
      },
      {
        id: "r3",
        pos: budgetRows[2],
        cells: [
          cell("Food"),
          cell("$300.00", { n: true, v: "300" }),
          cell("20%", { n: true, f: "=B3/B$5", v: "0.2" }),
        ],
      },
      { id: "r4", pos: budgetRows[3], cells: [] },
      {
        id: "r5",
        pos: budgetRows[4],
        cells: [
          cell("Total", { style: "font-weight:bold" }),
          cell("$1,500.00", { n: true, f: "=SUM(B2:B3)", v: "1500" }),
        ],
      },
      {
        id: "r6",
        pos: budgetRows[5],
        cells: [
          cell("Prices as of November", { colspan: 3, style: "text-align:center" }),
          cell("", { hidden: true }),
          cell("", { hidden: true }),
        ],
      },
    ],
  };

  const trips = {
    id: "s2",
    pos: sheetKeys[1],
    name: "Trips",
    cols: [
      { id: "cd", pos: tripCols[0] },
      { id: "ce", pos: tripCols[1] },
    ],
    rows: [
      {
        id: "r7",
        pos: tripRows[0],
        cells: [
          cell("Lisbon"),
          cell("Mar 14, 2026", { n: true, v: shown(serial("2026-03-14")), fmt: "mmm d, yyyy" }),
        ],
      },
      {
        id: "r8",
        pos: tripRows[1],
        cells: [
          cell("Budget left"),
          cell("$3,500.00", {
            n: true,
            f: "=5000-Budget!B5",
            fmt: "$#,##0.00",
            v: "3500",
          }),
        ],
      },
    ],
  };

  return { sheets: [budget, trips] };
}

function buildLedger(prefix, random, dataRows) {
  const totalRows = dataRows + 2;
  const sheetKey = keysBetween(null, null, 1)[0];
  const colKeys = keysBetween(null, null, COLUMNS);
  const rowKeys = keysBetween(null, null, totalRows);

  const cols = colKeys.map((pos, i) => {
    const col = { id: `${prefix}-c${i}`, pos };
    if (i === 0) col.width = 180;
    if (i === 12 || i === 13) col.fmt = "$#,##0.00";
    if (i === 14) col.fmt = "0%";
    return col;
  });

  const rows = [];
  rows.push({
    id: `${prefix}-r0`,
    pos: rowKeys[0],
    frozen: true,
    cells: HEADERS.map((name) => cell(name)),
  });

  const bValues = [];
  const qValues = [];
  const rValues = [];
  const totals = { b: Array(8).fill(0), m: 0, n: 0, q: 0, r: 0 };
  let q2 = null;

  for (let row = 2; row <= dataRows + 1; row++) {
    const units = nBetween(random, 10, 9999);
    const rate = nBetween(random, 1, 99);
    const qty = nBetween(random, 1, 200);
    const price = Math.round(random() * 5000) / 100;
    const cost = Math.round(random() * 5000) / 100;
    const tax = Math.round(random() * 900) / 100;
    const fee = Math.round(random() * 200) / 100;
    const margin = Math.round(random() * 10000) / 100;
    const budget = Math.round(random() * 10000) / 100;
    const actual = Math.round(random() * 10000) / 100;
    const share = Math.round(random() * 10000) / 10000;
    const date = dateParts(nBetween(random, 0, 1095));
    const region = REGIONS[nBetween(random, 0, REGIONS.length - 1)];
    const owner = OWNERS[nBetween(random, 0, OWNERS.length - 1)];
    const status = STATUSES[nBetween(random, 0, STATUSES.length - 1)];
    const vendor = VENDORS[nBetween(random, 0, VENDORS.length - 1)];

    const plain = [units, rate, qty, price, cost, tax, fee, margin];
    plain.forEach((value, i) => {
      totals.b[i] += value;
    });

    const sum = plain.reduce((a, b) => a + b, 0);
    const product = units * rate;
    if (q2 === null) q2 = sum;
    const ratio = sum / q2;

    totals.m = Math.round((totals.m + budget) * 100) / 100;
    totals.n = Math.round((totals.n + actual) * 100) / 100;
    totals.q += sum;
    totals.r += product;

    bValues[row] = units;
    qValues[row] = sum;
    rValues[row] = product;

    rows.push({
      id: `${prefix}-r${row}`,
      pos: rowKeys[row - 1],
      cells: [
        cell(`${vendor} ${1000 + row}`),
        ...plain.map((value) => cell(shown(value), { n: true })),
        cell(region),
        cell(owner),
        cell(status),
        cell(moneyText(budget), { n: true, v: shown(budget), fmt: "$#,##0.00" }),
        cell(moneyText(actual), { n: true, v: shown(actual), fmt: "$#,##0.00" }),
        cell(percentText(share), { n: true, v: shown(share), fmt: "0%" }),
        dateCell(date),
        numberFormula(shown(sum), sum, { f: `=SUM(B${row}:I${row})` }),
        numberFormula(shown(product), product, { f: `=B${row}*C${row}` }),
        cell(sum > 4000 ? "high" : "low", { f: `=IF(Q${row}>4000,"high","low")` }),
        numberFormula(percentText(ratio), ratio, { f: `=Q${row}/Q$2`, fmt: "0%" }),
      ],
    });
  }

  const last = dataRows + 1;
  const totalRow = {
    id: `${prefix}-r${last + 1}`,
    pos: rowKeys[last],
    cells: [
      cell("Total", { style: "font-weight:bold" }),
      ...totals.b.map((sum, i) =>
        numberFormula(shown(sum), sum, { f: `=SUM(${COL_LETTERS[1 + i]}2:${COL_LETTERS[1 + i]}${last})` }),
      ),
      cell("n/a"),
      cell("n/a"),
      cell("n/a"),
      numberFormula(moneyText(totals.m), totals.m, { f: `=SUM(M2:M${last})`, fmt: "$#,##0.00" }),
      numberFormula(moneyText(totals.n), totals.n, { f: `=SUM(N2:N${last})`, fmt: "$#,##0.00" }),
      cell("n/a"),
      cell("n/a"),
      numberFormula(shown(totals.q), totals.q, { f: `=SUM(Q2:Q${last})` }),
      numberFormula(shown(totals.r), totals.r, { f: `=SUM(R2:R${last})` }),
      cell("n/a"),
      cell("n/a"),
    ],
  };
  rows.push(totalRow);

  return {
    sheet: {
      id: prefix,
      pos: sheetKey,
      name: "Ledger",
      cols,
      rows,
    },
    bValues,
    qValues,
    rValues,
  };
}

function buildSummary(prefix, random, ledger, dataRows) {
  const totalRows = dataRows + 1;
  const sheetKey = keysBetween(null, null, 1)[0];
  const colKeys = keysBetween(null, null, COLUMNS);
  const rowKeys = keysBetween(null, null, totalRows);

  const cols = colKeys.map((pos, i) => {
    const col = { id: `${prefix}-c${i}`, pos };
    if (i === 0) col.width = 180;
    return col;
  });

  const rows = [
    {
      id: `${prefix}-r0`,
      pos: rowKeys[0],
      cells: HEADERS.map((name) => cell(name)),
    },
  ];

  for (let row = 2; row <= dataRows + 1; row++) {
    const q = ledger.qValues[row];
    const r = ledger.rValues[row];
    const b = ledger.bValues[row];
    rows.push({
      id: `${prefix}-r${row}`,
      pos: rowKeys[row - 1],
      cells: [
        cell(`Line ${row - 1}`),
        numberFormula(shown(q), q, { f: `=Ledger!Q${row}` }),
        numberFormula(shown(r), r, { f: `=Ledger!R${row}` }),
        numberFormula(shown(b), b, { f: `=Ledger!B${row}` }),
        numberFormula(shown(q * 2), q * 2, { f: `=Ledger!Q${row}*2` }),
        ...Array.from({ length: 15 }, () => cell(shown(nBetween(random, 1, 9999)), { n: true })),
      ],
    });
  }

  return {
    id: prefix,
    pos: sheetKey,
    name: "Summary",
    cols,
    rows,
  };
}

function standardSheetSizes(dataRows) {
  const ledger = buildLedger("L", rng(20260101), dataRows);
  const summaryCount = dataRows === 898 ? 99 : 499;
  const summary = buildSummary("S", rng(20260202), ledger, summaryCount);
  const sheetKeys = keysBetween(null, null, 2);
  ledger.sheet.pos = sheetKeys[0];
  summary.pos = sheetKeys[1];
  return { sheets: [ledger.sheet, summary] };
}

function standard() {
  return standardSheetSizes(898);
}

function stretch() {
  return standardSheetSizes(4498);
}

function merged() {
  const colKeys = keysBetween(null, null, 4);
  const rowKeys = keysBetween(null, null, 4);
  return {
    sheets: [
      {
        id: "m",
        name: "Merged",
        pos: "G",
        cols: colKeys.map((pos, i) => ({ id: `m-c${i}`, pos })),
        rows: [
          {
            id: "m-r1",
            pos: rowKeys[0],
            cells: [
              cell("Title", { colspan: 3 }),
              cell("", { hidden: true }),
              cell("", { hidden: true }),
              cell("D1"),
            ],
          },
          {
            id: "m-r2",
            pos: rowKeys[1],
            cells: [cell("Tall", { rowspan: 2 }), cell("B2"), cell("C2")],
          },
          {
            id: "m-r3",
            pos: rowKeys[2],
            cells: [cell("", { hidden: true }), cell("B3"), null, cell("D3")],
          },
          {
            id: "m-r4",
            pos: rowKeys[3],
            cells: [cell("Box", { colspan: 2, rowspan: 2 }), cell("", { hidden: true })],
          },
        ],
      },
    ],
  };
}

function styled() {
  const colKeys = keysBetween(null, null, 3);
  const rowKeys = keysBetween(null, null, 3);
  return {
    sheets: [
      {
        id: "st",
        name: "Styled",
        pos: "G",
        freezeCols: 2,
        cols: [
          { id: "st-c0", pos: colKeys[0], width: 120 },
          { id: "st-c1", pos: colKeys[1], fmt: "0.0%" },
          { id: "st-c2", pos: colKeys[2] },
        ],
        rows: [
          {
            id: "st-r1",
            pos: rowKeys[0],
            frozen: true,
            style: "font-weight:bold;background:#eef",
            cells: [cell("Name"), cell("Share"), cell("Note")],
          },
          {
            id: "st-r2",
            pos: rowKeys[1],
            cells: [
              cell("Red", { style: "color:#c00" }),
              cell("12.5%", { n: true, v: "0.125", style: "text-align:right;font-style:italic" }),
              cell("underlined", { style: "text-decoration:underline;white-space:nowrap" }),
            ],
          },
          {
            id: "st-r3",
            pos: rowKeys[2],
            style: "border-bottom:1px solid #999",
            cells: [cell("last")],
          },
        ],
      },
    ],
  };
}

function formulasFormatted() {
  const colKeys = keysBetween(null, null, 5);
  const rowKeys = keysBetween(null, null, 10);
  const rows = Array.from({ length: 10 }, (_, i) => {
    const k = i + 1;
    const product = k * 7 * 1.5;
    const ratio = (k * 7) / 70;
    const date = serial(`2026-01-${String(k).padStart(2, "0")}`);
    return {
      id: `ff-r${k}`,
      pos: rowKeys[i],
      cells: [
        cell(shown(k * 7), { n: true }),
        numberFormula(moneyText(product), product, { f: `=A${k}*1.5`, fmt: "$#,##0.00" }),
        numberFormula(percentText(ratio), ratio, { f: `=A${k}/70`, fmt: "0%" }),
        numberFormula(`${MONTHS[0]} ${k}, 2026`, date, { f: `=DATE(2026,1,${k})`, fmt: "mmm d, yyyy" }),
        cell(k * 7 > 35 ? "TRUE" : "FALSE", { f: `=A${k}>35` }),
      ],
    };
  });
  return {
    sheets: [
      {
        id: "ff",
        name: "Calc",
        pos: "G",
        cols: [
          { id: "ff-c0", pos: colKeys[0] },
          { id: "ff-c1", pos: colKeys[1], fmt: "$#,##0.00" },
          { id: "ff-c2", pos: colKeys[2], fmt: "0%" },
          { id: "ff-c3", pos: colKeys[3], fmt: "mmm d, yyyy" },
          { id: "ff-c4", pos: colKeys[4] },
        ],
        rows,
      },
    ],
  };
}

function empty() {
  return {
    sheets: [{ id: "e", name: "Empty", pos: "G", cols: [], rows: [] }],
  };
}

function chain(pos) {
  const rowKeys = keysBetween(null, null, 1000);
  const colKeys = keysBetween(null, null, 1);
  const rows = Array.from({ length: 1000 }, (_, i) => {
    const row = i + 1;
    const attrs = row > 1 ? { n: true, f: `=A${row - 1}+1` } : { n: true };
    return {
      id: `C-r${row}`,
      pos: rowKeys[i],
      cells: [cell(shown(row), attrs)],
    };
  });

  return {
    id: "C-s",
    pos,
    name: "Chain",
    cols: [{ id: "C-c0", pos: colKeys[0], width: 120 }],
    rows,
  };
}

function sparse(pos) {
  const random = rng(20260404);
  const rowKeys = keysBetween(null, null, 200);
  const colKeys = keysBetween(null, null, 200);

  const cols = colKeys.map((key, i) => ({ id: `P-c${i}`, pos: key }));
  const rows = [];

  for (let row = 0; row < 200; row++) {
    const cells = [];
    for (let c = 0; c < 200; c++) {
      if (random() < 0.02) {
        const numeric = random() < 0.6;
        cells.push(
          numeric
            ? cell(shown(nBetween(random, 1, 9999)), { n: true })
            : cell(VENDORS[nBetween(random, 0, VENDORS.length - 1)]),
        );
      } else {
        cells.push(null);
      }
    }
    while (cells.length > 0 && cells[cells.length - 1] === null) cells.pop();
    rows.push({ id: `P-r${row + 1}`, pos: rowKeys[row], cells });
  }

  return {
    id: "P-s",
    pos,
    name: "Sparse",
    cols,
    rows,
  };
}

function twoTabs() {
  const sheetKeys = keysBetween(null, null, 2);
  return { sheets: [chain(sheetKeys[0]), sparse(sheetKeys[1])] };
}

function escapes() {
  const colKeys = keysBetween(null, null, 3);
  const rowKeys = keysBetween(null, null, 14);
  const row = (index, cells, attrs = {}) => ({ id: `x-r${index}`, pos: rowKeys[index - 1], ...attrs, cells });

  return {
    sheets: [
      {
        id: "x",
        name: "Esc & <tab>",
        pos: "G",
        cols: [
          { id: "x-c0", pos: colKeys[0] },
          { id: "x-c1", pos: colKeys[1], fmt: '#,##0 "kg"' },
          { id: "x-c2", pos: colKeys[2] },
        ],
        rows: [
          row(1, [cell('a & b < c > d " e \' f')]),
          row(2, [cell("line one\nline two\ttabbed")]),
          row(3, [cell("  padded  ")]),
          row(4, [cell("-->")]),
          row(5, [cell("<!-- not a comment -->")]),
          row(6, [cell("&amp; already escaped text")]),
          row(7, [cell("Unicode: é ü 中文 😀")]),
          row(8, [cell("=literal")]),
          row(9, [cell("02134", { t: true })]),
          row(10, [cell("123", { t: true })]),
          row(11, [cell("TRUE", { t: true })]),
          row(12, [
            cell("7", { n: true, f: '=IF(A1="</table>","<td>","-->")&"\n"&"a&b"' }),
          ]),
          row(13, [null, cell("1,200 kg", { n: true, v: "1200", fmt: '#,##0 "kg"' })]),
          row(14, [cell("styled row")], { style: 'background:url("x&y")' }),
        ],
      },
    ],
  };
}

export const FIXTURES = {
  tiny,
  "budget-20k": standard,
  "wide-100k": stretch,
  merged,
  styled,
  "formulas-formatted": formulasFormatted,
  empty,
  "two-tabs": twoTabs,
  escapes,
};

const attr = (name, value) => ` ${name}="${attrEscape(value)}"`;

function sectionHtml(sheet) {
  return (
    `<section item${attr("data-id", sheet.id)}${attr("data-pos", sheet.pos)}>` +
    `<h2 bind="name">${textEscape(sheet.name)}</h2>` +
    tableHtml(sheet) +
    `</section>`
  );
}

export function documentHtml(workbook) {
  const sections = workbook.sheets.map(sectionHtml);

  return (
    `<!DOCTYPE html>\n` +
    `<html lang="en">\n` +
    `<head>\n` +
    `<meta charset="utf-8">\n` +
    `<title>Sheet</title>\n` +
    `</head>\n` +
    `<body>\n` +
    `<main sap data-rev="12">\n` +
    `<div items="sheets">\n` +
    sections.join("\n") +
    `\n</div>\n` +
    `</main>\n` +
    `<script type="application/json" merge="sheet" clay="live">{"base":12,"patches":{}}</script>\n` +
    `</body>\n` +
    `</html>\n`
  );
}
