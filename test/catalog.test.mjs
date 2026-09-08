import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evaluateRule, validateRule } from '../src/rules.mjs';

const root = new URL('../', import.meta.url);
const source = new URL('../../reports/subpage-audit/revalidation-2026-09-08/', import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(`catalog/${name}.json`, root), 'utf8'));
const finding = id => read('findings').find(f => f.id === id);
const types = new Set(['requireText','forbidText','orderedText','requireLink','forbidLink','linkCount','requireHeading','forbidHeading','mainNotEmpty','mailtoCoverage','legacyResources','overflow','compareMetric','review']);

test('catalog artifacts and reproducible exporter exist', () => {
  for (const name of ['findings','availability','file-pairs','historical-claims','external-links','anchors'])
    assert.ok(existsSync(new URL(`catalog/${name}.json`, root)), `${name} catalog is missing`);
  assert.ok(existsSync(new URL('scripts/export-catalog.mjs', root)));
});

test('exact finding identities, schemas and corrections follow the contract', () => {
  const reportURL = new URL('verification-report-data.json', source);
  const report = existsSync(reportURL) ? JSON.parse(readFileSync(reportURL)) : null;
  const findings = read('findings');
  assert.equal(findings.length, 36);
  const expected = Object.entries({ABOUT:6,ARCHIVE:7,GENERAL:5,TECH:3,STYLE:4,NAV:2,ASSET:1,LINK:8})
    .flatMap(([prefix,count]) => Array.from({length:count}, (_,i) => `${prefix}-${String(i+1).padStart(2,'0')}`));
  assert.deepEqual([...findings.map(f => f.id)].sort(), expected.sort());
  if (report) assert.deepEqual(findings.map(f => f.id), report.findings.map(f => f.id));
  for (const f of findings) {
    if (report) {
      const original = report.findings.find(x => x.id === f.id);
      assert.equal(f.title, original.title);
      assert.equal(f.correction, original.reportCorrection);
      assert.equal(f.historicalCheckCount, original.checks.length);
    }
    assert.ok(f.rules.length && f.reviews.length);
    assert.equal(new Set(f.rules.map(r => r.id)).size, f.rules.length);
    for (const r of f.rules) {
      assert.ok(types.has(r.type), `${f.id}: ${r.type}`);
      assert.deepEqual(validateRule(r), [], r.id);
      assert.ok(r.id && r.label);
      assert.ok((r.pageKey ?? 'primary') === 'primary' || f.pages?.some(p => p.key === r.pageKey));
    }
    assert.ok(f.rules.some(r => r.type === 'review'), `${f.id} must retain review obligations`);
  }
});

test('344 raw statements are historical traceability, never executable rules', () => {
  const claims = read('historical-claims');
  assert.equal(claims.length, 344);
  assert.equal(new Set(claims.map(c => c.id)).size, 344);
  assert.equal(read('findings').reduce((n,f) => n + f.historicalCheckCount, 0), 344);
  for (const c of claims) {
    assert.match(c.note, /historical.*not.*current/i);
    assert.ok(finding(c.findingId));
    assert.ok(c.statement && c.historicalStatus);
    assert.ok(!('rules' in c) && !('status' in c));
  }
});

test('all supplemental inventories preserve exact scope', () => {
  const availability = read('availability');
  assert.equal(availability.length, 44);
  assert.ok(availability.every(a => a.expectedDocument === false && a.historicalStatus && a.note));
  const pairs = read('file-pairs');
  assert.equal(pairs.length, 5);
  assert.equal(pairs.filter(p => p.mode === 'package').length, 4);
  assert.equal(pairs.filter(p => p.mode === 'document-review').length, 1);
  assert.equal(pairs.reduce((n,p) => n+p.dependencies.length, 0), 71);
  for (const p of pairs) for (const d of p.dependencies) {
    assert.match(d.sha256, /^[a-f0-9]{64}$/);
    assert.ok(d.oldURL.startsWith('https://') && d.newURL.startsWith('https://'));
  }
  for (const p of pairs) {
    assert.match(p.expectedOldHash, /^[a-f0-9]{64}$/);
    assert.match(p.expectedNewHash, /^[a-f0-9]{64}$/);
  }
  const external = read('external-links');
  assert.equal(external.length, 11);
  assert.equal(new Set(external.map(e => e.findingId)).size, 8);
  for (const e of external) assert.ok(finding(e.findingId).rules.some(r => r.type === 'review' && r.reason.includes(e.url) && /fresh destination check/i.test(r.reason)));
  const anchors = read('anchors');
  assert.equal(anchors.filter(a => a.mode === 'sections').reduce((n,a) => n+a.expectedSections.length, 0), 10);
  assert.ok(anchors.some(a => a.mode === 'return-top' && a.baselineURL.includes('past-reliability')));
});

