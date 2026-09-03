type WebhookRawBodyRequest = {
  url: string;
  rawBody?: Buffer;
};

export function captureWebhookRawBody(
  request: WebhookRawBodyRequest,
  body: Buffer,
): void {
  if (request.url.startsWith('/api/webhooks')) {
    request.rawBody = body;
  }
}
