import { captureWebhookRawBody } from './webhook-raw-body';

describe('captureWebhookRawBody', () => {
  it('preserves the exact request bytes for webhook signature verification', () => {
    const request: { url: string; rawBody?: Buffer } = {
      url: '/api/webhooks/monnify',
    };
    const bytes = Buffer.from('{"eventType":"SUCCESSFUL_TRANSACTION"}');

    captureWebhookRawBody(request, bytes);

    expect(request.rawBody).toBe(bytes);
    expect(Buffer.isBuffer(request.rawBody)).toBe(true);
  });

  it('does not retain bodies for non-webhook routes', () => {
    const request: { url: string; rawBody?: Buffer } = { url: '/api/health' };

    captureWebhookRawBody(request, Buffer.from('{}'));

    expect(request.rawBody).toBeUndefined();
  });
});