test('archive rules cover every affected page and intended restored content', () => {
  for (const [id, expected] of [['ARCHIVE-04',4],['ARCHIVE-05',5],['ARCHIVE-06',2]]) {
    const f = finding(id);
    assert.equal(f.pages.length, expected);
    assert.equal(new Set(f.pages.map(p => p.migratedURL)).size, expected);
    for (const p of f.pages) assert.ok(f.rules.some(r => r.pageKey === p.key && r.type !== 'review'));
  }
  assert.equal(finding('ARCHIVE-04').rules.filter(r => r.type === 'requireLink' && r.filter.text === 'Cover' && r.filter.hrefEndsWith === '.pdf').length, 4);
  assert.equal(finding('ARCHIVE-07').rules.filter(r => r.type === 'requireLink').length, 9);
  assert.ok(finding('ARCHIVE-01').rules.some(r => r.type === 'requireText' && r.values.includes('Intersecting Definitions of V&V')));
  assert.ok(finding('ARCHIVE-02').rules.some(r => r.type === 'mainNotEmpty'));
  assert.deepEqual(finding('ARCHIVE-03').rules.filter(r => r.type !== 'review').map(r => r.type), ['forbidHeading']);
  assert.ok(finding('ASSET-01').pages.some(p => p.key === 'roadmap'));
  assert.ok(finding('ARCHIVE-06').rules.some(r => r.type === 'forbidText' && r.values.includes('AugustSpecial Issue') && r.caseSensitive));
});

test('corrected ASSET and email conditions cannot encode the defects as success', () => {
  const asset = finding('ASSET-01');
  assert.ok(asset.rules.some(r => r.type === 'legacyResources' && r.hostname === 'rs.ieee.org'));
  assert.equal(asset.rules.filter(r => r.type === 'forbidLink').length, 0);
  assert.equal(asset.rules.filter(r => r.type === 'review' && /optional cleanup/i.test(r.reason)).length, 6);
  assert.match(asset.correction, /eight image dependencies/);
  assert.match(asset.correction, /six visible download actions.*do not/);
  const email = finding('TECH-02');
  assert.ok(email.rules.some(r => r.type === 'forbidLink' && r.filter.text === 'eskang@cmu.edu' && r.filter.href === 'mailto:gsong7@ford.com'));
  assert.ok(!email.rules.some(r => r.type === 'requireLink' && r.filter?.text === 'eskang@cmu.edu' && r.filter?.href === 'mailto:gsong7@ford.com'));
  assert.ok(email.reviews.some(r => /Eunsuk/.test(r)));
  assert.ok(finding('NAV-02').rules.some(r => r.type === 'forbidLink' && r.filter.text === 'Reliability Society Newsletter-TA'));
});

test('data contains no local paths, raw HTML, credentials, or current result states', () => {
  for (const name of ['findings','availability','file-pairs','historical-claims','external-links','anchors']) {
    const text = JSON.stringify(read(name));
    assert.doesNotMatch(text, /\b[A-Za-z]:[\\/]|file:\/\/|<\/?(?:html|body|script|div|a|p)\b|(?:password|authorization|cookie)\s*[=:]/i, name);
    for (const item of read(name)) assert.ok(!('status' in item), name);
  }
});

