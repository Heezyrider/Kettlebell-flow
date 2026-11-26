import { describe, expect, it } from 'vitest';
import { RepCounter, type CounterConfig } from './repCounter';

const base: CounterConfig = { lo: 100, hi: 150, countOn: 'hi', minRepMs: 400, alpha: 1 };

/** Feeds samples 100 ms apart and returns the number of reps counted. */
function run(cfg: CounterConfig, samples: (number | null)[], dt = 100): number {
  const c = new RepCounter({ ...cfg });
  let reps = 0;
  samples.forEach((s, i) => {
    if (c.update(s, i * dt)) reps++;
  });
  return reps;
}

/** One smooth hi -> lo -> hi cycle, 2 s long. */
const cycle = (hi: number, lo: number): number[] =>
  Array.from({ length: 20 }, (_, i) => lo + ((hi - lo) * (1 + Math.cos((i / 20) * 2 * Math.PI))) / 2);

describe('RepCounter', () => {
  it('counts one rep per full down-up cycle', () => {
    expect(run(base, [...cycle(170, 80), ...cycle(170, 80), ...cycle(170, 80), 170])).toBe(3);
  });

  it('does not count the starting position', () => {
    expect(run(base, [170, 170, 170, 170])).toBe(0);
    expect(run(base, [80, 80, 170])).toBe(1);
  });

  it('ignores partial reps that never cross the far threshold', () => {
    expect(run(base, [170, 140, 120, 110, 120, 140, 170, 170])).toBe(0);
  });

  it('hysteresis absorbs jitter around a threshold', () => {
    expect(run(base, [170, 149, 151, 149, 151, 149, 151, 170])).toBe(0);
    expect(run(base, [170, 80, 101, 99, 101, 99, 170])).toBe(1);
  });

  it('enforces the minimum rep duration', () => {
    const fast = [170, 80, 170, 80, 170, 80, 170];
    expect(run({ ...base, minRepMs: 400 }, fast, 100)).toBe(2);
    expect(run({ ...base, minRepMs: 0 }, fast, 100)).toBe(3);
  });

  it('skips frames where the signal is unavailable', () => {
    expect(run(base, [170, null, 80, NaN, null, 170])).toBe(1);
  });

  it("countOn 'lo' credits the rep at the bottom of the signal", () => {
    const c = new RepCounter({ ...base, lo: 70, hi: 140, countOn: 'lo' });
    expect(c.update(160, 0)).toBe(false);
    expect(c.update(50, 1000)).toBe(true);
    expect(c.update(160, 2000)).toBe(false);
    expect(c.update(50, 3000)).toBe(true);
  });

  it("countOn 'both' credits every zone change", () => {
    expect(run({ ...base, lo: -0.25, hi: 0.25, countOn: 'both' }, [0.5, -0.5, 0.5, -0.5], 1000)).toBe(3);
  });

  describe("countOn 'cross'", () => {
    const cfg: CounterConfig = { lo: -0.25, hi: 0.25, countOn: 'cross', minRepMs: 0, alpha: 1 };
    const sidesOf = (samples: number[]): string[] => {
      const c = new RepCounter({ ...cfg });
      const out: string[] = [];
      samples.forEach((s, i) => {
        if (c.update(s, i * 100)) out.push(c.lastStartSide as string);
      });
      return out;
    };
    it('counts a pass on arrival at the second side and reports where it started', () => {
      expect(sidesOf([0, 0.5, 0, -0.5, 0])).toEqual(['hi']);
      expect(sidesOf([0, -0.5, 0, 0.5, 0])).toEqual(['lo']);
    });
    it('handles alternating directions', () => {
      expect(sidesOf([0, 0.5, 0, -0.5, 0, -0.5, 0, 0.5, 0, 0.5, 0, -0.5, 0])).toEqual(['hi', 'lo', 'hi']);
    });
    it('handles the same direction every time', () => {
      expect(sidesOf([0, 0.5, 0, -0.5, 0, 0.5, 0, -0.5, 0, 0.5, 0, -0.5, 0])).toEqual(['hi', 'hi', 'hi']);
    });
    it('does not count going out and back on one side', () => {
      expect(sidesOf([0, 0.5, 0, 0.5, 0, 0.5, 0])).toEqual([]);
    });
  });

  it('smooths spikes with the EMA', () => {
    // A single-frame glitch down to 60 must not register as the bottom of a rep.
    expect(run({ ...base, alpha: 0.3 }, [170, 170, 60, 170, 170, 170])).toBe(0);
  });

  it('requires the signal to dwell in a zone before accepting it', () => {
    const cfg = { ...base, minRepMs: 0, dwellMs: 150 };
    // 100 ms dips to the bottom are too short; 300 ms ones count.
    expect(run(cfg, [170, 170, 170, 80, 170, 170, 80, 170, 170])).toBe(0);
    expect(run(cfg, [170, 170, 170, 80, 80, 80, 170, 170, 170])).toBe(1);
  });

  it('waits for the starting position to be held', () => {
    const cfg = { ...base, minRepMs: 0, settleMs: 400 };
    // Passing through the bottom on the way into position must not arm the counter.
    expect(run(cfg, [80, 80, 170, 170, 170, 170, 170, 170])).toBe(0);
    expect(run(cfg, [80, 80, 80, 80, 80, 80, 170, 170])).toBe(1);
  });

  it('applies live threshold changes', () => {
    const c = new RepCounter({ ...base });
    c.update(170, 0);
    c.update(120, 1000);
    expect(c.zone).toBe('hi');
    c.setThresholds(125, 150);
    c.update(120, 2000);
    expect(c.zone).toBe('lo');
  });
});
