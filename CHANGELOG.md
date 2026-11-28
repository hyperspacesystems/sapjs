# Changelog

## [0.5.2] - 2026-10-17

### Changed
- Homepage no longer shows the CSP unsafe-eval callout
- Homepage uses plain section headings, adds a "When to use it" section, and renames the explainer to "How it works"
- Homepage restates the large-records limit using the 10,000-row numbers
- Site uses Newsreader instead of Fraunces for headings and all serif text
- Rebuilt dist and docs for inert seed rows
- cms-template seed rows are treated as inert

### Fixed
- W30 is skipped after a visitor draft restore, and warnings are printed as warnings



## [0.5.1] - 2026-10-15

### Changed
- Reworded the sapjs homepage meta description and heading
- The self-contained doc test now allows the polite pop loader, and only that loader
- The polite pop newsletter ask now loads from hyperclay.com
- Doubled the space between the hero demo and its code
- Elements with no directives now share one empty plan

### Fixed
- A change at 10,000 rows now stays under 50 ms because parsed directives are cached



## [0.5.0] - 2026-10-14

### Added
- Shared site.css stylesheet used across all pages
- How-it-works page
- New home page
- Guide for building malleable document apps, generated at build time
- Editable rows in each loops
- Presence fields
- Detail dialogs
- Shared blueprints



## [0.4.0] - 2026-10-12

### Added
- `each=`, a keyed projection list
- A 1,000-record `each` benchmark and a CPU profile summarizer
- `data-*` attributes accepted as state fields, and detail panels can write through to them

### Changed
- Rows are keyed by `data-id`, and ids are no longer stamped onto rows at mount
- Mounting waits for `clay.ready`, and detail panels resolve after intake
- Documented `each=`, row keys, `data-*` fields and the `clay.ready` mount
- README explains where paints live in a malleable file (saved paints, freeze scratchpads)
- Rebuilt dist and the explainer bundle

### Fixed
- Move actions in `each` rows
- `data-*` fields whose names look like booleans or reserved words



## [0.3.1] - 2026-09-28

### Changed
- Saving now preserves the author's original markup when the saved content matches the live page state

### Fixed
- A textarea's leading newline is now kept through save and reload



## [0.3.0] - 2026-09-19

### Added
- Deploy script for releases
- SAPJS package to the packed contract
- sapjs llms.txt reference

### Changed
- Include the packed contract in published package files
- clayjs sapjs destination path to entries/sap.js

### Fixed
- Broken npm package link



## [0.2.4] - 2026-08-21

### Changed
- Update sapjs dependency



## [Unreleased]

## [0.11.2] - 2026-11-28

### Changed
- No user-facing changes.

## [0.11.1] - 2026-11-23

### Fixed
- Grid formulas in X2 now calculate correctly.
- Rooms keep the encoding they had before the codec change.
- Hidden digests stay out of view.
- `describe` now reports a document's details correctly.

## [0.11.0] - 2026-11-20

### Added

