/**
 * proxy5000.js
 * Bridges Replit's web-preview port (5000) → Metro bundler port (8081).
 * Handles both plain HTTP and WebSocket upgrade requests so the Replit
 * preview pane works while Metro runs on 8081 for ws-tunnel (Expo Go).
 *
 * Auto-reload additions:
 *  - Injects a tiny <script> into every HTML page that watches for Metro
 *    WebSocket disconnects and reloads the iframe automatically.
 *  - When Metro is unreachable (502), returns a self-polling HTML page that
 *    reloads as soon as Metro comes back up — no manual refresh needed.
 */
const http = require('http');
const net  = require('net');
const { execSync } = require('child_process');

const TARGET_PORT = 8081;
const PROXY_PORT  = 5000;

// ── Auto-reload script injected into every HTML page ─────────────────────────
// Polls the server every 1.5 s after a WS disconnect and reloads when it's up.
const INJECT_SCRIPT = `
<script>
(function(){
  var POLL_MS = 1500;
  var disconnected = false;
  var polling = false;

  function poll(){
    if(polling) return;
    polling = true;
    (function loop(){
      fetch(location.href, {cache:'no-store', method:'HEAD'})
        .then(function(r){ if(r.ok){ location.reload(); } else { setTimeout(loop, POLL_MS); } })
        .catch(function(){ setTimeout(loop, POLL_MS); });
    })();
  }

  // Metro HMR uses a WebSocket; intercept the close event to detect restarts
  var _WS = window.WebSocket;
  window.WebSocket = function(url, protocols){
    var ws = protocols ? new _WS(url, protocols) : new _WS(url);
    ws.addEventListener('close', function(e){
      if(e.code !== 1000){ // abnormal close = Metro restarted
        disconnected = true;
        setTimeout(poll, 800);
      }
    });
    ws.addEventListener('open', function(){
      if(disconnected){ disconnected = false; location.reload(); }
    });
    return ws;
  };
  window.WebSocket.prototype = _WS.prototype;
  Object.defineProperty(window.WebSocket,'CONNECTING',{get:function(){return _WS.CONNECTING;}});
  Object.defineProperty(window.WebSocket,'OPEN',{get:function(){return _WS.OPEN;}});
  Object.defineProperty(window.WebSocket,'CLOSING',{get:function(){return _WS.CLOSING;}});
  Object.defineProperty(window.WebSocket,'CLOSED',{get:function(){return _WS.CLOSED;}});
})();
</script>`;

