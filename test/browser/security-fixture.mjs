export function securityFixture(req,res,hits) {
  const path=new URL(req.url,'http://fixture').pathname;
  if(path==='/security') {
    res.end(`<title>Security fixture</title><main class="entry-content">
      <a href="/article?token=DOM_SECRET">Private query</a>
      <input type="hidden" value="HIDDEN_SECRET"><textarea name="token">TEXTAREA_SECRET</textarea>
      <select id="public-year"><option value="2026">2026</option></select><input type="checkbox" checked>
      <input type="hidden" name="page" value="1"><h1>2014 archive</h1>
      <a href="/publications/2014.html">2014 newsletter</a><table><tr><td>2014 issue 1</td></tr></table>
      <p>Public selection 2026 stays on this page. Connection information.</p>
      <img src="/broken-image" onerror="window.savedExecuted=true">
      <iframe srcdoc="<script>window.savedExecuted=true</script>"></iframe>
      <table><tr><td><a href="/article?SAMLRequest=TABLE_SECRET">Table</a></td></tr></table>
      <script>fetch('/asset?token=REQUEST_SECRET');fetch('/logout');fetch('/signin');fetch('/SSO/start');fetch('/SAML2');fetch('/privacy');fetch('/donate');fetch('/redirect-auth');fetch('/redirect-chain');</script>
      Public article content.</main>`);return true;
  }
  if(path==='/prevented') {res.end('<title>Anchor</title><main class="entry-content"><a href="#near" onclick="event.preventDefault()">Near</a><h2 id="near">Already visible</h2></main>');return true;}
  if(path==='/return-top') {
    const params=new URL(req.url,'http://fixture').searchParams;
    res.end(`<title>Return top</title><style>body{margin:0}a{display:block}main{min-height:${params.has('short')?0:4000}px}</style><main class="entry-content"><a href="#" ${params.has('prevented')?'onclick="event.preventDefault()"':''}>Top of Page</a><p>Scrollable article.</p></main>`);return true;
  }
  if(path==='/hidden-headings') {
    res.end('<title>Headings</title><h1 hidden>Hidden title</h1><h1>Visible title</h1><main class="entry-content"><h2 hidden>Hidden attribute</h2><div style="display:none"><h2>Hidden ancestor</h2></div><h2 style="visibility:hidden">Hidden visibility</h2><h2>Visible section</h2><p>Public article content.</p></main>');return true;
  }
  if(path==='/image-readiness') {
    const lazy=new URL(req.url,'http://fixture').searchParams.has('lazy');
    const unsized=new URL(req.url,'http://fixture').searchParams.has('unsized');
    res.end(`<title>Images</title><main id="root" class="entry-content"><p>${'Newsletter article content. '.repeat(30)}</p><img ${lazy?'loading="lazy" style="display:block;margin-top:12000px"':''} src="${lazy?'/fixture-pixel.png':'/broken-image'}" ${unsized?'':'width="40" height="40" alt="Article image"'}></main>`);return true;
  }
  if(path==='/fixture-pixel.png') {
    hits.push(req.url);res.setHeader('Content-Type','image/png');
    setTimeout(()=>res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')),100);return true;
  }
  if(path==='/image-placeholders') {
    const hiddenOnly=new URL(req.url,'http://fixture').searchParams.has('hidden-only');
    res.end(`<title>Image placeholders</title><main id="root" class="entry-content"><p>${'Newsletter article content. '.repeat(30)}</p>
      ${hiddenOnly?'':'<img src="/fixture-pixel.png" width="40" height="40" alt="Visible article image">'}
      <img hidden loading="lazy" src="/broken-image" width="40" height="40" alt="Hidden attribute">
      <div style="display:none"><img loading="lazy" src="/broken-image" width="40" height="40" alt="Hidden carousel slide"></div>
      <img style="visibility:hidden" loading="lazy" src="/broken-image" width="40" height="40" alt="Hidden visibility">
      <img style="width:0;height:0" loading="lazy" src="/broken-image" alt="Zero-size tracking placeholder">
      </main><img src="/broken-image" width="40" height="40" alt="Outside main">`);return true;
  }
  if(path==='/redaction-collision') {
    res.end('<title>Public archive</title><main class="entry-content"><input name="token" value="a"><p>Public article contains a blockquote.</p><a href="/catalog">Public link</a><a href="/catalog?token=a">Query link</a><a href="/archive?code=blockquote">Public blockquote</a><blockquote class="blockquote">Public quotation.</blockquote></main>');return true;
  }
  if(path==='/redaction-long-form') {
    res.end('<title>Public quotation</title><main class="entry-content"><input type="hidden" name="token" value="blockquote"><blockquote class="blockquote" title="blockquote">Public quotation.</blockquote><a href="/blockquote">Public long link</a><p>Repeated secret: blockquote</p></main>');return true;
  }
  if(path==='/redaction-escaped') {
    res.end('<title>Escaped secret</title><main class="entry-content"><textarea name="token">TEXTAREA_&lt;SECRET&gt;&amp;</textarea><p title="TEXTAREA_&lt;SECRET&gt;&amp;">TEXTAREA_&lt;SECRET&gt;&amp;</p><a href="http://USER_SECRET:PASSWORD_SECRET@127.0.0.1/article?token=QUERY_SECRET#auth=FRAGMENT_SECRET">Private URL</a><img src="/broken-image?token=IMAGE_SECRET" alt="Article image"></main>');return true;
  }
  if(path==='/redaction-reflected') {
    res.end('<title>Public article</title><main class="entry-content"><a href="/article?token=QUERY_SECRET_123#auth=FRAGMENT_SECRET_456">Public link</a><p title="QUERY_SECRET_123">Debug token: QUERY_SECRET_123 and FRAGMENT_SECRET_456</p></main>');return true;
  }
  if(path==='/redirect-auth') {res.writeHead(302,{location:'/login?SAMLRequest=REDIRECT_SECRET'});res.end();return true;}
  if(path==='/redirect-chain') {res.writeHead(302,{location:'/redirect-auth'});res.end();return true;}
  if(path==='/redirect-private') {res.writeHead(302,{location:'http://127.0.0.1/private-hit'});res.end();return true;}
  if(path==='/broken-image') {res.writeHead(404);res.end();return true;}
  hits.push(req.url);return false;
}