- Pages with a `<table grid>` load the grid plugin on their own, with the table's own `freeze-cols` and `stale` attributes known before it loads.
- A saved sheet opens as a live table. Typed edits write the cell, and saving writes the file back byte for byte.
- The grid reads with `get`, `cell`, `input` and `issues`, writes with `set`, `setRange`, `clear`, `format` and `repair`, runs the row and column commands, and imports and exports CSV and TSV.
- Rows and columns take a bare `hidden` attribute, and merges may run tall.
- A batch of grid edits is one undo step, and a page undo gives back each cell a batch changed, including a cell it cleared while reformatting its column.
- Rows stay in the writer's `thead` and 50-row `tbody` groups, and an undo puts them back in their groups.
- `createSheetWriter()` writes the same bytes as `tableHtml` and reuses each untouched group's string. `touch()` takes a Grid change event or `apply`'s changes, plus changed formula results. `Sap.grid.createSheetWriter()` is there for the sheet shell, and `createSheetWriter` on the codec entry for Node hosts.
- A workbook's formulas follow their cells through row inserts, deletes and moves, column steps, and tab renames, deletes and moves. A deleted cell reads `#REF!`, and a reference past the edge floats.
- `applyWorkbook` runs one step over every tab, all or nothing, with an inverse that takes it back.
- One engine computes every tab's results (`createSheets`, `Sap.grid.sheets`), and a step computes only the ranges whose rows or columns changed.
- 86 functions: sums, counts, rounding, `SUMIF` and its kin, logic, `IS` functions, `ROW` and `COLUMN`, lookups (`VLOOKUP`, `HLOOKUP`, `XLOOKUP`, `LOOKUP`, `MATCH`, `INDEX`), text, dates, `SUBTOTAL`, `RAND` and `RANDBETWEEN`. Their values are checked against what Google Sheets gives.
- `standard(f, homeId, frame)` prints a formula in standard spelling: function names, `TRUE` and `FALSE` in capitals, references from the tabs' own names.
- `Sap.grid.tokenize` for a host's formula editor.
- `locale` on `createGrid` and `createSheets` takes "de", "fr", "es", "pt-BR", "it" or "nl". A person types 1.234,56, 5.3.2024, WAHR and =SUMME(A1;2,5), and the table stores 1234.56, the date, TRUE and =SUM(A1,2.5), so a file saved under one locale is byte identical under any other.
- The cell editor shows numbers, dates and formulas the way the locale types them, and Enter on an unchanged cell changes nothing.
- CSV in a decimal-comma locale exports with ";" and local numbers and dates, and imports back unchanged.
- `Sap.grid.sheets(root, extra)` passes a host's `locale`, `quiet`, `now` and `random`.
- `grid-functions` adds 26 statistics and finance functions (STDEV, VAR, MODE, LARGE, SMALL, PERCENTILE, QUARTILE, RANK, CORREL, PMT, FV, PV, NPER, NPV, IRR, RATE and aliases).
- `grid-formats` draws any number code through numfmt, kept as an optional peer so sapjs keeps zero runtime dependencies.
- `Sap.grid.extend({ functions, formatters })` adds to the grid's own tables, with `Sap.grid.fmtKind` and `Sap.grid.adjustDecimals` for a host's format menus.
- Opening a saved sheet before an extension pack arrives keeps each waiting formula's saved result and writes nothing. When the functions arrive the waiting formulas compute and announce. When the formatters arrive, results are drawn again, not computed, so `RAND` keeps its number.
- `Sap.grid.roomCodec` implements ClayJS's live-room codec over a plain workbook document: it reads and writes the `[sheet-workbook]` region's bytes, sorts, undoes in a room, and carries actions over 128 operations or 63 KiB in parts.
- An undo in a room puts back each field only while it still holds what the undone action left, skips what a coworker changed since, and names it in `skipped`.
- A whole-width sort takes an optional `pos` (one key per row) that its undo uses to put the exact keys back.
- A table may end with one `<template rules>` block holding a `<rule>` per checkbox column, dropdown, conditional format or color scale. A rules action adds, replaces and removes rules by id.
- A chart is a fifth rule kind: its range is the box of cells it covers, its source the data it draws, with a type (column, bar, line, area, pie, scatter), an optional title, stacked and series by rows. Its last drawing is saved as `<figure chart sap-ignore>` after the tab's table, so a reader with no script sees it.
- `Sap.grid` exposes `drawingProblem`, `drawingsIn` and `areaOf` for ClayJS.
- `derived.register` receives `{ flush }` as its second argument, which runs `Sap.flush`. ClayJS calls it before a save so the file holds the latest derived paints.

### Changed

- A 10,000-row paste applies and undoes in about 0.1 s each, down from 19 s and 87 s.
- Inserted and deleted rows and columns move every rule's range and source as formulas move. A move or a sort leaves rules in place, and a conditional format's formula moves with its range's top-left corner.
- An undo puts back every rule a step changed or rebound, unless a coworker changed it since.
- A grid without a formula engine refuses edits that would shift its rules.
- `patchGrid` marks a table stale only when it holds a formula or a written number needs its format drawn. Text (`@`) and automatic formats count as drawn.
- Opening a file whose results changed only through `TODAY`, `NOW`, `RAND` or `RANDBETWEEN` does not mark it unsaved (`createSheets(root, { quiet })`).
- A typed formula with an English "," between arguments, or a "." in a decimal-comma locale, is refused with a message instead of being read as another formula.
- A page's own url for a plugin the manifest names wins over the default address.
- `Sap.use` while the same plugin is loading ends that load.
- Formulas whose ranges a sort reorders, or that a `SUMIF` stretches into one, are recalculated.

### Fixed

