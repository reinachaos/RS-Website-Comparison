import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { classifyPage, safeWebURL, redactURL, redactEvidence, sensitiveKey } from './core.mjs';
import { createNetworkProxy } from './network-policy.mjs';

export const VIEWPORTS = {desktop:{width:1440,height:1000}, mobile:{width:390,height:844}};
const roots = {old:['.item-page'], new:['.entry-content','.wp-block-post-content'], external:['body'], newsletter:['#root']};
async function openPage(browser, url, options) {
  const viewport=VIEWPORTS[options.viewport||'desktop'];
  if(!viewport) throw new Error('Unknown viewport');
  const proxy=await createNetworkProxy({allowLocal:options.allowLocal===true,timeoutMs:options.timeoutMs||20000});
  let context;
  try {context=await browser.newContext({viewport,locale:'en-US',timezoneId:'UTC',deviceScaleFactor:1,reducedMotion:'reduce',ignoreHTTPSErrors:false,acceptDownloads:false,serviceWorkers:'block',proxy:{server:proxy.server,bypass:'<-loopback>'}});}
  catch(error){await proxy.close();throw error;}
  const close=async()=>{try{await context.close();}finally{await proxy.close();}};
  try {
  await context.routeWebSocket('**/*',socket=>socket.close());
  await context.route('**/*',async route=>{
    let response;
    try {
      if(!['GET','HEAD','OPTIONS'].includes(route.request().method())) return await route.abort('blockedbyclient');
      safeWebURL(route.request().url(),options);
      const headers={...route.request().headers()};
      for(const name of ['authorization','cookie','referer','proxy-authorization'])delete headers[name];
      // Inspect redirects before Chromium follows them, including HTTPS destinations.
      response=await route.fetch({headers,maxRedirects:0,maxRetries:0,timeout:options.timeoutMs||20000});
      const responseHeaders={...response.headers()};delete responseHeaders['set-cookie'];
      if(responseHeaders.location)safeWebURL(new URL(responseHeaders.location,route.request().url()).href,options);
      await route.fulfill({response,headers:responseHeaders});
    } catch { await route.abort('blockedbyclient').catch(()=>{}); }
    finally {await response?.dispose().catch(()=>{});}
  });
  const page=await context.newPage();
  page.setDefaultTimeout(6000);
  page.setDefaultNavigationTimeout(options.timeoutMs||20000);
  page.on('dialog',dialog=>dialog.dismiss());
  page.on('popup',popup=>popup.close());
  let response, error;
  try { safeWebURL(url,options);response=await page.goto(url,{waitUntil:'domcontentloaded'}); }
  catch(e) { error=e.message.split('\n')[0]; }
  const state={httpStatus:response?.status()??null,finalURL:page.url(),error};
  try {
    state.title=await page.title();
    state.text=await page.locator('body').innerText({timeout:2000});
    state.loginVisible=await page.locator('input[type=password]:visible').count()>0;
  } catch(e) { state.error ||= e.message.split('\n')[0]; }
  state.status=classifyPage(state);
  const choices=options.mainSelectors||roots[options.side||'new'];
  let selector;
  if(state.status==='ready') {
    for(const item of choices) {
      await page.locator(item).waitFor({state:'visible',timeout:5000}).catch(()=>{});
      if(await page.locator(item).count()===1 && await page.locator(item).isVisible()) {selector=item;break;}
    }
    if(!selector) {state.status='blocked';state.error=`Expected unique visible main-content root not found: ${choices.join(', ')}`;}
  }
  if(selector&&options.side==='newsletter') {
    try {
      await page.waitForFunction(s=>{const root=document.querySelector(s),text=root?.innerText.trim()||'';return text.length>=300&&!/^loading\b|^please wait\b/i.test(text)&&!root.querySelector('[aria-busy="true"]');},selector,{timeout:7000});
      const settled=await page.evaluate(s=>new Promise(resolve=>{
        const root=document.querySelector(s);let quiet;
        const finish=value=>{clearTimeout(quiet);clearTimeout(limit);observer.disconnect();resolve(value);};
        const reset=()=>{clearTimeout(quiet);quiet=setTimeout(()=>finish(true),300);};
        const observer=new MutationObserver(reset);
        const limit=setTimeout(()=>finish(false),3000);
        observer.observe(root,{childList:true,subtree:true,characterData:true});reset();
      }),selector);
      if(!settled)throw new Error('Newsletter content continued changing');
      state.contentSettled=true;
    } catch {state.status='blocked';state.error='Newsletter body did not become non-placeholder and stable within the bounded readiness period.';}
  }
  return {context,page,state,selector,viewport,close};
  } catch(error){await close();throw error;}
}

