import { mkdir, readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { safeWebURL } from './core.mjs';

const sha=data=>createHash('sha256').update(data).digest('hex');
const exists=path=>access(path).then(()=>true,()=>false);
const imageName=file=>typeof file==='string'&&/^[a-f0-9]{64}\.png$/.test(file);
export const visualKey=(url,viewport='desktop')=>sha(`${url}|${viewport}`);
function validateIdentity(entry) {
  safeWebURL(entry.url);
  if(new URL(entry.url).hostname!=='rs.ieee.org'||!['desktop','mobile'].includes(entry.viewport||'desktop')||entry.key!==visualKey(entry.url,entry.viewport||'desktop'))throw new Error('Visual reference URL/viewport key identity mismatch');
}

export async function createCandidate(images,directory,environment) {
  if(!images.length)throw new Error('No readable source screenshots to capture');
  if(await exists(join(directory,'manifest.json')))throw new Error('Candidate already exists; use a new directory');
  await mkdir(directory,{recursive:true});
  const entries=[];
  for(const item of images) {
    validateIdentity(item);
    if(entries.some(e=>e.key===item.key))throw new Error('Duplicate visual reference key');
    if(new URL(item.url).hostname!=='rs.ieee.org')throw new Error('A source reference must come from rs.ieee.org');
    const bytes=await readFile(item.path),png=PNG.sync.read(bytes),digest=sha(bytes),file=`${digest}.png`;
    await copyFile(item.path,join(directory,file));
    entries.push({key:item.key,url:item.url,file,sha256:digest,width:png.width,height:png.height,viewport:item.viewport||'desktop'});
  }
  const result={schemaVersion:1,approved:false,createdAt:new Date().toISOString(),environment,entries};
  await writeFile(join(directory,'manifest.json'),JSON.stringify(result,null,2));
  return result;
}
export async function approveCandidate(candidate,approved,{reviewer,reason,replace=false}={}) {
  if(!reviewer?.trim()||!reason?.trim())throw new Error('A reviewer and approval reason are required');
  const data=JSON.parse(await readFile(join(candidate,'manifest.json'),'utf8'));
  if(data.schemaVersion!==1||data.approved!==false||!data.environment||!data.entries?.length)throw new Error('Invalid candidate manifest');
  const seen=new Set();
  for(const entry of data.entries) {
    validateIdentity(entry);
    if(!entry.key||seen.has(entry.key)||!imageName(entry.file)||new URL(entry.url).hostname!=='rs.ieee.org')throw new Error('Invalid candidate entry');
    seen.add(entry.key);
    const bytes=await readFile(join(candidate,entry.file));
    if(sha(bytes)!==entry.sha256||entry.file!==`${entry.sha256}.png`)throw new Error('Candidate image hash mismatch');
    const png=PNG.sync.read(bytes);
    if(png.width!==entry.width||png.height!==entry.height)throw new Error('Candidate dimensions mismatch');
  }
  const manifest=join(approved,'manifest.json');
  if(await exists(manifest)) {
    if(!replace)throw new Error('Approved baseline already exists; explicit replace is required');
    const old=await readFile(manifest);
    await writeFile(join(approved,`history-${sha(old)}.json`),old);
  }
  await mkdir(approved,{recursive:true});
  for(const entry of data.entries)await copyFile(join(candidate,entry.file),join(approved,entry.file));
  const result={...data,approved:true,reviewer:reviewer.trim(),reason:reason.trim(),approvedAt:new Date().toISOString()};
  await writeFile(manifest,JSON.stringify(result,null,2));
  return result;
}
export async function checkVisual(directory,key,currentPath,environment,diffPath,{maxDiffRatio=.01}={}) {
  const expected='Approved source-region screenshot in the same recorded environment';
  if(!await exists(join(directory,'manifest.json')))return {status:'review',expected,actual:null,note:'No approved visual references. Capture and review a candidate; normal QA never auto-approves.'};
  try {
    const data=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
    if(data.approved!==true||!data.reviewer||!data.reason||data.schemaVersion!==1)throw new Error('Invalid approved manifest');
    if(JSON.stringify(data.environment)!==JSON.stringify(environment))return {status:'review',expected,actual:{baseline:data.environment,current:environment},note:'Visual runtime differs. Generate references in the same environment; do not call font-rendering drift a migration defect.'};
    const entry=data.entries.find(e=>e.key===key);
    if(!entry)return {status:'review',expected,actual:key,note:'No approved screenshot for this page and viewport.'};
    validateIdentity(entry);
    if(!imageName(entry.file))throw new Error('Invalid baseline path');
    const bytes=await readFile(join(directory,entry.file));
    if(sha(bytes)!==entry.sha256)throw new Error('Approved image hash mismatch');
    const old=PNG.sync.read(bytes),current=PNG.sync.read(await readFile(currentPath));
    if(old.width!==current.width||old.height!==current.height)return {status:'review',expected,actual:{old:[old.width,old.height],new:[current.width,current.height]},note:'Region dimensions changed. Review structure and typography; no image stretching was used.'};
    const diff=new PNG({width:old.width,height:old.height});
    const changed=pixelmatch(old.data,current.data,diff.data,old.width,old.height,{threshold:.2,includeAA:false});
    await mkdir(join(diffPath,'..'),{recursive:true});
    await writeFile(diffPath,PNG.sync.write(diff));
    const ratio=changed/(old.width*old.height);
    return {status:ratio<=maxDiffRatio?'pass':'review',expected,actual:{changedPixels:changed,ratio,maxDiffRatio},note:'Pixel differences are review evidence, not automatically migration defects; minor typography is not separately failed.'};
  } catch(e) {return {status:'error',expected,actual:null,note:e.message};}
}
