import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { createServer as createTCPServer, connect } from 'node:net';
import { createNetworkProxy, resolveAddress } from '../src/network-policy.mjs';
import { fetchResource, compareFiles, isPublicAddress } from '../src/http.mjs';

function throughProxy(proxy,url,method='GET') {
  return new Promise((resolve,reject)=>{
    const endpoint=new URL(proxy.server);
    const req=request({host:endpoint.hostname,port:endpoint.port,path:url,method,agent:false},res=>{
      let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body}));
    });req.on('error',reject);req.end();
  });
}
test('proxy rejects private/mixed DNS for HTTP and CONNECT before dialing',async()=>{
  let lookups=0;
  const proxy=await createNetworkProxy({resolver:async()=>{lookups++;return [{address:'127.0.0.1',family:4}];}});
  try {
    assert.equal((await throughProxy(proxy,'http://private.example.org/')).status,403);
    const endpoint=new URL(proxy.server);
    const reply=await new Promise((resolve,reject)=>{
      const client=connect({host:endpoint.hostname,port:endpoint.port},()=>client.write('CONNECT private.example.org:443 HTTP/1.1\r\nHost: private.example.org:443\r\n\r\n'));
      client.on('error',reject);client.once('data',chunk=>{resolve(chunk.toString());client.destroy();});
    });
    assert.match(reply,/403 Forbidden/);assert.equal(lookups,2);
    await assert.rejects(resolveAddress('mixed.example.org',{resolver:async()=>[{address:'1.1.1.1',family:4},{address:'127.0.0.1',family:4}]}),/private/);
  } finally {await proxy.close();}
});
test('ephemeral-port proxy pins its sole DNS result for HTTP and CONNECT and closes tunnels',async()=>{
  let hits=0,lookups=0;
  const server=createServer((_req,res)=>{hits++;res.end('pinned response');});
  const echo=createTCPServer(socket=>socket.pipe(socket));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  await new Promise(resolve=>echo.listen(0,'127.0.0.1',resolve));
  const proxy=await createNetworkProxy({allowLocal:true,resolver:async()=>{lookups++;return [{address:'127.0.0.1',family:4}];}});
  let client;
  try {
    const r=await throughProxy(proxy,`http://fixture.example.org:${server.address().port}/`);
    assert.equal(r.status,200);assert.equal(r.body,'pinned response');assert.equal(hits,1);assert.equal(lookups,1);
    const endpoint=new URL(proxy.server);
    await new Promise((resolve,reject)=>{
      let reply='';client=connect({host:endpoint.hostname,port:endpoint.port},()=>client.write(`CONNECT fixture.example.org:${echo.address().port} HTTP/1.1\r\nHost: fixture.example.org\r\n\r\n`));
      client.on('error',reject);client.on('data',chunk=>{reply+=chunk;if(reply.includes('pinned-tunnel'))resolve();else if(reply.includes('200 Connection Established'))client.write('pinned-tunnel');});
    });
    assert.equal(lookups,2);
    const disconnected=new Promise(resolve=>client.once('close',resolve));
    await proxy.close();await disconnected;assert.equal(client.destroyed,true);
  } finally {client?.destroy();await proxy.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>echo.close(resolve));}
});

test('image byte differences require review, with hashes preserved; other file differences fail',()=>{
  const old={status:'ready',complete:true,sha256:'old',contentType:'image/png'};
  const next={...old,sha256:'new'};
  const result=compareFiles(old,next);
  assert.equal(result.status,'review');assert.equal(result.actual.oldHash,'old');assert.equal(result.actual.newHash,'new');
  assert.equal(compareFiles({...old,contentType:'application/pdf'},{...next,contentType:'application/pdf'}).status,'fail');
});

test('a migrated HTML 404 fails against a readable binary, while an unreadable source remains blocked',()=>{
  const good={status:'ready',complete:true,sha256:'binary',contentType:'application/pdf',fileTypeValid:true};
  const missing={status:'missing',complete:true,sha256:null,contentType:'text/html',fileTypeValid:false,prefix:'<html>'};
  assert.equal(compareFiles(good,missing).status,'fail');
  assert.equal(compareFiles(missing,good).status,'blocked');
});

