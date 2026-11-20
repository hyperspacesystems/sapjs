# The grid grammar

This is the contract between the sheet's canonical writer (`write.js`) and its strict reader (`scan.js`). The reader accepts a region if and only if it fits this grammar, and the writer emits only bytes that fit it. Every host (hyperclay.com, Hyperclay Local, HTML Clay in Go) reads a sheet's data by these rules, so change this file, the writer and the reader together or not at all.

Why it is strict: a reader that accepts more than the writer emits can read a value differently from a real HTML parser (six such inputs were found in the prototype). A reader that accepts only what the writer emits cannot disagree, and that is tested as a fixpoint: every row and column the reader accepts, written back by the writer, equals its bytes in the source.

## Grammar

Over the decoded text of the file. `ws` is a run of zero or more space, tab and line feed characters. Nothing else may appear between the tokens shown.

```
grid     = '<table grid' [' freeze-cols="' count '"'] [' stale'] '>' ws [colgroup ws] [thead ws] {tbody ws} [rules ws] '</table>'
colgroup = '<colgroup>' {ws col} ws '</colgroup>'
col      = '<col data-id="' aval '" data-pos="' aval '"' [' fmt="' aval '"'] [' hidden'] [' style="width:' count 'px"'] '>'
thead    = '<thead>' {ws row} ws '</thead>'
tbody    = '<tbody>' {ws row} ws '</tbody>'
row      = '<tr data-id="' aval '" data-pos="' aval '"' [' hidden'] [' style="' aval '"'] '>' {cell} '</tr>'
cell     = '<td' [' n'] [' t'] [' f="' aval '"'] [' v="' aval '"'] [' fmt="' aval '"']
           [' colspan="' count '"'] [' rowspan="' count '"'] [' hidden'] [' style="' aval '"'] '>' text '</td>'
rules    = '<template rules>' {ws rule} ws '</template>'        at least one rule
rule     = '<rule data-id="' aval '" data-pos="' aval '" kind="' kind '" range="' aval '"'
           [' items="' aval '"'] [' source="' aval '"'] [' open'] [' test="' test '"'] [' a="' aval '"'] [' b="' aval '"']
           [' f="' aval '"'] [' style="' aval '"'] [' low="' color '"'] [' mid="' color '"'] [' high="' color '"']
           [' type="' type '"'] [' title="' aval '"'] [' stacked'] [' series="rows"'] '></rule>'
kind     = 'check' | 'list' | 'when' | 'scale' | 'chart'
type     = 'column' | 'bar' | 'line' | 'area' | 'pie' | 'scatter'
test     = 'gt' | 'ge' | 'lt' | 'le' | 'eq' | 'ne' | 'contains' | 'starts' | 'ends' | 'between' | 'outside'
         | 'empty' | 'filled' | 'duplicate' | 'unique' | 'formula'
color    = '#' 6 * ('0'..'9' | 'a'..'f')
aval     = { any character except '"' '&' CR NUL  |  '&amp;'  |  '&quot;' }
text     = { any character except '<' '>' '&' CR NUL  |  '&amp;'  |  '&lt;'  |  '&gt;' }
count    = '0' | ('1'..'9') {'0'..'9'}        at most 7 characters
```

Value limits on `count`: `freeze-cols` is at least 1 (a table with no frozen columns omits the attribute), `colspan` and `rowspan` are at least 2, the column width is at least 0.

Further rules the grammar alone does not show:

- A cell with `hidden` has empty text. A `hidden` row or column is a row or column a person hid; it keeps its cells and its place, and the reader reads its values as any other's.
- A row's last cell is never a bare `<td></td>`: the writer drops trailing empty cells, so the reader refuses a row that ends with one.
- Rows in `thead` are the frozen rows. A table has at most one `thead`, and it comes before every `tbody`.
- The writer always emits a `colgroup` and at least one `tbody`; the reader accepts a table without them, since the grammar marks them optional, and the fixpoint holds row by row and column by column.

## What the writer emits

`tableHtml(sheet, { groupSize = 50 })` writes the table start tag, the `colgroup` on the same line, then a line feed. Frozen rows go in one `thead`, one row per line. Data rows go in `tbody` groups of `groupSize` rows, one row per line, except that a group never ends inside a merge down a column: it runs on until every merge open at its cut has ended (`groupStarts(rows, groupSize)`), since a browser draws no cell across two row groups. The next group counts its `groupSize` rows from where the longer group ended. An empty sheet still gets one empty `tbody`. The reader accepts a group of any size. Escapes: `&amp; &lt; &gt;` in text, `&amp; &quot;` in attribute values, nothing else. A carriage return or a NUL in any value is an error, never written: callers turn CRLF into LF before they write.

