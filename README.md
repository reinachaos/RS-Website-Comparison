# RS Website Comparison

Repeatable, read-only migration QA for the IEEE Reliability Society website.

- Baseline: <https://rs.ieee.org/>
- Migrated site: <https://ieeerelsoc.wpenginepowered.com/>
- Reference scope: the corrected September 8, 2026 subpage QA report.

## 中文快速开始

这是可反复运行的 Playwright 自动化测试套件，不需要 AI 或 Browser MCP 才能运行。旧站为对照基准，检查已登记子页面的内容、链接、锚点和部分格式指标；较小的字体差异不自动判错。

首次安装需要 Node.js 22 或更高版本、Git 和网络连接：

```sh
git clone https://github.com/reinachaos/RS-Website-Comparison.git
cd RS-Website-Comparison
npm ci --ignore-scripts
npx playwright install chromium
```

Linux 环境可能需要 `npx playwright install --with-deps chromium`。安装完成后，每次完整检查只需：

```sh
npm run qa
```

终端会输出报告路径。直接打开对应 `artifacts/<run-id>/report.html`，无需启动服务器。报告包含逐项状态、规则、期望值、实际观测、截图及 DOM/HTTP 证据；`results.json` 用于程序读取。证据文件须与报告一起保留。

也可以在 GitHub 仓库的 **Actions → Live website QA → Run workflow** 中选择 `full`，运行结束后下载 `qa-evidence`。Artifacts 默认保留 7 天。实时 QA 返回非零退出码时，工作流会显示失败，但仍上传已经生成的报告；这是验收门槛，不能仅根据红色图标认定测试程序坏了。

**范围与边界：**包含全部 36 个已登记问题、44 个补充可用性地址、5 组文件、71 组已知依赖以及指定锚点交互。344 条历史陈述只作追溯，不是 344 条已自动复测的断言。目前有 128 条自动规则和 90 条审阅规则，另外还有采集检查及人工审阅义务。首页、新发现的全站页面、所有 newsletter 翻页状态、登录后内容均不在 v1 自动覆盖范围。

**不能把“测试运行成功”理解成“网站通过验收”。**网站拦截自动化、需要登录、超时、未批准视觉基准或仍有人工判断时，都不会自动变绿。当前人工审阅义务没有一键忽略开关；关闭义务须由负责人审阅并在版本控制中修订规则与依据。

## Commands

```sh
npm run qa:validate
npm run qa:list
npm test
npm run test:browser
npm run qa:smoke
npm run qa -- --ids ARCHIVE-02,TECH-01
npm run qa -- --concurrency 1 --out artifacts/my-run
```

`qa:smoke` selects ABOUT-01, ARCHIVE-02 and TECH-01. Any `--ids` run excludes the supplemental inventories and is explicitly partial. `--skip-supplemental` also creates a partial run. Output directories must be new so previous evidence is not overwritten. Browser concurrency is limited to one or two finding workers; dependency requests are separately bounded. Run from the repository directory.

## Status And Exit Codes

| Status | Meaning |
| --- | --- |
| `pass` | The specific current assertion passed; not blanket certification of the page. |
| `fail` | A configured discrepancy was observed. This does not by itself establish migration causation or editorial intent. |
| `blocked` | Access, network, unsettled content, or insufficient capture prevented verification. |
| `review` | A visual, semantic, baseline-drift or owner decision remains. |
| `error` | Test configuration or execution failed. |

Exit codes: **0** all selected checks accepted; **1** discrepancy present; **2** blocked/review remains without a confirmed discrepancy; **3** tool/configuration error. Higher-priority error and discrepancy states take precedence in the exit code, but individual blocked/review results remain visible. Every original finding currently contains review obligations, so a normal live run is not expected to certify fully automatic acceptance.

Two workflows deliberately separate checker health from website acceptance:

- **Suite self-tests** runs offline/unit and local-browser fixtures on pushes and pull requests. It does not contact the IEEE sites.
- **Live website QA** is manual only. It contacts the configured public destinations and retains evidence even when acceptance fails. It never silently approves screenshots or modifies either website.

## Visual References

