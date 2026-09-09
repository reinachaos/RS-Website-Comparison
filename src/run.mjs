import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { aggregateStatus, acceptanceExit, selectFindings } from './core.mjs';
import { evaluateRule } from './rules.mjs';
import { capturePage, exerciseAnchors, VIEWPORTS } from './browser.mjs';
import { fetchResource, compareFiles } from './http.mjs';
import { checkVisual, visualKey } from './baseline.mjs';
import { renderReport } from './report.mjs';

export async function mapLimit(items,limit,fn) {
  if(!Number.isInteger(limit)||limit<1||limit>4)throw new Error('Concurrency must be an integer between 1 and 4');
  let next=0;const results=new Array(items.length);
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const index=next++;results[index]=await fn(items[index],index);}}));
  return results;
}
const digest=value=>createHash('sha256').update(value).digest('hex').slice(0,20);
const normalize=text=>String(text||'').replace(/\s+/g,' ').trim();
const evidenceOf=(snapshot,label)=>Object.entries(snapshot.artifacts||{}).map(([kind,path])=>({label:`${label} ${kind}`,path}));
function result(id,title,category,checks,evidence=[],notes=[]) {return {id,title,category,status:aggregateStatus(checks),checks,evidence,notes};}
function accessCheck(snapshot,side) {
  const status=snapshot.status==='ready'?'pass':snapshot.status==='error'?'error':snapshot.status==='missing'&&side==='new'?'fail':'blocked';
  return {id:`${side}-access`,label:`${side==='old'?'Baseline':'Migrated'} page access`,status,expected:'Readable public page and a recognized content root',actual:{status:snapshot.status,httpStatus:snapshot.httpStatus,finalURL:snapshot.finalURL},note:snapshot.error};
}

