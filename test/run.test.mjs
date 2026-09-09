import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAudit, mapLimit } from '../src/run.mjs';
import { loadCatalog } from '../src/cli.mjs';
import { fileURLToPath } from 'node:url';
test('bounded mapping preserves order and never exceeds concurrency',async()=>{
  let active=0,peak=0;
  const result=await mapLimit([1,2,3,4],2,async n=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;return n*2;});
  assert.deepEqual(result,[2,4,6,8]);assert.equal(peak,2);
});

const fixtureSnapshot=(status='ready')=>({status,httpStatus:status==='missing'?404:200,mainText:status==='ready'?'Expected':'',mainHTML:'<p>Expected</p>',artifacts:{},links:[],images:[],headings:[],metrics:{}});
const fixtureCatalog=()=>({findings:[{id:'ABOUT-01',title:'Fixture',baselineURL:'https://rs.ieee.org/a',migratedURL:'https://ieeerelsoc.wpenginepowered.com/a',rules:[{id:'text',type:'requireText',label:'Required',values:['Expected']}],reviews:[]}],availability:[],filePairs:[],externalLinks:[],anchors:[],historicalClaims:[]});
const hash='a'.repeat(64);
const fixtureServices=()=>({launch:async()=>({version:()=> 'fixture',close:async()=>{}}),capture:async()=>fixtureSnapshot(),fetch:async()=>({status:'ready',httpStatus:200,complete:true,sha256:hash,contentType:'application/pdf'}),anchors:async()=>({checks:[{id:'target',label:'Fixture anchor',status:'pass'}],evidence:[]})});
const filePair=(id,mode='document-review')=>({id,mode,oldURL:`https://rs.ieee.org/${id}`,newURL:`https://ieeerelsoc.wpenginepowered.com/${id}`,dependencies:mode==='package'?[{oldURL:`https://rs.ieee.org/${id}.js`,newURL:`https://ieeerelsoc.wpenginepowered.com/${id}.js`,sha256:hash}]:[]});

for(const httpStatus of ['blocked','missing'])test(`a browser-readable landing page cannot certify a document after ${httpStatus} download`,async()=>{
  const root=await mkdtemp(join(tmpdir(),'rs-document-availability-'));
  const catalog=fixtureCatalog();catalog.availability=[{id:'download',url:'https://rs.ieee.org/file.pdf',expectedDocument:true}];
  try {
    const run=await runAudit(catalog,{outDir:join(root,'run')},{...fixtureServices(),fetch:async()=>({status:httpStatus,httpStatus:httpStatus==='missing'?404:null,complete:false,sha256:null,contentType:''})});
    const record=run.results.find(r=>r.id==='download');
    assert.notEqual(record.status,'pass');
    assert.ok(record.checks.some(c=>c.id==='document-type'&&c.status!=='pass'));
  } finally {await rm(root,{recursive:true,force:true});}
});

