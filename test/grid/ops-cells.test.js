import { readFileSync } from "node:fs";
import { join } from "node:path";

import { backing, bytesOf, fixture, keptEmpty, rowLine, startTag, S, unstale } from "./support/ops-fixture.js";
import { derive } from "../../src/grid/content.js";
import { normalizeSheet } from "../../src/grid/normalize.js";
import { modelBacking } from "../../src/grid/backing-model.js";
import { gridModel } from "../../src/grid/codec/read.js";
import { patchGrid } from "../../src/grid/codec/patch.js";
import { derivePlain } from "../../src/grid/derive-plain.js";
import { apply, applyUnchecked, creates, fits, GridRefused, needs, targets, validate } from "../../src/grid/ops.js";

global.__SAP_KEEP_CONSOLE__ = true;

const GOLDEN = join(__dirname, "..", "grid-codec", "golden", "tiny.html");

test("the fixture is in normal form", () => {
  expect(normalizeSheet(fixture(), { derive }).repairs).toEqual([]);
});

const PINS = [
  [
    "one number",
    {"v":1,"t":"set","sheet":"items","cells":[["r1","cc",42]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td n>42</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td colspan="2">Total</td><td hidden></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n f="=SUM(B3:B4)" v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "a number into the #,##0 column",
    {"v":1,"t":"set","sheet":"items","cells":[["r1","cb",1234]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td n v="1234">1,234</td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td colspan="2">Total</td><td hidden></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n f="=SUM(B3:B4)" v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "text that looks like a number",
    {"v":1,"t":"set","sheet":"items","cells":[["r1","cc","007"]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>007</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td colspan="2">Total</td><td hidden></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n f="=SUM(B3:B4)" v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "text the value rule would read as a number",
    {"v":1,"t":"set","sheet":"items","cells":[["r1","cc","TRUE"]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td t>TRUE</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td colspan="2">Total</td><td hidden></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n f="=SUM(B3:B4)" v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "true",
    {"v":1,"t":"set","sheet":"items","cells":[["r1","cc",true]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>TRUE</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td colspan="2">Total</td><td hidden></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n f="=SUM(B3:B4)" v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "false",
    {"v":1,"t":"set","sheet":"items","cells":[["r1","cc",false]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>FALSE</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td colspan="2">Total</td><td hidden></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n f="=SUM(B3:B4)" v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "a formula",
    {"v":1,"t":"set","sheet":"items","cells":[["r1","cc",{"f":"=SUM(B3:B4)"}]]},
    `<table grid stale><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td f="=SUM(B3:B4)"></td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td colspan="2">Total</td><td hidden></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n f="=SUM(B3:B4)" v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "an empty string clears a cell",
    {"v":1,"t":"set","sheet":"items","cells":[["r1","ca",""]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td></td><td>Qty</td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td colspan="2">Total</td><td hidden></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n f="=SUM(B3:B4)" v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "clearing a cell",
    {"v":1,"t":"set","sheet":"items","cells":[["r1","cc",null]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td></td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td colspan="2">Total</td><td hidden></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n f="=SUM(B3:B4)" v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "clearing the last cell in a row",
    {"v":1,"t":"set","sheet":"items","cells":[["r4","cd",null]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td colspan="2">Total</td><td hidden></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n f="=SUM(B3:B4)" v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "clearing a cell that keeps its fmt",
    {"v":1,"t":"set","sheet":"items","cells":[["r3","cc",null,{"fmt":"0%"}]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td colspan="2">Total</td><td hidden></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%"></td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n f="=SUM(B3:B4)" v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "clearing a cell that keeps its style",
    {"v":1,"t":"set","sheet":"items","cells":[["r4","ca",null]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td colspan="2">Total</td><td hidden></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333"></td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n f="=SUM(B3:B4)" v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "clearing a cell with no format at all",
    {"v":1,"t":"set","sheet":"items","cells":[["r3","cd",null]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td colspan="2">Total</td><td hidden></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n f="=SUM(B3:B4)" v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "setting fmt",
    {"v":1,"t":"set","sheet":"items","cells":[["r1","cc",12,{"fmt":"0.00"}]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td n v="12" fmt="0.00">12.00</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td colspan="2">Total</td><td hidden></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n f="=SUM(B3:B4)" v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "removing fmt with null",
    {"v":1,"t":"set","sheet":"items","cells":[["r3","cc","kept",{"fmt":null}]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td colspan="2">Total</td><td hidden></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td>kept</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n f="=SUM(B3:B4)" v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "a set that keeps the cell's span",
    {"v":1,"t":"set","sheet":"items","cells":[["r2","ca","Total 2"]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td colspan="2">Total 2</td><td hidden></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n f="=SUM(B3:B4)" v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "setting a style property",
    {"v":1,"t":"set","sheet":"items","cells":[["r1","ca","Name",{"style":{"color":"#f00"}}]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td style="color:#ff0000">Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td colspan="2">Total</td><td hidden></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n f="=SUM(B3:B4)" v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "removing one property",
    {"v":1,"t":"format","sheet":"items","cells":[["r4","ca",{"style":{"color":null}}]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td colspan="2">Total</td><td hidden></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n f="=SUM(B3:B4)" v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "removing the last property",
    {"v":1,"t":"format","sheet":"items","cells":[["r4","ca",{"style":{"font-weight":null,"color":null}}]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td colspan="2">Total</td><td hidden></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td>Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n f="=SUM(B3:B4)" v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "two style properties in style order",
    {"v":1,"t":"format","sheet":"items","cells":[["r4","ca",{"style":{"text-align":"center","font-weight":null}}]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td colspan="2">Total</td><td hidden></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="color:#333333;text-align:center">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n f="=SUM(B3:B4)" v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "a style on an empty cell",
    {"v":1,"t":"format","sheet":"items","cells":[["r3","cd",{"style":{"text-align":"right"}}]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td colspan="2">Total</td><td hidden></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td><td style="text-align:right"></td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n f="=SUM(B3:B4)" v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "a fmt on a text cell",
    {"v":1,"t":"format","sheet":"items","cells":[["r3","cc",{"fmt":"0.00"}]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td colspan="2">Total</td><td hidden></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0.00">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n f="=SUM(B3:B4)" v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "removing a fmt",
    {"v":1,"t":"format","sheet":"items","cells":[["r5","cb",{"fmt":null}]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td colspan="2">Total</td><td hidden></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n f="=SUM(B3:B4)" v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "a format on a formula cell keeping its result",
    {"v":1,"t":"format","sheet":"items","cells":[["r5","cb",{"fmt":"0.00"}]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td colspan="2">Total</td><td hidden></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n f="=SUM(B3:B4)" v="1205" fmt="0.00">1205.00</td></tr>
</tbody></table>`,
  ],
  [
    "a format on a formula cell removed fmt",
    {"v":1,"t":"format","sheet":"items","cells":[["r5","cb",{"fmt":null}]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td colspan="2">Total</td><td hidden></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n f="=SUM(B3:B4)" v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "a number into a cell with its own fmt",
    {"v":1,"t":"set","sheet":"items","cells":[["r3","cc",3,{"fmt":"0.0"}]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td colspan="2">Total</td><td hidden></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td n v="3" fmt="0.0">3.0</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n f="=SUM(B3:B4)" v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "a block of 2x3",
    {"v":1,"t":"set","sheet":"items","cells":[["r3","ca","x"],["r3","cb",1],["r3","cc",null],["r4","ca",null],["r4","cb",2000],["r4","cc","y"]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td colspan="2">Total</td><td hidden></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>x</td><td n>1</td><td fmt="0%"></td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333"></td><td n v="2000">2,000</td><td>y</td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n f="=SUM(B3:B4)" v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "a batch of set and format",
    {"v":1,"t":"batch","actions":[{"v":1,"t":"set","sheet":"items","cells":[["r1","cc","hi"]]},{"v":1,"t":"format","sheet":"items","cells":[["r3","cc",{"style":{"color":"blue"}}]]}]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>
<tbody>
<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>hi</td><td>Flag</td></tr>
<tr data-id="r2" data-pos="G"><td colspan="2">Total</td><td hidden></td><td n>7</td></tr>
<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%" style="color:#0000ff">plain</td></tr>
<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>
<tr data-id="r5" data-pos="l"><td>Form</td><td n f="=SUM(B3:B4)" v="1205">1,205</td></tr>
</tbody></table>`,
  ],
  [
    "a set that brings a row",
    {"v":1,"t":"set","sheet":"items","rows":[{"id":"r9","pos":"z"}],"cells":[["r9","cc",1]]},
    `<table grid><colgroup><col data-id="ca" data-pos="8"><col data-id="cb" data-pos="G" fmt="#,##0"><col data-id="cc" data-pos="O"><col data-id="cd" data-pos="V"></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="8"><td>Name</td><td>Qty</td><td>Note</td><td>Flag</td></tr>\n<tr data-id="r2" data-pos="G"><td colspan="2">Total</td><td hidden></td><td n>7</td></tr>\n<tr data-id="r3" data-pos="O"><td>a</td><td n>5</td><td fmt="0%">plain</td></tr>\n<tr data-id="r4" data-pos="V"><td style="font-weight:bold;color:#333333">Bold</td><td n v="1200">1,200</td><td></td><td>TRUE</td></tr>\n<tr data-id="r5" data-pos="l"><td>Form</td><td n f="=SUM(B3:B4)" v="1205">1,205</td></tr>\n<tr data-id="r9" data-pos="z"><td></td><td></td><td n>1</td></tr>\n</tbody></table>`,
  ],
  [
    "a set that brings a column",
    {"v":1,"t":"set","sheet":"items","cols":[{"id":"cz","pos":"z"}],"cells":[["r1","cz",1]]},
    `\u003ctable grid\u003e\u003ccolgroup\u003e\u003ccol data-id=\"ca\" data-pos=\"8\"\u003e\u003ccol data-id=\"cb\" data-pos=\"G\" fmt=\"#,##0\"\u003e\u003ccol data-id=\"cc\" data-pos=\"O\"\u003e\u003ccol data-id=\"cd\" data-pos=\"V\"\u003e\u003ccol data-id=\"cz\" data-pos=\"z\"\u003e\u003c/colgroup\u003e\n\u003ctbody\u003e\n\u003ctr data-id=\"r1\" data-pos=\"8\"\u003e\u003ctd\u003eName\u003c/td\u003e\u003ctd\u003eQty\u003c/td\u003e\u003ctd\u003eNote\u003c/td\u003e\u003ctd\u003eFlag\u003c/td\u003e\u003ctd n\u003e1\u003c/td\u003e\u003c/tr\u003e\n\u003ctr data-id=\"r2\" data-pos=\"G\"\u003e\u003ctd colspan=\"2\"\u003eTotal\u003c/td\u003e\u003ctd hidden\u003e\u003c/td\u003e\u003ctd n\u003e7\u003c/td\u003e\u003c/tr\u003e\n\u003ctr data-id=\"r3\" data-pos=\"O\"\u003e\u003ctd\u003ea\u003c/td\u003e\u003ctd n\u003e5\u003c/td\u003e\u003ctd fmt=\"0%\"\u003eplain\u003c/td\u003e\u003c/tr\u003e\n\u003ctr data-id=\"r4\" data-pos=\"V\"\u003e\u003ctd style=\"font-weight:bold;color:#333333\"\u003eBold\u003c/td\u003e\u003ctd n v=\"1200\"\u003e1,200\u003c/td\u003e\u003ctd\u003e\u003c/td\u003e\u003ctd\u003eTRUE\u003c/td\u003e\u003c/tr\u003e\n\u003ctr data-id=\"r5\" data-pos=\"l\"\u003e\u003ctd\u003eForm\u003c/td\u003e\u003ctd n f=\"=SUM(B3:B4)\" v=\"1205\"\u003e1,205\u003c/td\u003e\u003c/tr\u003e\n\u003c/tbody\u003e\u003c/table\u003e`,
  ],
];

const REFUSED = [
  ["a missing row", { v: 1, t: "set", sheet: S, cells: [["r9", "cc", 1]] }, "missing_row"],
  ["a missing column", { v: 1, t: "set", sheet: S, cells: [["r1", "cz", 1]] }, "missing_col"],
  ["a covered cell", { v: 1, t: "set", sheet: S, cells: [["r2", "cb", "x"]] }, "covered_cell"],
  ["a covered cell after a good cell", { v: 1, t: "set", sheet: S, cells: [["r1", "cc", 1], ["r2", "cb", "x"]] }, "covered_cell"],
  ["a format on a covered cell", { v: 1, t: "format", sheet: S, cells: [["r2", "cb", { fmt: "0%" }]] }, "covered_cell"],
  ["a batch whose second action hits a covered cell", { v: 1, t: "batch", actions: [
    { v: 1, t: "set", sheet: S, cells: [["r1", "cc", 1]] },
    { v: 1, t: "set", sheet: S, cells: [["r2", "cb", "x"]] },
  ] }, "covered_cell"],
  ["a wrong sheet id", { v: 1, t: "set", sheet: "other", cells: [["r1", "cc", 1]] }, "bad_action"],
  ["a batch whose second action names a missing row", { v: 1, t: "batch", actions: [
    { v: 1, t: "set", sheet: S, cells: [["r1", "cc", 1]] },
    { v: 1, t: "set", sheet: S, cells: [["r9", "cc", 2]] },
  ] }, "missing_row"],
];

for (const [name, action, bytes] of PINS) {
  test(`pinned: ${name}`, () => {
    const store = backing();
    const out = apply(store, action, { derive });
    expect(out.out).toBe("applied");
    expect(bytesOf(store)).toBe(bytes);
    expect(keptEmpty(store.sheet)).toEqual([]);
  });
}

test("inverse restores the bytes", () => {
  for (const [name, action, bytes] of PINS) {
    const store = backing();
    const before = bytesOf(store);
    const out = apply(store, action, { derive });
    expect([name, out.out]).toEqual([name, "applied"]);
    const back = apply(store, out.inverse, { derive });
    expect([name, back.out]).toEqual([name, "applied"]);
    // A new formula marks the table stale (no engine in M4), and no action clears stale.
    expect([name, unstale(bytesOf(store))]).toEqual([name, before]);
    const again = apply(store, back.inverse, { derive });
    expect([name, again.out]).toEqual([name, "applied"]);
    expect([name, bytesOf(store)]).toEqual([name, bytes]);
  }
});

const INVALID = [
  ["an action that is not an object", "nope"],
  ["an unknown top level key", { v: 1, t: "set", sheet: S, cells: [["r1", "cc", 1]], extra: 1 }],
  ["a field of the wrong type", { v: 1, t: "set", sheet: S, cells: "r1/cc" }],
  ["a v that is not 1", { v: 2, t: "set", sheet: S, cells: [["r1", "cc", 1]] }],
  ["an unknown kind", { v: 1, t: "merge", sheet: S }],
  ["a sheet that is not text", { v: 1, t: "set", sheet: 5, cells: [["r1", "cc", 1]] }],
  ["a missing sheet", { v: 1, t: "set", cells: [["r1", "cc", 1]] }],
  ["an empty cells list", { v: 1, t: "set", sheet: S, cells: [] }],
  ["a cell entry that is too short", { v: 1, t: "set", sheet: S, cells: [["r1", "cc"]] }],
  ["a NUL in text", { v: 1, t: "set", sheet: S, cells: [["r1", "cc", "a\u0000b"]] }],
  ["a carriage return in text", { v: 1, t: "set", sheet: S, cells: [["r1", "cc", "a\rb"]] }],
  ["a lone surrogate in text", { v: 1, t: "set", sheet: S, cells: [["r1", "cc", "a\ud800b"]] }],
  ["a number that is not finite", { v: 1, t: "set", sheet: S, cells: [["r1", "cc", NaN]] }],
  ["content that is an array", { v: 1, t: "set", sheet: S, cells: [["r1", "cc", [1]]] }],
  ["content that is an object that is not exactly { f }", { v: 1, t: "set", sheet: S, cells: [["r1", "cc", { g: "=A1" }]] }],
  ["a formula that does not start with =", { v: 1, t: "set", sheet: S, cells: [["r1", "cc", { f: "A1" }]] }],
  ["an id outside the id syntax", { v: 1, t: "set", sheet: S, cells: [["r 1", "cc", 1]] }],
  ["an id that is too long", { v: 1, t: "set", sheet: S, cells: [["r1", "c".repeat(65), 1]] }],
  ["an order key that is not a key", { v: 1, t: "set", sheet: S, rows: [{ id: "r9", pos: "0" }], cells: [["r9", "cc", 1]] }],
  ["a record with a field that is not id or pos", { v: 1, t: "set", sheet: S, rows: [{ id: "r9", pos: "z", width: 4 }], cells: [["r9", "cc", 1]] }],
  ["a style property outside the list", { v: 1, t: "set", sheet: S, cells: [["r1", "cc", 1, { style: { outline: "1px" } }]] }],
  ["a style value that is not canonical", { v: 1, t: "set", sheet: S, cells: [["r1", "cc", 1, { style: { color: " red" } }]] }],
  ["a style value that is not text or null", { v: 1, t: "set", sheet: S, cells: [["r1", "cc", 1, { style: { color: 5 } }]] }],
  ["a fmt longer than 255 characters", { v: 1, t: "set", sheet: S, cells: [["r1", "cc", 1, { fmt: "0".repeat(256) }]] }],
  ["an extra field that is not fmt, style, css or text", { v: 1, t: "set", sheet: S, cells: [["r1", "cc", 1, { span: 2 }]] }],
  ["a text in an extra that is not text", { v: 1, t: "set", sheet: S, cells: [["r1", "cc", 1, { text: 5 }]] }],
  ["a NUL in a text in an extra", { v: 1, t: "set", sheet: S, cells: [["r1", "cc", 1, { text: "a\u0000b" }]] }],
  ["a carriage return in a text in an extra", { v: 1, t: "format", sheet: S, cells: [["r1", "cc", { text: "a\rb" }]] }],
  ["a carriage return in a css in an extra", { v: 1, t: "format", sheet: S, cells: [["r1", "cc", { css: "color:red;\r\nfont-weight:bold" }]] }],
  ["a lone surrogate in a text in an extra", { v: 1, t: "format", sheet: S, cells: [["r1", "cc", { text: "a\ud800b" }]] }],
  ["a format with no extra", { v: 1, t: "format", sheet: S, cells: [["r1", "cc"]] }],
  ["the same cell named twice", { v: 1, t: "set", sheet: S, cells: [["r1", "cc", 1], ["r1", "cc", 2]] }],
  ["the same record id brought twice", { v: 1, t: "set", sheet: S, rows: [{ id: "r9", pos: "z" }, { id: "r9", pos: "zz" }], cells: [["r9", "cc", 1]] }],
  ["a batch inside a batch", { v: 1, t: "batch", actions: [{ v: 1, t: "batch", actions: [{ v: 1, t: "set", sheet: S, cells: [["r1", "cc", 1]] }] }] }],
  ["an empty actions list", { v: 1, t: "batch", actions: [] }],
  ["an action inside a batch that is invalid", { v: 1, t: "batch", actions: [{ v: 1, t: "set", sheet: S, cells: [] }] }],
];

const VALID = [
  { v: 1, t: "set", sheet: S, cells: [["r1", "cc", 1, { fmt: "0.00", style: { "font-weight": "bold" }, text: "one" }]] },
  { v: 1, t: "format", sheet: S, cells: [["r1", "cc", { text: "one" }]] },
  { v: 1, t: "set", sheet: S, rows: [{ id: "r9", pos: "z" }], cols: [{ id: "cz", pos: "z" }], cells: [["r9", "cz", null]] },
  { v: 1, t: "batch", actions: [
    { v: 1, t: "set", sheet: S, cells: [["r1", "cc", { f: "=A1" }]] },
    { v: 1, t: "format", sheet: S, cells: [["r1", "cb", { fmt: null, style: { color: null } }]] },
  ] },
];

test("validate", () => {
  for (const [name, action] of INVALID) {
    let caught = null;
    try {
      validate(action);
    } catch (err) {
      caught = err;
    }
    expect([name, caught instanceof GridRefused]).toEqual([name, true]);
    expect([name, caught.code]).toEqual([name, name === "an order key that is not a key" ? "bad_key" : "bad_action"]);
    expect([name, typeof caught.detail]).toEqual([name, "string"]);
  }
  for (const action of VALID) expect(validate(action)).toBe(undefined);
});

test("refused changes nothing", () => {
  for (const [name, action, code] of REFUSED) {
    const store = backing();
    const before = bytesOf(store);
    const out = apply(store, action, { derive });
    expect([name, out.out]).toEqual([name, "refused"]);
    expect([name, out.code]).toEqual([name, code]);
    expect([name, bytesOf(store)]).toEqual([name, before]);
  }
});

test("fits agrees with apply", () => {
  const cases = [...PINS.map(([name, action]) => [name, action]), ...REFUSED.map(([name, action]) => [name, action])];
  let applied = 0;
  let refused = 0;
  for (const [name, action] of cases) {
    const read = backing();
    const before = bytesOf(read);
    const fit = fits(read, action);
    expect([name, bytesOf(read)]).toEqual([name, before]);
    const out = apply(backing(), action, { derive });
    expect([name, fit === true]).toEqual([name, out.out === "applied"]);
    if (out.out === "applied") applied++;
    else refused++;
  }
  expect(applied).toBeGreaterThan(0);
  expect(refused).toBeGreaterThan(0);
});

test("batch is all or nothing", () => {
  const action = REFUSED.find(([name]) => name === "a batch whose second action names a missing row")[1];
  const before = bytesOf(backing());

  const store = backing();
  const out = apply(store, action, { derive });
  expect(out.out).toBe("refused");
  expect(out.code).toBe("missing_row");
  expect(bytesOf(store)).toBe(before);

  const unchecked = backing();
  const direct = applyUnchecked(unchecked, action, { derive });
  expect(direct.out).toBe("refused");
  expect(direct.code).toBe("missing_row");
  expect(bytesOf(unchecked)).toBe(before);
});

test("needs, creates, targets", () => {
  const set = { v: 1, t: "set", sheet: S, cells: [["r1", "cb", 1, { fmt: "0.00", style: { "font-weight": "bold" } }], ["r2", "cc", "x"]] };
  expect(needs(set)).toEqual({ rows: ["r1", "r2"], cols: ["cb", "cc"] });
  expect(creates(set)).toEqual({ rows: [], cols: [] });
  expect(targets(set)).toEqual([
    [S, "r1", "cb", "content"],
    [S, "r1", "cb", "fmt"],
    [S, "r1", "cb", "style:font-weight"],
    [S, "r2", "cc", "content"],
  ]);

  const format = { v: 1, t: "format", sheet: S, cells: [["r3", "cc", { fmt: "0.0", style: { color: "red", "text-align": null } }]] };
  expect(needs(format)).toEqual({ rows: ["r3"], cols: ["cc"] });
  expect(creates(format)).toEqual({ rows: [], cols: [] });
  expect(targets(format)).toEqual([
    [S, "r3", "cc", "fmt"],
    [S, "r3", "cc", "style:color"],
    [S, "r3", "cc", "style:text-align"],
  ]);

  const batch = { v: 1, t: "batch", actions: [set, format] };
  expect(needs(batch)).toEqual({ rows: ["r1", "r2", "r3"], cols: ["cb", "cc"] });
  expect(creates(batch)).toEqual({ rows: [], cols: [] });
  expect(targets(batch)).toEqual([...targets(set), ...targets(format)]);

  const grows = { v: 1, t: "set", sheet: S, rows: [{ id: "r9", pos: "z" }], cells: [["r9", "cc", 1]] };
  expect(needs(grows)).toEqual({ rows: [], cols: ["cc"] });
  expect(creates(grows)).toEqual({ rows: ["r9"], cols: [] });
});

test("derivePlain matches the host patch", () => {
  const source = readFileSync(GOLDEN, "utf8");
  const model = gridModel(source, 0);
  const rowId = model.rows[1].id;
  const colId = model.cols[1].id;
  const values = [1200, 0, -3.5, "text", "007", "TRUE", true, false, null, "", "=A1", 1234.5];
  let compared = 0;
  for (const value of values) {
    const content = typeof value === "string" && value.startsWith("=") ? { f: value } : value;
    const store = modelBacking(gridModel(source, 0));
    const out = apply(store, { v: 1, t: "set", sheet: "", cells: [[rowId, colId, content]] }, { derive: derivePlain });
    expect([value, out.out]).toEqual([value, "applied"]);
    const mine = bytesOf(store);
    const theirs = patchGrid(source, [{ range: "B2", values: [[value]] }]).bytes;
    expect([value, startTag(mine)]).toEqual([value, startTag(theirs)]);
    expect([value, rowLine(mine, rowId)]).toEqual([value, rowLine(theirs, rowId)]);
    compared++;
  }
  console.log(`derivePlain matched patchGrid on ${compared} values`);
  expect(compared).toBeGreaterThan(0);
});

test("stale", () => {
  const action = { v: 1, t: "set", sheet: S, cells: [["r1", "cc", "x"]] };

  const plain = backing();
  expect(apply(plain, action, { derive: derivePlain }).out).toBe("applied");
  expect(startTag(bytesOf(plain))).toBe("<table grid stale>");

  const rich = backing();
  expect(apply(rich, action, { derive }).out).toBe("applied");
  expect(bytesOf(rich).includes("stale")).toBe(false);

  const store = backing();
  const before = bytesOf(store);
  const out = apply(store, action, { derive: derivePlain });
  expect(startTag(bytesOf(store))).toBe("<table grid stale>");
  expect(apply(store, out.inverse, { derive: derivePlain }).out).toBe("applied");
  expect(startTag(bytesOf(store))).toBe("<table grid stale>");
  expect(bytesOf(store).replace("<table grid stale>", "<table grid>")).toBe(before);

  const formula = backing();
  expect(apply(formula, { v: 1, t: "set", sheet: S, cells: [["r1", "cc", { f: "=1+1" }]] }, { derive }).out).toBe("applied");
  expect(startTag(bytesOf(formula))).toBe("<table grid stale>");
});

test("a format the grid does not know keeps the cell's text", () => {
  const source = `<table grid><colgroup><col data-id="c1" data-pos="8"></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="8"><td n v="12345" fmt="0.0,&quot;k&quot;">12.3k</td></tr>\n</tbody></table>`;
  const store = modelBacking(gridModel(source, 0), { sheetId: null });
  const bold = { v: 1, t: "format", sheet: "", cells: [["r1", "c1", { style: { "font-weight": "bold" } }]] };
  const out = apply(store, bold, { derive });
  expect(out.out).toBe("applied");
  expect(bytesOf(store)).toBe(`<table grid><colgroup><col data-id="c1" data-pos="8"></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="8"><td n v="12345" fmt="0.0,&quot;k&quot;" style="font-weight:bold">12.3k</td></tr>\n</tbody></table>`);
  expect(apply(store, out.inverse, { derive }).out).toBe("applied");
  expect(bytesOf(store)).toBe(source);
});

const CUSTOM = `<table grid><colgroup><col data-id="c1" data-pos="8"><col data-id="c2" data-pos="G"></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="8"><td n v="12345" fmt="0.0,&quot;k&quot;">12.3k</td><td>Sum</td></tr>\n<tr data-id="r2" data-pos="G"><td>a</td></tr>\n</tbody></table>`;

const CUSTOM_COL = `<table grid><colgroup><col data-id="c1" data-pos="8" fmt="0.0,&quot;k&quot;"><col data-id="c2" data-pos="G"></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="8"><td n v="12345">12.3k</td><td>Sum</td></tr>\n<tr data-id="r2" data-pos="G"><td>a</td></tr>\n</tbody></table>`;

const customStore = (source) => modelBacking(gridModel(source, 0), { sheetId: null });

const undoRestores = (source, action, after) => {
  const store = customStore(source);
  const out = apply(store, action, { derive });
  expect(out.out).toBe("applied");
  expect(bytesOf(store)).toBe(after);
  const back = apply(store, out.inverse, { derive });
  expect([back.out, back.code]).toEqual(["applied", undefined]);
  expect(bytesOf(store)).toBe(source);
  expect(apply(store, back.inverse, { derive }).out).toBe("applied");
  expect(bytesOf(store)).toBe(after);
};

test("undo brings back a custom format\u0027s text after a format change", () => {
  undoRestores(
    CUSTOM,
    { v: 1, t: "format", sheet: "", cells: [["r1", "c1", { fmt: "0.00" }]] },
    `<table grid><colgroup><col data-id="c1" data-pos="8"><col data-id="c2" data-pos="G"></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="8"><td n v="12345" fmt="0.00">12345.00</td><td>Sum</td></tr>\n<tr data-id="r2" data-pos="G"><td>a</td></tr>\n</tbody></table>`,
  );
});

test("undo brings back a custom format\u0027s text after a delete of the column", () => {
  undoRestores(
    CUSTOM,
    { v: 1, t: "deleteCols", sheet: "", cols: ["c1"] },
    `<table grid><colgroup><col data-id="c2" data-pos="G"></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="8"><td>Sum</td></tr>\n<tr data-id="r2" data-pos="G"></tr>\n</tbody></table>`,
  );
});

test("undo brings back a custom format\u0027s text after a changeCols format change", () => {
  undoRestores(
    CUSTOM_COL,
    { v: 1, t: "changeCols", sheet: "", cols: [{ id: "c1", fmt: "0.00" }] },
    `<table grid><colgroup><col data-id="c1" data-pos="8" fmt="0.00"><col data-id="c2" data-pos="G"></colgroup>\n<tbody>\n<tr data-id="r1" data-pos="8"><td n v="12345">12345.00</td><td>Sum</td></tr>\n<tr data-id="r2" data-pos="G"><td>a</td></tr>\n</tbody></table>`,
  );
});

test("apply ignores a text under a built-in format", () => {
  const plain = backing();
  const builtin = apply(plain, { v: 1, t: "set", sheet: S, cells: [["r1", "cc", 7, { text: "seven" }]] }, { derive });
  expect([builtin.out, builtin.code]).toEqual(["applied", undefined]);
  expect(rowLine(bytesOf(plain), "r1")).toEqual(expect.stringContaining("<td n>7</td>"));

  const columnStore = customStore(CUSTOM_COL);
  const column = apply(columnStore, { v: 1, t: "format", sheet: "", cells: [["r1", "c1", { fmt: "0.00", text: "12.3k" }]] }, { derive });
  expect([column.out, column.code]).toEqual(["applied", undefined]);
  expect(rowLine(bytesOf(columnStore), "r1")).toEqual(expect.stringContaining('fmt="0.00">12345.00<'));

  const formulaStore = backing();
  const formula = apply(formulaStore, { v: 1, t: "set", sheet: S, cells: [["r1", "cc", { f: "=1+1" }, { text: "two" }]] }, { derive });
  expect([formula.out, formula.code]).toEqual(["applied", undefined]);
});
