import { chartBox, drawingProblem, figureHtml } from "../../src/grid/codec/index.js";

describe("a chart's drawing", () => {
  test("a drawing a browser would read differently is refused", () => {
    const bad = [
      "<svg></svg><title></svg>",
      "<svg/><title></svg>",
      "<svg><title><title></svg>",
      "<svg><title><rect></rect></title></svg>",
      '<svg><rect fill="&#117;rl(x)"></rect></svg>',
      '<svg><rect style="fill:\\75rl(x)"></rect></svg>',
      '<svg><rect style="fill:url/**/(x)"></rect></svg>',
      '<svg onload="x"></svg>',
      "<svg><!-- x --></svg>",
      "<svg><image></image></svg>",
      "<svg><rect></svg>",
      "<svg><g><rect></g></rect></svg>",
      "<svg></svg><svg></svg>",
      "<svg><rect x='1'></rect></svg>",
      "<svg>\ud800</svg>",
      '<svg sap="" effect="x"></svg>',
      '<svg><g sap=""></g></svg>',
      '<svg editmode:onclick="x"></svg>',
      "<svg><rect style=\"background:image-set('x' 1x)\"></rect></svg>",
      '<svg aria-label="a &lt; b"></svg>',
      "",
    ];
    for (const html of bad) expect([html, drawingProblem(html)]).toEqual([html, expect.any(String)]);
  });

  test("a drawing the page serializer writes is accepted", () => {
    const ns = "http://www.w3.org/2000/svg";
    const figure = document.createElement("figure");
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 10 10");
    const title = document.createElementNS(ns, "title");
    title.textContent = "Sales";
    const rect = document.createElementNS(ns, "rect");
    rect.setAttribute("x", "1");
    svg.append(title, rect);
    const text = document.createElementNS(ns, "text");
    text.textContent = "Tom's & Jerry's <plan>\u00a0end";
    svg.append(text);
    figure.append(svg);
    expect(drawingProblem(figure.innerHTML)).toBeNull();
  });

  test("a figure's chart id with a no-break space is written as a browser writes it", () => {
    expect(figureHtml("a\u00a0b", "<svg></svg>")).toContain('chart="a&nbsp;b"');
  });

  test("a chart box is closed, top-left first and within XFD", () => {
    expect(chartBox("E2:J14")).toEqual({ left: 4, top: 1, right: 9, bottom: 13 });
    for (const range of ["J14:E2", "$E$2", "E2:E", "XFE1", "A0"]) expect([range, chartBox(range)]).toEqual([range, null]);
    expect(chartBox("XFD9999999")).not.toBeNull();
  });
});
