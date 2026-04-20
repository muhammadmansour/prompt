#!/usr/bin/env node
/* ============================================================
   ncar-proxy.js
   Tiny pure-Node HTTP forward proxy with optional Basic auth.
   Intended to run on a Saudi-located machine (e.g. your laptop)
   so the remote app server can route ncar.gov.sa traffic through
   an SA IP.

   Usage:
     node scripts/ncar-proxy.js
     PROXY_PORT=3128 PROXY_AUTH=user:strongPass node scripts/ncar-proxy.js
     PROXY_BIND=100.101.102.103 node scripts/ncar-proxy.js

   Env:
     PROXY_PORT   listen port               (default 3128)
     PROXY_BIND   bind address              (default 0.0.0.0)
     PROXY_AUTH   "user:pass" for Basic auth (default: no auth — insecure!)
     PROXY_ALLOW  comma-separated host suffixes to permit
                  (default: ncar.gov.sa)
   ============================================================ */

const http = require('http');
const net = require('net');
const { URL } = require('url');

const PORT = Number(process.env.PROXY_PORT || 3128);
const BIND = process.env.PROXY_BIND || '0.0.0.0';
const AUTH = process.env.PROXY_AUTH || '';
const ALLOW_LIST = (process.env.PROXY_ALLOW || 'ncar.gov.sa')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const EXPECTED_AUTH = AUTH ? 'Basic ' + Buffer.from(AUTH).toString('base64') : '';

function nowIso() {
  return new Date().toISOString();
}

function log(...args) {
  console.log(`[${nowIso()}]`, ...args);
}

function isHostAllowed(host) {
  if (!host) return false;
  const h = host.toLowerCase().split(':')[0];
  return ALLOW_LIST.some((suffix) => h === suffix || h.endsWith('.' + suffix));
}

function checkAuth(req) {
  if (!EXPECTED_AUTH) return true;
  return req.headers['proxy-authorization'] === EXPECTED_AUTH;
}

function send407(resOrSocket, isSocket) {
  const body =
    'HTTP/1.1 407 Proxy Authentication Required\r\n' +
    'Proxy-Authenticate: Basic realm="ncar-proxy"\r\n' +
    'Content-Length: 0\r\n\r\n';
  if (isSocket) {
    resOrSocket.write(body);
    resOrSocket.end();
  } else {
    resOrSocket.writeHead(407, {
      'Proxy-Authenticate': 'Basic realm="ncar-proxy"',
      'Content-Length': 0,
    });
    resOrSocket.end();
  }
}

function sendDenied(resOrSocket, isSocket, reason) {
  const body =
    `HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nContent-Length: ${reason.length}\r\n\r\n${reason}`;
  if (isSocket) {
    resOrSocket.write(body);
    resOrSocket.end();
  } else {
    resOrSocket.writeHead(403, { 'Content-Type': 'text/plain' });
    resOrSocket.end(reason);
  }
}

const server = http.createServer((req, res) => {
  // Plain-HTTP proxy requests (target url is absolute).
  if (!checkAuth(req)) return send407(res, false);

  let target;
  try {
    target = new URL(req.url);
  } catch {
    return sendDenied(res, false, 'bad target url');
  }

  if (!isHostAllowed(target.hostname)) {
    log('DENY http', target.hostname);
    return sendDenied(res, false, `host not allowed: ${target.hostname}`);
  }

  log('HTTP ', req.method, target.hostname + target.pathname);

  const forwardHeaders = { ...req.headers };
  delete forwardHeaders['proxy-authorization'];
  delete forwardHeaders['proxy-connection'];

  const upstream = http.request(
    {
      host: target.hostname,
      port: Number(target.port) || 80,
      path: target.pathname + target.search,
      method: req.method,
      headers: forwardHeaders,
    },
    (upRes) => {
      res.writeHead(upRes.statusCode || 502, upRes.headers);
      upRes.pipe(res);
    }
  );

  upstream.on('error', (err) => {
    log('HTTP upstream error', err.code || err.message);
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });

  req.pipe(upstream);
});

// HTTPS proxy (browser/undici sends CONNECT host:port)
server.on('connect', (req, clientSocket, head) => {
  if (!checkAuth(req)) return send407(clientSocket, true);

  const [host, portStr] = req.url.split(':');
  const port = Number(portStr) || 443;

  if (!isHostAllowed(host)) {
    log('DENY CONNECT', host);
    return sendDenied(clientSocket, true, `host not allowed: ${host}`);
  }

  log('CONN ', host + ':' + port);

  const upstream = net.connect(port, host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head && head.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });

  const cleanup = () => {
    try { upstream.destroy(); } catch {}
    try { clientSocket.destroy(); } catch {}
  };
  upstream.on('error', (err) => {
    log('CONN upstream error', err.code || err.message);
    try { clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch {}
    cleanup();
  });
  clientSocket.on('error', cleanup);
  clientSocket.on('close', cleanup);
});

server.on('clientError', (err, socket) => {
  try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch {}
});

server.listen(PORT, BIND, () => {
  log(`NCAR proxy listening on http://${BIND}:${PORT}`);
  log(`Allow list: ${ALLOW_LIST.join(', ')}`);
  log(`Auth: ${EXPECTED_AUTH ? 'enabled' : 'DISABLED (set PROXY_AUTH!)'}`);
});
