import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { createCandidate, approveCandidate, checkVisual, visualKey } from '../src/baseline.mjs';
test('visual references require explicit approval, matching runtime and untampered pixels',async()=>{
  const root=await mkdtemp(join(tmpdir(),'rs-baseline-'));
  const env={platform:'test',browser:'fixture',locale:'en-US',scale:1};
  const png=new PNG({width:4,height:4});png.data.fill(255);
  const input=join(root,'input.png');await writeFile(input,PNG.sync.write(png));
  const key=visualKey('https://rs.ieee.org/test','desktop');
  try {
    assert.equal((await checkVisual(join(root,'approved'),key,input,env,join(root,'diff.png'))).status,'review');
    await createCandidate([{key,url:'https://rs.ieee.org/test',requestedURL:'https://rs.ieee.org/test',finalURL:'https://rs.ieee.org/test',path:input}],join(root,'candidate'),env);
    await assert.rejects(()=>approveCandidate(join(root,'candidate'),join(root,'approved'),{}),/reviewer|reason/i);
    await approveCandidate(join(root,'candidate'),join(root,'approved'),{reviewer:'test',reason:'Fixture reviewed'});
    assert.equal((await checkVisual(join(root,'approved'),key,input,env,join(root,'diff.png'))).status,'pass');
    assert.equal((await checkVisual(join(root,'approved'),key,input,{...env,platform:'different'},join(root,'diff.png'))).status,'review');
    png.data.fill(0);await writeFile(input,PNG.sync.write(png));
    assert.equal((await checkVisual(join(root,'approved'),key,input,env,join(root,'diff.png'))).status,'review');
    const m=JSON.parse(await readFile(join(root,'approved','manifest.json'),'utf8'));
    await writeFile(join(root,'approved',m.entries[0].file),'tampered');
    assert.equal((await checkVisual(join(root,'approved'),key,input,env,join(root,'diff.png'))).status,'error');
    await assert.rejects(()=>approveCandidate(join(root,'candidate'),join(root,'approved'),{reviewer:'test',reason:'no silent replace'}),/already/i);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('approval rejects a correct image assigned to the wrong URL or viewport key',async()=>{
  const root=await mkdtemp(join(tmpdir(),'rs-baseline-map-'));
  const png=new PNG({width:2,height:2});png.data.fill(255);
  const input=join(root,'input.png');await writeFile(input,PNG.sync.write(png));
  try {
    const dir=join(root,'candidate');
    await createCandidate([{key:visualKey('https://rs.ieee.org/a','desktop'),url:'https://rs.ieee.org/a',requestedURL:'https://rs.ieee.org/a',finalURL:'https://rs.ieee.org/a',viewport:'desktop',path:input}],dir,{platform:'fixture'});
    const manifest=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'));
    manifest.entries[0].key=visualKey('https://rs.ieee.org/b','mobile');
    await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest));
    await assert.rejects(()=>approveCandidate(dir,join(root,'approved'),{reviewer:'test',reason:'Wrong mapping'}),/identity|key|mapping/i);
  } finally {await rm(root,{recursive:true,force:true});}
});

async function provenanceFixture(t) {
  const root=await mkdtemp(join(tmpdir(),'rs-baseline-provenance-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const png=new PNG({width:2,height:2});png.data.fill(255);
  const input=join(root,'input.png');await writeFile(input,PNG.sync.write(png));
  const url='https://rs.ieee.org/source',env={platform:'fixture'};
  return {root,input,env,candidate:join(root,'candidate'),approved:join(root,'approved'),
    entry:{url,key:visualKey(url),requestedURL:url,finalURL:url,viewport:'desktop',path:input}};
}

test('same-origin redirect provenance survives candidate approval and comparison',async t=>{
  const f=await provenanceFixture(t);
  f.entry.finalURL='https://rs.ieee.org/redirected-source';
  const candidate=await createCandidate([f.entry],f.candidate,f.env);
  assert.equal(candidate.entries[0].requestedURL,f.entry.url);
  assert.equal(candidate.entries[0].finalURL,f.entry.finalURL);
  const approved=await approveCandidate(f.candidate,f.approved,{reviewer:'test',reason:'Redirected source path reviewed'});
  assert.equal(approved.entries[0].requestedURL,f.entry.url);
  assert.equal(approved.entries[0].finalURL,f.entry.finalURL);
  assert.equal((await checkVisual(f.approved,f.entry.key,f.input,f.env,join(f.root,'diff.png'))).status,'pass');
});

const invalidProvenance=[
  ['legacy entry without provenance',entry=>{delete entry.requestedURL;delete entry.finalURL;}],
  ['missing final URL',entry=>{delete entry.finalURL;}],
  ['migration origin',entry=>{entry.finalURL='https://ieeerelsoc.wpenginepowered.com/source';}],
  ['changed scheme',entry=>{entry.finalURL='http://rs.ieee.org/source';}],
  ['different requested identity',entry=>{entry.requestedURL='https://rs.ieee.org/other';}],
];
for(const [label,mutate] of invalidProvenance)for(const stage of ['capture','approve','compare']) {
  test(`${stage} rejects ${label}`,async t=>{
    const f=await provenanceFixture(t);
    if(stage==='capture') {
      mutate(f.entry);
      await assert.rejects(()=>createCandidate([f.entry],f.candidate,f.env),/provenance/i);
      await assert.rejects(readFile(join(f.candidate,'manifest.json')),/ENOENT/);
      return;
    }
    const candidate=await createCandidate([f.entry],f.candidate,f.env);
    if(stage==='approve') {
      mutate(candidate.entries[0]);
      await writeFile(join(f.candidate,'manifest.json'),JSON.stringify(candidate));
      await assert.rejects(()=>approveCandidate(f.candidate,f.approved,{reviewer:'test',reason:'Fixture'}),/provenance/i);
      return;
    }
    const approved=await approveCandidate(f.candidate,f.approved,{reviewer:'test',reason:'Fixture'});
    mutate(approved.entries[0]);
    await writeFile(join(f.approved,'manifest.json'),JSON.stringify(approved));
    const result=await checkVisual(f.approved,f.entry.key,f.input,f.env,join(f.root,'diff.png'));
    assert.equal(result.status,'error');
    assert.match(result.note,/provenance/i);
  });
}
