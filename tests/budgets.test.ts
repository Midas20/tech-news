import { describe, it, expect } from 'vitest';
import { isUsable, type BudgetRow } from '../src/llm/budgets.ts';

const base: BudgetRow = {
  provider_id: 'groq', quota_observed: 1000, remaining_observed: 500,
  window_seconds: 60, window_start: '2026-08-25T03:00:00Z', spent: 1,
  health: 'healthy', retry_after: null,
};
const now = new Date('2026-08-25T03:10:00Z');

describe('provider budgets', () => {
  it('uses a provider it has never seen', () => {
    expect(isUsable(undefined, now)).toBe(true);
  });

  it('respects a cooldown that has not elapsed', () => {
    expect(isUsable({ ...base, health: 'exhausted', retry_after: '2026-08-25T03:15:00Z' }, now)).toBe(false);
  });

  it('recovers once the cooldown has elapsed, whatever the health flag says', () => {
    // The regression: a 429 at 03:03 must not retire the provider for the day.
    expect(isUsable({ ...base, health: 'exhausted', retry_after: '2026-08-25T03:04:00Z' }, now)).toBe(true);
    expect(isUsable({ ...base, health: 'down', retry_after: '2026-08-25T03:04:00Z' }, now)).toBe(true);
  });

  it('treats a depleted allowance as spent only while its window is open', () => {
    expect(isUsable({ ...base, remaining_observed: 0, window_start: '2026-08-25T03:09:30Z' }, now)).toBe(false);
    expect(isUsable({ ...base, remaining_observed: 0, window_start: '2026-08-25T03:00:00Z' }, now)).toBe(true);
  });
});
