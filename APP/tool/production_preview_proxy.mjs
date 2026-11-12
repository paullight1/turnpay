// Local Flutter-web preview only. Forward to one fixed production API over
// verified TLS; never log credentials or retry a possibly committed mutation.
import http from 'node:http';
import https from 'node:https';

const origins = new Set([
  'http://localhost:50231',
  'http://127.0.0.1:50231',
]);
const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const allowedHeaders = new Set([
  'authorization', 'content-type', 'idempotency-key', 'cache-control',
  'pragma', 'accept',
]);
const hopHeaders = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'set-cookie',
]);

const server = http.createServer((request, response) => {
  const origin = request.headers.origin;
  if (origin && !origins.has(origin)) {
    response.writeHead(403).end();
    return;
  }
  response.setHeader('Cache-Control', 'no-store');
  if (origin) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }
  if (!request.url?.startsWith('/api/')) {
    response.writeHead(404).end();
    return;
  }
  if (request.method === 'OPTIONS') {
    const method = request.headers['access-control-request-method'];
    const headers = String(request.headers['access-control-request-headers'] ?? '')
      .split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
    if ((method && !methods.has(method)) ||
        headers.some(value => !allowedHeaders.has(value))) {
      response.writeHead(403).end();
      return;
    }
    response.setHeader('Access-Control-Allow-Methods', [...methods].join(', '));
    response.setHeader('Access-Control-Allow-Headers', [...allowedHeaders].join(', '));
    response.writeHead(204).end();
    return;
  }
  if (!methods.has(request.method)) {
    response.writeHead(405).end();
    return;
  }
  const headers = Object.fromEntries(Object.entries(request.headers)
    .filter(([name]) => allowedHeaders.has(name.toLowerCase())));
  const upstream = https.request({
    hostname: 'api.trustpayhq.com',
    port: 443,
    path: request.url,
    method: request.method,
    headers,
  }, incoming => {
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (value !== undefined && !hopHeaders.has(name.toLowerCase()) &&
          !name.toLowerCase().startsWith('access-control-') &&
          !['cache-control', 'vary'].includes(name.toLowerCase())) {
        response.setHeader(name, value);
      }
    }
    response.writeHead(incoming.statusCode ?? 502);
    incoming.on('error', () => response.destroy());
    incoming.pipe(response);
  });
  upstream.setTimeout(30_000, () => upstream.destroy());
  upstream.on('error', () => {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    response.writeHead(502, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ message: 'TrustPay could not be reached. Please try again shortly.' }));
  });
  request.on('aborted', () => upstream.destroy());
  response.on('close', () => {
    if (!response.writableEnded) upstream.destroy();
  });
  request.pipe(upstream);
});

server.on('error', () => {
  process.stderr.write('The TrustPay preview proxy could not start. Check port 3001.\n');
  process.exitCode = 1;
});
server.listen(3001, '127.0.0.1', () => {
  process.stdout.write('TrustPay preview proxy listening on http://127.0.0.1:3001\n');
});
