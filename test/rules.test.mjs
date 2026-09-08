import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRule, validateRule } from '../src/rules.mjs';

const rule = (type, parameters = {}) => ({ id: 'fixture', label: 'Fixture check', type, ...parameters });
const link = (parameters = {}) => ({ text: 'Guide', href: 'https://example.org/guide.pdf', rawHref: '/guide.pdf', visible: true, inMain: true, ...parameters });
const image = (parameters = {}) => ({ src: 'https://legacy.example.org/a.png', currentSrc: 'https://legacy.example.org/a.png', alt: '', loaded: true, visible: true, inMain: true, width: 100, height: 100, naturalWidth: 100, naturalHeight: 100, x: 0, y: 0, ...parameters });
const snapshot = (parameters = {}) => ({
  requestedURL: 'https://example.org/', finalURL: 'https://example.org/',
  status: 'ready', httpStatus: 200, title: 'Fixture', mainText: 'Alpha beta\nGamma delta',
  mainHTML: '<main>Alpha beta\nGamma delta</main>', headings: [{ level: 1, text: 'Overview', id: 'overview' }],
  links: [link()], images: [], tables: [], metrics: { scrollWidth: 1000, clientWidth: 1000, overflow: 0, h1: { fontSize: 32, fontWeight: 700 } },
  artifacts: { screenshot: 'page.png', dom: 'page.html', json: 'page.json' }, timestamp: '2026-09-08T12:00:00Z', viewport: { width: 1440, height: 1000 },
  ...parameters,
});
const pair = (newParameters = {}, oldParameters = {}) => ({ old: snapshot(oldParameters), new: snapshot(newParameters) });

const validRules = [
  rule('requireText', { values: ['Alpha'] }), rule('forbidText', { values: ['Absent'] }),
  rule('orderedText', { values: ['Alpha', 'Gamma'] }), rule('requireLink', { filter: { text: 'Guide' } }),
  rule('forbidLink', { filter: { text: 'Absent' } }), rule('linkCount', { filter: {}, min: 1, max: 1 }),
  rule('requireHeading', { text: 'overview' }), rule('forbidHeading', { text: 'Absent' }),
  rule('mainNotEmpty', { minChars: 1 }), rule('mailtoCoverage', { addresses: ['a@example.org'] }),
  rule('legacyResources', { hostname: 'legacy.example.org' }), rule('overflow'),
  rule('compareMetric', { path: 'h1.fontSize' }), rule('review', { reason: 'Inspect diagram' }),
];

for (const candidate of validRules) {
  test(`validateRule accepts ${candidate.type}`, () => assert.deepEqual(validateRule(candidate), []));
  test(`${candidate.type} produces a serializable result envelope`, () => {
    const result = evaluateRule(candidate, pair());
    assert.equal(result.id, candidate.id);
    assert.equal(result.label, candidate.label);
    assert.ok(['pass', 'fail', 'blocked', 'review', 'error'].includes(result.status));
    assert.ok(Object.hasOwn(result, 'expected'));
    assert.ok(Object.hasOwn(result, 'actual'));
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  });
}

