/**
 * Generic rep counter.
 *
 * Feed it one scalar "signal" per video frame (a joint angle, a relative
 * height, ...). The signal is smoothed with an exponential moving average and
 * classified into a "lo" zone (<= lo) or a "hi" zone (>= hi). The band between
 * the two thresholds is the hysteresis gap: the zone only changes once the
 * signal has fully crossed to the other side, so jitter around one threshold
 * can never produce a rep.
 *
 * A rep is one full cycle. `countOn` picks the moment it is credited:
 *   'hi'   - when the signal comes back up into the hi zone (push-up lockout)
 *   'lo'   - when it comes back down into the lo zone (top of a curl)
 *   'both' - on every zone change (movements that alternate direction)
 *   'cross' - when the signal has gone to one side and then arrives at the
 *            other, whichever side it started on (see updateCross)
 */
export type Zone = 'lo' | 'hi';
export type CountOn = Zone | 'both' | 'cross';

export interface CounterConfig {
  lo: number;
  hi: number;
  countOn: CountOn;
  /** Reps closer together than this are ignored (filters twitches). */
  minRepMs: number;
  /** EMA factor, 0..1. Higher = snappier, lower = smoother. */
  alpha?: number;
  /** The signal must stay in a zone this long before the zone change is accepted (filters spikes). */
  dwellMs?: number;
  /** The starting position must be held this long before counting begins. */
  settleMs?: number;
}

/** Signals older than this are discarded instead of blended into the EMA. */
const STALE_MS = 1000;

export class RepCounter {
  /** Smoothed signal, null until the first sample. */
  value: number | null = null;
  zone: Zone | null = null;
  private lastRepAt = -Infinity;
  private lastSampleAt = -Infinity;
  /** 'cross' mode: the side the current pass started on, and the start side of the last counted pass. */
  private startSide: Zone | null = null;
  lastStartSide: Zone | null = null;
  private pending: Zone | null = null;
  private pendingSince = 0;

  constructor(public cfg: CounterConfig) {}

  setThresholds(lo: number, hi: number): void {
    this.cfg.lo = lo;
    this.cfg.hi = hi;
  }

  /**
   * @param raw  signal for this frame; null/NaN = not measurable, frame skipped
   * @param t    timestamp in ms
   * @returns true when this sample completes a rep
   */
  update(raw: number | null, t: number): boolean {
    if (raw === null || Number.isNaN(raw)) return false;
    const alpha = this.cfg.alpha ?? 0.4;
    this.value =
      this.value === null || t - this.lastSampleAt > STALE_MS
        ? raw
        : this.value + alpha * (raw - this.value);
    this.lastSampleAt = t;

    const z: Zone | null = this.value <= this.cfg.lo ? 'lo' : this.value >= this.cfg.hi ? 'hi' : null;
    if (this.cfg.countOn === 'cross') return this.updateCross(z, t);
    if (z === null || z === this.zone) {
      this.pending = null;
      return false;
    }
    // A new zone only counts once the signal has stayed there for the dwell time.
    if (this.pending !== z) {
      this.pending = z;
      this.pendingSince = t;
    }
    const dwell = this.cfg.dwellMs ?? 0;
    const need = this.zone === null ? Math.max(dwell, this.cfg.settleMs ?? 0) : dwell;
    if (t - this.pendingSince < need) return false;
    this.pending = null;

    const prev = this.zone;
    this.zone = z;
    // The very first zone is just the starting position, not a rep.
    if (prev === null) return false;
    if (this.cfg.countOn !== 'both' && this.cfg.countOn !== z) return false;
    if (t - this.lastRepAt < this.cfg.minRepMs) return false;
    this.lastRepAt = t;
    return true;
  }

  /**
   * Side-to-side passes, e.g. a halo seen from the front: the bell leaves the
   * centre to one side, goes behind the head and reappears on the other side.
   * That arrival on the second side is one rep, and the side it started on is
   * the direction (lastStartSide). Coming back to the centre (the inner half
   * of the gap between the thresholds) releases the zone, so the next pass may
   * start on either side: same direction every time or alternating both work.
   */
  private updateCross(z: Zone | null, t: number): boolean {
    const { lo, hi } = this.cfg;
    if (z === null) {
      this.pending = null;
      if (Math.abs((this.value as number) - (lo + hi) / 2) <= (hi - lo) / 4) this.zone = null;
      return false;
    }
    if (z === this.zone) {
      this.pending = null;
      return false;
    }
    if (this.pending !== z) {
      this.pending = z;
      this.pendingSince = t;
    }
    if (t - this.pendingSince < (this.cfg.dwellMs ?? 0)) return false;
    this.pending = null;
    this.zone = z;
    if (this.startSide === null || this.startSide === z) {
      this.startSide = z;
      return false;
    }
    const started = this.startSide;
    this.startSide = null;
    if (t - this.lastRepAt < this.cfg.minRepMs) return false;
    this.lastRepAt = t;
    this.lastStartSide = started;
    return true;
  }
}
