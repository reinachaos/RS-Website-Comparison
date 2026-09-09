import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns';
import { createHash } from 'node:crypto';
import { safeWebURL, redactURL, redactEvidence, classifyPage } from './core.mjs';
import { isPublicAddress } from './network-policy.mjs';
export { isPublicAddress } from './network-policy.mjs';

function guardedLookup(host,options,callback) {
  lookup(host,{all:true},(error,addresses)=>{
    if(error) return callback(error);
    if(!addresses.length||addresses.some(a=>!isPublicAddress(a.address))) return callback(new Error('DNS resolved to a private or reserved address'));
    if(options.all) callback(null,addresses); else callback(null,addresses[0].address,addresses[0].family);
  });
}
function requestOne(url,{maxBytes,timeoutMs,allowLocal}) {
  return new Promise(resolve=>{
    const u=new URL(url),transport=u.protocol==='https:'?https:http;
    let statusCode=null,headers={},bytes=0,done=false;
    const finish=result=>{if(done)return;done=true;clearTimeout(timer);resolve({httpStatus:statusCode,headers,bytes,...result});};
    const req=transport.request(u,{method:'GET',rejectUnauthorized:true,headers:{'User-Agent':'RS-Website-Comparison/1.0 (read-only migration QA)','Accept-Encoding':'identity'},lookup:allowLocal?lookup:guardedLookup},res=>{
      statusCode=res.statusCode; headers=res.headers;
      if([301,302,303,307,308].includes(statusCode)&&headers.location){finish({redirect:headers.location,complete:false});res.destroy();return;}
      if(statusCode===206||headers['content-range']){finish({complete:false,sha256:null,error:'Partial representation received; EOF does not establish the complete file'});res.destroy();return;}
      if(headers['content-encoding']&&headers['content-encoding'].trim().toLowerCase()!=='identity'){finish({complete:false,sha256:null,error:'Unsupported Content-Encoding; wire bytes are not comparable file bytes'});res.destroy();return;}
      const hash=createHash('sha256');let head=Buffer.alloc(0);
      res.on('data',chunk=>{
        bytes+=chunk.length;
        if(bytes>maxBytes){finish({complete:false,sha256:null,error:`Response exceeds ${maxBytes} byte limit`});res.destroy();return;}
        hash.update(chunk);
        if(head.length<8192)head=Buffer.concat([head,chunk.subarray(0,8192-head.length)]);
      });
      res.on('end',()=>finish({complete:true,sha256:hash.digest('hex'),signature:head.toString('hex'),prefix:head.toString('utf8')}));
      res.on('error',e=>finish({complete:false,sha256:null,error:e.message}));
      res.on('aborted',()=>finish({complete:false,sha256:null,error:'Response aborted before EOF'}));
    });
    const timer=setTimeout(()=>req.destroy(new Error('Request timed out')),timeoutMs);
    req.on('error',e=>finish({complete:false,sha256:null,error:e.message}));
    req.end();
  });
}
function inspectFile(input,url,contentType,prefix,signature) {
  const html=/\b(?:text\/html|application\/xhtml\+xml)\b/i.test(contentType)||/^\s*(?:<!--[\s\S]*?-->\s*)*<(?:!doctype\s+html\b|html\b|head\b|body\b|title\b|form\b|input\b|script\b|div\b|h[1-6]\b|p\b)/i.test(prefix);
  const paths=[input,url].map(value=>new URL(value).pathname);
  const expectedPDF=paths.some(p=>/\.pdf$/i.test(p))||/application\/pdf/i.test(contentType);
  const expectedJS=paths.some(p=>/\.(?:m?js)$/i.test(p))||/(?:java|ecma)script/i.test(contentType);
  const expectedOther=paths.some(p=>/\.(?:png|jpe?g|gif|webp|svg|ico|zip|docx?|xlsx?|pptx?|css|json|csv|txt|woff2?)$/i.test(p))||/^(?:image\/|font\/|application\/(?!xhtml))/i.test(contentType);
  const login=html&&(/<input\b[^>]*type\s*=\s*["']?password\b/i.test(prefix)||classifyPage({httpStatus:200,text:prefix,finalURL:url})==='blocked');
  if(login)return {fileTypeValid:false,blocked:true};
  if(html)return {fileTypeValid:false,blocked:expectedPDF||expectedJS||expectedOther,html:true};
  if(expectedPDF)return {fileTypeValid:signature.startsWith('255044462d'),blocked:!signature.startsWith('255044462d')};
  if(expectedJS)return {fileTypeValid:/(?:javascript|ecmascript|text\/plain|octet-stream)/i.test(contentType),blocked:!/(?:javascript|ecmascript|text\/plain|octet-stream)/i.test(contentType)};
  return {fileTypeValid:true,blocked:false};
}
export async function fetchResource(input,{maxBytes=32*1024*1024,timeoutMs=20000,allowLocal=false}={}) {
  const started=Date.now(),redirects=[];
  let url=input,lastURL=null;
  try {
    for(let hop=0;hop<=5;hop++) {
      url=safeWebURL(url,{allowLocal});
      const remaining=timeoutMs-(Date.now()-started);
      if(remaining<=0)throw new Error('Total request timeout');
      const response=await requestOne(url,{maxBytes,timeoutMs:remaining,allowLocal});
      if(response.httpStatus)lastURL=url;
      if(response.redirect) {
        const next=new URL(response.redirect,url).href;
        redirects.push({from:redactURL(url),to:redactURL(next),status:response.httpStatus});
        safeWebURL(next,{allowLocal});url=next;continue;
      }
      let status=response.complete&&response.bytes>0&&response.httpStatus>=200&&response.httpStatus<300&&response.httpStatus!==202?'ready':[404,410].includes(response.httpStatus)?'missing':'blocked';
      const {headers,prefix='',signature='',...rest}=response;
      const contentType=String(headers['content-type']||''),contentEncoding=String(headers['content-encoding']||'identity');
      const inspection=inspectFile(input,url,contentType,prefix,signature);
      if(status==='ready'&&inspection.blocked){status='blocked';rest.sha256=null;rest.error='Response is not the expected readable file type, or is a login/challenge page';}
      // Body prefixes can contain credentials; persist only type markers and binary magic.
      return redactEvidence({requestedURL:redactURL(input),finalURL:redactURL(lastURL),status,redirects,contentType,contentEncoding,contentRange:headers['content-range']||null,...rest,fileTypeValid:inspection.fileTypeValid,prefix:inspection.html?'<html>':'',signature:status==='ready'&&!inspection.html?signature.slice(0,32):'',elapsedMs:Date.now()-started});
    }
    throw new Error('Redirect limit exceeded');
  } catch(e) {return redactEvidence({requestedURL:redactURL(input),finalURL:lastURL?redactURL(lastURL):null,status:'blocked',complete:false,sha256:null,redirects,error:e.message,elapsedMs:Date.now()-started});}
}
export function compareFiles(oldFile,newFile,historicalHash) {
  const base={expected:'Complete readable corresponding files have the same SHA256',actual:{oldStatus:oldFile.status,newStatus:newFile.status,oldHash:oldFile.sha256,newHash:newFile.sha256}};
  const invalidType=file=>file.fileTypeValid===false||/html/i.test(file.contentType||'')||/<(?:!doctype\s+html|html|form|input|title)\b/i.test(file.prefix||'');
  if(oldFile.status!=='ready'||!oldFile.complete||!oldFile.sha256)return {...base,status:'blocked',note:'The baseline file was not completely readable; parity cannot be established.'};
  if(invalidType(oldFile))return {...base,status:'blocked',note:'The baseline response is not a valid file type.'};
  if(newFile.status==='missing')return {...base,status:'fail',note:'Migrated destination returned a missing-file response; baseline file is readable.'};
  if(invalidType(newFile))return {...base,status:'blocked',note:'An HTML, login, challenge, or invalid file-type response cannot establish file parity.'};
  if(newFile.status!=='ready'||!newFile.complete||!newFile.sha256)return {...base,status:'blocked',note:'The migrated file was not completely readable.'};
  if(oldFile.sha256!==newFile.sha256) {
    if([oldFile,newFile].every(file=>/^image\//i.test(file.contentType||'')))return {...base,status:'review',note:'Image file bytes differ; server re-encoding is possible. No decoded-pixel comparison has been performed.'};
    return {...base,status:'fail',note:'Complete file bytes differ; editorial/version intent is a separate decision.'};
  }
  if(historicalHash&&oldFile.sha256!==historicalHash)return {...base,status:'review',note:'Current files match each other but differ from the recorded baseline hash. Review baseline drift.'};
  return {...base,status:'pass',note:'Equality applies only to these complete compared response bodies, not all document semantics or application states.'};
}
