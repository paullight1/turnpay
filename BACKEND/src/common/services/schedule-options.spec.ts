import { scheduleOptions } from './schedule-options';

describe('local scheduled job configuration', () => {
  it('disables background jobs when explicitly requested in development', () => {
    expect(scheduleOptions('development', 'true')).toEqual({
      cronJobs: false,
      intervals: false,
      timeouts: false,
    });
  });

  it('keeps background jobs enabled by default and in production', () => {
    expect(scheduleOptions('development', undefined).cronJobs).toBe(true);
    expect(scheduleOptions('production', 'true').cronJobs).toBe(true);
    expect(scheduleOptions('staging', 'true').cronJobs).toBe(true);
  });
});
