import type IORedis from 'ioredis';

/** Retirement affects only the old cache namespace. Durable DB replay rows
 * and the new keyed/PIN-free cache must remain intact. SCAN may repeat a key;
 * UNLINK's actual removal count remains accurate and replay-safe. */
export async function retireLegacyIdempotencyCache(
  redis: Pick<IORedis, 'scan' | 'unlink'>,
  apply = false,
) {
  let cursor = '0';
  let scanned = 0;
  let legacyMatches = 0;
  let removed = 0;
  do {
    const [next, keys] = await redis.scan(
      cursor,
      'MATCH',
      'idempotency:*',
      'COUNT',
      500,
    );
    cursor = next;
    scanned += keys.length;
    const legacy = keys.filter(
      (key) =>
        key.startsWith('idempotency:') && !key.startsWith('idempotency:v2:'),
    );
    legacyMatches += legacy.length;
    if (apply && legacy.length > 0) removed += await redis.unlink(...legacy);
  } while (cursor !== '0');
  return { scanned, legacyMatches, removed, applied: apply };
}
