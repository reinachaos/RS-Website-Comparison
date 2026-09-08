import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const repo = fileURLToPath(new URL('../', import.meta.url));
const norm = value => value.replace(/\s+/g, ' ').trim();

// Select fields explicitly: the evidence also contains local paths and raw HTML.
export async function buildCatalog(sourceRoot) {
  const read = async name => JSON.parse(await readFile(join(sourceRoot, name), 'utf8'));
  const report = await read('verification-report-data.json');
  const archive = await read('archive/findings.json');
  const links = await read('links/findings.json');
  const availabilityEvidence = await read('links/availability-consolidated.json');
  const files = await read('file-gaps/consolidated.json');
  const browser = async name => read(`browser/${name}.json`);
  const findings = report.findings.map(f => ({
    id: f.id, title: f.title, baselineURL: f.baselineURL, migratedURL: f.migratedURL,
    rules: [], reviews: [f.qaNote], historicalCheckCount: f.checks.length,
    correction: f.reportCorrection,
  }));
  const get = id => findings.find(f => f.id === id);
  const claims = id => archive.findings.find(f => f.id === id).atomicClaims;
  const add = (id, type, label, parameters = {}) => {
    const f = get(id);
    f.rules.push({ id: `${id}-${String(f.rules.length + 1).padStart(2, '0')}`, type, label, ...parameters });
  };
  const review = (id, reason) => get(id).reviews.push(reason);
  const pair = (key, old, fresh) => ({ key, baselineURL: old.url, migratedURL: fresh.url });
  const page = async (key, stem) => pair(key, await browser(`${stem}-old`), await browser(`${stem}-new`));
  const issue = async key => page(key, `reliability-special-issue-${key}`);
  const nonempty = (id, pageKey = 'primary') => add(id, 'mainNotEmpty', 'Capture a populated content region for comparison', { minChars: 80, pageKey });
  const visibleLink = (id, text, parameters = {}, pageKey = 'primary') => add(id, 'requireLink', `Restore the ${text} action`, { filter: { text, ...parameters }, pageKey });
  const sitemap = await page('sitemap', 'sitemap');
  const oldSitemap = await browser('sitemap-old');
  const newSitemap = await browser('sitemap-new');

  add('ABOUT-01', 'forbidText', 'Separate all four joined elected-member names', {
    values: ['Loretta ArellanoJoanna F. DeFranco','Ruizhi (Ricky) GaoGeorge Pallis','Preeti ChauhanChristian K. Hansen','Farnoosh NaderkhaniScott Tamashiro'],
  });
  add('ABOUT-01', 'requireText', 'Keep the affected member names readable', {
    values: ['Loretta Arellano','Joanna F. DeFranco','Ruizhi (Ricky) Gao','George Pallis','Preeti Chauhan','Christian K. Hansen','Farnoosh Naderkhani','Scott Tamashiro'],
  });
  review('ABOUT-01', 'Inspect table-cell DOM and matched screenshots: each approved member must occupy a separate readable line. Whitespace-normalized text cannot prove BR nodes or line layout. Roster authority remains ABOUT-02.');
  nonempty('ABOUT-02');
  review('ABOUT-02', 'Compare the complete term-ending-2026 cells and obtain the approved roster from the owner; neither Nir Kshetri nor Joanna F. DeFranco is automatically declared the authorized appointment.');
  get('ABOUT-03').pages = [{ key: 'primary', baselineURL: get('ABOUT-03').baselineURL, migratedURL: get('ABOUT-03').migratedURL }, sitemap];
  for (const text of ['Adcom Only','ExCom Only']) add('ABOUT-03', 'requireLink', `Restore discoverable ${text} navigation`, { filter: { text }, scope: 'all' });
  add('ABOUT-03', 'requireLink', 'Restore discoverable AdCom Meetings sitemap entry', { filter: { text: 'AdCom Meetings' }, scope: 'all', pageKey: 'sitemap' });
  review('ABOUT-03', 'Owner approval is required for replacement routes and access roles. Capture navigation and sitemap, but do not fetch protected bodies or equate a login gate with deletion.');
  review('ABOUT-04', 'Compare requested/final URLs and logged-out entry screenshots for both routes. Obtain the intended access matrix and authorized role-based testing. There is no reliable automatic acceptance condition until the owner decides public versus restricted access; blocked captures must never pass. Do not preserve public editorial access as an expected condition.');
  const mouLabels = (await browser('mou-old')).links.filter(l => l.href.includes('/samlcontent/')).map(l => norm(l.text));
  assert.equal(mouLabels.length, 7);
  add('ABOUT-05', 'orderedText', 'Preserve all seven MOU labels in their source order', { values: mouLabels });
  for (const label of mouLabels) visibleLink('ABOUT-05', label);
  review('ABOUT-05', 'Compare all seven hrefs and unauthenticated entry responses with the approved access policy. Link labels/order do not approve public PDFs or establish equality with protected source documents.');
  visibleLink('ABOUT-06', 'See chapter list', { href: get('GENERAL-01').migratedURL });
  add('ABOUT-06', 'forbidLink', 'Remove the old-host chapter navigation target', { filter: { text: 'See chapter list', href: get('GENERAL-01').baselineURL } });

  const mayArticles = claims('ARCHIVE-01')[0].observed.articles.map(a => a.title);
  add('ARCHIVE-01', 'requireText', 'Restore the two May 2015 articles and subject', { values: [...mayArticles, 'System and Software Assurance'] });
  for (const title of mayArticles) visibleLink('ARCHIVE-01', title, { hrefEndsWith: '.pdf' });
  const combinedArticles = claims('ARCHIVE-02').filter(c => c.observed?.baselineEntry).map(c => c.observed.baselineEntry.title);
  add('ARCHIVE-01', 'forbidText', 'Remove the combined-issue articles from May', { values: combinedArticles });
  add('ARCHIVE-01', 'linkCount', 'Restore the nine May PDF document actions', { filter: { hrefEndsWith: '.pdf' }, min: 9, max: 9 });
  review('ARCHIVE-01', 'Compare the cover and all nine intended May documents, including the 15-page entire issue. Text/extension checks cannot prove document identity; historical twelve-file combined-to-May equality is not a current test.');
  nonempty('ARCHIVE-02');
  add('ARCHIVE-02', 'requireText', 'Restore all five combined-issue article titles', { values: combinedArticles });
  const combinedDocs = claims('ARCHIVE-02').filter(c => c.observed?.baselineAnchor).map(c => norm(c.observed.baselineAnchor.text));
  assert.equal(combinedDocs.length, 12);
  for (const title of combinedDocs) visibleLink('ARCHIVE-02', title, { hrefEndsWith: '.pdf' });
  add('ARCHIVE-02', 'linkCount', 'Restore twelve total combined-issue PDF actions, including the five articles', { filter: { hrefEndsWith: '.pdf' }, min: 12, max: 12 });
  review('ARCHIVE-02', 'Inspect the cover and all twelve document identities at the combined route. The PDF contents and 27-page entire issue require separate file inspection. No CMS deletion history is asserted.');
  add('ARCHIVE-03', 'forbidHeading', 'Remove the incorrect February 2016 subject heading', { text: 'Special Issue on Trustworthy Computing and Cybersecurity', level: 2 });
  review('ARCHIVE-03', 'Compare the restored subject with the cover and all three retained article documents; a text occurrence alone does not establish issue-wide subject consistency.');
  get('ARCHIVE-04').pages = [];
  for (const key of ['2015-november','2016-may','2016-august','2016-november']) {
    get('ARCHIVE-04').pages.push(await issue(key));
    visibleLink('ARCHIVE-04', 'Cover', { hrefEndsWith: '.pdf' }, key);
    review('ARCHIVE-04', `${key}: inspect the response MIME type and cover identity. A .pdf href does not prove PDF bytes or forced download; owner-approved conversion needs an explicit acceptance change.`);
  }
  get('ARCHIVE-05').pages = [];
  for (const key of ['2015-february','2015-november','2016-may','2016-august','2016-november']) {
    get('ARCHIVE-05').pages.push(await issue(key));
    const scoped = claims('ARCHIVE-05').filter(c => c.claim.startsWith(`${key}:`));
    const labels = scoped.filter(c => c.observed?.sourceLabel).map(c => c.observed.sourceLabel);
    add('ARCHIVE-05', 'requireText', `Restore ${key} subject/category labels`, { values: labels, pageKey: key });
    for (const c of scoped.filter(c => c.observed?.baselineEntry)) visibleLink('ARCHIVE-05', norm(c.observed.baselineEntry.title), { hrefEndsWith: '.pdf' }, key);
  }
  const august = claims('ARCHIVE-05').find(c => c.observed?.specialIssueArticles).observed;
  add('ARCHIVE-05', 'orderedText', 'Restore August special versus regular article grouping', { values: ['Special Issue on IoT Security:', ...august.specialIssueArticles, 'Regular Issue:', august.regularIssueArticle], pageKey: '2016-august' });
  review('ARCHIVE-05', 'Compare all five contents blocks and twenty article destinations. Six subject/category label occurrences are not six headings. August has two special articles and one regular article; inspect group boundaries. Eleven source category-anchor occurrences represent ten document targets, not eleven distinct PDFs.');
  const associations = claims('ARCHIVE-06').slice(0,3);
  get('ARCHIVE-06').pages = associations.slice(1).map((c,i) => ({ key: i ? 'technical-archive' : 'primary', baselineURL: get('ARCHIVE-06').baselineURL, migratedURL: c.claim.match(/https:\/\/\S+/)[0].replace(/\.$/, '') }));
  for (const p of get('ARCHIVE-06').pages) {
    add('ARCHIVE-06', 'forbidText', 'Remove the exact joined and misassociated AugustSpecial Issue label', { values: ['AugustSpecial Issue'], caseSensitive: true, pageKey: p.key });
    visibleLink('ARCHIVE-06', 'August', { hrefEndsWith: '/2011/3_2011/index.htm' }, p.key);
    visibleLink('ARCHIVE-06', 'Special Issue-AdCom Election', { hrefEndsWith: '/2011/specialissue_2011/index.htm' }, p.key);
  }
  review('ARCHIVE-06', 'Inspect both Publications and Technical Activities archive copies and open both 2011 targets. Labels and href suffixes cannot prove full regular-August versus AdCom Election document identity.');
  for (const c of claims('ARCHIVE-07').filter(c => c.observed?.baseline?.url && c.observed?.migrated?.expectedCanonical)) {
    const o = c.observed;
    visibleLink('ARCHIVE-07', norm(o.baseline.text), { hrefEndsWith: '/' + new URL(o.migrated.expectedCanonical).pathname.split('/').filter(Boolean).at(-1) + '/' });
  }
  review('ARCHIVE-07', 'Inspect all nine index captions and cover links, including August/September/October Issue. Test keyboard activation and resulting issue identity; image links alone cannot satisfy caption-link parity.');

  add('GENERAL-01', 'overflow', 'Avoid materially worse mobile chapter overflow', { viewport: 'mobile', maxExtraPixels: 20 });
  review('GENERAL-01', 'Compare at 390 by 844 with the same environment and all 53 chapter rows expanded. The threshold is conservative, not a pixel-perfect verdict. Inspect contact-column visibility and local table overflow; source overflow was not zero.');
  add('GENERAL-02', 'requireText', 'Restore the omitted baseline board member and affiliation pending editorial approval', { values: ['Xiaoge Zhang','The Hong Kong Polytechnic University','Hong Kong'] });
  review('GENERAL-02', 'Compare the complete roster and obtain editor approval for any replacement roster. Baseline-parity failure does not establish an incorrect appointment.');
  add('GENERAL-03', 'requireLink', 'Restore the closing IEEE conference-search navigation', { filter: { href: 'http://www.ieee.org/conferences_events/index.html' } });
  review('GENERAL-03', 'Verify the link is in the closing paragraph after the last event table. An approved HTTPS/replacement URL needs a catalog update; href presence alone cannot prove placement.');
  add('GENERAL-04', 'requireText', 'Restore discoverable sponsor-category labels', { values: ['Society Sponsor','Technical Cosponsor'] });
  review('GENERAL-04', 'Compare controls and exercise each sponsor category with known events, then clear the filter. Static text cannot prove filtering or accessible control semantics. Source filtering was not proven functional by the historical captures.');
  nonempty('GENERAL-05');
  review('GENERAL-05', 'Capture the full schedule including pagination, dates and item counts on both sites, then ask the owner to approve the feed horizon/item limit. Historical 13-versus-21 counts are not fixed acceptance limits; 2028-2032 events must not be automatically forbidden.');
  add('TECH-01', 'forbidText', 'Remove all four joined word boundaries', { values: ['linebetween','DigitalTransformation','besuccessful','personallearning'] });
  add('TECH-01', 'requireText', 'Restore readable Digital Reality Initiative wording', { values: ['line between','Digital Transformation','be successful','personal learning'] });
  const contacts = (await browser('eav-old')).links.filter(l => l.href.startsWith('mailto:'));
  assert.equal(contacts.length, 16);
  add('TECH-02', 'mailtoCoverage', 'Restore fifteen verified contact actions, including the retained Wong action', { addresses: contacts.filter(l => norm(l.text) !== 'eskang@cmu.edu').map(l => norm(l.text)) });
  add('TECH-02', 'forbidLink', 'Do not restore the inherited Eunsuk Kang wrong-recipient link', { filter: { text: 'eskang@cmu.edu', href: 'mailto:gsong7@ford.com' } });
  review('TECH-02', 'Confirm Eunsuk Kang\'s intended recipient with the owner before adding a positive mailto rule for eskang@cmu.edu. The source label and href disagree. The other gsong7@ford.com contact is legitimate and must remain independently clickable; no email delivery is tested.');
  nonempty('TECH-03');
  review('TECH-03', 'Compare Technical Committees navigation and sitemap hierarchy for BIG Data, PHM, Reliability Science for Advanced Materials & Devices, System and Software Assurance, Systems of Systems, Trustworthy Computing and the newsletter duplicate. Review all linked parallel routes, body equivalence and canonical tags; Snapshot has no canonical or tree semantics. No SEO penalty is inferred.');
  get('TECH-03').pages = [{ key: 'primary', baselineURL: get('TECH-03').baselineURL, migratedURL: get('TECH-03').migratedURL }, sitemap];
  nonempty('TECH-03', 'sitemap');
  for (const slug of ['big-data','prognostics-and-health-management-phm','reliability-science-for-advanced-materials-devices','system-and-software-assurance','systems-of-systems','trustworthy-computing-and-cybersecurity']) {
    const old = oldSitemap.links.find(l => l.href.endsWith(`/${slug}.html`));
    const mapped = newSitemap.links.filter(l => l.href.endsWith(`/${slug}/`) || l.href.endsWith(`/${slug}-tc/`));
    assert.ok(old && mapped.length, `Missing mapped evidence for ${slug}`);
    add('TECH-03', 'requireLink', `Restore ${norm(old.text)} under Technical Committees`, { filter: { textIncludes: norm(old.text), hrefIncludes: '/technical-committees/' }, pageKey: 'primary' });
    for (const [i,l] of mapped.entries()) {
      const key = `${slug}-${i+1}`;
      get('TECH-03').pages.push({key,baselineURL:old.href,migratedURL:l.href});
      nonempty('TECH-03', key);
    }
  }
  const oldNewsletter = oldSitemap.links.find(l => l.href.endsWith('/publications/reliability-society-newsletter.html'));
  const newsletters = newSitemap.links.filter(l => l.href.endsWith('/reliability-society-newsletter/') || l.href.endsWith('/reliability-society-newsletter-ta/'));
  assert.ok(oldNewsletter && newsletters.length === 2, 'Both newsletter hierarchy routes required');
  for (const [i,l] of newsletters.entries()) {
    const key = `newsletter-${i+1}`;
    get('TECH-03').pages.push({key,baselineURL:oldNewsletter.href,migratedURL:l.href});
    nonempty('TECH-03', key);
  }
  for (const path of ['h1.fontSize','h1.fontWeight']) add('STYLE-01', 'compareMetric', `Keep sampled H1 ${path.split('.').at(-1)} near the baseline`, { path, relativeTolerance: 0.25, absoluteTolerance: 2 });
  review('STYLE-01', 'Use matched desktop captures with fonts settled. Numeric tolerances flag substantial differences only; judge hierarchy visually and do not extrapolate this single Technical Committees H1 to every site heading.');
  for (const id of ['STYLE-02','STYLE-03','STYLE-04']) {
    nonempty(id);
    add(id, 'overflow', 'Avoid materially worse page overflow during visual restoration', { maxExtraPixels: 20 });
  }
  review('STYLE-02', 'Compare complete AdCom table screenshots and cell rectangles for borders, column proportions and spacing. Snapshot does not provide border styles; overflow/content checks do not automate grid or proportion parity.');
  review('STYLE-03', 'Compare November 2015 cover placement, contents table and download order using image/table rectangles and screenshots. Entire Issue already remains above the cover. No numeric layout identity is claimed; other issues are outside this visual sample.');
  review('STYLE-04', 'Compare Wong and Yang image rectangles, natural dimensions and contact spacing. Both were enlarged; only Yang was browser-upscaled. Snapshot values support human comparison but no contract rule compares individual image sizes or sharpness.');
  const annual = oldSitemap.links.filter(l => l.href.includes('/annual-technical-reports/') && /^20(?:07|08|09|10|11)$/.test(l.text)).map(l => norm(l.text));
  assert.equal(annual.length, 5);
  add('NAV-01', 'orderedText', 'Restore descending annual-report order', { values: annual });
  review('NAV-01', 'Compare the full sitemap tree with the main navigation and all nine dated archive captions. Whole-text order cannot validate parent-child branches or repeated month labels. Owner approval may supersede baseline order.');
  for (const text of ['Editorial Board-RM','Editorial Board-TOR','Editorial Board-RNSI','Education-TC','Reliability Society Newsletter-TA','Systems of Systems \u2013 TC']) add('NAV-02', 'forbidLink', `Remove the public disambiguation suffix in ${text}`, { filter: { text } });
  review('NAV-02', 'Inspect exact public labels, branch context and the special-issue editorial browser title (RNSI). Do not forbid internal route slugs; the contract has no browser-title assertion. Confirm approved public naming.');

  const asset = get('ASSET-01');
  asset.pages = [await page('division', 'division'), await page('roadmap', 'roadmap'), await issue('2014-november'), await issue('2016-february')];
  for (const key of ['division','roadmap']) add('ASSET-01', 'legacyResources', 'Migrate loaded visible images off the legacy host', { hostname: 'rs.ieee.org', pageKey: key });
  for (const key of ['2014-november','2016-february']) {
    const capture = await browser(`reliability-special-issue-${key}-new`);
    for (const l of capture.links.filter(l => l.main && !norm(l.text) && l.href.startsWith('https://rs.ieee.org/images/'))) {
      add('ASSET-01', 'review', 'Optional cleanup of the residual empty legacy file anchor', { reason: `Optional cleanup: retention is allowed for the empty/line-break-only legacy anchor ${l.href}. This historical href is not a visible download action or a loaded-image dependency.`, pageKey: key });
    }
  }
  const congressOld = oldSitemap.links.find(l => /2024/.test(l.text) && /congress/i.test(l.text));
  const congressNew = newSitemap.links.find(l => /2024/.test(l.text) && /congress/i.test(l.text));
  assert.ok(congressOld && congressNew, 'Chapter Congress 2024 evidence URLs required');
  asset.pages.push({ key: 'congress-2024', baselineURL: congressOld.href, migratedURL: congressNew.href });
  add('ASSET-01', 'review', 'Optional cleanup of the residual empty Binghamton legacy anchor', { reason: 'Optional cleanup: retention is allowed for the empty/line-break-only legacy anchor on rs.ieee.org ending in /Binghamton.pptx. This historical href is not a visible download action or a loaded-image dependency.', pageKey: 'congress-2024' });
  review('ASSET-01', 'Inventory eight loaded images (seven Division VI logos and one Roadmap schedule image) separately from six empty/line-break-only hrefs. Confirm migrated images still render and the six labeled migrated downloads remain usable. Zero legacy images can also result from missing images, so inspect replacement completeness. Intentional retained hosting requires owner approval.');

  const external = links.candidateResults.map(c => ({ id: c.id, findingId: c.findingId, url: c.url,
    note: `Historical 2026-09-08 target inventory, not a current availability result. ${get(c.findingId).correction} Confirm an approved replacement or removal and recheck its destination.` }));
  for (const target of external) add(target.findingId, 'review', 'Use fresh destination evidence for this historical external target', { reason: `For ${target.url}, use the fresh destination check in src/run.mjs when the exact target remains a visible main-content link. A repaired original URL can satisfy availability without a catalog revision; historical failure does not permanently forbid it. Owner review applies only to replacement or removal semantics, including useful navigation and intended destination identity. Absence alone does not certify a replacement.` });
  for (const f of findings.filter(f => f.id.startsWith('LINK-'))) review(f.id, 'Compare current source/migrated anchors with the external target inventory. Use the runner\'s fresh destination check for any retained visible original target, including a repaired URL; no catalog revision is required for repair. Owner review applies only to replacement or removal semantics. Absence of the historical target alone does not establish useful replacement navigation. No historical migration causation, domain ownership or compromise is inferred.');

  // Review rules keep partial checks from silently certifying the whole finding.
  for (const f of findings) for (const reason of f.reviews) add(f.id, 'review', 'Review acceptance beyond the automated predicates', { reason });
  const historical = report.findings.flatMap(f => f.checks.map(c => ({
    id: `${f.id}-H${String(c.number).padStart(3, '0')}`, findingId: f.id,
    statement: c.statement, historicalStatus: c.status,
    note: `Historical traceability only; not a current test or result. ${c.note || ''} Parent correction: ${f.reportCorrection}`.trim(),
  })));
  const availability = report.availability.map(a => ({ id: a.id, url: a.requestedURL,
    expectedDocument: availabilityEvidence.targets.find(t => t.id === a.id).expectedDocument,
    historicalStatus: a.status, note: `Historical 2026-09-08 observation; recheck before acceptance. ${a.note}` }));
  const filePairs = files.pairs.map(p => ({ id: p.id, oldURL: p.oldURL, newURL: p.newURL,
    expectedOldHash: p.old.sha256, expectedNewHash: p.new.sha256,
    mode: p.dependencyComparisons ? 'package' : 'document-review',
    dependencies: (p.dependencyComparisons || []).map(d => {
      assert.equal(d.old.sha256, d.new.sha256, 'Only identified equal historical dependencies have one shared hash');
      return { oldURL: d.old.url, newURL: d.new.url, sha256: d.old.sha256 };
    }),
    note: p.dependencyComparisons
      ? 'Historical equality covers these identified complete dependency files only. Re-fetch both sides through EOF and compare hashes; shell HTML differs. Compare settled runtime content separately; this is not exhaustive interaction or pagination parity.'
      : 'Document review required: the article body was retained in the DOC-to-PDF conversion, but title and typesetting changed. Compare full extracted body, title, pagination and rendered pages; do not require raw-byte equality or declare the title change automatically approved.',
  }));
  const oldAwards = await browser('awards-old');
  const newAwards = await browser('awards-new');
  const awardSections = oldAwards.links.filter(l => l.main && new URL(l.href).hash && !['#','#top'].includes(new URL(l.href).hash));
  const newSections = newAwards.links.filter(l => l.main && new URL(l.href).hash && !['#','#top','#awards_header'].includes(new URL(l.href).hash));
  assert.equal(awardSections.length, 10);
  assert.equal(newSections.length, 10);
  const anchors = [{ id: 'awards-sections', baselineURL: oldAwards.url, migratedURL: newAwards.url, mode: 'sections',
    expectedSections: awardSections.map((l,i) => ({ label: norm(l.text), baselineFragment: new URL(l.href).hash, migratedFragment: new URL(newSections[i].href).hash })) },
  { id: 'awards-return-top', baselineURL: oldAwards.url, migratedURL: newAwards.url, mode: 'return-top', expectedSections: 10 },
  { id: 'past-networks-return-top', baselineURL: (await browser('past-networks-old')).url, migratedURL: (await browser('past-networks-new')).url, mode: 'return-top', expectedSections: 30 }];
  const result = { findings, availability, 'file-pairs': filePairs, 'historical-claims': historical, 'external-links': external, anchors };
  assert.equal(findings.length, 36);
  assert.equal(historical.length, 344);
  assert.equal(availability.length, 44);
  assert.equal(external.length, 11);
  assert.equal(filePairs.length, 5);
  assert.equal(filePairs.reduce((n,p) => n + p.dependencies.length, 0), 71);
  assert.ok(!/\b[A-Za-z]:[\\/]|file:\/\/|<\/?(?:html|body|script|div|a|p)\b|(?:password|authorization|cookie)\s*[=:]/i.test(JSON.stringify(result)), 'Unsafe fields in catalog export');
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sourceRoot = resolve(process.argv[2] || join(repo, '../reports/subpage-audit/revalidation-2026-09-08'));
  const data = await buildCatalog(sourceRoot);
  await mkdir(join(repo, 'catalog'), { recursive: true });
  for (const [name, value] of Object.entries(data)) await writeFile(join(repo, 'catalog', `${name}.json`), JSON.stringify(value, null, 2) + '\n');
  console.log(`Exported ${data.findings.length} findings and ${data['historical-claims'].length} historical claims into catalog/.`);
}
