# Standalone HTML Report

`src/report.mjs` exports `renderReport(run) -> string` for the version 1 result
object in `docs/contracts.md`. It is synchronous, does not mutate its input,
does not write files or request network resources, and uses only Node's built-in
crypto module. Unsupported or missing `schemaVersion` throws a `TypeError`.

```js
import { renderReport } from './src/report.mjs';

const html = renderReport(run);
// The caller writes html beside the artifact paths recorded in run.results.
```

The generated document includes its CSS and a fixed, hash-authorized filter
script. It opens directly from disk without a server or external packages.
Evidence images remain separate files; retain their directory structure when
moving the report. No absolute local path is converted into a clickable URL.

## Outcomes and Scope

- Finding and check counters are computed from the corresponding result arrays,
  never from `run.summary`. All five statuses have explicit text and distinct
  colors. Counters always describe the complete supplied run, even when filtered.
- Findings, checks, notes, and evidence retain input order. No finding or check
  is omitted because it passed, failed, was blocked, needs review, or errored.
- Supplied finding status is retained. A mismatch with the check aggregate is
  flagged beside it; aggregate precedence is error, fail, blocked, review, pass.
  An empty check array requires review. Missing or unknown statuses are counted
  as error and their original value is displayed escaped.
- Partial scope is prominent whenever `partial` is not explicitly false, the
  total is unknown/invalid, selected IDs do not cover the declared total, a
  selected ID has no result, or fewer results than declared findings exist.
  Supplemental results cannot compensate for a missing selected ID.
- "Full declared scope" means only the declared catalog. No report, including
  one with all pass results and exit code 0, certifies the whole website.
- Tool exit code, dates, and environment are shown independently from findings.
  Exit code is not relabeled as a website acceptance result.

## Coverage and Values

Current check count and review outcomes appear separately from the supplied
coverage data. Historical claims are explicitly labeled as non-executable.
The renderer does not convert historical totals into automated checks or infer
an executable-coverage percentage. `coverage` and `summary` are preserved as
labeled, bounded data; the supplied summary is expandable and does not control
status counts.

Each rule displays its ID, label, status, expected value, actual value, and note.
Null renders as `null`, missing values as `[not supplied]`, and structured values
as indented JSON-like text. Long or multiline values use native `details` and
`summary` controls. Rendering limits are 16,384 characters per value before HTML
escaping, eight nested object/array levels, and 100 entries per container, with
a shared traversal text budget. Truncation is explicit and directs readers to
original JSON/DOM evidence. These excerpts need not be valid JSON. Cycles are
displayed as `[Circular]`; no custom `toJSON` hook is called.

Only bulky values (expected, actual, environment, coverage, summary, selected
IDs, and rejected-path diagnostics) are bounded. Every rule, label, note, and
evidence entry is retained. Large failed observations are not silently dropped.
Input is expected to be ordinary in-memory data from parsed result JSON, not
objects with executable getters or proxies.

## Escaping and Evidence Policy

Every supplied string is escaped at HTML text/attribute boundaries, including
quotes and apostrophes. Embedded page HTML is displayed as text, never injected
into the report DOM. IDs/classes/selectors come from renderer-owned values;
untrusted data is never interpolated into CSS or JavaScript. The filter script
uses DOM text, values, and `hidden`, with no HTML parsing sinks.

Evidence entries are `{label, path}`. Accepted targets are:

- Explicit `http://` or `https://` URLs with a valid hostname, no credentials,
  no whitespace/control characters, and no backslashes. These are marked
  "External page", open in a new tab with `noopener noreferrer`, and never load
  as image thumbnails.
- Artifact paths relative to the HTML file's directory, using forward slashes
  and nonempty segments. Plain spaces and `%20` are permitted. Literal Unicode
  filenames are permitted. Other percent encodings are deliberately rejected,
  including nested encodings; the producer should emit literal safe filenames.

Relative targets reject absolute/drive/UNC/protocol-relative paths, `.` or `..`
segments, backslashes, empty segments, query strings, fragments, colons, control
characters, Windows-invalid filename characters, Windows device names, and
segments ending in a dot or space. Non-HTTP schemes (`javascript:`, `data:`,
`file:`, and others) never become links. Rejected paths remain visible as escaped
diagnostic text with a warning; no anchor or image is created.

Local PNG, JPEG, GIF, WebP, AVIF, and BMP paths receive linked inline thumbnails
with a maximum width of 320px, constrained to the available width and a 200px
maximum height. HTML, SVG, JSON, and other evidence are links only, never embedded
documents. Opening a DOM/HTML artifact navigates to that evidence file; the
report's own CSP does not govern separately opened files. Evidence producers
must keep the artifact directory trustworthy and avoid symlinks outside it;
the pure renderer does not inspect filesystem targets or verify image bytes.

The document CSP blocks default resource loading, base URL changes, forms, and
objects. Only the exact static filter script, inline CSS, and same-origin local
images are enabled. External links are navigation, not embedded resources.

## Interaction and Layout

Search matches rendered finding text, including expandable check details.
The status selector filters on the supplied finding status (unknown values use
error); it does not sort or rewrite results. Reset restores every finding.
The visible-result count is announced through a polite live region. Native
inputs, select, button, links, and details support keyboard operation with
visible focus. With JavaScript disabled, all findings remain visible and filter
controls stay hidden. Printing includes findings hidden by active filters.

Desktop uses dense check tables; mobile stacks labeled fields within each rule.
Long text wraps, expanded values scroll vertically, and thumbnails shrink within
their columns. There are no external fonts, branding assets, or runtime CDNs.

## Verification

From the repository root, run the dependency-free `node:test` cases:

```powershell
node --test test/report.test.mjs
```

The browser case is opt-in and uses the repository's existing Playwright and
installed Chromium. It creates and removes temporary HTML/image fixtures:

```powershell
$env:REPORT_BROWSER_TESTS = '1'
node --test test/report.test.mjs
Remove-Item Env:REPORT_BROWSER_TESTS
```

Tests cover escaping/injection, allowed and rejected links, all statuses,
partial scope, inconsistent summary/status data, every failed rule, bounded
structured values, CSP/script integrity, local image loading, keyboard filters,
no-JavaScript fallback, and layout at 1440px, 390px, and 320px widths.

## Contract Gaps

The runner contract documents coverage units and scope. The renderer displays
metadata and uses conservative scope checks rather than interpreting catalog
rules. Producers must keep historical, automatic, supplemental, and manual
counts distinct; a blocked executed rule is not a passed rule.

Evidence paths are relative to the saved HTML and results JSON. The renderer
infers thumbnail
eligibility from a raster extension. Producers must relativize capture paths
before reporting; absolute snapshot paths are rejected instead of rewritten.

The contract does not prescribe behavior for conflicting finding/check statuses
or malformed optional fields. This renderer preserves declared status, exposes
aggregate mismatches, and treats absent/non-array collections as empty. It does
not replace upstream validation or re-evaluate website rules.