## Rules

A table may end with one `<template rules>` block, after its last row group. A browser keeps a `<template>` inside a table where it is, draws nothing for it, and keeps its children out of the table's rows and cells, so a reader without script and every reader of the rows are unaffected. A parser puts the `<rule>` elements in the template's content, not under the element: a tree reader reads them from there.

Each `<rule>` is one checkbox column, dropdown, conditional format or color scale over `range`, an A1 range on its own tab (`C2:C40`, an open-ended `C2:C`, or one cell). `data-id` and `data-pos` are an id and an order key as rows have; rules are written in `data-pos` order, and an earlier rule wins where two conditional formats set the same property.

- `check`: each cell of the range shows a checkbox; its value is `TRUE` or `FALSE`, and a blank shows unchecked. No other attribute.
- `list`: each cell shows a dropdown of `items` (a JSON array of 1 to 500 strings, each 1 to 255 characters with no carriage return, NUL or half of a surrogate pair, written exactly as `JSON.stringify` writes it) or of the values in `source` (an A1 range, which may name another tab). Exactly one of the two. With `open`, a value not in the list is kept and marked; without it, the app refuses it.
- `when`: each cell for which `test` holds takes `style`. `a` and `b` hold the compared values as stored text: `between` and `outside` take both, `empty`, `filled`, `duplicate` and `unique` take neither, every other test takes `a`, and `formula` takes `f`, a formula written for the range's top-left cell. No other attribute.
- `scale`: each number in the range takes a background between `low` (the range's smallest number), the optional `mid` (its middle) and `high` (its largest).
- `chart`: a chart drawn over the cells of `range` from the values in `source` (an A1 range, which may name another tab). `type` is one of `column` (vertical bars), `bar` (horizontal bars), `line`, `area`, `pie` and `scatter`. `title` is optional, 1 to 255 characters with no carriage return, NUL or half of a surrogate pair. `stacked` stacks the series, and only a `column`, `bar` or `area` chart takes it. `series="rows"` makes each row of `source` one series; without it each column is one. No other attribute. A chart's `range` is one cell or one closed range on its own tab, top-left cell first, no `$`, within column XFD and row 9999999.

What a chart shows:

- The first column of `source` holds the categories (the x values on a `scatter`), and every other column is one series. With `series="rows"`, read rows for columns and columns for rows.
- The first row holds the series names when every cell in it past the first column is text or blank and at least one is text. Otherwise the series are named by their column letters, and every row is data.
- A category cell's shown text is its label. A series cell's number is its value; a blank or text cell is a gap. A `pie` draws only the first series, and a slice that is not a positive number is left out.
- Rows and columns a person hid, or a filter hides, are not drawn.

A rule covers places in the sheet. Inserting or deleting rows and columns moves its range and source as a formula's references move (a range whose rows are all gone removes the rule); moving or sorting rows leaves them where they are. A `when` rule's `f` is written for the range's top-left cell: its relative parts move with that corner, and its `$` parts keep naming their row or column.
A chart's box is a picture over the cells: it keeps its size when rows or columns come or go outside it. An end past the tab's last row moves back one row for each row a step removes before a row that stays, and on one row for each row a step puts before a row that stays; rows added or removed after the last row that stays move it not at all. Columns likewise. An end whose row and every row after it a step removes is past the edge after it, and moves as such an end does.

A miss, beyond the grammar: an empty block, an attribute a kind does not take, a missing attribute a kind needs, `items` not written as `JSON.stringify` writes it, a chart rule with no `source`, a `type` not in the list, `stacked` on a `line`, `pie` or `scatter`, a `series` other than `rows`, a chart `range` that is not one cell or a closed range top-left cell first within column XFD and row 9999999, a `title` over 255 characters or holding a carriage return, NUL or half a character.

Model: `sheet.rules?: Rule[]`, absent when the table has none. `Rule { id, pos, kind, range, items?: string[], source?, open?: true, test?, a?, b?, f?, style?, low?, mid?, high?, type?, title?, stacked?: true, series?: "rows" }`.

## Charts' drawings

A tab's section may hold, after its table, one `figure` per chart rule that has been drawn, each on its own line, in rules order. The figure holds the last SVG the app drew for that chart. It is the app's output: no reader takes data from it, and a chart rule with no figure is one the app has not drawn yet.

```
tab      = '<section' attrs '>' '<h2 bind="name">' text '</h2>' grid {ws figure} ws '</section>'
figure   = '<figure chart="' aval '" sap-ignore="">' drawing '</figure>'
drawing  = '<svg' dattrs '>' {start | end | dtext} '</svg>'               at most 1,048,576 characters
start    = '<' name dattrs '>'
end      = '</' name '>'
name     = 'svg' | 'g' | 'title' | 'desc' | 'rect' | 'line' | 'polyline' | 'polygon' | 'path'
         | 'circle' | 'ellipse' | 'text' | 'tspan'
dattrs   = {' ' dname '="' dval '"'}
dname    = 'xmlns' | 'viewBox' | 'width' | 'height' | 'x' | 'y' | 'x1' | 'y1' | 'x2' | 'y2'
         | 'cx' | 'cy' | 'r' | 'rx' | 'ry' | 'd' | 'points' | 'fill' | 'fill-opacity'
         | 'stroke' | 'stroke-width' | 'stroke-opacity' | 'stroke-dasharray'
         | 'stroke-linecap' | 'stroke-linejoin' | 'opacity' | 'transform' | 'text-anchor'
         | 'dominant-baseline' | 'font-family' | 'font-size' | 'font-weight' | 'role'
         | 'aria-label' | 'aria-hidden'
dval     = {any character except '"' '<' CR NUL}
dtext    = {any character except '<' CR NUL}
```

Further rules: a drawing is never empty, and no start tag has white space before its `>`; every element is closed by its own end tag, in order; `title` and `desc` hold text only; `&` appears only as `&amp;`, `&lt;`, `&gt;`, `&quot;` or `&nbsp;`; no value holds `url(`, `\`, `/*`, `&lt;` or `&gt;`. So a drawing holds no script, no link, no comment, no CDATA and nothing a parser reads past, and the first `</figure>` after the start tag always ends the figure.

- **What the writer emits:** for each chart rule with a drawing that fits, a line feed then the figure. A drawing that does not fit is not written.
- **What a reader does:** the room codec reads past each figure (it accepts only the `<figure chart="ID" sap-ignore="">` start tag it writes) and refuses a tab whose figure content is not a `drawing`. A host keeps the bytes as they are. ClayJS writes the live figure as the page serializer writes it, which for the drawer's output is the same bytes (ran: spike 05).
- **Why `sap-ignore=""` and not a bare `sap-ignore`:** it is how the page serializer writes the attribute, so a figure saved by ClayJS and one written by the room codec are byte for byte the same (ran: spike 05), as the codec already writes `<section item="">` (`src/grid/room-codec.js:183`, read).

## The model

The model the writer takes and the reader returns (frozen at Gate A):

```js
// sheet: { id, name, pos, freezeCols?: number, stale?: true, cols: Col[], rows: Row[], rules?: Rule[] }
// Col:   { id, pos, fmt?: string, hidden?: true, width?: number }
// Row:   { id, pos, frozen?: true, hidden?: true, style?: string, cells: (Cell | null)[] }   trailing nulls are not stored
// Cell:  { text: string, n?: true, t?: true, f?: string, v?: string, fmt?: string,
//          colspan?: number, rowspan?: number, hidden?: true, style?: string }
// Rule:  { id, pos, kind: "check" | "list" | "when" | "scale" | "chart", range, items?: string[], source?, open?: true,
//          test?, a?, b?, f?, style?, low?, mid?, high?, type?, title?, stacked?: true, series?: "rows" }
```

The reader returns `null` for a bare `<td></td>`.

## The value rule (`value.js`)

- A cell's raw string is its `v` when present, otherwise its text. A `hidden` cell's value is blank.
- An empty string is blank (`null`).
- With `t`, the raw string is text.
- `TRUE` and `FALSE`, exactly in uppercase, are booleans.
- A string matching `^-?(0|[1-9][0-9]*)(\.[0-9]+)?$` with at most 15 significant digits is a number. Significant digits are the digits after removing the sign, the decimal point, leading zeros and trailing zeros. So `02134`, `1e5`, `+5`, `.5`, `1,200` and a 16 digit card number are text. A string that would overflow to infinity or underflow to zero is text.
- Everything else is text. Text is never trimmed.
- This rule reads the stored file form only. What a person types is parsed by the sheet app by locale (a decimal comma, grouping, a plus sign) and stored as a plain decimal, so the file never holds `1,5` for one and a half.
- `shown(value)` prints a value back: a number with at most 15 significant digits, in plain decimal (never an exponent), with no trailing zeros and no `-0`; booleans as `TRUE` and `FALSE`; a blank as the empty string. Infinity and NaN are an error.
- A cell stores `v` exactly when its text is not `shown(value)`: a formatted number, date or formula result. Formula cells follow the same rule (approved change to decision 2).
- Dates are numbers: serial days since 1899-12-30 (decision 16). A date cell is `<td n v="46095" fmt="mmm d, yyyy">Mar 14, 2026</td>`.

The 15 digit limit was approved by David on review form 5, question 3 (2026-11-11). Worked cases every port must match: `123456789012345` (15 digits) is a number; `4111111111111111` (16 digits) and `12345678901234567890` (a 20 digit id) are text; `02134` is text because of its leading zero; `1200.50` is the number 1200.5 (trailing zeros are not significant); `100000000000000000000` is a number (one significant digit).

A miss is a `CodecMiss` (in Go, a distinct error type), never a plain error, so a host can tell "not canonical" apart from a fault: it reads that table through the tree route and refuses a patch write with 409 (form 5, question 4).

## What is a miss, by design

Any `&` that is not one of the listed references (so `&copy`, `&#0;`, `&#x80;`, `&nbsp;` all miss). A carriage return or a NUL anywhere in the region. A repeated attribute. An attribute in another order, with another name, in uppercase, with single quotes or no quotes, or with a value on a boolean attribute (`n=""`, as a browser's `outerHTML` writes it). An uppercase tag name. Any tag or comment inside a cell. A space before a tag's `>`. A `tbody` before a `thead`, two `thead`s, a `tfoot`, a `caption`. A `hidden` cell that has text. A count with a leading zero or out of its limits.

A miss is not an error for a read: the caller takes the tree route (parses the table with a real HTML parser). It is a refusal for a patch write (decision A3: a host patch on a hand-edited table is refused with 409).

## The guard's row digest

`gridDigest(model)` gives one row per row that holds at least one input, in row order; a row with nothing filled is left out. Each row is:

```
[rowId, filled, mass, inputsHash, columnsHash, mask]
```

- `input` of a cell: `f`, else `v`, else the text; a hidden (covered) cell's input is empty. A recalculation changes only `v` of a formula cell, so it changes no digest.
- `filled`: cells with a non-empty input. `mass`: the sum of each input's length after trim, in UTF-16 code units.
- `inputsHash`: FNV-1a 32 bit over the UTF-8 bytes of every cell's input followed by a NUL, in column order, as 8 lowercase hex digits.
- `columnsHash`: the XOR of FNV-1a of each filled cell's column id (`#<index>` when the column has no id), as 8 hex digits.
- `mask`: the occupancy mask. Bit `i` is set when the cell at column index `i` has an input. Lowercase hex with no leading zeros, column 0 the lowest bit, any width (`"7"` is columns 0 to 2, `"10"` is column 4).

A tab's digest (`tabDigest`) is `{ cols, rows }`: `cols` lists the tab's column ids by index once (a column with no id is `"#<index>"`), `rows` the row digests. `rowChange(before, after, beforeCols, afterCols)` names each mask bit's column through its side's `cols`.

`rowChange(before, after, beforeCols, afterCols)` is the one rule a guard applies to two digests of the same row id (`after` is null when the row is gone):

1. `after` is null (the row is gone): `"destruction"`.
2. Fewer filled cells: `"destruction"`.
3. A column id behind a set bit of `before`'s mask (through `beforeCols`) that is behind no set bit of `after`'s mask (through `afterCols`): `"destruction"`. This is a cleared cell, a removed column, or a column replaced by another at the same position, also when other columns were inserted at the same time.
4. Same `inputsHash`, `columnsHash` and `mask`: `"same"`.
5. Otherwise `"modification"`: an overwrite, or an empty column removed or inserted.

A modification never alarms; a destruction does. `test/grid-codec/golden/digest-vectors.json` carries the table bytes and expected rows for the fixtures (`sheets`) and eleven before and after pairs with their verdict (`changes`: unchanged, overwrite, clear, clear and overwrite in one row, clear one cell and fill another, fill an empty cell, remove a filled column, remove an empty column, clear the whole row, replace a filled column, remove a filled column and insert another). Other hosts check their port against that file.

## Vectors for other hosts

`test/grid-codec/golden/host-vectors.json` (written by `test/grid-codec/support/write-host-vectors.js`, checked by `host-vectors.test.js`) holds what a port of the strict reader and the value rule must reproduce: every golden table, every hostile input and 400 seeded one-character mutants, each with its verdict and, when accepted, the table, cols and rows the reader reports (offsets left out, since JavaScript counts UTF-16 units and Go counts bytes); and the value rule's worked cases plus 1,000 seeded numbers with `shown` and `typed`. Gate V packs it, with `digest-vectors.json`, into the host conformance package.
