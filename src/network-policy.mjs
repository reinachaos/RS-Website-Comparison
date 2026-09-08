import http from 'node:http';
import { lookup } from 'node:dns/promises';
import { connect, isIP } from 'node:net';
import { safeWebURL } from './core.mjs';

export function isPublicAddress(address) {
  if(isIP(address)===6) {
    const canonical=new URL(`http://[${address}]/`).hostname.slice(1,-1);
    return /^[23]/i.test(canonical)&&! /^(?:2001:(?:[01]?[\da-f]{0,2}:|db8:)|2002:|3fff:)/i.test(canonical);
  }
  if(isIP(address)!==4)return false;
  const [a,b,c]=address.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||b===2||(b===88&&c===99)))||(a===198&&(b===18||b===19||b===51))||(a===203&&b===0&&c===113));
}

export async function resolveAddress(host,{allowLocal=false,resolver=lookup}={}) {
  host=host.replace(/^\[|\]$/g,'');
  const addresses=isIP(host)?[{address:host,family:isIP(host)}]:await resolver(host,{all:true,verbatim:true});
  if(!addresses.length||addresses.some(a=>!isIP(a.address)||(!allowLocal&&!isPublicAddress(a.address))))throw new Error('DNS resolved to a private or reserved address');
  return addresses[0];
}

// Each upstream connects to a numeric address from this resolution only. No second DNS lookup.
export async function createNetworkProxy({allowLocal=false,timeoutMs=20000,maxBytes=64*1024*1024,maxConnections=64,resolver=lookup}={}) {
  const sockets=new Set();let closed=false;
  const track=socket=>{
    if(closed||sockets.size>=maxConnections){socket.destroy();return false;}
    sockets.add(socket);
    const timer=setTimeout(()=>socket.destroy(),timeoutMs);
    socket.setTimeout(Math.min(timeoutMs,10000),()=>socket.destroy());
    socket.on('error',()=>{});
    socket.once('close',()=>{clearTimeout(timer);sockets.delete(socket);});
    let bytes=0;socket.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes)socket.destroy();});
    return true;
  };
  const dial=async url=>{
    const u=new URL(safeWebURL(url,{allowLocal}));
    let timer;
    const pinned=await Promise.race([resolveAddress(u.hostname,{allowLocal,resolver}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('DNS timeout')),Math.min(timeoutMs,5000));})]).finally(()=>clearTimeout(timer));
    if(closed)throw new Error('Proxy closed');
    return new Promise((resolve,reject)=>{
      const socket=connect({host:pinned.address,family:pinned.family,port:Number(u.port)||(u.protocol==='https:'?443:80)});
      if(!track(socket))return reject(new Error('Proxy connection limit'));
      socket.once('error',reject);
      socket.once('close',()=>reject(new Error('Upstream closed')));
      socket.once('connect',()=>{
        const actual=socket.remoteAddress?.replace(/^::ffff:/,'');
        const expected=pinned.address.replace(/^::ffff:/,'');
        if(actual!==expected||(!allowLocal&&!isPublicAddress(actual))){socket.destroy();reject(new Error('Upstream address mismatch'));return;}
        resolve(socket);
      });
    });
  };
  const server=http.createServer({maxHeaderSize:16384},async(req,res)=>{
    let upstream;
    try {
      if(!['GET','HEAD','OPTIONS'].includes(req.method))throw new Error('Method excluded');
      const u=new URL(safeWebURL(req.url,{allowLocal}));
      if(u.protocol!=='http:')throw new Error('Use CONNECT for TLS');
      upstream=await dial(u.href);
      if(req.destroyed||res.destroyed){upstream.destroy();return;}
      const headers={...req.headers,host:u.host,connection:'close'};
      for(const name of ['proxy-authorization','proxy-connection','authorization','cookie','referer','upgrade','content-length','transfer-encoding'])delete headers[name];
      const agent=new http.Agent({keepAlive:false});
      agent.createConnection=()=>upstream;
      const outgoing=http.request({hostname:u.hostname,port:u.port||80,path:u.pathname+u.search,method:req.method,headers,agent},response=>{
        if(response.headers.location) {
          try{safeWebURL(new URL(response.headers.location,u).href,{allowLocal});}
          catch{response.destroy();res.writeHead(403);res.end('Destination excluded');return;}
        }
        const responseHeaders={...response.headers};delete responseHeaders['set-cookie'];
        res.writeHead(response.statusCode,responseHeaders);response.pipe(res);
        response.on('error',()=>res.destroy());
      });
      outgoing.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Upstream unavailable');});
      res.once('close',()=>{outgoing.destroy();upstream.destroy();agent.destroy();});
      outgoing.end();
    } catch {upstream?.destroy();if(!res.headersSent)res.writeHead(403);res.end('Destination excluded');}
  });
  server.on('connection',track);
  server.on('connect',async(req,client,head)=>{
    let upstream;
    try {
      // Parse authority strictly; CONNECT cannot smuggle a path or credentials.
      if(!/^(?:\[[\da-f:]+\]|[a-z\d.-]+):\d+$/i.test(req.url))throw new Error('Invalid authority');
      upstream=await dial(`https://${req.url}/`);
      if(client.destroyed){upstream.destroy();return;}
      client.once('close',()=>upstream.destroy());upstream.once('close',()=>client.destroy());
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if(head.length)upstream.write(head);
      client.pipe(upstream);upstream.pipe(client);
    } catch {upstream?.destroy();client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');}
  });
  server.on('upgrade',(_req,socket)=>socket.destroy());
  server.on('clientError',(_error,socket)=>socket.destroy());
  server.requestTimeout=timeoutMs;server.headersTimeout=Math.min(timeoutMs,10000);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {server:`http://127.0.0.1:${server.address().port}`,close:async()=>{closed=true;for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}
