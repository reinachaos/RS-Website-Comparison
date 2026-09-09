# Checker logic audit

This is an audit of the test program, not a new claim about which website defects are fixed. Starting revision: `d78989a`. September 8, 2026.

## Reproduced cases

| Case | Previous risk | Correction / regression coverage |
| --- | --- | --- |
| Partial downloads and pending page responses | EOF on a 206 response could be treated as a complete file; unresolved page responses could appear readable. | Reject partial/Content-Range files and pending, partial, missing-status or unresolved redirect page evidence. Ordinary complete files still pass. |
| Download address opening a landing page | A blocked download followed by a readable browser body could pass document availability. | Require document evidence independently of browser landing-page readability. |
| Empty destination page | A visible but empty body could pass availability. | Block empty bodies without loaded visible images; retain a positive image-only fixture. |
| External collector exception | One exception could replace a finding's completed rules with a single error and skip its later destinations. | Preserve completed checks and continue independent destination checks. |
| Source screenshot redirected to the migrated site | Requested URL alone could label migrated pixels as an approved source reference. | Preserve and validate requested/final URL provenance during capture, approval and comparison. |
| Nonfunctional return-to-top control | Focus could scroll to the top before Enter, falsely proving the control worked. | Establish and record a non-top position immediately before keyboard activation. |
| Hidden heading | Hidden H1/H2 text could satisfy a visible heading requirement. | Extract visible headings and the first visible H1. |
| Broken and lazy images | A broken image has `complete=true`; offscreen native lazy images, including images without dimensions, may not load before extraction. | Promote native lazy images before testing dimensions, wait for completion, and check rendered image success. Genuinely hidden elements are excluded. |
| Redaction token colliding with ordinary text | Global token substitution could alter URLs, markup and public text rather than only sensitive evidence. | Sanitize text/attribute values before serialization and credential URL components structurally. Keep reflected long query/fragment secrets masked without rewriting tag names or URL paths. |
| Historical note presented as a fresh conclusion | A corrected finding could still display an unqualified old statement that the defect was confirmed. | Label historical corrections and catalog context separately from current checks. |

Each correction is exercised by deterministic local fixtures, including negative and positive cases. Existing catalog acceptance requirements are not weakened to make results green.

## Intentional limits

The 36-finding catalog, 128 automatic rules and 90 review rules remain unchanged. A review obligation is not a program failure. Closing one remains an owner-approved versioned policy change, not an automatic consequence of a passing text predicate.

The program still does not certify protected pages, arbitrary JavaScript lazy-loading states, touch interaction, every newsletter pagination state, or pixel-perfect design. Access restrictions remain blocked. Historical live results in `docs/verification.md` apply to their recorded revision, not automatically to this updated checker.

Older visual manifests without requested/final URL provenance are deliberately rejected and require source re-capture and explicit approval. Same-origin redirected paths remain visible for the approver to inspect.

## Reproduction commands

```sh
npm test
npm run test:browser
npm run qa:validate
```

The optional standalone report-browser check is enabled with `REPORT_BROWSER_TESTS=1`; CI also runs it separately. A successful checker test run does not establish site acceptance.

## Verification

Verified locally on Windows x64, Node v24.19.0, Playwright 1.63.0 and Chromium 153.0.8010.12:

- All 507 Node tests passed with `REPORT_BROWSER_TESTS=1`, zero failures, skips or TODOs.
- All 24 Chromium collector tests passed, zero expected-failure tests.
- Catalog validation retained 36 findings, 128 automatic rules and 90 review rules.
- `git diff --check` passed.
- A live smoke run selected ABOUT-01, ARCHIVE-02 and TECH-01. All three were emitted with no tool errors or unexecuted selected IDs. All 19 automatic rules ran: one passed and 18 failed. The three finding statuses were `fail`, with acceptance exit code 1.
- All 15 referenced smoke evidence files existed and all six PNGs decoded successfully.

The final smoke run was performed against this audit's working-tree changes at `2026-09-09T04:27:19Z` (September 8 locally); its recorded HEAD was still `d78989a`. It was a partial run, not a repeat of the complete 97-record release audit. The source pages returned HTTP 418 and were explicitly blocked. Migrated-only predicates still ran, but no fresh complete source comparison is claimed. Local smoke artifacts are intentionally git-ignored.
