// The hostile inputs every host's strict reader must refuse (a CodecMiss), shared by
// hostile.test.js and the host vectors.
export const CELLS = (cells) => `<table grid><tbody>\n<tr data-id="r" data-pos="G">${cells}</tr>\n</tbody></table>`;
const ROW = (row) => `<table grid><tbody>\n${row}\n</tbody></table>`;
const TABLE = (start, rest = "") =>
  `${start}<tbody>\n<tr data-id="r" data-pos="G"><td>x</td></tr>\n</tbody>${rest}</table>`;

export const MISSES = [
  ["cell <td>&copy 2026</td>", CELLS("<td>&copy 2026</td>")],
  ["cell <td>a&notit;b</td>", CELLS("<td>a&notit;b</td>")],
  ["cell <td>&#0;</td>", CELLS("<td>&#0;</td>")],
  ["cell <td>&#x80;</td>", CELLS("<td>&#x80;</td>")],
  ["cell <td>&nbsp;</td>", CELLS("<td>&nbsp;</td>")],
  ['cell <td n v="1" v="2">x</td>', CELLS('<td n v="1" v="2">x</td>')],
  ['cell <td N V="7">x</td>', CELLS('<td N V="7">x</td>')],
  ["cell <td v='1'>x</td>", CELLS("<td v='1'>x</td>")],
  ["cell <td v=1>x</td>", CELLS("<td v=1>x</td>")],
  ['cell <td v="1"n>x</td>', CELLS('<td v="1"n>x</td>')],
  ['cell <td v="1" f="=A1">x</td> (order)', CELLS('<td v="1" f="=A1">x</td>')],
  ['cell <td n="">1</td>', CELLS('<td n="">1</td>')],
  ["cell <td>a\rb</td>", CELLS("<td>a\rb</td>")],
  ['cell <td f="a\rb">x</td>', CELLS('<td f="a\rb">x</td>')],
  ["cell <td>a\0b</td>", CELLS("<td>a\0b</td>")],
  ["cell <td><b>x</b></td>", CELLS("<td><b>x</b></td>")],
  ["cell <td>a<!--c-->b</td>", CELLS("<td>a<!--c-->b</td>")],
  ["cell <td>x</td >", CELLS("<td>x</td >")],
  ["cell <TD>x</TD>", CELLS("<TD>x</TD>")],
  ["cell <td hidden>x</td>", CELLS("<td hidden>x</td>")],
  ['cell <td colspan="1">x</td>', CELLS('<td colspan="1">x</td>')],
  ['cell <td colspan="02">x</td>', CELLS('<td colspan="02">x</td>')],
  ["cell <td>x</td><td></td> (trailing empty cell)", CELLS("<td>x</td><td></td>")],
  ["cell <td>a > b</td> (raw > in text)", CELLS("<td>a > b</td>")],
  ['row <tr data-pos="a" data-id="r">', ROW('<tr data-pos="a" data-id="r"><td>x</td></tr>')],
  ['row <tr data-id="r" data-pos="a" class="x">', ROW('<tr data-id="r" data-pos="a" class="x"><td>x</td></tr>')],
  [
    "a carriage return between two rows",
    '<table grid><tbody>\n<tr data-id="r1" data-pos="G"><td>x</td></tr>\r\n<tr data-id="r2" data-pos="O"><td>y</td></tr>\n</tbody></table>',
  ],
  ['table <table grid class="x">', TABLE('<table grid class="x">')],
  ['table <table grid freeze-cols="01">', TABLE('<table grid freeze-cols="01">')],
  ['table <table grid freeze-cols="0">', TABLE('<table grid freeze-cols="0">')],
  ['table <table grid stale freeze-cols="1">', TABLE('<table grid stale freeze-cols="1">')],
  [
    "table with a <tfoot>",
    `${TABLE("<table grid>").replace("</tbody></table>", "</tbody>")}<tfoot><tr data-id="t" data-pos="G"><td>x</td></tr></tfoot></table>`,
  ],
  ["table with a <caption>", '<table grid><caption>x</caption><tbody>\n<tr data-id="r" data-pos="G"><td>x</td></tr>\n</tbody></table>'],
  [
    "table with a <tbody> before <thead>",
    '<table grid><tbody>\n<tr data-id="r" data-pos="G"><td>x</td></tr>\n</tbody><thead>\n<tr data-id="t" data-pos="O"><td>y</td></tr>\n</thead></table>',
  ],
  [
    "table with two <thead>s",
    '<table grid><thead>\n<tr data-id="r" data-pos="G"><td>x</td></tr>\n</thead><thead>\n<tr data-id="t" data-pos="O"><td>y</td></tr>\n</thead></table>',
  ],
];