Raw approved source screenshots are intentionally not pre-populated from old report crops. Create and inspect a candidate in the same OS, architecture and Chromium version that will run the comparison:

```sh
npm run baseline:capture
npm run baseline:approve -- --candidate baselines/candidates/RUN-ID --reviewer "Reviewer name" --reason "Source layout inspected and approved"
```

Replace `RUN-ID` with the directory printed by capture. Review `capture-coverage.json` and every candidate image before approval. Approval of an incomplete candidate does not fill absent references. Replacing an approved set requires explicit `--replace` and keeps the previous manifest history. Review and commit `baselines/approved` separately; ordinary QA never updates it.

Candidates must retain both the requested and final captured source URLs. A redirect outside the requested source origin cannot become a source reference; same-origin redirects remain visible for owner review. Older candidates or approved references without this provenance must be re-captured and explicitly approved rather than silently reused.

Pixel comparison is limited to the configured STYLE and GENERAL-01 main-content captures. It ignores anti-aliasing and uses a conservative threshold; a significant pixel or dimension difference requests review rather than declaring a migration defect. Missing references or mismatched runtime environments cannot pass. Windows references will not silently match the Ubuntu GitHub runner. Capture in the `capture-baseline` workflow mode when preparing Ubuntu references, download its artifact and review it before explicit approval.

## Coverage And Evidence

The versioned JSON catalogs are sufficient to run this repository. Original Word files and private/local evidence directories are not required or included. Each finding has stable IDs, expected content/link rules, source and destination URLs, and explicit review obligations. See [coverage](docs/coverage.md), [contracts](docs/contracts.md), and [report format](docs/report-format.md).

The [release verification record](docs/verification.md) separates checker self-tests from the first complete live acceptance results.
The [checker logic audit](docs/debug-audit.md) records subsequent reproduced bugs, fixes, regression tests and the limits of the follow-up smoke run.

- DOM assertions use recognized main-content roots, not navigation/footer text as a fallback. Browser observations are rendered DOM and computed styles, **not access to the site's server-side source code**.
- Desktop is 1440 x 1000; mobile is 390 x 844. Anchor tests use keyboard activation on both. They do not certify touch reliability. Missing inline Top of Page links do not imply the global Back to Top button is missing.
- External availability is checked afresh. A historically broken URL that recovers is not permanently blacklisted. A removed URL still requires review of its replacement.
- Complete dependency response hashes are compared. Image byte changes require review because re-encoding can change bytes without changing appearance. Equal files that both changed from the historical pin also require review. DOC-to-PDF conversion needs content/version review, not byte equality.
- Screenshots, bounded structured observations and HTTP response metadata are evidence, not omniscient coverage. Partial captures and unexecuted supplemental inventory cannot silently become acceptance.
- A first live validation encountered HTTP 418/202 access gates on several source/external pages. An ordinary browser session can differ from a fresh headless session. Use an authorized runner allowed by the site, or record a manual review; do not bypass anti-bot controls or relabel blocked results.

## Safety And Maintenance

Requests are anonymous and read-only. Do not add credentials, cookies, storage state or login flows. The collector restricts destinations and excludes authentication/action routes; it is not a substitute for a sandboxed runner and an organization-approved network policy. Review evidence before sharing it. Generated artifacts, candidate references, authentication files and dependencies are git-ignored. Approved references are intentionally eligible for a separately reviewed commit.

Dependencies and Actions are pinned. To update Playwright, update both `package.json` and `package-lock.json`, install the matching browser, run all fixtures and re-capture/review environment-specific visual references. Do not approve a changed screenshot merely to make CI green. Changing an inventory also requires updating its validators and coverage documentation.

The optional `scripts/export-catalog.mjs` rebuilds catalogs from the original local corrected report data. That source is not distributed; ordinary testing needs only the committed catalogs. Its regeneration test explicitly skips when the source evidence is absent. The optional report-browser test can be run with `REPORT_BROWSER_TESTS=1 node --test test/report.test.mjs` on POSIX, or by setting `$env:REPORT_BROWSER_TESTS='1'` first in PowerShell.

No homepage parity certification, authenticated-role testing, exhaustive crawl, manual review completion, or semantic equivalence of every downloadable document is claimed by v1.
