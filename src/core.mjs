import { isIP } from 'node:net';

export const sensitiveKey = /^(?:samlrequest|samlresponse|relaystate|(?:access|id|refresh)[_-]?token|token|code|password|passwd|pwd|key|api[_-]?key|secret|client[_-]?secret|session(?:id)?|credential|authorization|auth)$/i;
const actionPath = /(?:^|[\/;])(?:log[\s_-]?(?:in|out)|sign[\s_-]?(?:in|out)|sso|saml\d*|oauth\d*|authorize|authenticate|delete|unsubscribe)(?:[\/;._-]|$)/i;
function decodedPath(path) {
  for(let i=0;i<3;i++) {try {const next=decodeURIComponent(path);if(next===path)break;path=next;} catch {break;}}
  return path.replaceAll('\\','/');
}
export function isSensitiveURL(input) {
  const u=new URL(input);
  return actionPath.test(decodedPath(u.pathname)) || [u.searchParams,new URLSearchParams(u.hash.slice(1))].some(params=>[...params.keys()].some(k=>sensitiveKey.test(k))) ||
    [...u.searchParams.entries()].some(([key,value])=>/^(?:action|do|cmd)$/i.test(key)&&/^(?:login|logout|signin|signout|delete|unsubscribe|submit)$/i.test(value));
}
export function redactURL(value,base) {
  try {
    const u=new URL(value,base);let changed=false;
    if(u.username||u.password){u.username='';u.password='';changed=true;}
    for(const key of [...u.searchParams.keys()]) if(sensitiveKey.test(key)){u.searchParams.set(key,'REDACTED');changed=true;}
    const fragment=new URLSearchParams(u.hash.slice(1));
    for(const key of [...fragment.keys()])if(sensitiveKey.test(key)){fragment.set(key,'REDACTED');u.hash=fragment.toString();changed=true;}
    if(!changed)return value;
    if(base&&!/^[a-z][a-z\d+.-]*:/i.test(value))return value.startsWith('#')?u.hash:value.startsWith('?')?u.search+u.hash:u.pathname+u.search+u.hash;
    return u.href;
  } catch {return redactText(String(value??''));}
}
export function redactText(value) {
  return String(value).replace(/([?&#]|&amp;)([a-z\d_%.-]+)=([^\s&#<>"']*)/gi,(whole,separator,key)=>{
    let decoded=key;try{decoded=decodeURIComponent(key);}catch{}
    return sensitiveKey.test(decoded)?`${separator}${key}=REDACTED`:whole;
  });
}
export function redactEvidence(value,secrets=[]) {
  if(typeof value==='string') {
    let text=redactText(value);
    for(const secret of secrets)if(secret)text=text.split(secret).join('REDACTED');
    return text;
  }
  if(Array.isArray(value))return value.map(v=>redactEvidence(v,secrets));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,redactEvidence(v,secrets)]));
  return value;
}

export function aggregateStatus(checks) {
  if (!checks.length) return 'review';
  const order = ['error', 'fail', 'blocked', 'review', 'pass'];
  if (checks.some(c => !order.includes(c.status))) return 'error';
  return order.find(status => checks.some(c => c.status === status));
}
export function acceptanceExit(results) {
  return {error:3, fail:1, blocked:2, review:2, pass:0}[aggregateStatus(results)];
}
export function selectFindings(records, ids) {
  if (ids === undefined) return records;
  const selected = [...new Set(ids.split(',').map(s => s.trim()).filter(Boolean))];
  if (!selected.length) throw new Error('Selection is empty');
  const unknown = selected.filter(id => !records.some(r => r.id === id));
  if (unknown.length) throw new Error(`Unknown finding IDs: ${unknown.join(', ')}`);
  return records.filter(r => selected.includes(r.id));
}
export function safeWebURL(input, {allowLocal = false} = {}) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only anonymous HTTP(S) URLs are permitted');
  if(isSensitiveURL(url))throw new Error('Authentication, credential or action destination excluded');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!allowLocal && (isIP(host) || !host.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host))) throw new Error('Private or literal-IP destination rejected');
  if (!allowLocal && url.port && !['80', '443'].includes(url.port)) throw new Error('Nonstandard destination port rejected');
  return url.href;
}
export function classifyPage({httpStatus, title = '', text = '', finalURL = '', error, loginVisible = false}) {
  if (error || !Number.isInteger(httpStatus)) return 'blocked';
  if ([401, 403, 418, 429, 202, 206].includes(httpStatus) || httpStatus >= 500) return 'blocked';
  let pathname = '';
  try { pathname = new URL(finalURL).pathname; } catch { /* Missing URL is resolved by the capture error boundary. */ }
  if (loginVisible || actionPath.test(decodedPath(pathname))) return 'blocked';
  const leading = `${title}\n${text.slice(0, 800)}`;
  if (/just a moment|checking your browser|verify (?:that )?you are human|access denied|enable javascript and cookies to continue/i.test(leading)) return 'blocked';
  if ([404, 410].includes(httpStatus)) return 'missing';
  if (/^(?:404(?:\b.*)?|not found|page not found|server error|site not found)(?:\s*[|\-].*)?$/i.test(title.trim())) return 'missing';
  if (httpStatus < 200 || httpStatus >= 300) return 'blocked';
  return 'ready';
}
