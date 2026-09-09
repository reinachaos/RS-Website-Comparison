import { test, expect, chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capturePage, exerciseAnchors } from '../../src/browser.mjs';
import { evaluateRule } from '../../src/rules.mjs';
import { securityFixture } from './security-fixture.mjs';
let server, base, output;
const securityHits=[];
test.beforeAll(async () => {
  output = await mkdtemp(join(tmpdir(), 'rs-qa-fixture-'));
  server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if(securityFixture(req,res,securityHits)) return;
    if(req.url === '/missing') { res.statusCode=404; return res.end('<title>Not Found</title>Not Found'); }
    if(req.url === '/blocked') { res.statusCode=403; return res.end('<title>Forbidden</title>Access denied'); }
    if(req.url === '/shell') return res.end('<title>Shell</title><nav>Do not compare me as main content</nav>');
    if(req.url === '/login') return res.end('<title>Sign in</title><input type=password>');
    if(req.url === '/loading') return res.end('<title>Newsletter</title><div id="root">Loading...</div><script>setTimeout(()=>document.querySelector("#root").textContent="Newsletter article content. ".repeat(30),600)</script>');
    if(req.url === '/stuck') return res.end('<title>Newsletter</title><div id="root">Loading...</div>');
    res.end(`<title>Fixture awards</title><style>body{margin:0}section{margin-top:1100px} .wide{width:640px}</style><h1>Fixture awards</h1><main class="entry-content"><a href="#award-one">Award one</a><a href="#award-two">Award two</a><a href="mailto:person@example.org">Contact</a><a href="/legacy.pdf"><br></a><a hidden href="/hidden">Invisible</a><p>Separate Name<br>Second Name</p><table class="wide"><tr><td>Cell A</td><td>Cell B</td></tr></table><section id="award-one"><h2>Award one</h2><a href="#">Top of Page</a></section><section id="award-two"><h2>Award two</h2><a href="#">Top of Page</a></section></main>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test('evidence is inert and contains no secret attributes or relative URL query values',async({browser,page})=>{
  const s=await capturePage(browser,base+'/security',{outDir:output,side:'new',allowLocal:true});
  expect(s.status).toBe('ready');
  const dom=await readFile(join(output,s.artifacts.dom),'utf8');
  expect(JSON.stringify(s)+dom).not.toMatch(/DOM_SECRET|HIDDEN_SECRET|TEXTAREA_SECRET|TABLE_SECRET|REQUEST_SECRET|REDIRECT_SECRET/);
  expect(s.mainHTML).not.toMatch(/onerror|srcdoc|<script/i);
  expect(s.artifacts.dom).toMatch(/\.dom\.txt$/);
  await page.goto(pathToFileURL(join(output,s.artifacts.dom)).href);
  expect(await page.evaluate(()=>window.savedExecuted)).toBeUndefined();
  await page.setContent(s.mainHTML);
  expect(await page.evaluate(()=>window.savedExecuted)).toBeUndefined();
});

test('browser never requests auth/action GETs or credential queries, including redirect chains',async({browser})=>{
  securityHits.length=0;
  await capturePage(browser,base+'/security',{outDir:output,side:'new',allowLocal:true});
  expect(securityHits).toContain('/privacy');expect(securityHits).toContain('/donate');
  expect(securityHits.filter(u=>/SECRET|logout|signin|SSO|SAML2/.test(u))).toEqual([]);
});

test('preventDefault cannot pass when the anchor target was already visible',async({browser})=>{
  const s=await exerciseAnchors(browser,base+'/prevented#near',{outDir:output,side:'new',allowLocal:true,expectedSections:1,mode:'sections'});
  expect(s.checks.find(c=>c.id==='target-1').status).toBe('fail');
});

test('collector regression: return-top requires movement caused by Enter',async({browser})=>{
  for(const prevented of [true,false]) {
    const s=await exerciseAnchors(browser,base+'/return-top'+(prevented?'?prevented':''),{outDir:output,side:'new',allowLocal:true,expectedSections:1,mode:'return-top'});
    const check=s.checks.find(c=>c.id==='top-1');
    expect(check.status).toBe(prevented?'fail':'pass');
    expect(check.actual.beforeScrollY).toBeGreaterThan(2);
  }
});

test('return-top on an unscrollable document is blocked',async({browser})=>{
  const s=await exerciseAnchors(browser,base+'/return-top?short',{outDir:output,side:'new',allowLocal:true,expectedSections:1,mode:'return-top'});
  const check=s.checks.find(c=>c.id==='top-1');
  expect(check.status).toBe('blocked');
  expect(check.actual.beforeScrollY).toBe(0);
});

test('browser rejects loopback requests without the local-fixture opt-in',async({browser})=>{
  securityHits.length=0;
  const s=await capturePage(browser,base+'/private-hit',{outDir:output,side:'new'});
  expect(s.status).toBe('blocked');
  expect(securityHits).toEqual([]);
});

test('collector regression: invisible headings cannot satisfy requireHeading',async({browser})=>{
  const s=await capturePage(browser,base+'/hidden-headings',{outDir:output,side:'new',allowLocal:true});
  expect(s.status).toBe('ready');
  for(const text of ['Hidden title','Hidden attribute','Hidden ancestor','Hidden visibility']) {
    expect(evaluateRule({id:'heading',label:'Visible heading',type:'requireHeading',text},{new:s}).status,text).toBe('fail');
  }
  expect(s.headings.map(h=>h.text)).toEqual(['Visible title','Visible section']);
});

test('collector regression: broken complete images cannot settle newsletter capture',async({browser})=>{
  const s=await capturePage(browser,base+'/image-readiness',{outDir:output,side:'newsletter',allowLocal:true});
  expect(s.images[0].loaded).toBe(false);
  expect(s.imagesSettled).toBe(false);
  expect(s.status).toBe('blocked');
});

test('collector regression: offscreen native lazy images load before snapshot extraction',async({browser})=>{
  securityHits.length=0;
  const s=await capturePage(browser,base+'/image-readiness?lazy',{outDir:output,side:'newsletter',allowLocal:true});
  expect(s.imagesSettled).toBe(true);
  expect(s.status).toBe('ready');
  expect(s.images[0].loaded).toBe(true);
  expect(s.images[0].naturalWidth).toBe(1);
  expect(s.images[0].y).toBeGreaterThan(10000);
  expect(securityHits).toContain('/fixture-pixel.png');
});

test('unsized native lazy images cannot be omitted from newsletter readiness',async({browser})=>{
  const s=await capturePage(browser,base+'/image-readiness?lazy&unsized',{outDir:output,side:'newsletter',allowLocal:true});
  expect(s.status).toBe('ready');
  expect(s.imagesSettled).toBe(true);
  expect(s.images[0]).toMatchObject({loaded:true,naturalWidth:1,naturalHeight:1});
});

for(const hiddenOnly of [false,true]) test(`image readiness ignores nonrendered placeholders (${hiddenOnly?'hidden only':'mixed'})`,async({browser})=>{
  const s=await capturePage(browser,base+'/image-placeholders'+(hiddenOnly?'?hidden-only':''),{outDir:output,side:'newsletter',allowLocal:true});
  expect(s.imagesSettled).toBe(true);
  expect(s.status).toBe('ready');
  expect(s.images).toHaveLength(hiddenOnly?5:6);
  const hidden=s.images.filter(i=>i.inMain&&!i.visible);
  expect(hidden).toHaveLength(4);
  expect(hidden.every(i=>!i.loaded)).toBe(true);
  expect(s.images.find(i=>!i.inMain)).toMatchObject({visible:true,loaded:false});
  if(!hiddenOnly)expect(s.images.find(i=>i.inMain&&i.visible)).toMatchObject({loaded:true,naturalWidth:1});
});

test('collector regression: redaction preserves URL and markup structure on token collisions',async({browser})=>{
  const s=await capturePage(browser,base+'/redaction-collision',{outDir:output,side:'new',allowLocal:true});
  const dom=await readFile(join(output,s.artifacts.dom),'utf8');
  expect.soft(s.links[0].href).toBe(base+'/catalog');
  expect.soft(s.mainHTML).toContain('<a data-href=');
  expect.soft(dom).toContain('<main');
  expect.soft(s.mainText).toContain('Public article contains a REDACTED.');
  expect.soft(s.mainHTML).toContain('<blockquote class="REDACTED">');
  expect.soft(s.links[1].href).toBe(base+'/catalog?token=REDACTED');
  expect.soft(s.links[2].href).toBe(base+'/archive?code=REDACTED');
});

test('redaction of long form secrets preserves tag and attribute names and URL paths',async({browser})=>{
  const s=await capturePage(browser,base+'/redaction-long-form',{outDir:output,side:'new',allowLocal:true});
  const dom=await readFile(join(output,s.artifacts.dom),'utf8');
  expect.soft(s.mainHTML).toContain('<blockquote class="REDACTED" title="REDACTED">Public quotation.</blockquote>');
  expect.soft(dom).toContain('<blockquote class="REDACTED" title="REDACTED">');
  expect.soft(s.links[0].href).toBe(base+'/blockquote');
  expect.soft(s.mainText).toContain('Repeated secret: REDACTED');
});

test('redaction sanitizes escaped text and attributes before serialization and URL credentials structurally',async({browser})=>{
  const s=await capturePage(browser,base+'/redaction-escaped',{outDir:output,side:'new',allowLocal:true});
  const dom=await readFile(join(output,s.artifacts.dom),'utf8');
  expect.soft(JSON.stringify(s)+dom).not.toMatch(/TEXTAREA_|USER_SECRET|PASSWORD_SECRET|QUERY_SECRET|FRAGMENT_SECRET|IMAGE_SECRET/);
  expect.soft(s.mainHTML).toContain('<p title="REDACTED">REDACTED</p>');
  expect.soft(s.links[0].href).toBe('http://127.0.0.1/article?token=REDACTED#auth=REDACTED');
});

test('reflected long URL secrets are removed from text and inert DOM evidence',async({browser})=>{
  const s=await capturePage(browser,base+'/redaction-reflected',{outDir:output,side:'new',allowLocal:true});
  const dom=await readFile(join(output,s.artifacts.dom),'utf8');
  expect(JSON.stringify(s)+dom).not.toMatch(/QUERY_SECRET_123|FRAGMENT_SECRET_456/);
  expect(s.mainText).toContain('Debug token: REDACTED and REDACTED');
});

test('opening saved evidence cannot execute the original image error handler',async({browser,page})=>{
  const s=await capturePage(browser,base+'/security',{outDir:output,side:'new',allowLocal:true});
  await page.goto(pathToFileURL(join(output,s.artifacts.dom)).href);
  expect(await page.evaluate(()=>window.savedExecuted)).toBeUndefined();
});

test('browser host resolver overrides cannot bypass the protected proxy',async()=>{
  const browser=await chromium.launch({args:['--host-resolver-rules=MAP fixture.example.org 127.0.0.1']});
  try {
    const s=await capturePage(browser,'http://fixture.example.org/',{outDir:output,side:'new',timeoutMs:3000});
    expect(s.status).toBe('blocked');
  } finally {await browser.close();}
});

test('redaction preserves public years and words despite select and checkbox values',async({browser})=>{
  const s=await capturePage(browser,base+'/security',{outDir:output,side:'new',allowLocal:true});
  expect(s.mainText).toContain('Public selection 2026 stays on this page. Connection information.');
  const dom=await readFile(join(output,s.artifacts.dom),'utf8');
  expect(dom).toContain('Public selection 2026 stays on this page. Connection information.');
  expect(s.headings.find(h=>h.level===1).text).toBe('2014 archive');
  expect(s.links.find(a=>a.text==='2014 newsletter').href).toContain('/publications/2014.html');
  expect(s.tables[0].text).toBe('2014 issue 1');
  expect(dom).toContain('<h1>2014 archive</h1>');
  expect(dom).not.toContain('<input');
  expect(JSON.stringify(s)+dom).not.toMatch(/HIDDEN_SECRET|TEXTAREA_SECRET/);
});
test.afterAll(async()=>{ await new Promise(resolve=>server.close(resolve)); await rm(output,{recursive:true,force:true}); });
test('capture records real content, visibility, table geometry and mobile overflow', async ({browser})=>{
  const s = await capturePage(browser, base, {outDir:output,side:'new',viewport:'mobile',allowLocal:true});
  expect(s.status).toBe('ready');
  expect(s.mainText).toContain('Separate Name\nSecond Name');
  expect(s.links.find(x=>x.text==='Invisible').visible).toBe(false);
  expect(s.links.find(x=>x.href.endsWith('/legacy.pdf')).text).toBe('');
  expect(s.metrics.overflow).toBeGreaterThan(200);
  expect(s.tables[0].rows[0].cells).toHaveLength(2);
  expect(s.artifacts.screenshot).toMatch(/\.png$/);
});
test('unreadable, missing root and login states cannot become readable snapshots', async({browser})=>{
  for(const [path,status] of [['/blocked','blocked'],['/missing','missing'],['/shell','blocked'],['/login','blocked']]) {
    const s=await capturePage(browser,base+path,{outDir:output,side:'new',allowLocal:true});
    expect(s.status,path).toBe(status);
    expect(s.mainText).toBe('');
  }
});
test('anchor checks actually activate two targets and return-to-top links',async({browser})=>{
  const s=await exerciseAnchors(browser,base,{outDir:output,side:'new',allowLocal:true,expectedSections:2,mode:'sections'});
  expect(s.checks.filter(x=>x.id.startsWith('target-'))).toHaveLength(2);
  expect(s.checks.every(x=>x.status==='pass')).toBe(true);
  const top=await exerciseAnchors(browser,base,{outDir:output,side:'new',allowLocal:true,expectedSections:2,mode:'return-top'});
  expect(top.checks.filter(x=>x.id.startsWith('top-'))).toHaveLength(2);
  expect(top.checks.every(x=>x.status==='pass')).toBe(true);
});
test('configured section fragments are used and a wrong mapping cannot pass',async({browser})=>{
  const expectedSections=[{label:'Award one',baselineFragment:'#award-one',migratedFragment:'#award-one'},{label:'Award two',baselineFragment:'#award-two',migratedFragment:'#wrong'}];
  const s=await exerciseAnchors(browser,base,{outDir:output,side:'new',allowLocal:true,expectedSections,mode:'sections'});
  expect(s.checks.some(c=>c.id==='missing-link-2'&&c.status==='fail')).toBe(true);
});
test('newsletter capture waits for real content and blocks a stuck loading shell',async({browser})=>{
  const loaded=await capturePage(browser,base+'/loading',{outDir:output,side:'newsletter',allowLocal:true});
  expect(loaded.status).toBe('ready');expect(loaded.mainText).toContain('Newsletter article content');
  const stuck=await capturePage(browser,base+'/stuck',{outDir:output,side:'newsletter',allowLocal:true});
  expect(stuck.status).toBe('blocked');
});
