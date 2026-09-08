# Module contracts

All modules are ES modules. Tests use node:test; browser integration uses Playwright Test. The project is the standalone RS-Website-Comparison clone, not its parent report workspace.

## Catalog

`catalog/findings.json` is an array of exactly 36 records:
`{id,title,baselineURL,migratedURL,rules:[Rule],reviews:[string],historicalCheckCount,correction}`.
Rules have `{id,type,label,...parameters}`. Record URLs may be supplemented by `pages:[{key,baselineURL,migratedURL}]`; rule `pageKey` selects that pair, default `primary`. Rules can specify `viewport:'mobile'`, default desktop. Every rule must state the intended corrected condition, never assert that a known defect should remain.

`catalog/availability.json`: array of 44 `{id,url,expectedDocument,historicalStatus,note}` entries. `catalog/file-pairs.json`: five `{id,oldURL,newURL,mode:'package'|'document-review',dependencies:[{oldURL,newURL,sha256}],note}`. `catalog/historical-claims.json`: 344 `{id,findingId,statement,historicalStatus,note}` records marked historical, not current results. `catalog/external-links.json`: 11 `{id,findingId,url,note}` records used for LINK findings. `catalog/anchors.json`: records `{id,baselineURL,migratedURL,expectedSections,mode:'sections'|'return-top'}` with known URLs from evidence.

## Snapshot

`{requestedURL,finalURL,status:'ready'|'blocked'|'missing'|'error',httpStatus,title,mainText,mainHTML,headings:[{level,text,id}],links:[{text,href,rawHref,visible,inMain}],images:[{src,currentSrc,alt,loaded,visible,inMain,width,height,naturalWidth,naturalHeight,x,y}],tables:[{text,rows:[{cells:[{text,html,width,height,x,y}]}],width,height}],metrics:{scrollWidth,clientWidth,overflow,h1:{fontSize,fontWeight}},artifacts:{screenshot,dom,json},timestamp,viewport,error?}`.
`mainText` preserves line breaks. Links contain all page anchors and inMain tags; rules default to inMain and visible unless specified. Screenshots and DOM are local evidence, not source-code/backend access.

## Pure rule evaluator

`evaluateRule(rule, {old,new}) -> {id,label,status:'pass'|'fail'|'blocked'|'review'|'error',expected,actual,note?}`.
Unavailable required snapshots yield blocked, never pass. Supported types:
- `requireText` / `forbidText`: `values:string[]`, optional `caseSensitive` default false; whitespace-normalized main text.
- `orderedText`: `values:string[]`, case-insensitive main text sequence.
- `requireLink` / `forbidLink` / `linkCount`: `filter:{text?,textIncludes?,href?,hrefIncludes?,hrefEndsWith?,protocol?}`, optional `scope:'all'`, `visible:false` to include hidden, `min`/`max` for counts. All filter fields AND together. Default minimum require 1, forbid maximum 0. Relative suffix matching is explicit, no guessed URL rewriting.
- `requireHeading` / `forbidHeading`: `text`, optional `level`, `exact` default true.
- `mainNotEmpty`: `minChars` default 80, excluding whitespace.
- `mailtoCoverage`: `addresses:string[]`; each exact href mailto recipient must be represented. Query strings ignored, labels do not prove links.
- `legacyResources`: `hostname`; count only visible, loaded in-main images on that exact hostname. Empty anchors are not resources.
- `overflow`: `maxExtraPixels` default 20; requires both snapshots, fails if new overflow exceeds old by threshold.
- `compareMetric`: `path` dotted under metrics, `relativeTolerance` default .25, `absoluteTolerance` default 2; numbers must exist. Both snapshots required.
- `review`: `reason`; always review, never automatic pass.
Unknown rules yield error. Rule IDs unique within finding. No string-eval or arbitrary code in catalog.

## Result/report

`{schemaVersion:1,runId,startedAt,finishedAt,scope:{mode,selectedIds,totalFindings,partial},environment,results:[{id,title,category,status,checks:[Check],evidence:[{label,path}],notes:[]}],coverage,summary,exitCode}`.
`aggregateStatus(checks)` precedence error, fail, blocked, review, pass; empty checks -> review. Renderer exports `renderReport(run)` returning a standalone HTML string. It must escape every supplied string, allow only HTTP(S) external URLs and artifact-relative evidence paths, and never treat raw page HTML as markup. Report must distinguish tool health from website acceptance, historical claims from executable checks, and partial from full runs. All statuses and evidence remain visible; filtering is optional client-side convenience.

`scope.mode` is `live`. `selectedIds` names finding IDs only; supplemental result IDs are tracked separately. `partial` is true when a finding filter or supplemental exclusion is requested. `coverage` contains expected/reported finding IDs, historical statement count (never individually rerun), automatic rules expected/emitted and their outcome counts, review rules emitted, collector-check count, and expected/reported availability, file and anchor counts. An emitted blocked automatic check counts as executed but not passed. Collector checks include access, visual reference, destination, file and anchor checks, not catalog rules or standalone owner-review obligations. These counts must not be added together and advertised as independent certified findings.

`summary` counts result records by status. `environment` records Node, platform, architecture, Chromium, viewports and the starting git revision. `visualEnvironment` additionally pins locale, timezone and scale. The report independently derives displayed result totals and displays metadata rather than trusting a supplied summary. `exitCode` follows the design's 0/1/2/3 acceptance contract.

Evidence paths are relative to the directory containing `results.json` and `report.html`. `dom` is sanitized inert structural `.dom.txt`, not executable HTML or original server source. Screenshots may include `mainScreenshot` for visual-region comparisons; `screenshotScope` states full-page versus bounded viewport capture. HTTP observations include completion, content type/encoding, digest and redirect information; a digest is not proof of semantic identity. Generated evidence is local or an explicitly downloaded CI artifact and is excluded from ordinary commits.
