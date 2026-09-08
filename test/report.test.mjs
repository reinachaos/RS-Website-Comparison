import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { renderReport } from '../src/report.mjs';

function fixture(overrides = {}) {
  return {
    schemaVersion: 1, runId: 'qa-2026-09-08',
    startedAt: '2026-09-08T10:00:00Z', finishedAt: '2026-09-08T10:05:00Z',
    scope: { mode: 'selected', selectedIds: ['MANUAL-1', 'FAIL-1'], totalFindings: 36, partial: true },
    environment: { browser: 'Chromium', platform: 'Windows', viewport: { width: 1440, height: 1000 } },
    results: [
      { id: 'MANUAL-1', title: 'Manual typography decision', category: 'visual', status: 'review',
        checks: [{ id: 'review-1', label: 'Review typography', status: 'review', expected: null,
          actual: { font: 'serif' }, note: 'Approval is still required' }], evidence: [], notes: ['Unapproved reference'] },
      { id: 'FAIL-1', title: 'Missing corrected content', category: 'content', status: 'fail',
        checks: [{ id: 'text-1', label: 'Require corrected text', status: 'fail',
          expected: ['First corrected rule', 'Second corrected rule'], actual: { found: false }, note: 'Both texts absent' },
        { id: 'link-2', label: 'Require download', status: 'blocked', expected: 1, actual: null, note: 'Login gate' }],
        evidence: [{ label: 'Desktop screenshot', path: 'artifacts/FAIL-1/desktop.png' },
          { label: 'DOM evidence', path: 'artifacts/FAIL-1/dom.html' },
          { label: 'Source page', path: 'https://example.org/page?q=one&next=two' }], notes: ['Needs correction'] }
    ],
    coverage: { historicalClaims: 344, automatedChecks: 3, manualDecisions: 1, supplementalTargets: 44 },
    summary: { pass: 999, note: 'Runner summary is supplied data' }, exitCode: 2,
    ...overrides
  };
}

test('returns a standalone document without mutating the input', () => {
  const run = fixture();
  const before = structuredClone(run);
  const html = renderReport(run);
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /<style>/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+stylesheet/i);
  assert.deepEqual(run, before);
});

test('shows dates, environment, partial scope and separate historical coverage', () => {
  const html = renderReport(fixture());
  for (const value of ['qa-2026-09-08', '2026-09-08T10:00:00Z', '2026-09-08T10:05:00Z',
    'Chromium', 'Windows', 'Partial scope', '36', '344', 'historicalClaims', 'automatedChecks']) {
    assert.ok(html.includes(value), `Missing ${value}`);
  }
  assert.match(html, /Current check results/);
  assert.match(html, /Historical claims are not executable checks/);
  assert.match(html, /Tool exit code/);
  assert.match(html, /does not establish whole-website acceptance/);
});

test('counts recorded statuses without trusting summary and preserves manual-first order', () => {
  const html = renderReport(fixture());
  assert.match(html, /data-finding-count="review">1</);
  assert.match(html, /data-finding-count="fail">1</);
  assert.match(html, /data-finding-count="pass">0</);
  assert.match(html, /data-check-count="blocked">1</);
  assert.ok(html.indexOf('Manual typography decision') < html.indexOf('Missing corrected content'));
  for (const text of ['review-1', 'Approval is still required', 'Unapproved reference',
    'text-1', 'First corrected rule', 'Second corrected rule', 'link-2', 'Login gate', 'Needs correction']) {
    assert.ok(html.includes(text), `Missing rule detail ${text}`);
  }
  for (const label of ['Expected', 'Actual', 'Note']) assert.ok(html.includes(label));
});

test('renders every status including errors with no hidden findings by default', () => {
  const statuses = ['pass', 'fail', 'blocked', 'review', 'error'];
  const html = renderReport(fixture({ results: statuses.map((status) => ({
    id: status, title: status, status, checks: [{ id: status, label: status, status, expected: 1, actual: 0 }]
  })) }));
  for (const status of statuses) {
    assert.match(html, new RegExp(`data-finding-count="${status}">1<`));
    assert.match(html, new RegExp(`data-check-count="${status}">1<`));
  }
  assert.equal((html.match(/class="finding"/g) || []).length, 5);
  assert.doesNotMatch(html, /<article[^>]*\bhidden\b/);
});

