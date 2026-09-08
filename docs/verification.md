# Release verification

Date: September 8, 2026. Tested implementation revision: `2eb0ffbc9e0a067d1a2c7b7d45785028bd8c3d3f`.

## Checker health

- Node.js 24.19.0, Windows x64, Playwright 1.63.0, Chromium 153.0.8010.12.
- Full Node test suite with opt-in report browser test: **478 passed, 0 failed, 0 skipped**.
- Playwright local browser fixtures: **11 passed, 0 failed**.
- Catalog validation: 36 findings, 344 historical statements, 128 automatic rules, 90 review rules, 44 availability URLs, five file pairs, 71 dependency pairs, 11 external targets and three anchor inventories (12 side/viewport result records).
- Dependency audit: no known vulnerabilities reported at verification time.
- Report checked at desktop and mobile widths; the report-browser fixture also checks 320px. No horizontal overflow was observed.
- Reviewed fixes include default baseline routing, per-item exception preservation, missing-file classification, cleanup failures, inert evidence, protected destinations, image re-encoding, real anchor activation, and preserving public years despite hidden form flags.

The catalog regeneration test depends on original local evidence and skips explicitly in an independent clone where that evidence is absent. The normal `npm test` also skips the optional report-browser test; CI runs it separately. A different skip count in that environment is therefore expected.

## Fresh live run

Command: `npm run qa -- --out artifacts/release-validation --concurrency 2`.

Run ID: `2026-09-08T21-46-14-120Z`. Started 21:46:14 UTC and finished 21:50:13 UTC.

| Inventory | Expected | Executed/reported |
| --- | ---: | ---: |
| Original findings | 36 | 36 |
| Automatic catalog rules | 128 | 128 |
| Availability URLs | 44 | 44 |
| File pairs | 5 | 5 |
| Anchor side/viewport records | 12 | 12 |

No planned IDs were unexecuted. All **465 referenced evidence files** existed and were nonempty, including **84 PNGs**. Generated evidence is intentionally not committed; the local report is `artifacts/release-validation/report.html`, and subsequent runs or CI artifacts generate their own evidence.

The **97 result records** were: **2 pass, 31 fail, 63 blocked, 1 review, 0 error**. These are mixed finding and supplemental records, not 97 original defects. The automatic catalog predicates separately produced 55 pass, 67 fail and six blocked outcomes. The live acceptance exit code was **1**, not success.

Most source and external access failures were HTTP 418/202 gates in the fresh automated environment. The migrated newsletter bodies rendered, but their source browser bodies were blocked. Therefore current rendered newsletter parity was not certified. Awards section activation passed on the migrated site at both widths; the configured return-to-document-top parity checks did not pass. These statements describe this run, not guaranteed future availability or migration causation.

There were no approved visual references and no automatic closure of owner-review obligations. This release verifies an operational checker, **not a completed website migration or pixel-perfect acceptance**. GitHub workflow execution is a separate environment check and is not inferred from the local results above.
