import pino from 'pino';
import { Writable } from 'stream';
import {
  HTTP_LOG_REDACTION_CENSOR,
  HTTP_LOG_REDACTION_PATHS,
} from './http-log-redaction';

describe('HTTP log redaction', () => {
  it('removes auth, cookies, retry keys, PINs, and OTPs from serialized logs', () => {
    let serialized = '';
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        serialized += chunk.toString();
        callback();
      },
    });
    const logger = pino(
      {
        redact: {
          paths: [...HTTP_LOG_REDACTION_PATHS],
          censor: HTTP_LOG_REDACTION_CENSOR,
        },
      },
      destination,
    );

    logger.info({
      req: {
        headers: {
          authorization: 'Bearer raw-access-token',
          cookie: 'raw-cookie',
          'set-cookie': 'raw-request-cookie',
          'idempotency-key': 'raw-idempotency-key',
          'x-idempotency-key': 'raw-x-idempotency-key',
        },
        body: {
          transactionPin: '1234',
          pin: '5678',
          otp: '112233',
          refreshToken: 'raw-refresh-token',
          safeField: 'visible',
        },
      },
      res: { headers: { 'set-cookie': 'raw-response-cookie' } },
    });

    for (const secret of [
      'raw-access-token',
      'raw-cookie',
      'raw-request-cookie',
      'raw-idempotency-key',
      'raw-x-idempotency-key',
      '1234',
      '5678',
      '112233',
      'raw-refresh-token',
      'raw-response-cookie',
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain(HTTP_LOG_REDACTION_CENSOR);
    expect(serialized).toContain('visible');
  });
});