- Formula results match Google Sheets where they differed: `^` groups from the right, a text of only spaces is `#VALUE!` in arithmetic, sums that cancel to rounding noise are 0, `0^-1` is `#NUM!`, `SUM("")` is `#VALUE!`, `AND()` is `#N/A`, and text functions count an emoji as one character.
- `=SUM(B2:B)` keeps its open end through a row insert instead of becoming `=SUM(#REF!)`.
- Rows that share one order key sort in order: an ascending sort of 50, 30, 10 shows 10, 30, 50.
- A sort's undo writes each cell back to its own row, so a row a coworker moved or deleted takes back its own values, and a whole-width undo leaves out rows a coworker deleted.
- A shipped plugin the engine has no address for is not fetched, so its table keeps its saved markup instead of showing E52.

## [0.10.0] - 2026-11-14

### Added
- Typed input in tables, so each cell keeps to the kind of value it holds.
- Number and date formats for cells, so values read the same way every time.
- Table checking that finds cells with broken or mismatched values, and repair for the problems it finds.
- Undo that puts a table back exactly as it was before each edit.

## [0.9.1] - 2026-11-14

### Fixed
- Money formats write a negative amount as `-$162.40`, and a value that rounds to zero shows no sign.

## [0.9.0] - 2026-11-13

### Added
- Plugins can add directives and page helpers through one plugin host.
- A plugin cannot claim a reserved directive name or a name that already exists on `window`; the message names the helper to rename.

### Fixed
- A page where every plugin loads no longer adds an extra `online` listener at boot. The plugin host listens for `online` only after a plugin fails to load.

## [0.8.0] - 2026-11-13

### Added
- A grid codec that writes and reads the saved table format of a sheet.
- A strict byte route for reading canonical grids.
- Row patches that leave untouched rows byte for byte unchanged.
- Grid digests that match the ones hosts compute.

## [0.7.1] - 2026-11-05

### Changed
- No user-facing changes.

## [0.7.0] - 2026-10-30

### Added
- `appOf` and `ownsAttr` take an optional host element, so a subtree just removed from the page keeps walking ancestors from the element it left, and a host can ask whether a detached node's attribute was painted.

### Changed
- A pass reuses the raw record reads it already made instead of reading every record again, so pages with many records re-render faster.
- A plain row that nothing changed keeps its object between passes, saving about 17 ms per keystroke on a 5,000-row Journal. Its fields are written back from that row's last read, and `$key`, `$index` and `$el` stay own and hidden, with `$index` now configurable.
- Sap refuses record writes at their real destinations while ClayJS write admission is closed. Standalone Sap is unchanged.

### Fixed
- A row shown in a `detail=` panel is read fresh on each pass, since the panel may write state onto it.
- A kept row whose field or `$index` a format made read-only is read again instead of throwing.
- Presence fields are restored before declared fields, so a same-name bind still wins.
- A loop guard that halts a runaway render re-arms on the next refresh or interaction, so a burst of typing no longer leaves the app frozen.
- Undo is rebound once per editing session, and a retired scope no longer receives undo callbacks.

## [0.6.0] - 2026-10-23

### Added
- An ownership reader reports which attributes, class tokens, custom properties and text a paint owns, read from the element's own attributes.

### Changed
- License: relicensed to MIT-0 (MIT No Attribution). Same rights, attribution no longer required. Covers everything in the repo, including src/control-serialize.js and its vendored copies downstream.
- `Sap.why` and `Sap.doctor` now ship only in the full build. The core build warns when you call them.
- The `E01` foreign-dialect check and its dictionary now ship only in the full build.
- The core build is smaller: 44,579 to 40,585 bytes minified, 15,864 to 14,488 gzipped.
- The core build keeps every correctness check.

### Fixed
- `attr:value`, `attr:checked` and `attr:selected` are owned unless a bind, a persist or a bound select owns that form state.
- Every host repaint mounts roots a merge added.
- The classic core bundle uses its own global, so it no longer replaces `window.Sap`.
- A halted app runs no passes.
- Full-only markup that arrives after mount halts the core app before it writes anything.

## [0.2.3] - 2026-08-14

### Added
- sapjs dependency updated



## [0.2.2] - 2026-08-12

### Added
- Support for reading platform capabilities from either the `clay` or `hyperclay` namespace
- `kind`, `status`, and `url` declarations in the `hyper` key


