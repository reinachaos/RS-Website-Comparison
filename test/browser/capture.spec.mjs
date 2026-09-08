import { test, expect, chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capturePage, exerciseAnchors } from '../../src/browser.mjs';
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
