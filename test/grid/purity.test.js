import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GRID = join(__dirname, "..", "..", "src", "grid");
const BANNED = /\b(Date|Intl|toLocaleString|toFixed|Math\.random|document|window|innerHTML|outerHTML)\b/;
const SKIP = new Set(["backing-dom.js", "grid.js"]);

function impure(folder) {
  const files = readdirSync(folder).filter((name) => name.endsWith(".js") && !SKIP.has(name));
  const bad = [];
  for (const name of files) {
    const hit = readFileSync(join(folder, name), "utf8").match(BANNED);
    if (hit) bad.push(`${name} uses ${hit[0]}`);
  }
  return { files, bad };
}

describe("grid purity", () => {
  test("pure grid files use no clock, locale or page", () => {
    const { files, bad } = impure(GRID);
    expect(files.length).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });

  test("the purity check catches a planted file", () => {
    const dir = mkdtempSync(join(tmpdir(), "grid-purity-"));
    writeFileSync(join(dir, "planted.js"), "x.toFixed(2);\n");
    const { bad } = impure(dir);
    expect(bad).toEqual(["planted.js uses toFixed"]);
  });
});
