# Catalog Coverage

This catalog is an acceptance specification derived from the final 2026-09-08 parent revalidation, not a record of website fixes. Its 36 finding IDs and corrections come from `verification-report-data.json`. Final parent decisions override older worker descriptions. The exporter reads that evidence without modifying it and selects public URLs, statements, labels and identified dependency hashes explicitly. It does not copy capture paths, raw page HTML, credentials or protected bodies.

## Inventories

| Catalog | Records | Meaning |
| --- | ---: | --- |
| `catalog/findings.json` | 36 | Intended-fix rules and explicit review obligations |
| `catalog/historical-claims.json` | 344 | Historical statements, including corrections and unproven assertions; never current tests or current result statuses |
| `catalog/availability.json` | 44 | Exact appendix URLs; all `expectedDocument:false` |
| `catalog/file-pairs.json` | 5 | Four packages and one DOC-to-PDF document review |
| `catalog/external-links.json` | 11 | Exact external targets mapped to eight LINK finding IDs |
| `catalog/anchors.json` | 3 | Ten Awards section mappings, Awards return links, and Past Networks return behavior |

The availability history is 31 readable public entries, five sign-in-gated entries and seven unresolved network/access cases (together 12 `access-unverified`), plus one `unavailable-confirmed` Switzerland destination. This does not mean 44 failures. The final parent notes preserve the access distinctions, including FedEx's publicly readable content and the contaminated earlier-capture corrections.

The four packages contain exactly 71 identified dependency pairs: 22 for `620d00b29e6fc148`, 16 for `49d0730a812128e2`, 18 for `0190e484c551a022`, and 15 for `87ef528d4825bbfa`. `b17b0404ee164bf4` is the DOC-to-PDF review and has no dependency pairs. Hashes represent historical complete-file equality for those identified resources only. Shell HTML differs. Neither historical hashes nor the inventory alone prove current runtime, pagination or exhaustive dependency parity.

## Executable Scope

There are **218 rules: 128 automated predicates and 90 review rules**. Twenty-seven findings have at least one automated predicate. ABOUT-04 intentionally has only review rules because its intended access policy is unresolved; the eight LINK findings use review rules referring to the runner's fresh destination checks instead of static URL prohibitions. All 36 findings retain review obligations. A complete run cannot become an unconditional acceptance pass merely because its automated predicates pass.

Twenty of the automated predicates are `mainNotEmpty` content/capture guards. These are useful prerequisites, not proof of the associated roster, schedule, hierarchy or visual claim. Three STYLE overflow checks likewise guard against worsened overflow without measuring the named visual defect. ABOUT-05 checks label/action continuity, not whether public PDF access is approved. GENERAL-04 checks control-label presence, not working sponsor filtering.

| Rule type | Count |
| --- | ---: |
| requireLink | 69 |
| forbidLink | 8 |
| mainNotEmpty | 20 |
| requireText | 11 |
| forbidText | 5 |
| overflow | 4 |
| orderedText | 3 |
| linkCount | 2 |
| compareMetric | 2 |
| legacyResources | 2 |
| mailtoCoverage | 1 |
| forbidHeading | 1 |
| review | 90 |

`requireHeading` is allowed by the shared contract but is not needed by this catalog. No additional rule types, arbitrary code or selector expressions are introduced.

| Finding | Automated | Review |
| --- | ---: | ---: |
| ABOUT-01 | 2 | 2 |
| ABOUT-02 | 1 | 2 |
| ABOUT-03 | 3 | 2 |
| ABOUT-04 | 0 | 2 |
| ABOUT-05 | 8 | 2 |
| ABOUT-06 | 2 | 1 |
| ARCHIVE-01 | 5 | 2 |
| ARCHIVE-02 | 15 | 2 |
| ARCHIVE-03 | 1 | 2 |
| ARCHIVE-04 | 4 | 5 |
| ARCHIVE-05 | 26 | 2 |
| ARCHIVE-06 | 6 | 2 |
| ARCHIVE-07 | 9 | 2 |
| GENERAL-01 | 1 | 2 |
| GENERAL-02 | 1 | 2 |
| GENERAL-03 | 1 | 2 |
| GENERAL-04 | 1 | 2 |
| GENERAL-05 | 1 | 2 |
| TECH-01 | 2 | 1 |
| TECH-02 | 2 | 2 |
| TECH-03 | 20 | 2 |
| STYLE-01 | 2 | 2 |
| STYLE-02 | 2 | 2 |
| STYLE-03 | 2 | 2 |
| STYLE-04 | 2 | 2 |
| NAV-01 | 1 | 2 |
| NAV-02 | 6 | 2 |
| ASSET-01 | 2 | 8 |
| LINK-01 | 0 | 4 |
| LINK-02 | 0 | 4 |
| LINK-03 | 0 | 3 |
| LINK-04 | 0 | 3 |
| LINK-05 | 0 | 4 |
| LINK-06 | 0 | 3 |
| LINK-07 | 0 | 3 |
| LINK-08 | 0 | 3 |

