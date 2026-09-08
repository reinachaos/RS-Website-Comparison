# Reliability Society repeatable migration QA

Approved scope: the existing 36 subpage findings, 44 supplemental availability targets, five file pairs and specified Awards and Past Technical Networks anchors. Homepage and new whole-site discovery are outside version 1. The baseline is rs.ieee.org; the migration target is ieeerelsoc.wpenginepowered.com.

This is a deterministic Node.js and Playwright suite, not an AI conversation replay. Browser MCP remains optional for investigations. Each run records fresh observations, evidence and explicit pass/fail/blocked/review/error outcomes. A successful program execution does not imply site acceptance. A source login gate is not readable source content; a timeout is not a broken link; an empty anchor is not a visible download.

Versioned acceptance rules derive from the corrected September 8 report. Its 344 historical statements are retained only as a traceability register, not presented as 344 executable assertions. Coverage separately counts finding-level rules, historical statements, supplemental targets and manual decisions. Every original ID must have rules or an explicit review obligation. No omission can silently become a pass.

Browser evidence consists of screenshots and structured DOM observations using fixed desktop 1440x1000 and mobile 390x844 viewports. Sanitized inert structural DOM is saved as text, never committed by default. Secrets, authentication state and original Word/evidence directories are excluded. Main-content selection must be explicit; missing content roots are blocked instead of falling back to the whole shell.

Visual references are raw, unannotated PNGs generated in the same runtime as testing. Capture creates an unapproved candidate; approval is a separate explicit developer command with reviewer and reason. Normal QA never updates approved references. Old report JPEG crops are not silently treated as pixel baselines. Until approved references exist, visual evidence is review, not pass. Small font differences do not automatically fail acceptance.

Architecture: catalog and pure rules; browser/HTTP collectors; result aggregation and exit gate; escaped HTML/JSON reporting; approved visual baseline store; offline fixtures plus real-browser fixture tests; manual GitHub Actions workflow. External checks are bounded, read-only, anonymous and never submit forms or bypass security warnings.

Exit contract: 0 all selected automatic checks pass and no review/blocked items; 1 at least one site discrepancy; 2 no discrepancy established but blocked/review/not-run outcomes remain; 3 tool/configuration error. A filtered run always states partial scope. CI self-tests can be green while the separate live QA workflow remains non-green because the sites still differ.
