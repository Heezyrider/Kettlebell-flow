import { describe, expect, it } from 'vitest';
import { dayStreak, doneToday, shouldSuggestRound, type HistoryEntry } from './history';

const DAY = 86400000;
const noon = new Date(2026, 10, 27, 12).getTime();

const entry = (daysAgo: number, difficulty: number | undefined, over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: String(Math.random()),
  at: noon - daysAgo * DAY,
  sequenceId: 'default',
  sequenceName: 'Kettlebell Flow',
  rounds: 5,
  plannedRounds: 5,
  reps: 275,
  minutes: 30,
  difficulty,
  ...over,
});

describe('dayStreak', () => {
  it('counts consecutive days ending today', () => {
    expect(dayStreak([entry(2, 3), entry(1, 3), entry(0, 3)], noon)).toBe(3);
  });
  it('keeps the streak alive until the end of today', () => {
    expect(dayStreak([entry(2, 3), entry(1, 3)], noon)).toBe(2);
    expect(doneToday([entry(1, 3)], noon)).toBe(false);
  });
  it('breaks on a missed day', () => {
    expect(dayStreak([entry(4, 3), entry(3, 3), entry(0, 3)], noon)).toBe(1);
    expect(dayStreak([entry(3, 3)], noon)).toBe(0);
  });
  it('counts two workouts on one day once', () => {
    expect(dayStreak([entry(0, 3), entry(0, 3)], noon)).toBe(1);
  });
});

describe('shouldSuggestRound', () => {
  it('suggests after three easy, complete workouts in a row', () => {
    expect(shouldSuggestRound([entry(2, 2), entry(1, 1), entry(0, 2)], 'default', 5)).toBe(true);
  });
  it('needs three', () => {
    expect(shouldSuggestRound([entry(1, 1), entry(0, 1)], 'default', 5)).toBe(false);
  });
  it('does not suggest when one of the last three was harder or unrated', () => {
    expect(shouldSuggestRound([entry(2, 2), entry(1, 3), entry(0, 2)], 'default', 5)).toBe(false);
    expect(shouldSuggestRound([entry(2, 2), entry(1, undefined), entry(0, 2)], 'default', 5)).toBe(false);
  });
  it('does not count workouts that were cut short', () => {
    expect(shouldSuggestRound([entry(2, 1), entry(1, 1), entry(0, 1, { rounds: 3 })], 'default', 5)).toBe(false);
  });
  it('starts over after a round has been added', () => {
    const easy = [entry(2, 1), entry(1, 1), entry(0, 1)];
    expect(shouldSuggestRound(easy, 'default', 6)).toBe(false);
  });
  it('looks at each sequence separately', () => {
    const mixed = [entry(3, 1), entry(2, 1), entry(1, 6, { sequenceId: 'other' }), entry(0, 1)];
    expect(shouldSuggestRound(mixed, 'default', 5)).toBe(true);
    expect(shouldSuggestRound(mixed, 'other', 5)).toBe(false);
  });
});