test('export rebuild is byte-for-byte deterministic from read-only evidence', {skip: !existsSync(source) && 'Original evidence is optional in standalone clones'}, async () => {
  const script = new URL('scripts/export-catalog.mjs', root);
  assert.ok(existsSync(script), 'exporter is missing');
  const { buildCatalog } = await import(script.href);
  const built = await buildCatalog(fileURLToPath(source));
  for (const [name, data] of Object.entries(built)) {
    assert.equal(JSON.stringify(data, null, 2) + '\n', readFileSync(new URL(`catalog/${name}.json`, root), 'utf8'), name);
  }
});

test('corrected acceptance counts distinguish automatic predicates from reviews', () => {
  const findings = read('findings');
  const rules = findings.flatMap(f => f.rules);
  assert.equal(rules.length, 218);
  assert.equal(rules.filter(r => r.type !== 'review').length, 128);
  assert.equal(rules.filter(r => r.type === 'review').length, 90);
  assert.equal(rules.filter(r => r.type === 'forbidLink').length, 8);
  assert.equal(findings.filter(f => f.rules.some(r => r.type !== 'review')).length, 27);
});

test('hierarchy review captures all twelve mapped bodies and checks committee navigation', () => {
  const f = finding('TECH-03');
  assert.equal(f.pages.filter(p => !['primary','sitemap'].includes(p.key)).length, 12);
  assert.equal(f.rules.filter(r => r.type === 'requireLink' && r.filter.hrefIncludes === '/technical-committees/').length, 6);
  for (const p of f.pages) assert.ok(f.rules.some(r => r.pageKey === p.key && r.type !== 'review'));
});

const snap = (extra = {}) => ({ status:'ready', httpStatus:200, mainText:'Populated captured page content', mainHTML:'', links:[], images:[], headings:[], metrics:{overflow:0,h1:{fontSize:28,fontWeight:400}}, ...extra });
const link = (text, href, extra = {}) => ({text,href,rawHref:href,visible:true,inMain:true,...extra});

test('every catalog rule is blocked or review, never pass, when required capture is unavailable', () => {
  for (const f of read('findings')) for (const r of f.rules) {
    for (const status of ['blocked','missing','error']) assert.equal(evaluateRule(r, {old:snap({status}),new:snap({status})}).status, r.type === 'review' ? 'review' : 'blocked', r.id);
  }
});

test('intended-fix predicates reject known defects and accept corrected fixtures', () => {
  const cases = [
    ['TECH-01','requireText',snap({mainText:'linebetween DigitalTransformation besuccessful personallearning'}),snap({mainText:'line between Digital Transformation be successful personal learning'})],
    ['ARCHIVE-01','requireText',snap({mainText:'Critical Infrastructure Systems and the Internet of Things'}),snap({mainText:'Performance Testing of a Real-World System Intersecting Definitions of V&V System and Software Assurance'})],
    ['ARCHIVE-03','forbidHeading',snap({headings:[{level:2,text:'Special Issue on Trustworthy Computing and Cybersecurity'}]}),snap({headings:[{level:2,text:'Special Issue on Systems of Systems'}]})],
    ['GENERAL-01','overflow',snap({metrics:{overflow:243}}),snap({metrics:{overflow:10}})],
    ['ARCHIVE-06','forbidText',snap({mainText:'AugustSpecial Issue'}),snap({mainText:'August Special Issue-AdCom Election'})],
  ];
  for (const [id,type,bad,good] of cases) {
    const rule = finding(id).rules.find(r => r.type === type);
    assert.equal(evaluateRule(rule,{old:snap(),new:bad}).status,'fail',id);
    assert.equal(evaluateRule(rule,{old:snap(),new:good}).status,'pass',id);
  }
  for (const r of finding('ARCHIVE-04').rules.filter(r => r.type === 'requireLink')) {
    assert.equal(evaluateRule(r,{new:snap({links:[link('Cover','https://example.org/cover.jpg')]})}).status,'fail');
    assert.equal(evaluateRule(r,{new:snap({links:[link('Cover','https://example.org/cover.pdf')]})}).status,'pass');
  }
});

