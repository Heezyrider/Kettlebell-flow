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
 */
export type Zone = 'lo' | 'hi';
export type CountOn = Zone | 'both';

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
}
