export const HTTP_LOG_REDACTION_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  "req.headers['set-cookie']",
  "req.headers['x-api-key']",
  "req.headers['x-auth-token']",
  "req.headers['idempotency-key']",
  "req.headers['x-idempotency-key']",
  "res.headers['set-cookie']",
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.transactionPin',
  'req.body.currentPin',
  'req.body.newPin',
  'req.body.pin',
  'req.body.otp',
  'req.body.accessToken',
  'req.body.refreshToken',
  'req.body.token',
  'req.body.secret',
] as const;

export const HTTP_LOG_REDACTION_CENSOR = '[REDACTED]';