// This function is serialized into the browser and reads rendered DOM only.
function extractSnapshot({selector,sensitiveSource}) {
  const root=document.querySelector(selector);
  const sensitive=new RegExp(sensitiveSource,'i');
  const secrets=[...document.querySelectorAll('input,textarea,select')].flatMap(e=>{
    const protectedField=e.type==='password'||sensitive.test(e.name)||sensitive.test(e.id);
    // Ordinary hidden flags such as page=1 are removed as controls, not replaced throughout the article.
    return [e.value,e.getAttribute('value')].filter(value=>value&&(protectedField||(e.type==='hidden'&&value.length>=8)));
  });
  for(const e of document.querySelectorAll('*'))for(const attr of e.attributes) {
    try {const u=new URL(attr.value,document.baseURI);for(const [key,value] of u.searchParams)if(sensitive.test(key)&&value)secrets.push(value);}catch{}
  }
  // Rebuild inert structural markup: no executable elements, resource URLs, CSS, or form state.
  const excluded=new Set('SCRIPT STYLE LINK META BASE IFRAME FRAME OBJECT EMBED INPUT TEXTAREA SELECT OPTION BUTTON FORM SVG MATH TEMPLATE NOSCRIPT'.split(' '));
  const allowed=new Set('HTML HEAD BODY TITLE MAIN ARTICLE SECTION HEADER FOOTER NAV DIV SPAN P A IMG H1 H2 H3 H4 H5 H6 TABLE THEAD TBODY TFOOT TR TH TD CAPTION COLGROUP COL UL OL LI DL DT DD BR HR STRONG EM B I U S SMALL BLOCKQUOTE PRE CODE FIGURE FIGCAPTION TIME SUP SUB'.split(' '));
  const clean=node=>{
    if(node.nodeType===Node.TEXT_NODE)return document.createTextNode(node.textContent);
    if(node.nodeType!==Node.ELEMENT_NODE||excluded.has(node.tagName))return document.createTextNode('');
    const e=document.createElement(allowed.has(node.tagName)?node.tagName.toLowerCase():'span');
    for(const name of ['id','class','alt','colspan','rowspan','scope','title'])if(node.hasAttribute(name))e.setAttribute(name,node.getAttribute(name));
    if(node.tagName==='A'&&node.hasAttribute('href')) {
      try {const u=new URL(node.getAttribute('href'),document.baseURI);for(const key of [...u.searchParams.keys()])if(sensitive.test(key))u.searchParams.set(key,'REDACTED');u.username='';u.password='';e.setAttribute('data-href',u.href);}catch{}
    }
    for(const child of node.childNodes)e.append(clean(child));
    return e;
  };
  const html=e=>clean(e).innerHTML;
  const rect=e=>{const r=e.getBoundingClientRect();return {width:r.width,height:r.height,x:r.x,y:r.y+scrollY};};
  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return !!(r.width&&r.height&&s.visibility!=='hidden'&&s.display!=='none'&&!e.closest('[hidden]'));};
  const h=document.querySelector('h1'),hs=h?getComputedStyle(h):null;
  return {
    mainText:root.innerText,mainHTML:html(root),sanitizedDOM:'<!doctype html>\n'+clean(document.documentElement).outerHTML,secrets,
    headings:[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(e=>e===h||root.contains(e)).map(e=>({level:Number(e.tagName[1]),text:e.innerText.trim(),id:e.id})),
    links:[...document.querySelectorAll('a[href]')].map(e=>({text:e.innerText.trim(),href:e.href,rawHref:e.getAttribute('href'),visible:visible(e),inMain:root.contains(e)})),
    images:[...document.images].map(e=>({src:e.src,currentSrc:e.currentSrc,alt:e.alt,loaded:e.complete&&e.naturalWidth>0,visible:visible(e),inMain:root.contains(e),naturalWidth:e.naturalWidth,naturalHeight:e.naturalHeight,...rect(e)})),
    tables:[...root.querySelectorAll('table')].map(t=>({text:t.innerText,rows:[...t.rows].map(r=>({cells:[...r.cells].map(c=>({text:c.innerText,html:html(c),...rect(c)}))})),...rect(t)})),
    metrics:{scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,overflow:Math.max(0,document.documentElement.scrollWidth-document.documentElement.clientWidth),h1:hs?{fontSize:parseFloat(hs.fontSize),fontWeight:parseFloat(hs.fontWeight)}:{}},
  };
}