const cases = [
  ['requireText normalizes whitespace and case', rule('requireText', { values: [' ALPHA\t beta ', 'gamma\nDELTA'] }), pair(), 'pass'],
  ['requireText requires every value', rule('requireText', { values: ['Alpha', 'missing'] }), pair(), 'fail'],
  ['requireText respects caseSensitive', rule('requireText', { values: ['alpha'], caseSensitive: true }), pair(), 'fail'],
  ['forbidText passes absent text', rule('forbidText', { values: ['Absent'] }), pair(), 'pass'],
  ['forbidText rejects any present value', rule('forbidText', { values: ['Absent', 'BETA'] }), pair(), 'fail'],
  ['forbidText respects caseSensitive', rule('forbidText', { values: ['ALPHA'], caseSensitive: true }), pair(), 'pass'],
  ['normalization does not invent word separators', rule('requireText', { values: ['Alpha beta'] }), pair({ mainText: 'Alphabeta' }), 'fail'],
  ['normalization preserves meaningful joined words', rule('requireText', { values: ['Alphabeta'] }), pair({ mainText: 'Alphabeta' }), 'pass'],
  ['normalization does not delete actual separators', rule('requireText', { values: ['Alphabeta'] }), pair({ mainText: 'Alpha\nbeta' }), 'fail'],
  ['regex punctuation is literal', rule('requireText', { values: ['a.*[b](c)?$\\d'] }), pair({ mainText: 'a.*[b](c)?$\\d' }), 'pass'],
  ['regex punctuation cannot match arbitrary text', rule('requireText', { values: ['.*'] }), pair(), 'fail'],
  ['code-shaped strings are literal', rule('requireText', { values: ["'; throw new Error('executed'); //"] }), pair({ mainText: "'; throw new Error('executed'); //" }), 'pass'],
  ['orderedText matches case-insensitive sequence', rule('orderedText', { values: ['alpha', 'BETA', 'gamma'] }), pair(), 'pass'],
  ['orderedText rejects reversed sequence', rule('orderedText', { values: ['Gamma', 'Alpha'] }), pair(), 'fail'],
  ['orderedText requires distinct repeated occurrences', rule('orderedText', { values: ['Alpha', 'Alpha'] }), pair(), 'fail'],
  ['orderedText accepts repeated occurrences', rule('orderedText', { values: ['Alpha', 'Alpha'] }), pair({ mainText: 'Alpha then alpha' }), 'pass'],
  ['requireLink matches exact text', rule('requireLink', { filter: { text: 'Guide' } }), pair(), 'pass'],
  ['requireLink ANDs every criterion', rule('requireLink', { filter: { text: 'Guide', textIncludes: 'uid', href: 'https://example.org/guide.pdf', hrefIncludes: 'example.org', hrefEndsWith: '/guide.pdf', protocol: 'https:' } }), pair(), 'pass'],
  ['requireLink rejects partial filter matches', rule('requireLink', { filter: { text: 'Guide', hrefIncludes: 'other.org' } }), pair(), 'fail'],
  ['requireLink excludes hidden by default', rule('requireLink', { filter: { text: 'Guide' } }), pair({ links: [link({ visible: false })] }), 'fail'],
  ['requireLink excludes shell by default', rule('requireLink', { filter: { text: 'Guide' } }), pair({ links: [link({ inMain: false })] }), 'fail'],
  ['requireLink explicit scope includes shell', rule('requireLink', { filter: { text: 'Guide' }, scope: 'all' }), pair({ links: [link({ inMain: false })] }), 'pass'],
  ['requireLink visible false includes hidden', rule('requireLink', { filter: { text: 'Guide' }, visible: false }), pair({ links: [link({ visible: false })] }), 'pass'],
  ['requireLink exact href is not rewritten', rule('requireLink', { filter: { href: '/guide.pdf' } }), pair(), 'fail'],
  ['requireLink explicitly matches relative suffix', rule('requireLink', { filter: { hrefEndsWith: '/guide.pdf' } }), pair(), 'pass'],
  ['requireLink suffix does not discard query', rule('requireLink', { filter: { hrefEndsWith: '.pdf' } }), pair({ links: [link({ href: 'https://example.org/a.pdf?q=1' })] }), 'fail'],
  ['requireLink text normalizes whitespace', rule('requireLink', { filter: { text: 'User Guide' } }), pair({ links: [link({ text: ' User\nGuide ' })] }), 'pass'],
  ['requireLink text is case-insensitive', rule('requireLink', { filter: { text: 'GUIDE' } }), pair(), 'pass'],
  ['requireLink href remains case-sensitive', rule('requireLink', { filter: { hrefIncludes: 'GUIDE.pdf' } }), pair(), 'fail'],
  ['protocol accepts colonless input', rule('requireLink', { filter: { protocol: 'HTTPS' } }), pair(), 'pass'],
  ['protocol does not guess relative URL base', rule('requireLink', { filter: { protocol: 'https' } }), pair({ links: [link({ href: '/guide.pdf' })] }), 'fail'],
  ['forbidLink passes absent links', rule('forbidLink', { filter: { text: 'Absent' } }), pair(), 'pass'],
  ['forbidLink rejects visible anchor', rule('forbidLink', { filter: { text: 'Guide' } }), pair(), 'fail'],
  ['forbidLink ignores invisible anchor', rule('forbidLink', { filter: { text: 'Guide' } }), pair({ links: [link({ visible: false })] }), 'pass'],
  ['forbidLink ignores empty rawHref leftovers', rule('forbidLink', { filter: { text: 'Guide' } }), pair({ links: [link({ rawHref: '' })] }), 'pass'],
  ['forbidLink ignores whitespace href leftovers', rule('forbidLink', { filter: { text: 'Guide' } }), pair({ links: [link({ rawHref: '  ', href: 'https://example.org/' })] }), 'pass'],
  ['forbidLink ignores empty resolved href', rule('forbidLink', { filter: { text: 'Guide' } }), pair({ links: [link({ href: '' })] }), 'pass'],
  ['linkCount obeys inclusive min/max', rule('linkCount', { filter: {}, min: 1, max: 2 }), pair(), 'pass'],
  ['linkCount fails below minimum', rule('linkCount', { filter: {}, min: 2 }), pair(), 'fail'],
  ['linkCount fails above maximum', rule('linkCount', { filter: {}, max: 0 }), pair(), 'fail'],
  ['linkCount can assert zero', rule('linkCount', { filter: {}, min: 0, max: 0 }), pair({ links: [] }), 'pass'],
  ['requireLink honors explicit minimum', rule('requireLink', { filter: { text: 'Guide' }, min: 2 }), pair(), 'fail'],
  ['forbidLink honors explicit maximum', rule('forbidLink', { filter: { text: 'Guide' }, max: 1 }), pair(), 'pass'],
  ['heading exact match is case-insensitive', rule('requireHeading', { text: 'OVERVIEW' }), pair(), 'pass'],
  ['heading exact is the default', rule('requireHeading', { text: 'Over' }), pair(), 'fail'],
  ['heading partial match is explicit', rule('requireHeading', { text: 'Over', exact: false }), pair(), 'pass'],
  ['heading level must match', rule('requireHeading', { text: 'Overview', level: 2 }), pair(), 'fail'],
  ['heading whitespace is normalized', rule('requireHeading', { text: ' Main Overview ', level: 2 }), pair({ headings: [{ level: 2, text: 'Main\nOverview', id: '' }] }), 'pass'],
  ['forbidHeading rejects matching heading', rule('forbidHeading', { text: 'overview' }), pair(), 'fail'],
  ['forbidHeading accepts absent heading', rule('forbidHeading', { text: 'Other' }), pair(), 'pass'],
  ['requireHeading fails empty headings', rule('requireHeading', { text: 'Overview' }), pair({ headings: [] }), 'fail'],
  ['mainNotEmpty uses default 80 non-whitespace chars', rule('mainNotEmpty'), pair({ mainText: 'a'.repeat(80) }), 'pass'],
  ['mainNotEmpty excludes whitespace', rule('mainNotEmpty'), pair({ mainText: ` ${'a'.repeat(79)} \t\n` }), 'fail'],
  ['mainNotEmpty fails empty content', rule('mainNotEmpty'), pair({ mainText: '', mainHTML: '' }), 'fail'],
  ['mainNotEmpty respects custom boundary', rule('mainNotEmpty', { minChars: 3 }), pair({ mainText: 'a b\nc' }), 'pass'],
  ['mailtoCoverage decodes exact recipients and ignores queries', rule('mailtoCoverage', { addresses: ['a@example.org', 'b@example.org'] }), pair({ links: [link({ href: 'MAILTO:a%40example.org,b@example.org?subject=hello&cc=c@example.org' })] }), 'pass'],
  ['mailtoCoverage recipient comparison is case-insensitive', rule('mailtoCoverage', { addresses: ['A@EXAMPLE.ORG'] }), pair({ links: [link({ href: 'mailto:a@example.org' })] }), 'pass'],
  ['mailtoCoverage labels do not prove mail links', rule('mailtoCoverage', { addresses: ['a@example.org'] }), pair({ links: [link({ text: 'a@example.org' })] }), 'fail'],
  ['mailtoCoverage rejects partial recipient', rule('mailtoCoverage', { addresses: ['a@example.org'] }), pair({ links: [link({ href: 'mailto:extra@example.org' })] }), 'fail'],
  ['mailtoCoverage ignores recipients in queries', rule('mailtoCoverage', { addresses: ['a@example.org'] }), pair({ links: [link({ href: 'mailto:b@example.org?to=a@example.org' })] }), 'fail'],
  ['mailtoCoverage ignores malformed percent escapes', rule('mailtoCoverage', { addresses: ['a@example.org'] }), pair({ links: [link({ href: 'mailto:a@example.org,%ZZ' })] }), 'fail'],
  ['mailtoCoverage rejects decoded newline injection', rule('mailtoCoverage', { addresses: ['a@example.org'] }), pair({ links: [link({ href: 'mailto:a@example.org%0A' })] }), 'fail'],
  ['mailtoCoverage decodes encoded recipient separator', rule('mailtoCoverage', { addresses: ['a@example.org', 'b@example.org'] }), pair({ links: [link({ href: 'mailto:a%40example.org%2Cb%40example.org' })] }), 'pass'],
  ['mailtoCoverage preserves plus in recipient', rule('mailtoCoverage', { addresses: ['a+b@example.org'] }), pair({ links: [link({ href: 'mailto:a+b@example.org' })] }), 'pass'],
  ['mailtoCoverage ignores hidden and shell links', rule('mailtoCoverage', { addresses: ['a@example.org'] }), pair({ links: [link({ href: 'mailto:a@example.org', visible: false }), link({ href: 'mailto:a@example.org', inMain: false })] }), 'fail'],
  ['mailtoCoverage accepts explicitly broadened scope', rule('mailtoCoverage', { addresses: ['a@example.org'], scope: 'all', visible: false }), pair({ links: [link({ href: 'mailto:a@example.org', visible: false, inMain: false })] }), 'pass'],
  ['legacyResources accepts no images', rule('legacyResources', { hostname: 'legacy.example.org' }), pair(), 'pass'],
  ['legacyResources rejects rendered legacy image', rule('legacyResources', { hostname: 'legacy.example.org' }), pair({ images: [image()] }), 'fail'],
  ['legacyResources ignores hidden unloaded shell images', rule('legacyResources', { hostname: 'legacy.example.org' }), pair({ images: [image({ visible: false }), image({ loaded: false }), image({ inMain: false })] }), 'pass'],
  ['legacyResources requires exact hostname', rule('legacyResources', { hostname: 'legacy.example.org' }), pair({ images: [image({ currentSrc: 'https://legacy.example.org.evil.test/a.png' }), image({ currentSrc: 'https://sub.legacy.example.org/a.png' })] }), 'pass'],
  ['legacyResources ignores port and hostname case', rule('legacyResources', { hostname: 'LEGACY.EXAMPLE.ORG' }), pair({ images: [image({ currentSrc: 'https://legacy.example.org:8443/a.png' })] }), 'fail'],
  ['legacyResources uses rendered currentSrc', rule('legacyResources', { hostname: 'legacy.example.org' }), pair({ images: [image({ currentSrc: 'https://new.example.org/a.png' })] }), 'pass'],
  ['legacyResources falls back to src', rule('legacyResources', { hostname: 'legacy.example.org' }), pair({ images: [image({ currentSrc: '' })] }), 'fail'],
  ['legacyResources does not count anchors', rule('legacyResources', { hostname: 'legacy.example.org' }), pair({ links: [link({ href: 'https://legacy.example.org/a.pdf' })] }), 'pass'],
  ['overflow allows threshold boundary', rule('overflow'), pair({ metrics: { overflow: 30 } }, { metrics: { overflow: 10 } }), 'pass'],
  ['overflow fails excess increase', rule('overflow'), pair({ metrics: { overflow: 31 } }, { metrics: { overflow: 10 } }), 'fail'],
  ['overflow accepts improvements', rule('overflow', { maxExtraPixels: 0 }), pair({ metrics: { overflow: 0 } }, { metrics: { overflow: 100 } }), 'pass'],
  ['compareMetric allows relative boundary', rule('compareMetric', { path: 'h1.fontSize' }), pair({ metrics: { h1: { fontSize: 40 } } }), 'pass'],
  ['compareMetric fails beyond tolerance', rule('compareMetric', { path: 'h1.fontSize' }), pair({ metrics: { h1: { fontSize: 41 } } }), 'fail'],
  ['compareMetric checks decreases too', rule('compareMetric', { path: 'h1.fontSize' }), pair({ metrics: { h1: { fontSize: 23 } } }), 'fail'],
  ['compareMetric uses absolute tolerance near zero', rule('compareMetric', { path: 'overflow' }), pair({ metrics: { overflow: 2 } }), 'pass'],
  ['compareMetric fails beyond absolute tolerance', rule('compareMetric', { path: 'overflow' }), pair({ metrics: { overflow: 3 } }), 'fail'],
  ['compareMetric supports negative baseline magnitude', rule('compareMetric', { path: 'custom', absoluteTolerance: 0 }), pair({ metrics: { custom: -125 } }, { metrics: { custom: -100 } }), 'pass'],
  ['compareMetric zero tolerances require equality', rule('compareMetric', { path: 'overflow', relativeTolerance: 0, absoluteTolerance: 0 }), pair({ metrics: { overflow: 0.01 } }), 'fail'],
  ['review always requests review without snapshots', rule('review', { reason: 'Inspect chart' }), {}, 'review'],
  ['review stays review with blocked snapshots', rule('review', { reason: 'Inspect chart' }), pair({ status: 'blocked' }), 'review'],
  ['only new snapshot required for text rules', rule('requireText', { values: ['Alpha'] }), { new: snapshot() }, 'pass'],
  ['unavailable old snapshot does not block new-only rules', rule('requireText', { values: ['Alpha'] }), pair({}, { status: 'blocked' }), 'pass'],
  ['forbidText blocks empty main root', rule('forbidText', { values: ['Absent'] }), pair({ mainText: '', mainHTML: '' }), 'blocked'],
  ['forbidText blocks whitespace-only main text', rule('forbidText', { values: ['Absent'] }), pair({ mainText: ' \n\t' }), 'blocked'],
  ['forbidLink blocks missing main root', rule('forbidLink', { filter: { text: 'Absent' } }), pair({ mainText: '', mainHTML: '' }), 'blocked'],
  ['scope all does not require main root', rule('requireLink', { filter: { text: 'Guide' }, scope: 'all' }), pair({ mainText: '', mainHTML: '' }), 'pass'],
];
for (const [name, candidate, snapshots, status] of cases) {
  test(name, () => assert.equal(evaluateRule(candidate, snapshots).status, status));
}

