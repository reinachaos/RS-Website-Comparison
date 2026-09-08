import { createHash } from 'node:crypto';

const STATUSES = ['error', 'fail', 'blocked', 'review', 'pass'];
const VALUE_LIMIT = 16384;

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function statusOf(value) {
  return STATUSES.includes(value) ? value : 'error';
}

function aggregate(checks) {
  if (!checks.length) return 'review';
  return STATUSES.find((status) => checks.some((check) => statusOf(check?.status) === status));
}

function badge(value) {
  const status = statusOf(value);
  const unknown = STATUSES.includes(value) ? '' : ` (unrecognized: ${escapeHTML(value ?? 'missing')})`;
  return `<span class="status ${status}">${status}${unknown}</span>`;
}

// Bound traversal as well as output: large observations must not monopolize the report.
function formatValue(value) {
  let remaining = VALUE_LIMIT;
  let truncated = false;
  const ancestors = new WeakSet();
  function clip(text) {
    const result = text.slice(0, Math.max(0, remaining));
    remaining -= result.length;
    if (result.length < text.length) truncated = true;
    return result;
  }
  function visit(item, depth) {
    if (item === undefined) return '[not supplied]';
    if (item === null || typeof item === 'boolean' || typeof item === 'number') {
      remaining -= 8;
      return item;
    }
    if (typeof item !== 'object') return clip(String(item));
    if (ancestors.has(item)) return '[Circular]';
    if (depth >= 8 || remaining <= 0) {
      truncated = true;
      return '[truncated]';
    }
    ancestors.add(item);
    const result = Array.isArray(item) ? [] : Object.create(null);
    const keys = Object.keys(item);
    let count = 0;
    for (const key of keys) {
      if (count >= 100 || remaining <= 0) break;
      count++;
      if (Array.isArray(item)) result.push(visit(item[key], depth + 1));
      else result[clip(key)] = visit(item[key], depth + 1);
    }
    if (count < keys.length) truncated = true;
    ancestors.delete(item);
    return result;
  }
  const snapshot = visit(value, 0);
  let text = typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot, null, 2);
  if (text.length > VALUE_LIMIT) {
    text = text.slice(0, VALUE_LIMIT);
    truncated = true;
  }
  return text + (truncated ? '\n[truncated; consult the original JSON/DOM evidence for full data]' : '');
}

function valueHTML(value) {
  const text = formatValue(value);
  if (text.length <= 180 && !text.includes('\n')) return `<pre>${escapeHTML(text)}</pre>`;
  const preview = text.replace(/\s+/g, ' ').slice(0, 140);
  return `<details class="value"><summary>${escapeHTML(preview)}${text.length > 140 ? ' ...' : ''}</summary><pre>${escapeHTML(text)}</pre></details>`;
}

function evidenceTarget(path) {
  if (typeof path !== 'string' || !path || path.trim() !== path) return null;
  if (/^https?:\/\/[^/?#\\]/i.test(path)) {
    if (/[\s\u0000-\u001f\u007f\\]/u.test(path)) return null;
    try {
      const url = new URL(path);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
      return { href: path, external: true, image: false };
    } catch {
      return null;
    }
  }
  // Only encoded spaces are needed for artifact names. Reject other encodings,
  // including nested encodings, before a browser or file server can normalize them.
  if (/%(?!20)/i.test(path)) return null;
  const decoded = path.replace(/%20/gi, ' ');
  if (/[\\?#:%<>"|*\u0000-\u001f\u007f]/.test(decoded)) return null;
  const segments = decoded.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..'
    || /[. ]$/.test(segment) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))) return null;
  return { href: path, external: false, image: /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(decoded) };
}

function evidenceHTML(evidence) {
  if (!evidence.length) return '<p class="muted">No evidence recorded.</p>';
  return `<ul class="evidence">${evidence.map((entry) => {
    const target = evidenceTarget(entry?.path);
    const label = entry?.label || 'Evidence';
    if (!target) return `<li><strong>${escapeHTML(label)}</strong><p class="warning">Unsafe or unsupported evidence path; link omitted.</p>${valueHTML(entry?.path)}</li>`;
    const href = escapeHTML(target.href);
    return `<li><a href="${href}"${target.external ? ' target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"' : ''}>${escapeHTML(label)}</a>
      <span class="muted">${target.external ? 'External page' : 'Local artifact'}</span>
      <div class="evidence-path">${escapeHTML(entry.path)}</div>
      ${target.image ? `<a class="thumbnail" href="${href}"><img src="${href}" alt="${escapeHTML(label)}" loading="lazy" decoding="async"></a>` : ''}</li>`;
  }).join('')}</ul>`;
}