## Page Routing

Record-level URLs define the default `primary` pair. Additional `pages` entries use exact evidence-derived URLs and stable keys. Resolve every rule against `rule.pageKey`, defaulting to `primary`; do not evaluate every rule against the record-level page. Cache captures by URL and viewport to avoid redundant navigation where keys share URLs.

- ARCHIVE-04 covers all four named Cover conversions: November 2015 and May, August and November 2016. Each has its own PDF-link rule.
- ARCHIVE-05 covers February and November 2015 and May, August and November 2016. It requires all six lost subject/category occurrences and all twenty retained article links. August also has an ordered special/regular grouping predicate.
- ARCHIVE-06 covers both Publications and Technical Activities archive copies. `AugustSpecial Issue` is the exact rejected text. The restored August and Special Issue-AdCom Election labels must point to their distinct observed 2011 destinations.
- ARCHIVE-07 evaluates all nine text-caption links on the issue index, with month text and a year-specific route suffix together. Image-only anchors cannot satisfy it. The combined label is `August/September/October Issue`.
- ASSET-01 covers Division VI, Roadmap, November 2014, February 2016 and Chapter Congress June 2024. Its two automatic image rules and six optional-cleanup anchor reviews are independent.
- ABOUT-03 includes both AdCom navigation and the sitemap. TECH-03 captures the sitemap and all twelve mapped committee/newsletter bodies; six link predicates require committee destinations under `/technical-committees/`. Body guards do not prove hierarchy, canonical correctness or duplicate equivalence.

The ARCHIVE-04/05 page arrays do not name a `primary` key, because their operational rules name specific issue keys. Record-level URLs still provide the default pair for general review rules. ARCHIVE-01 and ARCHIVE-02 independently cover May and the combined issue; cross-issue PDF/cover identity remains an explicit paired review obligation.

## Corrected Acceptance Conditions

ASSET-01 has two `legacyResources` predicates for the **eight loaded images** (seven Division VI logos and one Roadmap schedule image). It separately has six review-only optional-cleanup rules for empty or line-break-only anchors, **not visible download actions**. Deliberate retention is allowed and does not automatically fail acceptance, whether those empty anchors are reported as visible or hidden. The review reasons preserve the historical hrefs or Binghamton suffix and their page routing. No `linkCount:6` asserts visible old-host downloads. A zero legacy-image result does not prove that replacement images exist or load; replacement completeness remains review-required.

TECH-02 automates fifteen verified recipients: the fourteen unambiguous removed actions plus retained `ewong@utdallas.edu`. The fifteenth removed action, Eunsuk Kang, is a separate review obligation. The source label `eskang@cmu.edu` incorrectly targets `gsong7@ford.com`; a negative label-plus-href rule prevents restoring that mismatch. The legitimate separate `gsong7@ford.com` contact is preserved. No new unverified recipient or email-delivery test is asserted.

NAV-02 preserves `Reliability Society Newsletter-TA` and `Systems of Systems \u2013 TC` (the latter contains an en dash in JSON). It does not shorten the newsletter label or treat internal URL slugs as public labels. Its link-label matching follows the evaluator's case-insensitive contract; historical strings and URL/fragment case remain intact.

Eleven LINK review rules refer to the fresh destination check in `src/run.mjs` for each exact historical target that remains a visible main-content link. A repaired original URL can satisfy availability without a catalog update or a static URL-rule failure. Owner review applies only to replacement or removal semantics; absence alone does not establish useful replacement navigation or intended destination identity. The external-target inventory remains unchanged historical provenance, not a permanent denylist. Eight targets appeared on both checked current sites; UK/Ireland, San Diego and Twin Cities were linked only on the checked migrated table, after all 53 baseline rows were inspected. This does not establish historical causation or compromise. P7009's browser-visible error does not invent an HTTP 404; its separate collector timed out.

## Review And Evidence Gaps

ABOUT-01's text rules cannot prove separate rendered lines or exact BR structure. ABOUT-02 and GENERAL-02 need authorized roster decisions. ABOUT-03 through ABOUT-05 need route/access decisions and authorized role testing; no protected bodies are exported or treated as baseline content assertions. GENERAL-05 requires a current full-feed comparison and owner-approved horizon, not fixed 13-versus-21 counts or automatic rejection of later conferences.