export async function capturePage(browser,url,options={}) {
  const {outDir}=options;
  if(!outDir) throw new Error('Evidence output directory required');
  await mkdir(outDir,{recursive:true});
  const key=createHash('sha256').update(`${url}|${options.side}|${options.viewport||'desktop'}`).digest('hex').slice(0,20);
  const paths={screenshot:`evidence/${key}.png`,json:`evidence/${key}.json`,dom:`evidence/${key}.dom.txt`};
  await mkdir(join(outDir,'evidence'),{recursive:true});
  const session=await openPage(browser,url,options);
  const {page,state,selector,viewport,close}=session;
  let snapshot={requestedURL:redactURL(url),finalURL:redactURL(state.finalURL),status:state.status,httpStatus:state.httpStatus,title:state.title||'',error:state.error,mainText:'',mainHTML:'',headings:[],links:[],images:[],tables:[],metrics:{},timestamp:new Date().toISOString(),viewport,artifacts:{json:paths.json}};
  try {
    if(state.status==='ready') {
      snapshot.fontsReady=await page.waitForFunction(()=>document.fonts.status==='loaded',null,{timeout:5000}).then(()=>true,()=>false);
      snapshot.imagesSettled=await page.waitForFunction(s=>[...document.querySelector(s).querySelectorAll('img')].every(i=>i.complete),selector,{timeout:5000}).then(()=>true,()=>false);
      const {sanitizedDOM,secrets,...extracted}=await page.evaluate(extractSnapshot,{selector,sensitiveSource:sensitiveKey.source});
      Object.assign(snapshot,redactEvidence(extracted,secrets));
      snapshot.contentSettled=state.contentSettled??null;
      if(options.side==='newsletter'&&!snapshot.imagesSettled){snapshot.status='blocked';snapshot.error='Newsletter images did not finish loading before capture.';}
      snapshot.contentSelector=selector;
      snapshot.links=snapshot.links.map(l=>({...l,href:redactURL(l.href),rawHref:redactURL(l.rawHref,state.finalURL)}));
      await writeFile(join(outDir,paths.dom),redactEvidence(sanitizedDOM,secrets));
      snapshot.artifacts.dom=paths.dom;
      await page.evaluate(({values,sensitiveSource})=>{
        const sensitive=new RegExp(sensitiveSource,'i');
        for(const e of document.querySelectorAll('input,textarea,select'))if(['hidden','password'].includes(e.type)||sensitive.test(e.name)||sensitive.test(e.id))e.setAttribute('data-rs-sensitive-control','');
        const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
        while(walker.nextNode())if(!walker.currentNode.parentElement?.closest('script,style'))for(const secret of values)if(secret)walker.currentNode.textContent=walker.currentNode.textContent.split(secret).join('REDACTED');
      },{values:secrets,sensitiveSource:sensitiveKey.source});
      const bounds=await page.locator(selector).boundingBox();
      if(bounds&&bounds.height<=20000) {
        const region=`evidence/${key}-main.png`;
        try {await page.locator(selector).screenshot({path:join(outDir,region),animations:'disabled',timeout:10000,mask:[page.locator('[data-rs-sensitive-control]')]});snapshot.artifacts.mainScreenshot=region;}
        catch(e) {snapshot.regionScreenshotError=e.message.split('\n')[0];}
      }
    }
    if(state.status==='ready') try {
      const height=await page.evaluate(()=>document.documentElement.scrollHeight);
      snapshot.screenshotScope=height<=20000?'full-page':'viewport-height-limit';
      await page.screenshot({path:join(outDir,paths.screenshot),fullPage:height<=20000,animations:'disabled',timeout:10000,mask:[page.locator('[data-rs-sensitive-control]')]});
      snapshot.artifacts.screenshot=paths.screenshot;
    } catch(e) {snapshot.screenshotError=e.message.split('\n')[0];}
    snapshot=redactEvidence(snapshot);
    await writeFile(join(outDir,paths.json),JSON.stringify(snapshot,null,2));
    return snapshot;
  } finally {await close();}
}

