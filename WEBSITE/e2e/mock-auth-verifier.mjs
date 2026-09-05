import { createServer } from 'node:http';

const HOST = '127.0.0.1';
const PORT = 3100;
const TEST_TOKEN_PREFIX = 'access-token-';
const TEST_ADMIN_TOKEN_PREFIX = 'admin-access-token-';

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    sendJson(response, 200, { status: 'ok' });
    return;
  }

  if (request.method === 'POST' && request.url === '/api/auth/bootstrap') {
    const authorization = request.headers.authorization ?? '';
    const token = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';

    const isAdminToken = token.startsWith(TEST_ADMIN_TOKEN_PREFIX);
    const tokenPrefix = isAdminToken
      ? TEST_ADMIN_TOKEN_PREFIX
      : TEST_TOKEN_PREFIX;

    if (!token.startsWith(tokenPrefix)) {
      sendJson(response, 401, { message: 'Unauthorized' });
      return;
    }

    const email = token.slice(tokenPrefix.length);
    sendJson(response, 200, {
      user: {
        id: 'user-123',
        email,
        phone: '+2348012345678',
        role: isAdminToken ? 'ADMIN' : 'USER',
        kycStatus: 'VERIFIED',
      },
      wallets: [],
    });
    return;
  }

  sendJson(response, 404, { message: 'Not found' });
});

server.listen(PORT, HOST);

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
