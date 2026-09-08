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
  if(path==='/redirect-auth') {res.writeHead(302,{location:'/login?SAMLRequest=REDIRECT_SECRET'});res.end();return true;}
  if(path==='/redirect-chain') {res.writeHead(302,{location:'/redirect-auth'});res.end();return true;}
  if(path==='/redirect-private') {res.writeHead(302,{location:'http://127.0.0.1/private-hit'});res.end();return true;}
  if(path==='/broken-image') {res.writeHead(404);res.end();return true;}
  hits.push(req.url);return false;
}