export async function exerciseAnchors(browser,url,options={}) {
  const {page,state,selector,close}=await openPage(browser,url,options);
  const checks=[],evidence=[];
  try {
    if(state.status!=='ready') return {checks:[{id:'access',label:'Anchor page readable',status:'blocked',actual:state.status,note:state.error}],evidence};
    const anchors=await page.locator(`${selector} a[href]`).evaluateAll(elements=>elements.map((a,index)=>({index,text:a.innerText.trim(),href:a.getAttribute('href'),resolved:a.href})).filter(a=>{try{const u=new URL(a.resolved);return u.origin===location.origin&&u.pathname===location.pathname&&(u.hash||a.href==='#');}catch{return false;}}));
    const top=a=>/top\s*(?:of\s*(?:the\s*)?page)?|back to top/i.test(a.text)||a.href==='#';
    const discovered=anchors.filter(a=>options.mode==='return-top'?top(a):!top(a));
    const mapping=Array.isArray(options.expectedSections)?options.expectedSections:null;
    const selected=mapping?mapping.flatMap((entry,index)=>{
      const fragment=options.side==='old'?entry.baselineFragment:entry.migratedFragment;
      const link=discovered.find(a=>new URL(a.resolved).hash===fragment);
      if(!link){checks.push({id:`missing-link-${index+1}`,label:entry.label,status:'fail',expected:fragment,actual:null,note:'The configured section link is missing or has a different fragment.'});return [];}
      return [{...link,expectedLabel:entry.label}];
    }):discovered;
    const expected=mapping?mapping.length:options.expectedSections;
    checks.push({id:'count',label:'Expected anchor count',status:selected.length===expected?'pass':'fail',expected,actual:selected.length});
    for(const [i,a] of selected.entries()) {
      const check={id:`${options.mode==='return-top'?'top':'target'}-${i+1}`,label:a.text||a.href,expected:options.mode==='return-top'?'Document y <= 2':'Referenced target exists and is visible after keyboard activation'};
      try {
        const link=page.locator(`${selector} a[href]`).nth(a.index);
        await page.evaluate(()=>{history.replaceState(null,'',location.pathname+location.search);scrollTo(0,document.documentElement.scrollHeight);});
        await link.scrollIntoViewIfNeeded();
        await link.focus();
        await link.press('Enter');
        if(options.mode==='return-top') {
          await page.waitForFunction(()=>scrollY<=2,null,{timeout:2000}).catch(()=>{});
          check.actual={scrollY:await page.evaluate(()=>scrollY)};
          check.status=check.actual.scrollY<=2?'pass':'fail';
        } else {
          const target=decodeURIComponent(new URL(a.resolved).hash.slice(1));
          const measure=()=>page.evaluate(id=>{const e=document.getElementById(id)||[...document.getElementsByName(id)][0];if(!e)return {exists:false};const r=e.getBoundingClientRect();return {exists:true,top:r.top,viewportHeight:innerHeight,text:(e.innerText||e.nextElementSibling?.innerText||'').slice(0,160),hash:location.hash};},target);
          const expectedHash=new URL(a.resolved).hash;
          await page.waitForFunction(({id,hash})=>{const e=document.getElementById(id)||[...document.getElementsByName(id)][0];return location.hash===hash&&e&&e.getBoundingClientRect().top>=-2&&e.getBoundingClientRect().top<innerHeight;},{id:target,hash:expectedHash},{timeout:2000}).catch(()=>{});
          check.actual=await measure();
          check.status=check.actual.hash===expectedHash&&check.actual.exists&&check.actual.top>=-2&&check.actual.top<check.actual.viewportHeight?'pass':'fail';
          check.note='Keyboard activation is tested; this does not certify touch interaction or editorial correctness of section labels.';
          if(a.expectedLabel)check.actual.expectedLabel=a.expectedLabel;
        }
      } catch(e) {check.status='blocked';check.note=e.message.split('\n')[0];}
      checks.push(check);
    }
    if(options.mode==='return-top'&&!selected.length) checks.push({id:'global-control',label:'Global return-to-top is separate from inline controls',status:'review',note:'No inline links were found. This does not prove the global Back to Top control is absent.'});
    const key=createHash('sha256').update(url+options.mode+options.viewport).digest('hex').slice(0,20);
    await mkdir(join(options.outDir,'evidence'),{recursive:true});
    const path=`evidence/anchors-${key}.json`;
    await writeFile(join(options.outDir,path),JSON.stringify(redactEvidence({url:redactURL(url),viewport:options.viewport||'desktop',mode:options.mode,checks}),null,2));
    evidence.push({label:'Anchor activation observations',path});
    return redactEvidence({checks,evidence});
  } finally {await close();}
}