function counters(items, kind) {
  return `<dl class="counters">${STATUSES.map((status) => `<div class="counter ${status}"><dt>${status}</dt><dd data-${kind}-count="${status}">${items.filter((item) => statusOf(item?.status) === status).length}</dd></div>`).join('')}</dl>`;
}

function findingHTML(finding, index) {
  const checks = list(finding?.checks);
  const status = statusOf(finding?.status);
  const checkStatus = aggregate(checks);
  return `<article class="finding" data-status="${status}" aria-labelledby="finding-${index}">
    <header class="finding-heading"><h3 id="finding-${index}"><span class="finding-id">${escapeHTML(finding?.id)}</span> ${escapeHTML(finding?.title || 'Untitled finding')}</h3>${badge(finding?.status)}</header>
    <p class="category">${escapeHTML(finding?.category || 'Uncategorized')}</p>
    ${status !== checkStatus ? `<p class="warning">Status mismatch. Supplied finding status: ${badge(finding?.status)}. Check aggregate: ${badge(checkStatus)}.</p>` : ''}
    ${checks.length ? `<table class="checks"><caption>Checks for ${escapeHTML(finding?.id)}</caption><thead><tr><th scope="col">Rule</th><th scope="col">Status</th><th scope="col">Expected</th><th scope="col">Actual</th><th scope="col">Note</th></tr></thead>
      <tbody>${checks.map((check) => `<tr><th scope="row"><span class="field-label" aria-hidden="true">Rule</span><span class="rule-id">${escapeHTML(check?.id)}</span>${escapeHTML(check?.label || 'Unlabeled check')}</th>
        <td><span class="field-label" aria-hidden="true">Status</span>${badge(check?.status)}</td>
        <td><span class="field-label" aria-hidden="true">Expected</span>${valueHTML(check?.expected)}</td>
        <td><span class="field-label" aria-hidden="true">Actual</span>${valueHTML(check?.actual)}</td>
        <td><span class="field-label" aria-hidden="true">Note</span><div class="note">${escapeHTML(check?.note ?? 'No note')}</div></td></tr>`).join('')}</tbody></table>`
      : '<p class="warning">No checks recorded. Review required.</p>'}
    ${list(finding?.notes).length ? `<h4>Finding notes</h4><ul class="notes">${finding.notes.map((note) => `<li>${escapeHTML(note)}</li>`).join('')}</ul>` : ''}
    <h4>Evidence</h4>${evidenceHTML(list(finding?.evidence))}
  </article>`;
}

const FILTER_SCRIPT = `(() => {
  const form = document.getElementById('report-filters');
  const search = document.getElementById('report-search');
  const status = document.getElementById('report-status');
  const count = document.getElementById('visible-count');
  const empty = document.getElementById('no-matches');
  const findings = Array.from(document.querySelectorAll('.finding'));
  const texts = findings.map((finding) => finding.textContent.toLowerCase());
  function update() {
    const term = search.value.trim().toLowerCase();
    let visible = 0;
    findings.forEach((finding, index) => {
      const matches = (!status.value || finding.dataset.status === status.value) && texts[index].includes(term);
      finding.hidden = !matches;
      if (matches) visible++;
    });
    count.textContent = visible + ' of ' + findings.length + ' result records shown';
    empty.hidden = visible !== 0 || findings.length === 0;
  }
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  form.addEventListener('submit', (event) => event.preventDefault());
  form.addEventListener('reset', () => {
    search.value = '';
    status.value = '';
    update();
  });
  form.hidden = false;
  update();
})();`;

