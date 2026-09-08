const parameters = {
  requireText: ['values', 'caseSensitive'],
  forbidText: ['values', 'caseSensitive'],
  orderedText: ['values'],
  requireLink: ['filter', 'scope', 'visible', 'min', 'max'],
  forbidLink: ['filter', 'scope', 'visible', 'min', 'max'],
  linkCount: ['filter', 'scope', 'visible', 'min', 'max'],
  requireHeading: ['text', 'level', 'exact'],
  forbidHeading: ['text', 'level', 'exact'],
  mainNotEmpty: ['minChars'],
  mailtoCoverage: ['addresses', 'scope', 'visible'],
  legacyResources: ['hostname'],
  overflow: ['maxExtraPixels'],
  compareMetric: ['path', 'relativeTolerance', 'absoluteTolerance'],
  review: ['reason'],
};
const common = ['id', 'type', 'label', 'pageKey', 'viewport'];
const filterFields = ['text', 'textIncludes', 'href', 'hrefIncludes', 'hrefEndsWith', 'protocol'];
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = value => typeof value === 'string' && value.trim().length > 0;
const normalize = (value, caseSensitive = false) => {
  const text = value.replace(/\s+/gu, ' ').trim();
  return caseSensitive ? text : text.toLowerCase();
};
const isNumber = value => typeof value === 'number' && Number.isFinite(value);
const isAddress = value => typeof value === 'string' && !/[\u0000-\u001f\u007f]/u.test(value)
  && /^[^\s@,;?&#%<>]+@[^\s@,;?&#%<>]+\.[^\s@,;?&#%<>]+$/u.test(value);
const isHostname = value => isText(value) && value.length <= 253 && value.split('.').every(part =>
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(part));
const isMetricPath = value => isText(value) && value.split('.').every(part =>
  /^[a-zA-Z_$][\w$]*$/u.test(part) && !['__proto__', 'constructor', 'prototype'].includes(part));

/**
 * Validate one JSON Rule without mutation or throwing; returns string[] (empty
 * means valid). Rejects unknown parameters as well as unknown types, so typos
 * cannot silently weaken checks. Finding-level ID uniqueness belongs to callers.
 * Empty filters are allowed only for linkCount with an explicit min or max.
 */
export function validateRule(rule) {
  if (!isObject(rule)) return ['Rule must be an object.'];
  const errors = [];
  const require = (valid, message) => { if (!valid) errors.push(message); };
  for (const field of ['id', 'type', 'label']) require(isText(rule[field]), `${field} must be a nonempty string.`);
  if (typeof rule.type !== 'string' || !Object.hasOwn(parameters, rule.type)) {
    errors.push('Unknown rule type.');
    return errors;
  }
  const allowed = [...common, ...parameters[rule.type]];
  for (const field of Object.keys(rule)) require(allowed.includes(field), `Unknown parameter: ${field}.`);
  if (Object.hasOwn(rule, 'pageKey')) require(isText(rule.pageKey), 'pageKey must be a nonempty string.');
  if (Object.hasOwn(rule, 'viewport')) require(['desktop', 'mobile'].includes(rule.viewport), 'viewport must be desktop or mobile.');
  for (const field of ['caseSensitive', 'exact', 'visible']) {
    if (Object.hasOwn(rule, field)) require(typeof rule[field] === 'boolean', `${field} must be boolean.`);
  }
  if (Object.hasOwn(rule, 'scope')) require(rule.scope === 'all', 'scope must be all when specified.');
  for (const field of ['min', 'max', 'minChars', 'relativeTolerance', 'absoluteTolerance', 'maxExtraPixels']) {
    if (!Object.hasOwn(rule, field)) continue;
    const integer = ['min', 'max', 'minChars'].includes(field);
    require(isNumber(rule[field]) && rule[field] >= 0 && (!integer || Number.isSafeInteger(rule[field])),
      `${field} must be a finite nonnegative ${integer ? 'integer' : 'number'}.`);
  }
  if (Object.hasOwn(rule, 'min') && Object.hasOwn(rule, 'max')) require(rule.min <= rule.max, 'min must not exceed max.');
  if (parameters[rule.type].includes('values')) {
    require(Array.isArray(rule.values) && rule.values.length > 0 && rule.values.every(isText), 'values must be a nonempty array of nonempty strings.');
  }
  if (parameters[rule.type].includes('filter')) {
    if (!isObject(rule.filter)) errors.push('filter must be an object.');
    else {
      require(rule.type === 'linkCount' || Object.keys(rule.filter).length > 0, 'filter must contain at least one criterion.');
      for (const [field, value] of Object.entries(rule.filter)) {
        require(filterFields.includes(field), `Unknown filter criterion: ${field}.`);
        require(isText(value), `filter.${field} must be a nonempty string.`);
      }
      if (Object.hasOwn(rule.filter, 'protocol')) {
        require(typeof rule.filter.protocol === 'string' && /^[a-z][a-z0-9+.-]*:?$/iu.test(rule.filter.protocol), 'filter.protocol must be a scheme with an optional colon.');
      }
    }
    if (rule.type === 'linkCount') require(Object.hasOwn(rule, 'min') || Object.hasOwn(rule, 'max'), 'linkCount requires min or max.');
    const min = rule.min ?? (rule.type === 'requireLink' ? 1 : 0);
    const max = rule.max ?? (rule.type === 'forbidLink' ? 0 : Infinity);
    require(min <= max, 'Effective minimum must not exceed maximum.');
  }
  if (parameters[rule.type].includes('text')) {
    require(isText(rule.text), 'text must be a nonempty string.');
    if (Object.hasOwn(rule, 'level')) require(Number.isInteger(rule.level) && rule.level >= 1 && rule.level <= 6, 'level must be an integer from 1 to 6.');
  }
  if (rule.type === 'mailtoCoverage') require(Array.isArray(rule.addresses) && rule.addresses.length > 0 && rule.addresses.every(isAddress), 'addresses must contain exact email addresses without queries.');
  if (rule.type === 'legacyResources') require(isHostname(rule.hostname), 'hostname must be a hostname without a scheme, port, path or wildcard.');
  if (rule.type === 'compareMetric') require(isMetricPath(rule.path), 'path must be a safe dotted property path under metrics.');
  if (rule.type === 'review') require(isText(rule.reason), 'reason must be a nonempty string.');
  return errors;
}

function unavailable(snapshot, side) {
  if (!isObject(snapshot) || snapshot.status !== 'ready') return `${side} snapshot is unavailable.`;
  if (!Number.isInteger(snapshot.httpStatus) || snapshot.httpStatus < 200 || snapshot.httpStatus >= 300) {
    return `${side} snapshot does not have a successful HTTP status.`;
  }
  return null;
}

const hasRoot = snapshot => isText(snapshot.mainText) || isText(snapshot.mainHTML);
const validLinks = links => Array.isArray(links) && links.every(item => isObject(item)
  && ['text', 'href', 'rawHref'].every(key => typeof item[key] === 'string')
  && typeof item.visible === 'boolean' && typeof item.inMain === 'boolean');
const validHeadings = headings => Array.isArray(headings) && headings.every(item => isObject(item)
  && typeof item.text === 'string' && Number.isInteger(item.level) && item.level >= 1 && item.level <= 6);
const validImages = images => Array.isArray(images) && images.every(item => isObject(item)
  && typeof item.src === 'string' && typeof item.currentSrc === 'string'
  && ['visible', 'loaded', 'inMain'].every(key => typeof item[key] === 'boolean'));
const scopedLinks = (links, rule) => links.filter(item => isText(item.rawHref) && isText(item.href)
  && (rule.visible === false || item.visible) && (rule.scope === 'all' || item.inMain));

function matchesLink(link, filter) {
  return Object.entries(filter).every(([key, value]) => {
    switch (key) {
      case 'text': return normalize(link.text) === normalize(value);
      case 'textIncludes': return normalize(link.text).includes(normalize(value));
      case 'href': return link.href === value;
      case 'hrefIncludes': return link.href.includes(value);
      case 'hrefEndsWith': return link.href.endsWith(value);
      case 'protocol': {
        try { return new URL(link.href).protocol === `${value.replace(/:$/u, '').toLowerCase()}:`; }
        catch { return false; }
      }
    }
  });
}

function mailRecipients(href) {
  if (!/^mailto:/iu.test(href)) return [];
  try {
    const decoded = decodeURIComponent(href.slice(7).split('?')[0]);
    const recipients = decoded.split(',');
    return recipients.every(isAddress) ? recipients.map(address => address.toLowerCase()) : [];
  } catch { return []; }
}

function metric(snapshot, path) {
  let value = snapshot.metrics;
  for (const key of path.split('.')) {
    if (!isObject(value) || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}

/**
 * Evaluate a Rule against immutable JSON {old, new} snapshots, synchronously and
 * without I/O. Invalid rules yield error before evidence checks; unavailable or
 * malformed required evidence yields blocked. A valid review always yields review.
 * Text and heading comparisons normalize existing whitespace, never insert word
 * boundaries. Text/link labels are case-insensitive; href comparisons are literal.
 * legacyResources requires zero visible, loaded, in-main images on the hostname.
 * compareMetric allows |new-old| <= max(absoluteTolerance, |old|*relativeTolerance).
 * Empty main text blocks text absence/presence checks; mainNotEmpty instead fails
 * its threshold. Empty arrays are valid evidence if the required root is present.
 * expected/actual are JSON-safe descriptions or observed values; note explains
 * blocked/error/review outcomes. No result retains mutable references to inputs.
 */
export function evaluateRule(rule, snapshots = {}) {
  const errors = validateRule(rule);
  const result = (status, expected, actual, note) => ({
    id: typeof rule?.id === 'string' ? rule.id : null,
    label: typeof rule?.label === 'string' ? rule.label : null,
    status, expected, actual, ...(note === undefined ? {} : { note }),
  });
  if (errors.length) return result('error', 'A valid rule', null, errors.join(' '));
  const expected = `${rule.type}: ${JSON.stringify(Object.fromEntries(parameters[rule.type]
    .filter(key => Object.hasOwn(rule, key)).map(key => [key, rule[key]])))}`;
  const blocked = note => result('blocked', expected, null, note);
  const checked = (passes, actual) => result(passes ? 'pass' : 'fail', expected, actual);
  if (rule.type === 'review') return result('review', expected, null, rule.reason);
  const current = snapshots?.new;
  const previous = snapshots?.old;
  const problem = unavailable(current, 'new');
  if (problem) return blocked(problem);
  if (['overflow', 'compareMetric'].includes(rule.type)) {
    const oldProblem = unavailable(previous, 'old');
    if (oldProblem) return blocked(oldProblem);
    const path = rule.type === 'overflow' ? 'overflow' : rule.path;
    const oldValue = metric(previous, path);
    const newValue = metric(current, path);
    if (!isNumber(oldValue) || !isNumber(newValue)) return blocked(`Both snapshots require a finite numeric metrics.${path}.`);
    const tolerance = rule.type === 'overflow' ? (rule.maxExtraPixels ?? 20)
      : Math.max(rule.absoluteTolerance ?? 2, Math.abs(oldValue) * (rule.relativeTolerance ?? 0.25));
    const difference = rule.type === 'overflow' ? newValue - oldValue : Math.abs(newValue - oldValue);
    if (!Number.isFinite(tolerance) || !Number.isFinite(difference)) return blocked('Metric arithmetic exceeds the finite numeric range.');
    return checked(difference <= tolerance, { old: oldValue, new: newValue, difference, tolerance });
  }
  if (['requireText', 'forbidText', 'orderedText', 'mainNotEmpty'].includes(rule.type)) {
    if (typeof current.mainText !== 'string') return blocked('Main text is missing or malformed.');
    if (rule.type === 'mainNotEmpty') {
      const count = current.mainText.replace(/\s/gu, '').length;
      return checked(count >= (rule.minChars ?? 80), count);
    }
    if (!isText(current.mainText)) return blocked('Required main text is empty.');
    const text = normalize(current.mainText, rule.caseSensitive);
    const values = rule.values.map(value => normalize(value, rule.caseSensitive));
    if (rule.type === 'orderedText') {
      let cursor = 0;
      const positions = [];
      for (const value of values) {
        const index = text.indexOf(value, cursor);
        positions.push(index);
        if (index < 0) return checked(false, positions);
        cursor = index + value.length;
      }
      return checked(true, positions);
    }
    const matches = values.map(value => text.includes(value));
    return checked(rule.type === 'requireText' ? matches.every(Boolean) : !matches.some(Boolean), matches);
  }
  if (rule.scope !== 'all' && !hasRoot(current)) return blocked('Required main-content root is empty or missing.');
  if (['requireLink', 'forbidLink', 'linkCount', 'mailtoCoverage'].includes(rule.type)) {
    if (!validLinks(current.links)) return blocked('Links are missing or malformed.');
    const links = scopedLinks(current.links, rule);
    if (rule.type === 'mailtoCoverage') {
      const recipients = new Set(links.flatMap(item => mailRecipients(item.href)));
      const missing = rule.addresses.filter(address => !recipients.has(address.toLowerCase()));
      return checked(missing.length === 0, { recipients: [...recipients], missing });
    }
    const count = links.filter(item => matchesLink(item, rule.filter)).length;
    const min = rule.min ?? (rule.type === 'requireLink' ? 1 : 0);
    const max = rule.max ?? (rule.type === 'forbidLink' ? 0 : Infinity);
    return checked(count >= min && count <= max, count);
  }
  if (['requireHeading', 'forbidHeading'].includes(rule.type)) {
    if (!validHeadings(current.headings)) return blocked('Headings are missing or malformed.');
    const matches = current.headings.filter(heading => {
      if (rule.level !== undefined && heading.level !== rule.level) return false;
      const text = normalize(heading.text);
      return rule.exact === false ? text.includes(normalize(rule.text)) : text === normalize(rule.text);
    });
    return checked(rule.type === 'requireHeading' ? matches.length > 0 : matches.length === 0, matches.length);
  }
  if (!validImages(current.images)) return blocked('Images are missing or malformed.');
  let count = 0;
  for (const image of current.images) {
    if (!image.visible || !image.loaded || !image.inMain) continue;
    let hostname;
    try { hostname = new URL(image.currentSrc || image.src).hostname; }
    catch { return blocked('A rendered image has an invalid source URL.'); }
    if (hostname.toLowerCase() === rule.hostname.toLowerCase()) count += 1;
  }
  return checked(count === 0, count);
}
