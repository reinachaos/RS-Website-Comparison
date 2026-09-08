import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import * as cli from '../src/cli.mjs';
import { parseCLI, loadCatalog, validateCatalog } from '../src/cli.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
test('CLI rejects unknown commands, options, selections and invalid concurrency',()=>{
  assert.equal(parseCLI(['run','--ids','ABOUT-01']).ids,'ABOUT-01');
  assert.equal(parseCLI(['run']).command,'run');
  assert.throws(()=>parseCLI(['pretend']),/command/i);
  assert.throws(()=>parseCLI(['run','--typo']),/option/i);
  assert.throws(()=>parseCLI(['run','--concurrency','8']),/concurrency/i);
});
test('catalog loads standalone and validates every original and supplemental inventory',async()=>{
  const data=await loadCatalog(root),counts=validateCatalog(data);
  assert.equal(counts.findings,36);assert.equal(counts.historicalClaims,344);
  assert.equal(counts.availability,44);assert.equal(counts.filePairs,5);assert.equal(counts.dependencies,71);assert.equal(counts.externalLinks,11);
  assert.throws(()=>validateCatalog({...data,findings:data.findings.slice(1)}),/36/);
  const changed=structuredClone(data);changed.findings[0].rules[0].type='unsupported';
  assert.throws(()=>validateCatalog(changed),/rule|Unknown/i);
});

for(const unsettled of [false,true])test(`baseline capture resolves primary routes and records image readiness (${unsettled?'unsettled':'settled'})`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'rs-cli-baseline-'));
  const catalog=await loadCatalog(root);
  const selected=catalog.findings.filter(f=>f.id.startsWith('STYLE-')||f.id==='GENERAL-01');
  const calls=[];let closed=false;
  const png=new PNG({width:2,height:2});png.data.fill(255);
  try {
    const outcome=await cli.captureBaseline(selected,directory,{
      launch:async()=>({version:()=> 'fixture',close:async()=>{closed=true;}}),
      capture:async(_browser,url,options)=>{
        const image=`source-${calls.length}.png`;calls.push({url,viewport:options.viewport});
        await writeFile(join(options.outDir,image),PNG.sync.write(png));
        return {status:'ready',fontsReady:true,imagesSettled:!unsettled,artifacts:{mainScreenshot:image}};
      }
    });
    assert.equal(outcome.exitCode,unsettled?2:0);assert.equal(closed,true);
    for(const f of selected)assert.ok(calls.some(c=>c.url===f.baselineURL),f.id);
    assert.ok(calls.some(c=>c.viewport==='mobile'));
    const coverage=JSON.parse(await readFile(join(directory,'capture-coverage.json'),'utf8'));
    assert.equal(coverage.length,calls.length);
    assert.ok(coverage.every(c=>c.imagesSettled===!unsettled));
    if(unsettled)await assert.rejects(readFile(join(directory,'manifest.json')),/ENOENT/);
    else assert.equal(JSON.parse(await readFile(join(directory,'manifest.json'),'utf8')).entries.length,calls.length);
  } finally {await rm(directory,{recursive:true,force:true});}
});