// ── "Metro loading" page served when Metro is not yet up ─────────────────────
const LOADING_PAGE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Starting…</title>
  <style>
    body{margin:0;display:flex;align-items:center;justify-content:center;
         min-height:100vh;background:#0f0f13;font-family:system-ui,sans-serif;color:#ccc;}
    .box{text-align:center;}
    .dot{display:inline-block;width:8px;height:8px;border-radius:50%;
         background:#f5c518;margin:0 3px;animation:blink 1.2s infinite both;}
    .dot:nth-child(2){animation-delay:.2s;}
    .dot:nth-child(3){animation-delay:.4s;}
    @keyframes blink{0%,80%,100%{opacity:.2;}40%{opacity:1;}}
    p{margin-top:16px;font-size:14px;opacity:.6;}
  </style>
</head>
<body>
  <div class="box">
    <div><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
    <p>Metro bundler is starting…</p>
  </div>
  <script>
    (function poll(){
      fetch(location.href, {cache:'no-store', method:'HEAD'})
        .then(function(r){ if(r.ok) location.reload(); else setTimeout(poll,1500); })
        .catch(function(){ setTimeout(poll,1500); });
    })();
  </script>
</body>
</html>`;

// ── Graceful cleanup on exit ──────────────────────────────────────────────────
function cleanup() {
  try { server.close(); } catch {}
  process.exit(0);
}
process.on('SIGTERM', cleanup);
process.on('SIGINT',  cleanup);
process.on('SIGHUP',  cleanup);

// ── Inject auto-reload script into HTML responses ─────────────────────────────
function injectScript(proxyRes, res) {
  const chunks = [];
  proxyRes.on('data', (chunk) => chunks.push(chunk));
  proxyRes.on('end', () => {
    let html = Buffer.concat(chunks).toString('utf8');
    // Inject before </body> if present, otherwise append
    if (html.includes('</body>')) {
      html = html.replace('</body>', INJECT_SCRIPT + '</body>');
    } else {
      html += INJECT_SCRIPT;
    }
    const buf = Buffer.from(html, 'utf8');
    const headers = { ...proxyRes.headers };
    headers['content-length'] = String(buf.byteLength);
    headers['cache-control'] = 'no-store, no-cache, must-revalidate';
    headers['pragma'] = 'no-cache';
    delete headers['transfer-encoding']; // we now have exact length
    res.writeHead(proxyRes.statusCode, headers);
    res.end(buf);
  });
}

// ── HTTP proxy ────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  // Rewrite Origin and Referer so Expo's CorsMiddleware sees a trusted localhost
  // origin instead of the Replit preview domain, which it would otherwise reject.
  const headers = { ...req.headers, host: `localhost:${TARGET_PORT}` };
  if (headers['origin'])  headers['origin']  = `http://localhost:${TARGET_PORT}`;
  if (headers['referer']) headers['referer'] = `http://localhost:${TARGET_PORT}/`;

  const options = {
    hostname : 'localhost',
    port     : TARGET_PORT,
    path     : req.url,
    method   : req.method,
    headers,
  };

  const proxy = http.request(options, (proxyRes) => {
    const ct = (proxyRes.headers['content-type'] || '');
    if (ct.includes('text/html')) {
      injectScript(proxyRes, res);
    } else {
      // Force no-cache on JS bundles so the browser always fetches fresh code
      const headers = { ...proxyRes.headers };
      headers['cache-control'] = 'no-store, no-cache, must-revalidate';
      headers['pragma'] = 'no-cache';
      res.writeHead(proxyRes.statusCode, headers);
      proxyRes.pipe(res, { end: true });
    }
  });

  proxy.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    }
    res.end(LOADING_PAGE);
  });

  req.pipe(proxy, { end: true });
});

// ── WebSocket / HMR upgrade proxy ─────────────────────────────────────────────
server.on('upgrade', (req, clientSocket, head) => {
  const serverSocket = net.connect(TARGET_PORT, 'localhost', () => {
    // Rewrite Origin/Referer on WS upgrade too so Expo trusts the connection
    const wsHeaders = { ...req.headers, host: `localhost:${TARGET_PORT}` };
    if (wsHeaders['origin'])  wsHeaders['origin']  = `http://localhost:${TARGET_PORT}`;
    if (wsHeaders['referer']) wsHeaders['referer'] = `http://localhost:${TARGET_PORT}/`;

    const upgradeReq =
      `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n` +
      Object.entries(wsHeaders)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\r\n') +
      '\r\n\r\n';
    serverSocket.write(upgradeReq);
    if (head && head.length) serverSocket.write(head);
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });

  serverSocket.on('error', () => clientSocket.destroy());
  clientSocket.on('error', () => serverSocket.destroy());
});

// ── Start — kill any stale process holding the port first ─────────────────────
let killAttempts = 0;

function tryListen() {
  server.listen(PROXY_PORT, '0.0.0.0', () => {
    console.log(`[proxy] Listening on :${PROXY_PORT} → Metro :${TARGET_PORT}`);
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && killAttempts < 3) {
    killAttempts++;
    console.log(`[proxy] Port ${PROXY_PORT} in use — killing old process (attempt ${killAttempts})…`);
    try { execSync(`fuser -k ${PROXY_PORT}/tcp 2>/dev/null`); } catch {}
    setTimeout(tryListen, 1500);
  } else if (err.code === 'EADDRINUSE') {
    console.error(`[proxy] Port ${PROXY_PORT} still busy after ${killAttempts} kill(s) — giving up`);
    process.exit(1);
  } else {
    console.error('[proxy] Fatal error:', err.message);
    process.exit(1);
  }
});

tryListen();