test('encoded wire bodies cannot be certified as complete file bytes',async()=>{
  const server=createServer((_req,res)=>{res.writeHead(200,{'content-type':'image/png','content-encoding':'gzip'});res.end('wire body');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const r=await fetchResource(`http://127.0.0.1:${server.address().port}/picture.png`,{allowLocal:true});
    assert.equal(r.contentEncoding,'gzip');assert.equal(r.status,'blocked');assert.equal(r.sha256,null);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('partial representations cannot be certified as complete files even after EOF',async()=>{
  const server=createServer((req,res)=>{res.writeHead(req.url==='/range.pdf'?206:200,{'content-type':'application/pdf','content-range':'bytes 0-15/1000'});res.end('%PDF-1.7 partial');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    for(const path of ['/range.pdf','/mislabelled.pdf']) {
      const response=await fetchResource(`http://127.0.0.1:${server.address().port}${path}`,{allowLocal:true});
      assert.equal(response.status,'blocked',path);
      assert.equal(response.complete,false);assert.equal(response.sha256,null);
      assert.equal(compareFiles(response,response).status,'blocked');
    }
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('resolved private and mapped addresses are rejected',()=>{
  for(const address of ['127.0.0.1','10.2.3.4','192.168.2.1','172.31.1.1','169.254.169.254','::1','fc00::1','fe80::1','::ffff:127.0.0.1','2002:7f00:1::','2001::1','3fff::1']) assert.equal(isPublicAddress(address),false,address);
  assert.equal(isPublicAddress('1.1.1.1'),true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'),true);
});

test('file URLs cannot compare login/challenge HTML as bytes and redirects never leak or request secrets',async()=>{
  const hits=[];
  const server=createServer((req,res)=>{
    hits.push(req.url);
    if(req.url==='/redirect-secret'){res.writeHead(302,{location:'/login?SAMLRequest=HTTP_SECRET'});return res.end();}
    if(req.url==='/redirect-file.pdf'){res.writeHead(302,{location:'/ordinary'});return res.end();}
    if(req.url==='/ordinary'){res.setHeader('content-type','text/html');return res.end('<title>Public article</title><p>Article</p>');}
    if(req.url==='/template.js'){res.setHeader('content-type','application/javascript');return res.end("const template = '<input type=\"text\">'; const passwordTemplate = '<input type=\"password\">';");}
    res.setHeader('content-type',req.url.includes('disguised')?'application/octet-stream':'text/html');
    res.end('<!doctype html><title>Sign in</title><form><input type="password" value="HTTP_SECRET"></form>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`,opts={allowLocal:true,timeoutMs:1000};
  try {
    for(const path of ['/file.pdf','/file.js','/disguised.pdf','/disguised.js','/redirect-file.pdf']) {
      const r=await fetchResource(base+path,opts);
      assert.equal(r.status,'blocked',path);assert.equal(compareFiles(r,r).status,'blocked');
      assert.equal(r.sha256,null);assert.ok(!JSON.stringify(r).includes('HTTP_SECRET'));
    }
    const page=await fetchResource(base+'/ordinary',opts);
    assert.equal(page.status,'ready');assert.equal(compareFiles(page,page).status,'blocked');
    const javascript=await fetchResource(base+'/template.js',opts);
    assert.equal(javascript.status,'ready');assert.equal(compareFiles(javascript,javascript).status,'pass');
    const r=await fetchResource(base+'/redirect-secret',opts);
    assert.equal(r.status,'blocked');assert.ok(!JSON.stringify(r).includes('HTTP_SECRET'));
    await fetchResource(base+'/asset?token=HTTP_SECRET',opts);
    assert.ok(!hits.some(url=>url.includes('HTTP_SECRET')));
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('download results distinguish full files, failures, truncation, redirects and timeout',async()=>{
  const server=createServer((req,res)=>{
    if(req.url==='/redirect'){res.writeHead(302,{location:'/pdf'});return res.end();}
    if(req.url==='/private'){res.writeHead(302,{location:'http://169.254.169.254/'});return res.end();}
    if(req.url==='/loop'){res.writeHead(302,{location:'/loop'});return res.end();}
    if(req.url==='/slow')return setTimeout(()=>res.end('late'),100);
    if(req.url==='/missing'){res.writeHead(404);return res.end('Not Found');}
    if(req.url==='/blocked'){res.writeHead(403);return res.end('Forbidden');}
    if(req.url==='/large')return res.end('x'.repeat(200));
    res.writeHead(200,{'content-type':'application/pdf'});res.end('%PDF-1.7\nfixture');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const opts={allowLocal:true,timeoutMs:1000};
    const good=await fetchResource(base+'/pdf',opts);
    assert.equal(good.status,'ready'); assert.equal(good.complete,true); assert.match(good.sha256,/^[a-f0-9]{64}$/);
    const redirected=await fetchResource(base+'/redirect',opts);
    assert.equal(redirected.finalURL,base+'/pdf'); assert.equal(redirected.redirects.length,1);
    assert.equal((await fetchResource(base+'/missing',opts)).status,'missing');
    assert.equal((await fetchResource(base+'/blocked',opts)).status,'blocked');
    const truncated=await fetchResource(base+'/large',{...opts,maxBytes:20});
    assert.equal(truncated.complete,false); assert.equal(truncated.sha256,null);
    assert.equal((await fetchResource(base+'/loop',opts)).status,'blocked');
    assert.equal((await fetchResource(base+'/slow',{...opts,timeoutMs:20})).status,'blocked');
    assert.equal(compareFiles(good,redirected).status,'pass');
    assert.equal(compareFiles(good,{...good,sha256:'different'}).status,'fail');
    assert.equal(compareFiles({...good,status:'blocked'},good).status,'blocked');
    assert.equal(compareFiles(good,{...good,status:'missing'}).status,'fail');
    assert.equal(compareFiles(good,truncated).status,'blocked');
    assert.equal(compareFiles(good,good,'older-hash').status,'review');
  } finally {await new Promise(resolve=>server.close(resolve));}
});
