import { ScheduleModuleOptions } from '@nestjs/schedule';

export function scheduleOptions(
  nodeEnv: string | undefined,
  disableScheduledJobs: string | undefined,
): ScheduleModuleOptions {
  const disabled =
    (nodeEnv === 'development' || nodeEnv === 'test') &&
    disableScheduledJobs === 'true';
  return { cronJobs: !disabled, intervals: !disabled, timeouts: !disabled };
}