export async function runAudit(catalog,options,services={}) {
  const selected=selectFindings(catalog.findings,options.ids),supplemental=options.ids===undefined&&!options.skipSupplemental;
  if(await access(options.outDir).then(()=>true,()=>false))throw new Error('Output directory already exists; use a fresh run directory');
  await mkdir(options.outDir,{recursive:true});
  const concurrency=options.concurrency||2;
  if(![1,2].includes(concurrency))throw new Error('Browser concurrency must be 1 or 2');
  const run={schemaVersion:1,runId:options.runId||new Date().toISOString().replace(/[:.]/g,'-'),startedAt:new Date().toISOString(),scope:{mode:'live',selectedIds:selected.map(f=>f.id),totalFindings:catalog.findings.length,partial:!supplemental||selected.length!==catalog.findings.length},environment:{node:process.version,platform:process.platform,arch:process.arch,viewports:VIEWPORTS,revision:options.revision||null},results:[]};
  const anchorTasks=supplemental?catalog.anchors.flatMap(item=>['desktop','mobile'].flatMap(viewport=>[['old',item.baselineURL],['new',item.migratedURL]].map(([side,url])=>({id:`${item.id}-${side}-${viewport}`,title:`${item.mode}: ${url} (${viewport})`,category:'anchors',item,side,url,viewport})))):[];
  const planned=[...selected.map(f=>({id:f.id,title:f.title,category:'finding'})),...(supplemental?[
    ...catalog.availability.map(item=>({id:item.id,title:item.url,category:'availability'})),
    ...catalog.filePairs.map(pair=>({id:`FILE-${pair.id}`,title:pair.newURL,category:'file'})),...anchorTasks
  ]:[])];
  let browser;
  const capture=services.capture||capturePage,fetch=services.fetch||fetchResource,anchors=services.anchors||exerciseAnchors;
  const snapshots=new Map(),resources=new Map();
  const getSnapshot=(url,side,viewport='desktop')=>{
    const key=`${url}|${side}|${viewport}`;
    if(!snapshots.has(key))snapshots.set(key,Promise.resolve().then(()=>capture(browser,url,{outDir:options.outDir,side,viewport})).catch(e=>({requestedURL:url,status:'error',httpStatus:null,error:e.message,mainText:'',mainHTML:'',artifacts:{}})));
    return snapshots.get(key);
  };
  const getResource=url=>{
    if(!resources.has(url))resources.set(url,Promise.resolve().then(async()=>{
      const observation=await fetch(url);
      const path=`evidence/http-${digest(url)}.json`;
      await mkdir(join(options.outDir,'evidence'),{recursive:true});
      await writeFile(join(options.outDir,path),JSON.stringify(observation,null,2));
      return {...observation,evidencePath:path};
    }));
    return resources.get(url);
  };
  const announce=r=>{options.onProgress?.(`${r.id}: ${r.status}`);return r;};
  const collect=async({id,title,category},fn)=>{
    let record;
    try {record=await fn();}
    catch(e) {record=result(id,title,category,[{id:'execution',label:'Item execution',status:'error',note:e.message}]);}
    run.results.push(record);
    announce(record);
  };
  const availability=async(item)=>{
    const resource=await getResource(item.url),checks=[],evidence=[{label:'HTTP response observations',path:resource.evidencePath}];
    const isHTML=/html|text\/plain/i.test(resource.contentType||'')||/^\s*</.test(resource.prefix||'');
    if(item.expectedDocument&&resource.status==='ready'&&!isHTML) {
      const recognized=resource.signature?.startsWith('255044462d')||resource.signature?.startsWith('d0cf11e0a1b11ae1')||resource.signature?.startsWith('504b0304');
      checks.push({id:'document-response',label:'Complete recognized document response',status:recognized&&resource.complete?'pass':'review',expected:'Complete PDF/Office response',actual:resource,note:'Response availability only; intended document content is not certified by this check.'});
    } else {
      const snapshot=await getSnapshot(item.url,'external');
      evidence.push(...evidenceOf(snapshot,'Destination'));
      const emptyBody=!normalize(snapshot.mainText)&&!snapshot.images?.some(i=>i.inMain&&i.visible&&i.loaded);
      let status;
      if(snapshot.status==='missing')status='fail';
      else if(snapshot.status==='error')status='error';
      else if(snapshot.status!=='ready')status='blocked';
      else if(emptyBody)status='blocked';
      else if(resource.status==='missing')status='review';
      else status='pass';
      checks.push({id:'destination',label:'Browser-visible destination availability',status,expected:'Readable destination rather than a missing-page, access gate or challenge',actual:{browserStatus:snapshot.status,httpStatus:resource.httpStatus,browserHTTP:snapshot.httpStatus,finalURL:snapshot.finalURL,title:snapshot.title},note:status==='review'?'HTTP and browser outcomes conflict; review both observations.':snapshot.error||(snapshot.status==='ready'&&emptyBody?'No readable body text or loaded visible image was captured.':'Availability is distinct from semantic correctness and migration causation.')});
      if(item.expectedDocument)checks.push({id:'document-type',label:'Expected downloadable document',status:resource.status==='blocked'?'blocked':'review',actual:{contentType:resource.contentType,complete:resource.complete,status:resource.status},note:'The complete expected file was not verified. A browser-readable landing page does not establish downloadable document availability.'});
    }
    return result(item.id,item.url,'availability',checks,evidence,[item.note?`Catalog context (not a current check result): ${item.note}`:'',`Historical status: ${item.historicalStatus||'not supplied'} (not reused as a current result)`]);
  };
  try {
    browser=await (services.launch||(()=>chromium.launch({headless:true})))();
    run.environment.browser=browser.version();
    const visualEnv={platform:process.platform,arch:process.arch,browser:browser.version(),locale:'en-US',timezone:'UTC',scale:1};
    run.visualEnvironment=visualEnv;
    run.results=await mapLimit(selected,concurrency,async finding=>{
      try {
        const checks=[],evidence=[],pairs=new Map();
        const getPair=async(key='primary',viewport='desktop')=>{
          const cacheKey=`${key}|${viewport}`;
          if(!pairs.has(cacheKey)) {
            const pair=key==='primary'?finding:finding.pages?.find(p=>p.key===key);
            if(!pair)throw new Error(`Missing configured page pair: ${key}`);
            const [old,current]=await Promise.all([getSnapshot(pair.baselineURL,'old',viewport),getSnapshot(pair.migratedURL,'new',viewport)]);
            pairs.set(cacheKey,{old,new:current,pair,viewport});
            checks.push({...accessCheck(old,'old'),id:`${cacheKey}/old-access`},{...accessCheck(current,'new'),id:`${cacheKey}/new-access`});
            evidence.push(...evidenceOf(old,`${key} baseline ${viewport}`),...evidenceOf(current,`${key} migrated ${viewport}`));
          }
          return pairs.get(cacheKey);
        };
        await getPair();
        for(const rule of finding.rules) {
          const pair=await getPair(rule.pageKey,rule.viewport);
          checks.push(evaluateRule(rule,pair));
        }
        for(const [index,note] of (finding.reviews||[]).entries())checks.push({id:`manual-${index+1}`,label:'Owner or visual review obligation',status:'review',expected:'Recorded authorized review',actual:null,note});
        if(finding.id.startsWith('STYLE-')||finding.id==='GENERAL-01') {
          for(const [key,pair] of pairs) {
            const image=pair.new.artifacts?.mainScreenshot;
            if(!image||!pair.new.fontsReady||!pair.new.imagesSettled) {checks.push({id:`visual-${key}`,label:'Visual baseline comparison',status:'blocked',note:'A complete main-content screenshot with settled fonts and images was not captured.'});continue;}
            const diff=`evidence/diff-${digest(finding.id+key)}.png`;
            const visual=await checkVisual(options.approvedDir||'baselines/approved',visualKey(pair.pair.baselineURL,pair.viewport),join(options.outDir,image),visualEnv,join(options.outDir,diff));
            checks.push({id:`visual-${key}`,label:'Approved visual reference comparison',...visual});
            if(await access(join(options.outDir,diff)).then(()=>true,()=>false))evidence.push({label:'Pixel difference evidence',path:diff});
          }
        }
        for(const link of catalog.externalLinks.filter(l=>l.findingId===finding.id)) {
          const primary=(await getPair()).new;
          const present=primary.links?.some(a=>a.href===link.url&&a.visible&&a.inMain);
          if(primary.status!=='ready')checks.push({id:link.id,label:'External link occurrence',status:'blocked',note:'The migrated page is unreadable; current link occurrence is unknown.'});
          else if(!present)checks.push({id:link.id,label:'External link was removed or changed',status:'review',note:'The exact old target is no longer a visible migrated link. Verify the replacement before closing this finding.'});
          else {
            try {
              const r=await availability({...link,historicalStatus:'Previously unavailable'});
              checks.push(...r.checks.map(c=>({...c,id:`${link.id}/${c.id}`})));evidence.push(...r.evidence);
            } catch(e) {checks.push({id:`${link.id}/execution`,label:'External destination execution',status:'error',note:e.message});}
          }
        }
        return announce(result(finding.id,finding.title,'finding',checks,evidence,[finding.correction?`Historical report correction (not a current check result): ${finding.correction}`:'']));
      } catch(e) {return announce(result(finding.id,finding.title,'finding',[{id:'execution',label:'Finding execution',status:'error',note:e.message}]));}
    });
    if(supplemental) {
      await mapLimit(catalog.availability,concurrency,item=>collect({id:item.id,title:item.url,category:'availability'},()=>availability(item)));
      await mapLimit(catalog.filePairs,concurrency,pair=>collect({id:`FILE-${pair.id}`,title:pair.newURL,category:'file'},async()=>{
        const checks=[],evidence=[];
        if(pair.mode==='package') {
          checks.push(...await mapLimit(pair.dependencies,2,async(dep,index)=>{
            try {
              const [old,current]=await Promise.all([getResource(dep.oldURL),getResource(dep.newURL)]);
              evidence.push({label:`Dependency ${index+1} baseline`,path:old.evidencePath},{label:`Dependency ${index+1} migrated`,path:current.evidencePath});
              return {id:`dependency-${index+1}`,label:dep.newURL,...compareFiles(old,current,dep.sha256)};
            } catch(e) {return {id:`dependency-${index+1}`,label:dep.newURL,status:'error',note:e.message};}
          }));
          const [old,current]=await Promise.all([getSnapshot(pair.oldURL,'newsletter'),getSnapshot(pair.newURL,'newsletter')]);
          evidence.push(...evidenceOf(old,'Newsletter baseline'),...evidenceOf(current,'Newsletter migrated'));
          const readable=old.status==='ready'&&current.status==='ready'&&normalize(old.mainText)&&normalize(current.mainText);
          const access=aggregateStatus([accessCheck(old,'old'),accessCheck(current,'new')]);
          checks.push({id:'default-render',label:'Default rendered newsletter body',status:access!=='pass'?access:!readable?'blocked':normalize(old.mainText)===normalize(current.mainText)?'pass':'fail',expected:'Matching nonempty default rendered body text',actual:{oldStatus:old.status,newStatus:current.status,oldChars:normalize(old.mainText).length,newChars:normalize(current.mainText).length},note:'This check does not cover every pagination state.'});
        } else {
          const [old,current]=await Promise.all([getResource(pair.oldURL),getResource(pair.newURL)]);
          evidence.push({label:'Source document response',path:old.evidencePath},{label:'Migrated document response',path:current.evidencePath});
          checks.push({id:'documents-readable',label:'Both format-conversion files are readable',status:aggregateStatus([accessCheck(old,'old'),accessCheck(current,'new')]),actual:{old:old.status,new:current.status}});
          checks.push({id:'format-conversion',label:'DOC to PDF content and approved title',status:'review',expected:'Documented body comparison and owner approval of title/version changes',actual:{oldHash:old.sha256,newHash:current.sha256},note:pair.note});
        }
        if(pair.mode==='package')checks.push({id:'package-scope',label:'Package dependency coverage',status:pair.dependencies.length?'pass':'error',actual:pair.dependencies.length,note:'Only the versioned identified dependency inventory is compared; new or unlisted dependencies and exhaustive pagination are not certified.'});
        return result(`FILE-${pair.id}`,pair.newURL,'file',checks,evidence,[pair.note?`Catalog context (not a current check result): ${pair.note}`:'']);
      }));
      for(const task of anchorTasks) {
        await collect(task,async()=>{
          const {item,url,side,viewport}=task;
          const exercised=await anchors(browser,url,{outDir:options.outDir,side,viewport,expectedSections:item.expectedSections,mode:item.mode});
          return result(task.id,task.title,task.category,exercised.checks,exercised.evidence,['Keyboard activation; touch/pointer reliability is not certified.']);
        });
      }
    }
  } catch(e) {
    run.results.push(result('RUN-ERROR','Test execution could not finish','tool',[{id:'exception',label:'Runner error',status:'error',note:e.message}]));
  } finally {
    if(browser)try {await browser.close();}
    catch(e) {run.results.push(result('BROWSER-CLOSE-ERROR','Browser cleanup failed','tool',[{id:'close',label:'Browser cleanup',status:'error',note:e.message}]));}
    const notRun=planned.filter(item=>!run.results.some(r=>r.id===item.id));
    for(const item of notRun)run.results.push(result(item.id,item.title,item.category,[{id:'not-run',label:'Not executed',status:'blocked',note:'The run stopped before this item was executed.'}]));
    const order=new Map(planned.map((item,index)=>[item.id,index]));
    run.results.sort((a,b)=>(order.get(a.id)??planned.length)-(order.get(b.id)??planned.length));
    run.finishedAt=new Date().toISOString();
    const executedRules=selected.flatMap(f=>{const record=run.results.find(r=>r.id===f.id);return f.rules.flatMap(rule=>{const check=record?.checks.find(c=>c.id===rule.id);return check?[{rule,check}]:[];});});
    const automatic=executedRules.filter(x=>x.rule.type!=='review');
    const collectorCount=run.results.flatMap(r=>r.checks.filter(c=>!c.id.startsWith('manual-')&&!selected.find(f=>f.id===r.id)?.rules.some(rule=>rule.id===c.id))).length;
    run.coverage={findingIdsExpected:selected.map(f=>f.id),findingIdsReported:run.results.filter(r=>r.category==='finding').map(r=>r.id),historicalStatements:catalog.historicalClaims.length,historicalStatementsIndividuallyRerun:false,automaticRulesExpected:selected.flatMap(f=>f.rules).filter(r=>r.type!=='review').length,automaticRuleCount:automatic.length,automaticRuleOutcomes:Object.fromEntries(['pass','fail','blocked','review','error'].map(s=>[s,automatic.filter(x=>x.check.status===s).length])),reviewRulesReported:executedRules.filter(x=>x.rule.type==='review').length,collectorCheckCount:collectorCount,supplementalRequested:supplemental,availabilityExpected:supplemental?catalog.availability.length:0,availabilityReported:run.results.filter(r=>r.category==='availability').length,filePairsExpected:supplemental?catalog.filePairs.length:0,filePairsReported:run.results.filter(r=>r.category==='file').length,anchorsExpected:supplemental?catalog.anchors.length*4:0,anchorsReported:run.results.filter(r=>r.category==='anchors').length};
    run.coverage.notRunIds=notRun.map(item=>item.id);
    for(const [prefix,category] of [['availability','availability'],['filePairs','file'],['anchors','anchors']])run.coverage[`${prefix}Executed`]=run.results.filter(r=>r.category===category&&!r.checks.some(c=>c.id==='not-run')).length;
    const incomplete=notRun.length>0||run.coverage.availabilityExpected!==run.coverage.availabilityReported||run.coverage.filePairsExpected!==run.coverage.filePairsReported||run.coverage.anchorsExpected!==run.coverage.anchorsReported;
    if(incomplete)run.results.push(result('COVERAGE-INCOMPLETE','Requested execution is incomplete','tool',[{id:'coverage',label:'Expected versus executed coverage',status:'error',actual:run.coverage}]));
    run.summary=Object.fromEntries(['pass','fail','blocked','review','error'].map(status=>[status,run.results.filter(r=>r.status===status).length]));
    run.exitCode=acceptanceExit(run.results);
    await writeFile(join(options.outDir,'results.json'),JSON.stringify(run,null,2));
    await writeFile(join(options.outDir,'report.html'),renderReport(run));
  }
  return run;
}