const malformedRules = [
  null, [], 'requireText', {}, rule('unknown'), rule('__proto__'), rule('constructor'),
  { ...rule('review', { reason: 'Review' }), id: '' }, { ...rule('review', { reason: 'Review' }), label: null },
  rule('review', { reason: '' }), rule('review', { reason: 2 }),
  rule('requireText'), rule('requireText', { values: [] }), rule('forbidText', { values: [''] }),
  rule('orderedText', { values: [' \n'] }), rule('requireText', { values: [7] }),
  rule('requireText', { values: ['Alpha'], caseSensitive: 'false' }),
  rule('requireLink'), rule('requireLink', { filter: null }), rule('requireLink', { filter: [] }),
  rule('requireLink', { filter: {} }), rule('forbidLink', { filter: {} }),
  rule('requireLink', { filter: { typo: 'Guide' } }), rule('requireLink', { filter: { text: 1 } }),
  rule('requireLink', { filter: { text: 'Guide', href: '' } }),
  rule('requireLink', { filter: { protocol: 'https://' } }),
  rule('requireLink', { filter: { text: 'Guide' }, scope: 'main' }),
  rule('requireLink', { filter: { text: 'Guide' }, visible: 'false' }),
  rule('linkCount', { filter: {}, min: -1 }), rule('linkCount', { filter: {}, max: 0.5 }),
  rule('linkCount', { filter: {}, min: 2, max: 1 }), rule('linkCount', { filter: {} }),
  rule('requireHeading', { text: '' }), rule('requireHeading', { text: 'Overview', level: 0 }),
  rule('requireHeading', { text: 'Overview', level: 7 }), rule('requireHeading', { text: 'Overview', exact: 'yes' }),
  rule('mainNotEmpty', { minChars: -1 }), rule('mainNotEmpty', { minChars: 1.5 }),
  rule('mailtoCoverage', { addresses: [] }), rule('mailtoCoverage', { addresses: ['not-email'] }),
  rule('mailtoCoverage', { addresses: ['a@example.org?subject=x'] }), rule('mailtoCoverage', { addresses: ['a@example.org,b@example.org'] }),
  rule('legacyResources', { hostname: '' }), rule('legacyResources', { hostname: 'https://legacy.example.org' }),
  rule('legacyResources', { hostname: 'legacy.example.org:443' }), rule('legacyResources', { hostname: '*.example.org' }),
  rule('compareMetric', { path: '' }), rule('compareMetric', { path: 'h1..fontSize' }),
  rule('compareMetric', { path: '__proto__.x' }), rule('compareMetric', { path: 'constructor.prototype' }),
  rule('compareMetric', { path: 'h1.fontSize', relativeTolerance: -1 }),
  rule('compareMetric', { path: 'h1.fontSize', absoluteTolerance: '2' }),
  rule('overflow', { maxExtraPixels: -1 }), rule('overflow', { maxExtraPixels: null }),
  rule('review', { reason: 'Inspect', viewport: 'tablet' }), rule('review', { reason: 'Inspect', pageKey: '' }),
  rule('requireText', { values: ['Alpha'], typo: true }),
];
for (const [index, candidate] of malformedRules.entries()) {
  test(`malformed rule ${index} returns validation messages and error even without evidence`, () => {
    const messages = validateRule(candidate);
    assert.ok(Array.isArray(messages));
    assert.ok(messages.length > 0);
    assert.ok(messages.every(message => typeof message === 'string' && message.length > 0));
    assert.equal(evaluateRule(candidate, {}).status, 'error');
  });
}

