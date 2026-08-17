import { describe, expect, test } from 'bun:test';
import { CronScheduler } from './cron-scheduler.ts';

describe('CronScheduler day-of-month / day-of-week semantics', () => {
  test('OR semantics when both fields are restricted: "1,15 * MON" matches the 1st, the 15th, OR any Monday', () => {
    // 2026-08-17 is a Monday, not the 1st or 15th.
    expect(CronScheduler.matches('0 9 1,15 * 1', new Date('2026-08-17T09:00:00'))).toBe(true);
    // 2026-08-15 is a Saturday - not a Monday, but IS the 15th.
    expect(CronScheduler.matches('0 9 1,15 * 1', new Date('2026-08-15T09:00:00'))).toBe(true);
    // 2026-08-18 is a Tuesday, not the 1st/15th and not a Monday - no match.
    expect(CronScheduler.matches('0 9 1,15 * 1', new Date('2026-08-18T09:00:00'))).toBe(false);
  });

  test('plain AND when only one of the two day fields is restricted (the other is "*")', () => {
    // "0 9 15 * *" - only the 15th, day-of-week is unrestricted.
    expect(CronScheduler.matches('0 9 15 * *', new Date('2026-08-15T09:00:00'))).toBe(true);
    expect(CronScheduler.matches('0 9 15 * *', new Date('2026-08-16T09:00:00'))).toBe(false);
    // "0 9 * * 1" - only Mondays, day-of-month is unrestricted.
    expect(CronScheduler.matches('0 9 * * 1', new Date('2026-08-17T09:00:00'))).toBe(true);
    expect(CronScheduler.matches('0 9 * * 1', new Date('2026-08-18T09:00:00'))).toBe(false);
  });

  test('nextRun finds the nearer of the two OR-ed day fields, not their (rare) intersection', () => {
    // From 2026-08-02 (Sunday, neither the 1st/15th nor a Monday), "1,15 *
    // MON" should next fire on the very next Monday (2026-08-03), not wait
    // until both the 1st/15th AND a Monday coincide.
    const next = CronScheduler.nextRun('0 9 1,15 * 1', new Date('2026-08-02T00:00:00'));
    expect(next).not.toBeNull();
    expect(next!.getDate()).toBe(3);
    expect(next!.getDay()).toBe(1); // Monday
  });
});
