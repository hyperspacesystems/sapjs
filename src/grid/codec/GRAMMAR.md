# The grid grammar

This is the contract between the sheet's canonical writer (`write.js`) and its strict reader (`scan.js`). The reader accepts a region if and only if it fits this grammar, and the writer emits only bytes that fit it. Every host (hyperclay.com, Hyperclay Local, HTML Clay in Go) reads a sheet's data by these rules, so change this file, the writer and the reader together or not at all.

Why it is strict: a reader that accepts more than the writer emits can read a value differently from a real HTML parser (six such inputs were found in the prototype). A reader that accepts only what the writer emits cannot disagree, and that is tested as a fixpoint: every row and column the reader accepts, written back by the writer, equals its bytes in the source.

## Grammar

Over the decoded text of the file. `ws` is a run of zero or more space, tab and line feed characters. Nothing else may appear between the tokens shown.

```
grid     = '<table grid' [' freeze-cols="' count '"'] [' stale'] '>' ws [colgroup ws] [thead ws] {tbody ws} '</table>'
colgroup = '<colgroup>' {ws col} ws '</colgroup>'
col      = '<col data-id="' aval '" data-pos="' aval '"' [' fmt="' aval '"'] [' style="width:' count 'px"'] '>'
thead    = '<thead>' {ws row} ws '</thead>'
tbody    = '<tbody>' {ws row} ws '</tbody>'
row      = '<tr data-id="' aval '" data-pos="' aval '"' [' style="' aval '"'] '>' {cell} '</tr>'
cell     = '<td' [' n'] [' t'] [' f="' aval '"'] [' v="' aval '"'] [' fmt="' aval '"']
           [' colspan="' count '"'] [' rowspan="' count '"'] [' hidden'] [' style="' aval '"'] '>' text '</td>'
aval     = { any character except '"' '&' CR NUL  |  '&amp;'  |  '&quot;' }
text     = { any character except '<' '>' '&' CR NUL  |  '&amp;'  |  '&lt;'  |  '&gt;' }
count    = '0' | ('1'..'9') {'0'..'9'}        at most 7 characters
```

Value limits on `count`: `freeze-cols` is at least 1 (a table with no frozen columns omits the attribute), `colspan` and `rowspan` are at least 2, the column width is at least 0.

Further rules the grammar alone does not show:

- A cell with `hidden` has empty text.
- A row's last cell is never a bare `<td></td>`: the writer drops trailing empty cells, so the reader refuses a row that ends with one.
- Rows in `thead` are the frozen rows. A table has at most one `thead`, and it comes before every `tbody`.
- The writer always emits a `colgroup` and at least one `tbody`; the reader accepts a table without them, since the grammar marks them optional, and the fixpoint holds row by row and column by column.

## What the writer emits

`tableHtml(sheet, { groupSize = 50 })` writes the table start tag, the `colgroup` on the same line, then a line feed. Frozen rows go in one `thead`, one row per line. Data rows go in `tbody` groups of `groupSize` rows, one row per line; an empty sheet still gets one empty `tbody`. Escapes: `&amp; &lt; &gt;` in text, `&amp; &quot;` in attribute values, nothing else. A carriage return or a NUL in any value is an error, never written: callers turn CRLF into LF before they write.

## The model

The model the writer takes and the reader returns (frozen at Gate A):

```js
// sheet: { id, name, pos, freezeCols?: number, stale?: true, cols: Col[], rows: Row[] }
// Col:   { id, pos, fmt?: string, width?: number }
// Row:   { id, pos, frozen?: true, style?: string, cells: (Cell | null)[] }   trailing nulls are not stored
// Cell:  { text: string, n?: true, t?: true, f?: string, v?: string, fmt?: string,
//          colspan?: number, rowspan?: number, hidden?: true, style?: string }
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