for (const candidate of validRules.filter(item => item.type !== 'review')) {
  for (const state of ['blocked', 'missing', 'error', 'unexpected']) {
    test(`${candidate.type} blocks ${state} snapshot`, () => assert.equal(evaluateRule(candidate, pair({ status: state })).status, 'blocked'));
  }
  for (const httpStatus of [404, 500, 403, 0, null]) {
    test(`${candidate.type} blocks HTTP ${httpStatus}`, () => assert.equal(evaluateRule(candidate, pair({ httpStatus })).status, 'blocked'));
  }
  test(`${candidate.type} blocks missing new snapshot`, () => assert.equal(evaluateRule(candidate, { old: snapshot() }).status, 'blocked'));
}

for (const type of ['overflow', 'compareMetric']) {
  const candidate = rule(type, type === 'compareMetric' ? { path: 'h1.fontSize' } : {});
  test(`${type} requires old snapshot`, () => assert.equal(evaluateRule(candidate, { new: snapshot() }).status, 'blocked'));
  test(`${type} blocks old HTTP 404`, () => assert.equal(evaluateRule(candidate, pair({}, { httpStatus: 404 })).status, 'blocked'));
  for (const value of [null, '32', {}, NaN, Infinity, -Infinity]) {
    for (const side of ['old', 'new']) {
      test(`${type} blocks ${side} nonnumeric ${String(value)}`, () => {
        const snapshots = pair();
        snapshots[side].metrics = { overflow: value, h1: { fontSize: value } };
        assert.equal(evaluateRule(candidate, snapshots).status, 'blocked');
      });
    }
  }
  test(`${type} blocks missing metric path`, () => assert.equal(evaluateRule(candidate, pair({ metrics: {} })).status, 'blocked'));
}