test('supplemental records are not advertised as additional original findings', () => {
  const html = renderReport(fixture());
  assert.match(html, /2 result records; 36 total declared findings/);
  assert.match(html, /Result statuses/);
  assert.doesNotMatch(html, /2 finding results/);
});

test('empty runs and inconsistent scope never imply acceptance', () => {
  const html = renderReport(fixture({ results: [], exitCode: 0,
    scope: { mode: 'all', selectedIds: [], totalFindings: 36, partial: false } }));
  assert.match(html, /No findings recorded/);
  assert.match(html, /Partial scope/);
  assert.match(html, /does not establish whole-website acceptance/);
  assert.doesNotMatch(html, /website passed|all tests passed|website acceptance: pass/i);
});

test('full selected-check passes still do not certify the whole website', () => {
  const run = fixture({ results: [{ id: 'P', title: 'Recorded pass', status: 'pass',
    checks: [{ id: 'P1', status: 'pass', expected: true, actual: true }] }], exitCode: 0,
    scope: { mode: 'all', selectedIds: ['P'], totalFindings: 1, partial: false } });
  const html = renderReport(run);
  assert.match(html, /Full declared scope/);
  assert.match(html, /does not establish whole-website acceptance/);
});

test('supplemental results cannot hide missing selected finding IDs in full scope', () => {
  const html = renderReport(fixture({ scope: { mode: 'all', partial: false,
    totalFindings: 2, selectedIds: ['MANUAL-1', 'MISSING-1'] } }));
  assert.match(html, /Partial scope/);
  assert.doesNotMatch(html, /Full declared scope/);
});

test('retains supplied finding status and exposes conflicting check aggregate', () => {
  const html = renderReport(fixture({ results: [{ id: 'CONFLICT', title: 'Conflicting result', status: 'pass',
    checks: [{ id: 'bad', label: 'Failed rule', status: 'fail', expected: 1, actual: 0 }] }] }));
  assert.match(html, /data-finding-count="pass">1</);
  assert.match(html, /Status mismatch/);
  assert.match(html, /Check aggregate/);
  assert.match(html, /data-check-count="fail">1</);
});

test('unknown statuses and empty checks stay visible as error or review', () => {
  const html = renderReport(fixture({ results: [
    { id: 'UNKNOWN', title: 'Unknown', status: 'unexpected-status', checks: [] },
    { id: 'EMPTY', title: 'Empty', status: 'review', checks: [] },
    { id: 'BAD-CHECK', title: 'Bad check', status: 'error', checks: [{ id: 'x', status: 'odd-check-status' }] }
  ] }));
  assert.match(html, /unexpected-status/);
  assert.match(html, /odd-check-status/);
  assert.match(html, /No checks recorded/);
  assert.match(html, /data-finding-count="error">2</);
  assert.match(html, /data-check-count="error">1</);
});

test('escapes untrusted strings in every displayed field and never renders embedded page HTML', () => {
  const payload = '\"><img src=x onerror="globalThis.pwned=1"><script>alert(1)</script>&\'';
  const html = renderReport(fixture({ runId: payload, startedAt: payload, finishedAt: payload,
    environment: { [payload]: payload }, coverage: { [payload]: payload }, summary: { [payload]: payload },
    scope: { mode: payload, selectedIds: [payload], totalFindings: 1, partial: true }, exitCode: payload,
    results: [{ id: payload, title: payload, category: payload, status: payload, notes: [payload],
      checks: [{ id: payload, label: payload, status: payload, expected: { mainHTML: payload }, actual: payload, note: payload }],
      evidence: [{ label: payload, path: payload }, { label: payload, path: 'artifacts/safe.png' }] }] }));
  assert.doesNotMatch(html, /<img src=x|<script>alert|onerror="globalThis/);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('&amp;'));
  assert.ok(html.includes('&#39;'));
  assert.doesNotMatch(html, /<iframe|<object|<embed/i);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.every(([, script]) => !script.includes('pwned')));
});