test('retained empty or BR-only ASSET hrefs are optional cleanup, independent of loaded images', () => {
  const f = finding('ASSET-01');
  const fixtures = [
    ['ASSET-01-03','2014-november','https://rs.ieee.org/images/files/newsletters/2014/RD5._Prof._Brahim_Hamid_last.pdf'],
    ['ASSET-01-04','2014-november','https://rs.ieee.org/images/files/newsletters/2014/RD6_11-17.pdf'],
    ['ASSET-01-05','2016-february','https://rs.ieee.org/images/files/techact/Reliability/2016-02/2016-02-a01.pdf'],
    ['ASSET-01-06','2016-february','https://rs.ieee.org/images/files/techact/Reliability/2016-02/2016-02-a02.pdf'],
    ['ASSET-01-07','2016-february','https://rs.ieee.org/images/files/techact/Reliability/2016-02/2016-02-a03.pdf'],
    ['ASSET-01-08','congress-2024','https://rs.ieee.org/Binghamton.pptx'],
  ];
  for (const [id,pageKey,href] of fixtures) {
    const residual = f.rules.find(r => r.id === id);
    for (const text of ['', '\n']) for (const visible of [false,true]) {
      const retained = snap({links:[link(text,href,{visible})]});
      assert.equal(evaluateRule(residual,{new:retained}).status,'review',id);
      assert.ok(f.rules.filter(r => !r.pageKey || r.pageKey === pageKey)
        .every(r => ['pass','review'].includes(evaluateRule(r,{new:retained}).status)),id);
    }
    assert.equal(residual.pageKey,pageKey);
    assert.match(residual.reason,/optional cleanup.*retention is allowed/i);
    assert.ok(residual.reason.includes(href) || (pageKey === 'congress-2024' && residual.reason.includes('/Binghamton.pptx')));
    assert.equal(evaluateRule(residual,{new:snap()}).status,'review',id);
  }
  const resources = f.rules.filter(r => r.type !== 'review');
  assert.deepEqual(resources.map(r => [r.type,r.pageKey]), [['legacyResources','division'],['legacyResources','roadmap']]);
  const image = {src:'https://rs.ieee.org/logo.png',currentSrc:'https://rs.ieee.org/logo.png',loaded:true,visible:true,inMain:true};
  for (const resource of resources) {
    assert.equal(evaluateRule(resource,{new:snap({links:fixtures.map(([, ,href]) => link('',href,{visible:false}))})}).status,'pass');
    assert.equal(evaluateRule(resource,{new:snap({images:[image]})}).status,'fail');
    assert.equal(evaluateRule(resource,{new:snap({images:[{...image,loaded:false}]})}).status,'pass');
  }
  assert.ok(f.rules.some(r => r.type === 'review' && /replacement completeness/.test(r.reason)));
});

test('a repaired original LINK URL is not statically forbidden while fresh availability remains required', () => {
  for (const target of read('external-links')) {
    const f = finding(target.findingId);
    // Availability is checked by the runner; this fixture tests only static catalog acceptance.
    const retained = snap({links:[link('Original destination',target.url)]});
    for (const rule of f.rules) {
      assert.equal(evaluateRule(rule,{old:retained,new:retained}).status,'review',`${target.id}: ${rule.id}`);
    }
    const review = f.rules.find(r => r.reason?.includes(target.url));
    assert.match(review.reason,/fresh destination check/i);
    assert.match(review.reason,/src\/run\.mjs/);
    assert.match(review.reason,/repaired original URL.*without.*catalog (?:update|revision)/i);
    assert.match(review.reason,/owner review.*replacement or removal semantics/i);
    assert.equal(evaluateRule(review,{new:snap()}).status,'review',target.id);
    assert.ok(!f.reviews.some(reason => /requires.*explicit catalog revision/i.test(reason)));
  }
});

test('anchor inventory preserves exact fragment case and changed return semantics', () => {
  const anchors = read('anchors');
  const sections = anchors.find(a => a.mode === 'sections').expectedSections;
  assert.ok(sections.some(s => s.baselineFragment === '#Kowalski' && s.migratedFragment === '#Richard-Kowalski-Outstanding-Service-Award'));
  assert.equal(anchors.find(a => a.id === 'awards-return-top').expectedSections, 10);
  assert.equal(anchors.find(a => a.id === 'past-networks-return-top').expectedSections, 30);
});
