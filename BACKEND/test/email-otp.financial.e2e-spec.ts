import { randomUUID, createHash } from 'node:crypto';
import Redis from 'ioredis';
import { OtpService } from '../src/otp/otp.service';

// Uses an isolated email namespace on the explicitly configured test Redis.
// Email delivery is a fake boundary; Redis commands and Lua are real.
describe('email OTP concurrency (real Redis)', () => {
  it('does not erase a verification reserved during a resend', async () => {
    if (!process.env.FINANCIAL_TEST_REDIS_URL)
      throw new Error('FINANCIAL_TEST_REDIS_URL is required');
    const client = new Redis(process.env.FINANCIAL_TEST_REDIS_URL);
    const email = `otp-race-${randomUUID()}@test.invalid`;
    const hash = createHash('sha256').update(email).digest('hex');
    const codeKey = `otp:${hash}:code`,
      attemptsKey = `otp:${hash}:attempts`;
    let interleave = true;
    let checks = 0;
    const redis = {
      assertAvailable: () => {},
      isAvailable: () => true,
      execute: async (_name: string, work: (redis: Redis) => unknown) =>
        work(client),
      set: async (key: string, value: string, ttl: number) => {
        await client.set(key, value, 'EX', ttl);
        // Reproduces the old separate SET/DEL boundary without introducing a
        // test-only hook into the production service.
        if (key === codeKey && interleave) {
          interleave = false;
          await service.verifyOtp(email, '111111');
        }
      },
      del: (key: string) => client.del(key),
    };
    const service = new OtpService(
      redis as never,
      {
        get: (key: string) =>
          ({ NODE_ENV: 'staging', OTP_EXPIRES_IN: '5m' })[key],
      } as never,
      { setContext: () => {}, info: () => {}, warn: () => {} } as never,
      {
        sendOtp: async () => {},
        verifyOtp: async () => {
          checks++;
          return false;
        },
      } as never,
    );
    try {
      await service.startEmailChallenge(email);
      for (let i = 0; i < 4; i++) await service.verifyOtp(email, '111111');
      expect(checks).toBe(3);
      expect(await client.ttl(codeKey)).toBeLessThanOrEqual(300);
    } finally {
      await client.del(codeKey, attemptsKey);
      await client.quit();
    }
  });
});