const CSS = `
:root { color-scheme: light; font-family: system-ui, sans-serif; color: #20262a; background: #fff; }
* { box-sizing: border-box; letter-spacing: 0; }
body { margin: 0; font-size: 14px; line-height: 1.5; }
main { max-width: 1500px; margin: 0 auto; padding: 24px; }
h1 { font-size: 26px; margin: 0 0 6px; }
h2 { font-size: 19px; margin: 0 0 12px; }
h3 { font-size: 16px; margin: 0; }
h4 { font-size: 13px; margin: 14px 0 6px; }
p { margin: 6px 0 12px; }
h1, h2, h3, p, dd, li, label, summary, .note { overflow-wrap: anywhere; }
section { padding: 20px 0; border-top: 1px solid #d2d7db; }
.scope, .warning { border-left: 4px solid #a76608; background: #fff6df; padding: 8px 12px; color: #674000; }
.scope { margin: 16px 0; }
.scope.full { border-color: #52626c; background: #f1f4f6; color: #26333c; }
.muted, .category, .evidence-path { color: #535e65; }
.metadata, .coverage, .outcome-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 24px; }
.metadata { grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 16px 0; }
.metadata > div, .coverage > div { min-width: 0; }
dt { font-weight: 600; }
dd { margin: 2px 0 0; }
.counters { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; margin: 8px 0; }
.counter { min-width: 0; border-top: 3px solid; padding: 6px; }
.counter dt { font-size: 12px; overflow-wrap: anywhere; }
.counter dd { font-size: 20px; font-weight: 650; }
.status { display: inline-block; padding: 1px 6px; font-size: 12px; font-weight: 650; border: 1px solid; border-radius: 3px; overflow-wrap: anywhere; }
.error { color: #712f79; background: #f8eff9; border-color: #712f79; }
.fail { color: #9d2727; background: #fff0f0; border-color: #9d2727; }
.blocked { color: #805000; background: #fff7e1; border-color: #946009; }
.review { color: #22567a; background: #edf6fc; border-color: #22567a; }
.pass { color: #20603d; background: #edf7f0; border-color: #20603d; }
.finding { padding: 18px 0; border-top: 1px solid #bbc4ca; min-width: 0; }
.finding-heading { display: flex; gap: 10px; align-items: baseline; justify-content: space-between; }
.finding-heading h3 { min-width: 0; }
.finding-heading > .status { flex-shrink: 0; max-width: 35%; }
.finding-id, .rule-id { font-family: ui-monospace, monospace; font-size: 12px; font-weight: 600; }
.finding-id { margin-right: 8px; }
.rule-id { display: block; margin-bottom: 4px; }
.category { margin: 2px 0 10px; font-size: 12px; }
.checks { width: 100%; border-collapse: collapse; table-layout: fixed; }
.checks caption { text-align: left; font-weight: 600; padding: 0 0 6px; }
.checks th, .checks td { text-align: left; vertical-align: top; padding: 8px; border: 1px solid #d8dde1; overflow-wrap: anywhere; }
.checks thead { background: #f0f3f5; font-size: 12px; }
.checks thead th:nth-child(1) { width: 22%; }
.checks thead th:nth-child(2) { width: 10%; }
.checks thead th:nth-child(3), .checks thead th:nth-child(4) { width: 24%; }
.checks thead th:nth-child(5) { width: 20%; }
.checks tbody th { font-weight: 500; }
pre { font-family: ui-monospace, monospace; font-size: 12px; line-height: 1.5; margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
details.value pre { margin-top: 8px; max-height: 360px; overflow: auto; }
summary { cursor: pointer; }
.note, .notes { white-space: pre-wrap; }
.evidence { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 14px; }
.evidence li { min-width: 0; }
.evidence .muted { display: block; font-size: 12px; }
.evidence-path { font-size: 12px; overflow-wrap: anywhere; }
a { color: #145d89; text-underline-offset: 3px; }
.thumbnail { display: block; width: 100%; max-width: 320px; margin-top: 8px; }
.thumbnail img { display: block; width: auto; height: auto; max-width: 100%; max-height: 200px; border: 1px solid #ccd3d8; object-fit: contain; }
form { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; margin: 14px 0; }
form > div { display: flex; flex-direction: column; min-width: 0; }
form > div:first-child { flex: 1 1 240px; }
label { font-weight: 600; font-size: 12px; }
input, select, button { font: inherit; min-height: 40px; max-width: 100%; border: 1px solid #87959f; border-radius: 3px; padding: 7px 10px; color: #20262a; background: #fff; }
button { cursor: pointer; }
:focus-visible { outline: 3px solid #126ea6; outline-offset: 3px; }
.field-label { display: none; }
[hidden] { display: none !important; }
@media (max-width: 700px) {
  main { padding: 14px; }
  .metadata, .coverage, .outcome-grid { grid-template-columns: minmax(0, 1fr); }
  .finding-heading { flex-wrap: wrap; }
  .finding-heading > .status { max-width: 100%; }
  .checks, .checks tbody, .checks tr, .checks td, .checks tbody th { display: block; width: 100%; }
  .checks thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .checks tr { margin-bottom: 10px; }
  .checks th, .checks td { border-bottom: 0; }
  .checks td:last-child { border-bottom: 1px solid #d8dde1; }
  .field-label { display: block; font-size: 11px; font-weight: 650; color: #535e65; margin-bottom: 4px; }
}
@media print {
  form { display: none; }
  main { max-width: none; padding: 0; }
  .finding[hidden] { display: block !important; }
  .finding-heading, .checks tr { break-inside: avoid; }
}
`;

