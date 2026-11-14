import { sheet } from "./sheets.js";

// The shapes an agent writes and the seeded generator used to miss: mixed cell styles on the
// engine's families, row styles with `height` after another declaration and spaces after colons, a
// custom format column, and a hidden cell that held text under a merge.
export function agentSheet() {
  const model = sheet({
    cols: [["ca", "8"], ["cb", "G"], ["cc", "O"], ["cd", "V"]],
    rows: [
      ["h", "8", [
        { text: "Item", style: "text-align: center; color: var(--brand)" },
        { text: "Weight" },
        { text: "Qty", style: "border-width: 1px; border-style: solid; border-color: #cccccc" },
        { text: "Note", style: "font: 14px Georgia" },
      ]],
      ["r1", "G", [
        { text: "Rent", style: "background: linear-gradient(#ffffff,#000000)" },
        { text: "12.3k", n: true, v: "12345" },
        { text: "3", n: true, style: "background-image:url(icon.png); background-repeat:no-repeat" },
        { text: "a", style: "border-top-left-radius: 6px" },
      ]],
      ["r2", "O", [
        { text: "Total", colspan: 2, rowspan: 2 },
        { text: "", hidden: true },
        { text: "4", n: true },
        { text: "b" },
      ]],
      ["r3", "V", [
        { text: "", hidden: true },
        { text: "", hidden: true },
        { text: "5", n: true },
        { text: "c" },
      ]],
      ["r4", "l", ["x", { text: "internal note", hidden: true }, { text: "6", n: true }, "d"]],
    ],
  });
  model.cols[1].fmt = '0.0,"k"';
  model.rows[0].style = "background: #eeeeee; height: 24px";
  model.rows[2].style = "color:#333333; height: 30px";
  model.rows[4].style = "height: 20px";
  return model;
}

export const agentHiddenText = [{ row: 4, col: 1, text: "internal note" }];
