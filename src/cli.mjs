import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { validateRule } from './rules.mjs';
import { safeWebURL, selectFindings } from './core.mjs';
import { runAudit, mapLimit } from './run.mjs';
import { capturePage } from './browser.mjs';
import { createCandidate, approveCandidate, visualKey } from './baseline.mjs';

export function parseCLI(args) {
  const {values,positionals}=parseArgs({args,allowPositionals:true,strict:true,options:{ids:{type:'string'},out:{type:'string'},concurrency:{type:'string'},candidate:{type:'string'},reviewer:{type:'string'},reason:{type:'string'},replace:{type:'boolean'},'skip-supplemental':{type:'boolean'},help:{type:'boolean'}}});
  const command=values.help?'help':positionals[0]||'help';
  if(positionals.length>1||!['run','list','validate','baseline-capture','baseline-approve','help'].includes(command))throw new Error('Unknown command or extra positional argument');
  const concurrency=values.concurrency===undefined?2:Number(values.concurrency);
  if(![1,2].includes(concurrency))throw new Error('Concurrency must be 1 or 2');
  return {...values,command,concurrency,skipSupplemental:!!values['skip-supplemental']};
}
export async function loadCatalog(root) {
  const names={findings:'findings',availability:'availability',filePairs:'file-pairs',externalLinks:'external-links',anchors:'anchors',historicalClaims:'historical-claims'};
  return Object.fromEntries(await Promise.all(Object.entries(names).map(async([key,file])=>[key,JSON.parse(await readFile(join(root,'catalog',file+'.json'),'utf8'))])));
}
export function validateCatalog(catalog) {
  const expected={findings:36,availability:44,filePairs:5,externalLinks:11,anchors:3,historicalClaims:344};
  for(const [key,count] of Object.entries(expected)) {
    const entries=catalog[key];
    if(!Array.isArray(entries)||entries.length!==count)throw new Error(`Expected ${count} ${key}`);
    if(new Set(entries.map(e=>e.id)).size!==count||entries.some(e=>!e.id))throw new Error(`Duplicate or missing ${key} IDs`);
  }
  let automated=0,review=0;
  for(const finding of catalog.findings) {
    safeWebURL(finding.baselineURL);safeWebURL(finding.migratedURL);
    const keys=new Set();
    for(const page of finding.pages||[]) {
      if(!page.key||keys.has(page.key))throw new Error(`Duplicate page key in ${finding.id}`);
      if(page.key==='primary'&&(page.baselineURL!==finding.baselineURL||page.migratedURL!==finding.migratedURL))throw new Error(`Primary page override differs in ${finding.id}`);
      keys.add(page.key);safeWebURL(page.baselineURL);safeWebURL(page.migratedURL);
    }
    keys.add('primary');
    if(!Array.isArray(finding.rules)||!finding.rules.length||!Array.isArray(finding.reviews))throw new Error(`Rules/review obligations missing in ${finding.id}`);
    const ids=new Set();
    for(const rule of finding.rules) {
      const errors=validateRule(rule);
      if(errors.length)throw new Error(`${finding.id} rule ${rule.id}: ${errors.join('; ')}`);
      if(ids.has(rule.id)||!keys.has(rule.pageKey||'primary'))throw new Error(`Invalid rule ID/page mapping in ${finding.id}`);
      ids.add(rule.id);rule.type==='review'?review++:automated++;
    }
  }
  for(const item of [...catalog.availability,...catalog.externalLinks])safeWebURL(item.url);
  for(const item of catalog.externalLinks)if(!catalog.findings.some(f=>f.id===item.findingId))throw new Error('External link finding mapping missing');
  for(const pair of catalog.filePairs) {
    safeWebURL(pair.oldURL);safeWebURL(pair.newURL);
    if(!['package','document-review'].includes(pair.mode))throw new Error('Unknown file comparison mode');
    for(const dependency of pair.dependencies) {
      safeWebURL(dependency.oldURL);safeWebURL(dependency.newURL);
      if(!/^[a-f0-9]{64}$/.test(dependency.sha256))throw new Error('Invalid historical dependency hash');
    }
  }
  for(const item of catalog.anchors) {
    safeWebURL(item.baselineURL);safeWebURL(item.migratedURL);
    if(item.mode==='sections') {
      if(!Array.isArray(item.expectedSections)||!item.expectedSections.length)throw new Error('Section mappings required');
      for(const s of item.expectedSections)if(!s.baselineFragment?.startsWith('#')||!s.migratedFragment?.startsWith('#')||!s.label)throw new Error('Invalid section mapping');
    } else if(item.mode!=='return-top'||!Number.isInteger(item.expectedSections)||item.expectedSections<1)throw new Error('Invalid anchor mode/count');
  }
  const dependencies=catalog.filePairs.reduce((n,p)=>n+p.dependencies.length,0);
  if(dependencies!==71)throw new Error('Expected 71 identified dependency pairs');
  return {...expected,dependencies,automatedRules:automated,reviewRules:review};
}
export async function captureBaseline(selected,candidate,services={}) {
  const evidenceDir=join(candidate,'capture');
  await mkdir(evidenceDir,{recursive:true});
  const browser=await (services.launch||(()=>chromium.launch({headless:true})))();
  try {
    const pages=new Map();
    for(const f of selected)for(const rule of f.rules) {
      const page=!rule.pageKey||rule.pageKey==='primary'?f:f.pages?.find(p=>p.key===rule.pageKey);
      if(!page)throw new Error('Missing baseline page mapping');
      const viewport=rule.viewport||'desktop';pages.set(visualKey(page.baselineURL,viewport),{url:page.baselineURL,viewport});
    }
    const captures=await mapLimit([...pages],2,async([key,p])=>({key,...p,snapshot:await (services.capture||capturePage)(browser,p.url,{outDir:evidenceDir,side:'old',viewport:p.viewport})}));
    const images=captures.filter(c=>c.snapshot.status==='ready'&&c.snapshot.fontsReady&&c.snapshot.imagesSettled&&c.snapshot.artifacts.mainScreenshot).map(c=>({key:c.key,url:c.url,requestedURL:c.snapshot.requestedURL,finalURL:c.snapshot.finalURL,viewport:c.viewport,path:join(evidenceDir,c.snapshot.artifacts.mainScreenshot)}));
    await writeFile(join(candidate,'capture-coverage.json'),JSON.stringify(captures.map(c=>({url:c.url,requestedURL:c.snapshot.requestedURL??null,finalURL:c.snapshot.finalURL??null,viewport:c.viewport,status:c.snapshot.status,fontsReady:c.snapshot.fontsReady,imagesSettled:c.snapshot.imagesSettled,error:c.snapshot.error})),null,2));
    const env={platform:process.platform,arch:process.arch,browser:browser.version(),locale:'en-US',timezone:'UTC',scale:1};
    if(images.length)await createCandidate(images,candidate,env);
    return {captured:images.length,total:captures.length,exitCode:images.length===captures.length?0:2};
  } finally {await browser.close();}
}
export async function main(args=process.argv.slice(2)) {
  const options=parseCLI(args),root=fileURLToPath(new URL('..',import.meta.url));
  if(options.command==='help') {
    console.log('Commands: run [--ids ABOUT-01,TECH-01] [--skip-supplemental] [--out artifacts/run-name] [--concurrency 1|2]\nlist | validate\nbaseline-capture [--ids STYLE-01,STYLE-02,STYLE-03,STYLE-04,GENERAL-01]\nbaseline-approve --candidate baselines/candidates/ID --reviewer NAME --reason TEXT [--replace]\nExit: 0 accepted selected scope; 1 discrepancy; 2 blocked/review; 3 tool/configuration error.');return 0;
  }
  const catalog=await loadCatalog(root),counts=validateCatalog(catalog);
  if(options.command==='validate'){console.log(JSON.stringify(counts,null,2));return 0;}
  if(options.command==='list'){for(const f of catalog.findings)console.log(`${f.id}\t${f.title}\t${f.rules.length} rules`);console.log(JSON.stringify(counts));return 0;}
  if(options.command==='baseline-approve') {
    if(!options.candidate)throw new Error('--candidate is required');
    const approved=await approveCandidate(resolve(root,options.candidate),join(root,'baselines/approved'),options);
    console.log(`Approved ${approved.entries.length} visual references. Review and commit baselines/approved explicitly.`);return 0;
  }
  const id=new Date().toISOString().replace(/[:.]/g,'-');
  if(options.command==='baseline-capture') {
    const selected=selectFindings(catalog.findings,options.ids||'STYLE-01,STYLE-02,STYLE-03,STYLE-04,GENERAL-01');
    const candidate=join(root,'baselines/candidates',id);
    const outcome=await captureBaseline(selected,candidate);
    console.log(`Unapproved candidate: ${candidate}\nCaptured ${outcome.captured}/${outcome.total}. Inspect source screenshots and coverage before approval.`);
    return outcome.exitCode;
  }
  let revision=null;
  try {revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
  const outDir=options.out?resolve(root,options.out):join(root,'artifacts',id);
  const run=await runAudit(catalog,{...options,runId:id,outDir,approvedDir:join(root,'baselines/approved'),revision,onProgress:line=>console.log(line)});
  console.log(`Report: ${join(outDir,'report.html')}\nResults: ${join(outDir,'results.json')}\n${JSON.stringify(run.summary)}\nAcceptance exit code: ${run.exitCode}`);
  return run.exitCode;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().then(code=>{process.exitCode=code;},error=>{console.error(`QA tool error: ${error.message}`);process.exitCode=3;});
}