test('safe artifact links show inline raster thumbnails and external links are labeled', () => {
  const html = renderReport(fixture());
  assert.match(html, /href="artifacts\/FAIL-1\/desktop.png"/);
  assert.match(html, /<img[^>]+src="artifacts\/FAIL-1\/desktop.png"[^>]+alt="Desktop screenshot"/);
  assert.match(html, /href="artifacts\/FAIL-1\/dom.html"/);
  assert.match(html, /href="https:\/\/example.org\/page\?q=one&amp;next=two"/);
  assert.match(html, /External page/);
  assert.match(html, /Local artifact/);
  assert.match(html, /max-width:\s*320px/);
  assert.match(html, /max-width:\s*100%/);
});

const unsafePaths = [
  'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:image/png;base64,AA', 'file:///C:/secret.txt',
  'ftp://example.org/a', 'mailto:a@example.org', '//example.org/a', '/absolute/a.png',
  'C:/Users/example/secret.png', 'C:\\Users\\example\\secret.png', 'C:secret.png', '\\\\server\\share\\a.png',
  '../secret.png', 'artifacts/../secret.png', './artifacts/a.png', 'artifacts/./a.png',
  'artifacts\\a.png', 'artifacts//a.png', 'artifacts/%2e%2e/a.png', '%2E%2E/a.png',
  'artifacts/%2e./a.png', 'artifacts/.%2e/a.png', 'artifacts/%252e%252e/a.png',
  'artifacts/%25252e%25252e/a.png', 'artifacts/%5c../a.png', 'artifacts/%255c../a.png',
  'artifacts/%2f..%2fsecret.png', 'artifacts/%252fsecret.png', '%2f%2fexample.org/a.png',
  'artifacts/a.png?redirect=../secret', 'artifacts/a.png#fragment', 'artifacts/a.png:stream',
  'artifacts/%00a.png', 'artifacts/%0aa.png', 'artifacts/a%ZZ.png', ' artifacts/a.png',
  'artifacts/a.png ', 'artifacts/.. /secret.png', 'https://', 'https:example.org',
  'https:///example.org', 'https://example.org\\@evil.org', 'https://user:password@example.org/a',
  'https://example.org/\nunsafe', 'artifacts/a\u0000.png'
];
for (const path of unsafePaths) {
  test(`rejects unsafe evidence path ${JSON.stringify(path)}`, () => {
    const html = renderReport(fixture({ results: [{ id: 'UNSAFE', title: 'Unsafe evidence', status: 'review',
      checks: [], evidence: [{ label: 'Rejected evidence', path }] }] }));
    assert.match(html, /Unsafe or unsupported evidence path/);
    assert.doesNotMatch(html, /<a\s|<img\s/);
  });
}

for (const path of ['artifacts/page one.png', 'artifacts/page%20one.png', 'artifacts/one-two_3.PNG',
  'artifacts/snapshot.json', 'artifacts/source.html', 'https://example.org/a', 'http://example.org/a']) {
  test(`allows supported evidence path ${path}`, () => {
    const html = renderReport(fixture({ results: [{ id: 'SAFE', title: 'Safe', status: 'review',
      checks: [], evidence: [{ label: 'Evidence', path }] }] }));
    assert.match(html, /<a\s/);
    assert.doesNotMatch(html, /Unsafe or unsupported evidence path/);
  });
}

test('does not load external images or SVG/HTML as embedded content', () => {
  const html = renderReport(fixture({ results: [{ id: 'LINKS', title: 'Links', status: 'review', checks: [],
    evidence: ['https://example.org/image.png', 'artifacts/image.svg', 'artifacts/source.html']
      .map((path) => ({ label: 'Link only', path })) }] }));
  assert.equal((html.match(/<a\s/g) || []).length, 3);
  assert.doesNotMatch(html, /<img\s|<iframe\s/);
});

test('null, objects, deep values and large text have bounded expandable readable details', () => {
  const circular = { value: 1 }; circular.self = circular;
  let deep = { leaf: 'deep' };
  for (let i = 0; i < 100; i++) deep = { nested: deep };
  const html = renderReport(fixture({ results: [{ id: 'DETAILS', title: 'Details', status: 'fail', checks: [
    { id: 'null', status: 'fail', expected: null, actual: { found: false, count: 2 } },
    { id: 'long', status: 'fail', expected: 'A'.repeat(500000), actual: Array(10000).fill('B'.repeat(1000)) },
    { id: 'circular', status: 'error', expected: circular, actual: deep }
  ] }] }));
  assert.match(html, />null</);
  assert.match(html, /&quot;found&quot;: false/);
  assert.match(html, /<details[\s\S]*<summary/);
  assert.match(html, /truncated/i);
  assert.match(html, /Circular/);
  assert.ok(html.length < 100000, `Unbounded report: ${html.length}`);
});