/** Render schemaVersion 1 result data as a portable, escaped HTML document. */
export function renderReport(run) {
  if (!run || run.schemaVersion !== 1) throw new TypeError('renderReport requires schemaVersion 1');
  const results = list(run.results);
  const checks = results.flatMap((finding) => list(finding?.checks));
  const scope = run.scope ?? {};
  const totalKnown = Number.isInteger(scope.totalFindings) && scope.totalFindings >= 0;
  const selected = list(scope.selectedIds);
  const resultIds = new Set(results.map((finding) => finding?.id));
  const selectionComplete = Array.isArray(scope.selectedIds)
    && new Set(selected).size >= scope.totalFindings && selected.every((id) => resultIds.has(id));
  const partial = scope.partial !== false || !totalKnown || !selectionComplete || results.length < scope.totalFindings;
  const scriptHash = createHash('sha256').update(FILTER_SCRIPT).digest('base64');
  const csp = `default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${escapeHTML(csp)}"><meta name="referrer" content="no-referrer">
<title>QA report - ${escapeHTML(run.runId)}</title><style>${CSS}</style></head><body><main>
<header><h1>Website comparison QA</h1><p>Run <strong>${escapeHTML(run.runId)}</strong></p>
<p>Tool execution does not establish whole-website acceptance. Outcomes below apply only to the recorded checks and declared scope.</p>
<div class="scope${partial ? '' : ' full'}"><strong>${partial ? 'Partial scope' : 'Full declared scope'}</strong>: ${results.length} result records; ${totalKnown ? scope.totalFindings : 'unknown'} total declared findings. ${partial ? 'Unselected or missing findings are not accepted.' : 'Coverage is limited to the declared catalog.'}</div>
<dl class="metadata"><div><dt>Started</dt><dd>${escapeHTML(run.startedAt ?? 'Not supplied')}</dd></div><div><dt>Finished</dt><dd>${escapeHTML(run.finishedAt ?? 'Not supplied')}</dd></div>
<div><dt>Environment</dt><dd>${valueHTML(run.environment)}</dd></div><div><dt>Scope mode</dt><dd>${escapeHTML(scope.mode ?? 'Not supplied')}</dd><dt>Selected IDs</dt><dd>${valueHTML(scope.selectedIds)}</dd></div>
<div><dt>Tool exit code</dt><dd>${escapeHTML(run.exitCode ?? 'Not supplied')}</dd></div></dl></header>
<section aria-labelledby="outcomes-heading"><h2 id="outcomes-heading">Recorded outcomes</h2><div class="outcome-grid"><div><h3>Result statuses</h3>${counters(results, 'finding')}</div>
<div><h3>Check statuses</h3>${counters(checks, 'check')}</div></div></section>
<section aria-labelledby="coverage-heading"><h2 id="coverage-heading">Coverage</h2><div class="coverage"><div><h3>Current check results</h3>
<p>${checks.length} recorded checks; ${checks.filter((check) => check?.status === 'review').length} manual review outcomes. Pass, fail, blocked, and error counts describe current check outcomes.</p>
<p>Historical claims are not executable checks. Review outcomes require a manual decision; blocked and error outcomes do not establish acceptance.</p></div>
<div><h3>Supplied coverage (historical and automated)</h3>${valueHTML(run.coverage)}</div></div>
<details><summary>Supplied runner summary</summary>${valueHTML(run.summary)}</details></section>
<section aria-labelledby="findings-heading"><h2 id="findings-heading">Findings and supplemental results</h2>
<form id="report-filters" hidden><div><label for="report-search">Search results</label><input id="report-search" type="search" autocomplete="off"></div>
<div><label for="report-status">Result status</label><select id="report-status"><option value="">All statuses</option>${STATUSES.map((status) => `<option value="${status}">${status}</option>`).join('')}</select></div>
<button type="reset">Reset filters</button></form><p id="visible-count" role="status" aria-live="polite">${results.length} of ${results.length} result records shown</p>
<p id="no-matches" hidden>No findings match the selected filters.</p>
${results.length ? results.map(findingHTML).join('') : '<p class="warning">No findings recorded. Acceptance is undetermined.</p>'}
</section></main><script>${FILTER_SCRIPT}</script></body></html>`;
}