test('complete recognized documents pass availability without relying on a browser landing page',async()=>{
  const root=await mkdtemp(join(tmpdir(),'rs-complete-document-'));
  const catalog=fixtureCatalog();catalog.availability=[{id:'download',url:'https://rs.ieee.org/file.pdf',expectedDocument:true}];
  let destinationCaptures=0;
  try {
    const run=await runAudit(catalog,{outDir:join(root,'run')},{...fixtureServices(),
      fetch:async()=>({status:'ready',httpStatus:200,complete:true,sha256:hash,contentType:'application/pdf',signature:'255044462d312e37'}),
      capture:async(_b,_u,options)=>{if(options.side==='external')destinationCaptures++;return fixtureSnapshot();}
    });
    assert.equal(run.results.find(r=>r.id==='download').status,'pass');assert.equal(destinationCaptures,0);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('external collector failure preserves completed finding rules and checks later destinations',async()=>{
  const root=await mkdtemp(join(tmpdir(),'rs-external-failure-'));
  const catalog=fixtureCatalog();
  catalog.externalLinks=[{id:'external-broken',findingId:'ABOUT-01',url:'https://example.org/broken'},{id:'external-good',findingId:'ABOUT-01',url:'https://example.org/good'}];
  const services=fixtureServices();
  try {
    const run=await runAudit(catalog,{outDir:join(root,'run')},{...services,
      capture:async()=>({...fixtureSnapshot(),links:catalog.externalLinks.map(l=>({text:l.id,href:l.url,rawHref:l.url,visible:true,inMain:true}))}),
      fetch:async url=>{if(url.endsWith('/broken'))throw new Error('External collector failed');return services.fetch(url);}
    });
    const record=run.results.find(r=>r.id==='ABOUT-01');
    assert.equal(record.checks.find(c=>c.id==='text')?.status,'pass');
    assert.equal(record.checks.find(c=>c.id==='external-broken/execution')?.status,'error');
    assert.equal(record.checks.find(c=>c.id==='external-good/destination')?.status,'pass');
    assert.equal(run.coverage.automaticRuleCount,1);assert.equal(run.exitCode,3);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('an empty browser-visible body cannot pass destination availability',async()=>{
  const root=await mkdtemp(join(tmpdir(),'rs-empty-destination-'));
  const catalog=fixtureCatalog();catalog.availability=[{id:'blank',url:'https://example.org/blank'}];
  try {
    const run=await runAudit(catalog,{outDir:join(root,'run')},{...fixtureServices(),capture:async(_b,_u,options)=>options.side==='external'?{...fixtureSnapshot(),mainText:'  ',mainHTML:'<div style="height:100vh"></div>'}:fixtureSnapshot()});
    assert.equal(run.results.find(r=>r.id==='blank').status,'blocked');
    const imageOnly=await runAudit(catalog,{outDir:join(root,'image-only')},{...fixtureServices(),capture:async(_b,_u,options)=>options.side==='external'?{...fixtureSnapshot(),mainText:'',images:[{inMain:true,visible:true,loaded:true}]}:fixtureSnapshot()});
    assert.equal(imageOnly.results.find(r=>r.id==='blank').status,'pass');
  } finally {await rm(root,{recursive:true,force:true});}
});

test('historical correction notes cannot masquerade as current defect confirmations',async()=>{
  const root=await mkdtemp(join(tmpdir(),'rs-historical-note-'));
  const catalog=fixtureCatalog();catalog.findings[0].correction='The defect is confirmed.';
  try {
    const run=await runAudit(catalog,{outDir:join(root,'run')},fixtureServices());
    const finding=run.results.find(r=>r.id==='ABOUT-01');
    assert.equal(finding.status,'pass');
    assert.match(finding.notes[0],/^Historical report correction \(not a current check result\): /);
  } finally {await rm(root,{recursive:true,force:true});}
});

for(const concurrency of [1,2])test(`supplemental failures retain successes and execute every remaining item (concurrency ${concurrency})`,async()=>{
  const root=await mkdtemp(join(tmpdir(),'rs-run-items-'));
  const catalog=fixtureCatalog();
  catalog.availability=[1,2,3].map(i=>({id:`availability-${i}`,url:`https://rs.ieee.org/destination-${i}`}));
  catalog.filePairs=[filePair('good'),filePair('broken','package'),filePair('broken-doc'),filePair('later')];
  catalog.filePairs[1].dependencies.push({oldURL:'https://rs.ieee.org/later.js',newURL:'https://ieeerelsoc.wpenginepowered.com/later.js',sha256:hash});
  catalog.anchors=[{id:'anchor',baselineURL:'https://rs.ieee.org/anchors',migratedURL:'https://ieeerelsoc.wpenginepowered.com/anchors',expectedSections:1,mode:'return-top'}];
  const services=fixtureServices();let anchorCalls=0;
  try {
    const run=await runAudit(catalog,{outDir:join(root,'run'),concurrency},{...services,
      fetch:async url=>{if(url.endsWith('destination-2')||url.endsWith('broken.js')||url.endsWith('broken-doc'))throw new Error('Fixture resource failure');return services.fetch(url);},
      anchors:async()=>{if(++anchorCalls===1)throw new Error('Fixture anchor failure');return services.anchors();}
    });
    assert.deepEqual(run.results.filter(r=>r.category==='availability').map(r=>[r.id,r.status]),[['availability-1','pass'],['availability-2','error'],['availability-3','pass']]);
    assert.deepEqual(run.results.filter(r=>r.category==='file').map(r=>[r.id,r.status]),[['FILE-good','review'],['FILE-broken','error'],['FILE-broken-doc','error'],['FILE-later','review']]);
    assert.equal(run.results.find(r=>r.id==='FILE-broken').checks.find(c=>c.id==='dependency-2').status,'pass');
    assert.equal(anchorCalls,4);
    assert.deepEqual(run.results.filter(r=>r.category==='anchors').map(r=>r.status),['error','pass','pass','pass']);
    assert.equal(run.exitCode,3);
    assert.equal(run.coverage.availabilityReported,3);assert.equal(run.coverage.filePairsReported,4);assert.equal(run.coverage.anchorsReported,4);
    assert.equal(run.coverage.availabilityExecuted,3);assert.equal(run.coverage.filePairsExecuted,4);assert.equal(run.coverage.anchorsExecuted,4);
    assert.equal(new Set(run.results.map(r=>r.id)).size,run.results.length);
  } finally {await rm(root,{recursive:true,force:true});}
});

for(const mode of ['document-review','package'])for(const [oldStatus,newStatus,expected,exit] of [['ready','missing','fail',1],['missing','ready','blocked',2],['ready','error','error',3],['error','ready','error',3]])test(`${mode} preserves ${oldStatus}/${newStatus} as ${expected}`,async()=>{
  const root=await mkdtemp(join(tmpdir(),'rs-run-file-'));
  const catalog=fixtureCatalog();catalog.filePairs=[filePair('file',mode)];
  const services=fixtureServices();
  try {
    const run=await runAudit(catalog,{outDir:join(root,'run')},{...services,
      capture:async(_browser,url,options)=>fixtureSnapshot(options.side==='newsletter'?(url.includes('wpengine')?newStatus:oldStatus):'ready'),
      fetch:async url=>({...await services.fetch(url),status:mode==='document-review'?(url.includes('wpengine')?newStatus:oldStatus):'ready'})
    });
    assert.equal(run.results.find(r=>r.id==='FILE-file').status,expected);assert.equal(run.exitCode,exit);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('launch failure records every planned ID as not run and marks coverage incomplete',async()=>{
  const root=await mkdtemp(join(tmpdir(),'rs-run-launch-'));
  const catalog=await loadCatalog(fileURLToPath(new URL('..',import.meta.url)));
  const planned=[...catalog.findings.map(f=>f.id),...catalog.availability.map(a=>a.id),...catalog.filePairs.map(p=>`FILE-${p.id}`),...catalog.anchors.flatMap(a=>['desktop','mobile'].flatMap(v=>['old','new'].map(s=>`${a.id}-${s}-${v}`)))];
  try {
    const run=await runAudit(catalog,{outDir:join(root,'run')},{launch:async()=>{throw new Error('Fixture launch failure');}});
    for(const id of planned) {
      const records=run.results.filter(r=>r.id===id);assert.equal(records.length,1,id);
      assert.equal(records[0].status,'blocked',id);assert.equal(records[0].checks[0].id,'not-run',id);
    }
    assert.ok(run.results.some(r=>r.id==='COVERAGE-INCOMPLETE'));assert.equal(run.exitCode,3);
    assert.equal(run.coverage.automaticRuleCount,0);assert.equal(run.coverage.historicalStatementsIndividuallyRerun,false);
    assert.equal(run.coverage.availabilityReported,44);assert.equal(run.coverage.filePairsReported,5);assert.equal(run.coverage.anchorsReported,12);
    assert.equal(run.coverage.availabilityExecuted,0);assert.equal(run.coverage.filePairsExecuted,0);assert.equal(run.coverage.anchorsExecuted,0);
    assert.deepEqual(run.coverage.notRunIds,planned);
    assert.ok((await readFile(join(root,'run','report.html'),'utf8')).includes('COVERAGE-INCOMPLETE'));
  } finally {await rm(root,{recursive:true,force:true});}
});

test('browser cleanup failure records a tool error and still saves completed reports',async()=>{
  const root=await mkdtemp(join(tmpdir(),'rs-run-close-'));
  try {
    const run=await runAudit(fixtureCatalog(),{outDir:join(root,'run')},{...fixtureServices(),launch:async()=>({version:()=> 'fixture',close:async()=>{throw new Error('Fixture close failure');}})});
    assert.equal(run.results.find(r=>r.id==='ABOUT-01').status,'pass');assert.equal(run.exitCode,3);
    assert.ok(run.results.some(r=>r.category==='tool'&&r.status==='error'&&r.checks.some(c=>c.note?.includes('Fixture close failure'))));
    const saved=JSON.parse(await readFile(join(root,'run','results.json'),'utf8'));
    assert.equal(saved.exitCode,3);assert.ok(saved.finishedAt);
    assert.ok((await readFile(join(root,'run','report.html'),'utf8')).includes('Fixture close failure'));
  } finally {await rm(root,{recursive:true,force:true});}
});
test('runner emits current checks, manual obligations, partial scope and nonzero gate',async()=>{
  const root=await mkdtemp(join(tmpdir(),'rs-run-'));
  const finding=id=>({id,title:id,baselineURL:'https://rs.ieee.org/a',migratedURL:'https://ieeerelsoc.wpenginepowered.com/a',rules:[{id:'text',type:'requireText',label:'Required content',values:['Expected']}],reviews:id==='ABOUT-02'?['Owner must confirm roster']:[]});
  const catalog={findings:[finding('ABOUT-01'),finding('ABOUT-02')],availability:[],filePairs:[],externalLinks:[],anchors:[],historicalClaims:[]};
  let closed=false;
  const services={launch:async()=>({version:()=> 'fixture',close:async()=>{closed=true;}}),capture:async(_b,url)=>({status:'ready',httpStatus:200,mainText:url.includes('wpengine')?'Wrong':'Expected',mainHTML:'<p>Expected</p>',artifacts:{},links:[],images:[],headings:[],metrics:{}})};
  try {
    const run=await runAudit(catalog,{ids:'ABOUT-01',outDir:join(root,'run'),approvedDir:join(root,'approved')},services);
    assert.equal(run.exitCode,1);assert.equal(run.scope.partial,true);assert.equal(run.results.length,1);assert.equal(closed,true);
    assert.equal(run.coverage.automaticRuleCount,1);
    assert.equal(run.coverage.collectorCheckCount,2);
    assert.equal(JSON.parse(await readFile(join(root,'run','results.json'),'utf8')).results[0].checks.some(c=>c.status==='fail'),true);
    const full=await runAudit(catalog,{outDir:join(root,'full'),approvedDir:join(root,'approved')},{...services,capture:async()=>({status:'ready',httpStatus:200,mainText:'Expected',mainHTML:'<p>Expected</p>',artifacts:{},links:[],images:[],headings:[],metrics:{}})});
    assert.equal(full.results[1].status,'review');assert.equal(full.exitCode,2);
    assert.equal(full.coverage.automaticRuleCount,2);
  } finally {await rm(root,{recursive:true,force:true});}
});