test('filter controls are native, labeled and script uses no untrusted HTML sinks', () => {
  const html = renderReport(fixture());
  assert.match(html, /<label[^>]+for="report-search"/);
  assert.match(html, /<input[^>]+id="report-search"[^>]+type="search"/);
  assert.match(html, /<label[^>]+for="report-status"/);
  assert.match(html, /<select[^>]+id="report-status"/);
  assert.match(html, /<button[^>]+type="reset"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /:focus-visible/);
  assert.match(html, /@media/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotMatch(script, /innerHTML|outerHTML|document.write|eval\(|new Function/);
  const digest = createHash('sha256').update(script).digest('base64');
  assert.ok(html.includes(`sha256-${digest}`), 'CSP must authorize only the static filter script');
  assert.match(html, /default-src &#39;none&#39;/);
  assert.match(html, /base-uri &#39;none&#39;/);
});

test('rejects unsupported schema versions instead of rendering a misleading report', () => {
  assert.throws(() => renderReport(fixture({ schemaVersion: 2 })), /schemaVersion/);
  assert.throws(() => renderReport(null), /schemaVersion/);
});

test('standalone browser rendering, mobile rows, keyboard filters and no-JS fallback', {
  skip: process.env.REPORT_BROWSER_TESTS !== '1', timeout: 30000
}, async (t) => {
  const { chromium } = await import('playwright');
  const { mkdtemp, writeFile, unlink, rmdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const folder = await mkdtemp(join(tmpdir(), 'report-test-'));
  const htmlPath = join(folder, 'report.html');
  const imagePath = join(folder, 'screenshot.png');
  t.after(async () => {
    await unlink(htmlPath).catch(() => {});
    await unlink(imagePath).catch(() => {});
    await rmdir(folder);
  });
  await writeFile(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64'));
  const run = fixture();
  run.results[1].evidence = [{ label: 'Screenshot', path: 'screenshot.png' }];
  run.results[1].checks[0].actual = { mainHTML: '<img src=x onerror="window.pwned=1">', long: 'unbroken'.repeat(300) };
  await writeFile(htmlPath, renderReport(run));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(pathToFileURL(htmlPath).href);
  await page.locator('.thumbnail img').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('.thumbnail img').naturalWidth > 0);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Page overflow at ${width}`);
    if (width < 700) {
      const widths = await page.locator('.checks').first().evaluate((table) => ({
        table: table.getBoundingClientRect().width,
        rowHeader: table.querySelector('tbody th').getBoundingClientRect().width
      }));
      assert.ok(Math.abs(widths.table - widths.rowHeader) <= 1, `Mobile rule header must fill the row: ${JSON.stringify(widths)}`);
    }
  }
  await page.locator('#report-status').selectOption('review');
  assert.equal(await page.locator('.finding:visible').count(), 1);
  await page.getByRole('button', { name: 'Reset filters' }).focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.finding:visible').count(), 2);
  await page.locator('#report-search').fill('Both texts absent');
  assert.equal(await page.locator('.finding:visible').count(), 1);
  await page.locator('#report-search').fill('no matching finding');
  assert.equal(await page.locator('.finding:visible').count(), 0);
  assert.equal(await page.locator('#no-matches').isVisible(), true);
  await page.getByRole('button', { name: 'Reset filters' }).click();
  const summary = page.locator('.finding details summary').first();
  await summary.focus();
  await page.keyboard.press('Enter');
  assert.equal(await summary.evaluate((element) => element.parentElement.open), true);
  assert.equal(await page.evaluate(() => window.pwned), undefined);
  assert.equal(await page.locator('.finding img[onerror]').count(), 0);
  assert.deepEqual(errors, []);
  const staticContext = await browser.newContext({ javaScriptEnabled: false });
  const staticPage = await staticContext.newPage();
  await staticPage.goto(pathToFileURL(htmlPath).href);
  assert.equal(await staticPage.locator('.finding:visible').count(), 2);
  assert.equal(await staticPage.locator('#report-filters').isVisible(), false);
  await staticContext.close();
});
