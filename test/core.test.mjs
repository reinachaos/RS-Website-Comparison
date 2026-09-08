import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateStatus, acceptanceExit, selectFindings, safeWebURL, classifyPage } from '../src/core.mjs';

test('empty and incomplete checks cannot pass acceptance', () => {
  assert.equal(aggregateStatus([]), 'review');
  assert.equal(aggregateStatus([{status:'pass'}, {status:'blocked'}]), 'blocked');
  assert.equal(aggregateStatus([{status:'review'}, {status:'fail'}]), 'fail');
  assert.equal(aggregateStatus([{status:'fail'}, {status:'error'}]), 'error');
  assert.equal(acceptanceExit([{status:'review'}]), 2);
  assert.equal(acceptanceExit([{status:'blocked'}]), 2);
  assert.equal(acceptanceExit([{status:'fail'}]), 1);
  assert.equal(acceptanceExit([{status:'error'}]), 3);
  assert.equal(acceptanceExit([{status:'pass'}]), 0);
  assert.equal(acceptanceExit([]), 2);
});
test('selection rejects unknown IDs rather than silently dropping them', () => {
  const records = [{id:'ABOUT-01'},{id:'ABOUT-02'}];
  assert.deepEqual(selectFindings(records, 'ABOUT-02'), [records[1]]);
  assert.deepEqual(selectFindings(records), records);
  assert.throws(() => selectFindings(records, 'TYPO'), /Unknown/);
  assert.throws(() => selectFindings(records, ''), /empty/i);
});
test('network input rejects nonweb, credentials and private literal destinations', () => {
  for (const url of ['file:///x', 'javascript:alert(1)', 'https://a:b@example.com', 'http://127.0.0.1/', 'http://10.0.0.1', 'http://[::1]', 'http://169.254.169.254/', 'http://localhost']) {
    assert.throws(() => safeWebURL(url));
  }
  assert.equal(safeWebURL('https://rs.ieee.org/about-rs/'), 'https://rs.ieee.org/about-rs/');
  assert.equal(safeWebURL('http://127.0.0.1:9898', {allowLocal:true}), 'http://127.0.0.1:9898/');
});

test('request policy excludes auth/action paths and credential query keys but permits public landing pages', () => {
  for(const suffix of ['/login','/sign-in','/signin.aspx','/logout','/SSO/start','/SAML2','/%6cogin','/account?token=secret','/asset?code=secret','/asset?api_key=secret','/asset?SAMLRequest=secret']) {
    assert.throws(()=>safeWebURL('https://example.org'+suffix), /Authentication|credential|action/i, suffix);
  }
  for(const suffix of ['/privacy','/donate','/news?page=2']) assert.equal(safeWebURL('https://example.org'+suffix),'https://example.org'+suffix);
});
test('403, challenge, TLS and login states never become missing pages or readable bodies', () => {
  assert.equal(classifyPage({httpStatus:403,title:'Forbidden',text:'Access denied',finalURL:'https://example.org'}), 'blocked');
  assert.equal(classifyPage({httpStatus:200,title:'Just a moment...',text:'Checking your browser',finalURL:'https://example.org'}), 'blocked');
  assert.equal(classifyPage({httpStatus:200,title:'Sign in',text:'Sign in',finalURL:'https://example.org/home/sign-in'}), 'blocked');
  assert.equal(classifyPage({error:'net::ERR_CERT_AUTHORITY_INVALID'}), 'blocked');
  assert.equal(classifyPage({httpStatus:404,text:'Not Found',finalURL:'https://example.org'}), 'missing');
  assert.equal(classifyPage({httpStatus:200,title:'Not Found',text:'Page not found',finalURL:'https://example.org'}), 'missing');
  assert.equal(classifyPage({httpStatus:200,title:'Awards',text:'Awards list',finalURL:'https://example.org'}), 'ready');
});
