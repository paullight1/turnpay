import IORedis from 'ioredis';
import { retireLegacyIdempotencyCache } from '../src/common/utils/retire-legacy-idempotency-cache';

async function main() {
  if (process.argv.slice(2).some((arg) => arg !== '--apply'))
    throw new Error('Use --apply or no arguments');
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('Explicit REDIS_URL is required');
  const redis = new IORedis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  // Do not print connection errors: a provider exception may contain its URL.
  redis.on('error', () => undefined);
  try {
    await redis.connect();
    const result = await retireLegacyIdempotencyCache(
      redis,
      process.argv.includes('--apply'),
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    redis.disconnect();
  }
}

void main().catch(() => {
  process.stderr.write(
    'Legacy idempotency cache retirement failed. Check the explicit Redis connection and command arguments. No credentials or cache keys were printed.\n',
  );
  process.exitCode = 1;
});