Archive PDF links, counts and article labels do not prove downloaded document identity, MIME type, page count or forced-download behavior. Review all affected covers and documents, particularly May's 15-page and the combined issue's 27-page identities. ARCHIVE-03 only forbids the wrong H2; it does not require all articles to concern Systems of Systems. ARCHIVE-05's eleven historical category-anchor occurrences are ten distinct document targets. Its grouping predicate is a text-order proxy, not a semantic DOM-tree assertion.

GENERAL-01 compares mobile overflow increase using a conservative 20-pixel threshold and matched 390 by 844 captures. The baseline has local table overflow; source width is not asserted to be exactly 390. STYLE-01 compares only the sampled H1 size and weight, allowing the larger of 25% relative or 2 absolute units. Settled fonts, screenshots and visual judgment remain necessary. STYLE-02 through STYLE-04 require screenshots, cell/image rectangles and human review for borders, proportions, cover placement and portrait enlargement. Only Yang was browser-upscaled; no automatic sharpness verdict is available.

NAV-01 checks descending annual-year text but cannot prove sitemap parent-child order or disambiguate all repeated year/month strings. TECH-03 lacks an automatic canonical/tree-equivalence predicate. Snapshot lacks document-title rules and arbitrary image/table geometry comparison rules. These limits are not concealed with unsupported assertions.

For hard-to-automate findings, capture both requested/final URLs, status, full main DOM/text, headings, links, table/image metrics and screenshots as supported by Snapshot. Attach that evidence to the result and carry the catalog review reason into the report. A review rule does not itself collect evidence. If capture is blocked, preserve that status; an empty capture must never produce acceptance.

## Anchor Inventory Integration

The sections inventory uses `expectedSections:[{label,baselineFragment,migratedFragment}]` for Awards section pairs. Fragments include `#` and retain exact case, notably `#Kowalski` and `#Richard-Kowalski-Outstanding-Service-Award`. Per the integration clarification, return-top records use a numeric `expectedSections`: 10 for Awards and 30 for Past Networks, representing exact inline-action parity counts.

Historical Awards section activations covered all ten targets on each side at desktop and mobile widths; mobile keyboard success did not certify reliable touch/pointer behavior. Awards return actions map baseline `#top` to migrated `#awards_header`: reaching the heading is not document-top equivalence. The observed migrated return was y=264 desktop and y=177 mobile. Past Networks had thirty baseline inline Top of Page links, zero migrated inline links and one migrated global Back to Top action; the global action worked. The numeric parity test should fail zero-versus-thirty inline links, with a separate global-action review. Do not count the global action as an inline link or claim all return functionality disappeared.

The catalog does not implement anchor activation. A consuming browser runner must resolve section fragment fields and numeric return-action counts, test target identity and return position, distinguish keyboard from pointer behavior and retain review for touch reliability and exhaustive historical fragment coverage. Historical successful activations are not fresh passes. Each file-pair record also provides `expectedOldHash` and `expectedNewHash` from the complete original root-file observations, as requested by the integration update. These are separate historical pins, not an assertion of old/new root-byte equality.

## Rebuild And Verification

Run from the standalone repository with Node.js 22 or newer:

```powershell
node scripts/export-catalog.mjs
node --test test/catalog.test.mjs
```

The exporter accepts an optional first argument naming the evidence directory. Its default is the sibling parent reports directory. It writes only the six `catalog/*.json` outputs and fails on missing evidence or inventory mismatches. Runtime consumers need only the committed JSON, not the parent reports. Standalone catalog tests still validate schemas, IDs, inventories and acceptance behavior without the parent evidence; regeneration comparison is explicitly skipped when that evidence is absent, and authoritative field comparison runs when it is available.

Tests were written and executed before implementation: the first run failed with missing catalog/exporter assertions. The hierarchy expansion was also preceded by a failing twelve-body coverage test. The acceptance correction was preceded by five expected failures, including retained empty-anchor and original-LINK-URL fixtures returning `fail`. The 15 catalog tests cover exact records/corrections, historical isolation, inventories, field safety, byte-for-byte rebuilding, multi-page routing, evaluator validation, blocked captures, intended-fix negative/positive fixtures, image-versus-anchor semantics, corrected rule counts and fragment case. Fixtures exercise all six empty/line-break anchors in visible and hidden states, and all eleven unchanged original LINK URLs without a static failure. Loaded legacy images still fail their separate automatic checks. These are catalog/tool-health checks, not a live website acceptance run or proof that an external URL is currently repaired. The shared evaluator, browser runner, availability fetching, dependency downloading and report rendering remain outside this slice.
