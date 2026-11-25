/**
 * Exercise catalogue.
 *
 * Each exercise that the camera can count has a `detector`: a function that
 * turns one frame of pose landmarks into a single number (the "signal"), plus
 * the thresholds the generic RepCounter uses on that number. To tune an
 * exercise, change `lo` / `hi` here, or use the in-app debug mode, which
 * stores per-device overrides in localStorage.
 */
import type { CountOn } from './repCounter';

export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

/** One frame of pose data. `aspect` = video width / height. */
export interface Frame {
  lm: Landmark[];
  aspect: number;
}

export interface Detector {
  /** Short description of the signal, shown in debug mode. */
  label: string;
  unit: string;
  /**
   * Signal for this frame.
   *   number - measured value
   *   null   - required landmarks not visible (triggers the "step back" warning)
   *   NaN    - body visible but not in position for this exercise (frame ignored)
   */
  signal(f: Frame): number | null;
  lo: number;
  hi: number;
  countOn: CountOn;
  minRepMs: number;
  /** Increment used by the threshold tuning buttons. */
  step: number;
  /** Display range of the debug bar. */
  range: [number, number];
}

export type Confidence = 'high' | 'medium' | 'low' | 'none';

export interface ExerciseDef {
  id: string;
  name: string;
  defaultReps: number;
  /** How far camera counting can be trusted. 'low'/'none' default to manual mode. */
  confidence: Confidence;
  /** Camera placement tip shown on the "next exercise" overlay. */
  hint: string;
  detector?: Detector;
}

/* ---------- landmark helpers ---------- */

/** MediaPipe Pose landmark indices. */
export const LM = {
  nose: 0,
  lShoulder: 11,
  rShoulder: 12,
  lElbow: 13,
  rElbow: 14,
  lWrist: 15,
  rWrist: 16,
  lHip: 23,
  rHip: 24,
  lKnee: 25,
  rKnee: 26,
  lAnkle: 27,
  rAnkle: 28,
} as const;

export const MIN_VISIBILITY = 0.5;

interface Pt {
  x: number;
  y: number;
}

/** Aspect-corrected point, or null when the landmark is hidden or out of frame. */
function pt(f: Frame, i: number): Pt | null {
  const p = f.lm[i];
  if (!p || (p.visibility ?? 1) < MIN_VISIBILITY) return null;
  if (p.x < -0.05 || p.x > 1.05 || p.y < -0.05 || p.y > 1.05) return null;
  return { x: p.x * f.aspect, y: p.y };
}

function pts(f: Frame, idx: readonly number[]): Pt[] | null {
  const out: Pt[] = [];
  for (const i of idx) {
    const p = pt(f, i);
    if (!p) return null;
    out.push(p);
  }
  return out;
}

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Interior angle at b, in degrees (0..180). */
export function angle(a: Pt, b: Pt, c: Pt): number {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const d = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (d < 1e-9) return 180;
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / d));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Evaluates `fn` for the left and the right side of the body and returns the
 * values of the sides whose landmarks are all visible (0, 1 or 2 numbers).
 */
function sides(f: Frame, left: readonly number[], right: readonly number[], fn: (p: Pt[]) => number): number[] {
  const out: number[] = [];
  for (const idx of [left, right]) {
    const p = pts(f, idx);
    if (p) out.push(fn(p));
  }
  return out;
}

/** Combines per-side values; null when neither side was visible. */
function combine(vals: number[], how: 'min' | 'max' | 'mean'): number | null {
  // "Not in position" (NaN) on one side must not hide a valid other side.
  const ok = vals.filter((v) => !Number.isNaN(v));
  if (!ok.length) return vals.length ? NaN : null;
  if (how === 'min') return Math.min(...ok);
  if (how === 'max') return Math.max(...ok);
  return ok.reduce((a, b) => a + b, 0) / ok.length;
}

const ARM_L = [LM.lShoulder, LM.lElbow, LM.lWrist] as const;
const ARM_R = [LM.rShoulder, LM.rElbow, LM.rWrist] as const;
const LEG_L = [LM.lHip, LM.lKnee, LM.lAnkle] as const;
const LEG_R = [LM.rHip, LM.rKnee, LM.rAnkle] as const;

/* ---------- detectors ---------- */

/** Push-ups: elbow angle. ~165° at lockout, ~80° at the bottom. Side view. */
const pushups: Detector = {
  label: 'elbow angle',
  unit: '°',
  signal: (f) => combine(sides(f, ARM_L, ARM_R, ([s, e, w]) => angle(s, e, w)), 'min'),
  lo: 105,
  hi: 150,
  countOn: 'hi',
  minRepMs: 600,
  step: 5,
  range: [30, 180],
};

/**
 * Goblet squats: hip height above the knee, in shin lengths.
 * ~1.0 standing, ~0 with thighs parallel. Unlike the 2D knee angle this works
 * both facing the camera and side-on.
 */
const squats: Detector = {
  label: 'hip height over knee / shin',
  unit: '',
  signal: (f) =>
    combine(sides(f, LEG_L, LEG_R, ([hip, knee, ankle]) => (knee.y - hip.y) / Math.max(dist(knee, ankle), 1e-6)), 'mean'),
  lo: 0.4,
  hi: 0.75,
  countOn: 'hi',
  minRepMs: 800,
  step: 0.05,
  range: [-0.2, 1.3],
};

/** Bicep curls: elbow angle of the more bent arm. ~165° hanging, ~40° at the top. */
const curls: Detector = {
  label: 'elbow angle',
  unit: '°',
  signal: (f) => combine(sides(f, ARM_L, ARM_R, ([s, e, w]) => angle(s, e, w)), 'min'),
  lo: 70,
  hi: 140,
  countOn: 'lo',
  minRepMs: 700,
  step: 5,
  range: [20, 180],
};

/* ---------- catalogue ---------- */

const SIDE = 'Side-on to the camera works best.';
const FRONT = 'Face the camera, full body in frame.';

export const EXERCISES: ExerciseDef[] = [
  { id: 'rows', name: 'Rows', defaultReps: 5, confidence: 'none', hint: SIDE },
  { id: 'cleans', name: 'Cleans', defaultReps: 5, confidence: 'none', hint: FRONT },
  { id: 'swings', name: 'Swings', defaultReps: 5, confidence: 'none', hint: SIDE },
  { id: 'squats', name: 'Goblet squats', defaultReps: 5, confidence: 'high', hint: FRONT, detector: squats },
  { id: 'curls', name: 'Bicep curls', defaultReps: 5, confidence: 'high', hint: FRONT, detector: curls },
  { id: 'triceps', name: 'Tricep extensions', defaultReps: 5, confidence: 'none', hint: SIDE },
  {
    id: 'pullovers',
    name: 'Pullovers',
    defaultReps: 5,
    confidence: 'none',
    hint: 'Lie side-on to the camera. Turn the phone to landscape so your whole body fits.',
  },
  { id: 'halos', name: 'Alternating halos', defaultReps: 10, confidence: 'none', hint: FRONT },
  {
    id: 'pushups',
    name: 'Push-ups',
    defaultReps: 10,
    confidence: 'high',
    hint: 'Side-on to the camera, phone low. Landscape helps.',
    detector: pushups,
  },
];

export function getExercise(id: string): ExerciseDef {
  return EXERCISES.find((e) => e.id === id) ?? EXERCISES[0];
}

/** Whether camera counting should be the default for this exercise. */
export function cameraByDefault(ex: ExerciseDef): boolean {
  return !!ex.detector && (ex.confidence === 'high' || ex.confidence === 'medium');
}