for (const [candidate, field] of [
  [rule('forbidText', { values: ['Absent'] }), 'mainText'],
  [rule('mainNotEmpty'), 'mainText'], [rule('forbidLink', { filter: { text: 'Absent' } }), 'links'],
  [rule('forbidHeading', { text: 'Absent' }), 'headings'],
  [rule('legacyResources', { hostname: 'legacy.example.org' }), 'images'],
  [rule('mailtoCoverage', { addresses: ['a@example.org'] }), 'links'],
]) {
  test(`${candidate.type} blocks missing ${field}`, () => {
    const snapshots = pair();
    delete snapshots.new[field];
    assert.equal(evaluateRule(candidate, snapshots).status, 'blocked');
  });
  test(`${candidate.type} blocks malformed ${field}`, () => assert.equal(evaluateRule(candidate, pair({ [field]: 7 })).status, 'blocked'));
}

for (const [type, parameters, field] of [
  ['forbidLink', { filter: { text: 'Absent' } }, 'links'],
  ['forbidHeading', { text: 'Absent' }, 'headings'],
  ['legacyResources', { hostname: 'legacy.example.org' }, 'images'],
]) {
  test(`${type} blocks malformed entries instead of proving absence`, () => assert.equal(evaluateRule(rule(type, parameters), pair({ [field]: [null] })).status, 'blocked'));
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

test('all evaluations and validation preserve deeply frozen JSON inputs', () => {
  for (const candidate of [...validRules, ...malformedRules]) {
    const snapshots = deepFreeze(pair());
    deepFreeze(candidate);
    const before = JSON.stringify({ candidate, snapshots });
    validateRule(candidate);
    const first = evaluateRule(candidate, snapshots);
    assert.deepEqual(evaluateRule(candidate, snapshots), first);
    assert.equal(JSON.stringify({ candidate, snapshots }), before);
  }
});

test('review note preserves its reason', () => assert.equal(evaluateRule(rule('review', { reason: 'Inspect chart' }), {}).note, 'Inspect chart'));
test('omitted snapshot argument is blocked', () => assert.equal(evaluateRule(validRules[0]).status, 'blocked'));

for (const control of ['\u0000', '\u001b', '\u007f']) {
  test(`mailto rule rejects control character ${control.charCodeAt(0)}`, () => {
    const candidate = rule('mailtoCoverage', { addresses: [`a${control}@example.org`] });
    assert.ok(validateRule(candidate).length > 0);
    assert.equal(evaluateRule(candidate, pair()).status, 'error');
  });
  test(`mailto decoding rejects control character ${control.charCodeAt(0)}`, () => {
    const snapshots = pair({ links: [link({ href: `mailto:a@example.org,b${encodeURIComponent(control)}@example.org` })] });
    assert.equal(evaluateRule(rule('mailtoCoverage', { addresses: ['a@example.org'] }), snapshots).status, 'fail');
  });
}
