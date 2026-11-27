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
  /**
   * For 'cross' exercises: label of a rep by the side it started towards.
   * When set, the workout shows a running tally per direction.
   */
  directions?: { hi: string; lo: string };
  /** Time the signal must stay past a threshold before it counts (default 150 ms). */
  dwellMs?: number;
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

export const MIN_VISIBILITY = 0.6;

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

const BODY_L = [LM.lShoulder, LM.lElbow, LM.lWrist, LM.lHip] as const;
const BODY_R = [LM.rShoulder, LM.rElbow, LM.rWrist, LM.rHip] as const;
const LEG_TORSO_L = [LM.lHip, LM.lKnee, LM.lAnkle, LM.lShoulder] as const;
const LEG_TORSO_R = [LM.rHip, LM.rKnee, LM.rAnkle, LM.rShoulder] as const;

/*
 * Posture gates. A detector returns NaN ("not in position") unless the body
 * is in the posture the exercise is done in, so walking into frame or picking
 * up the bell cannot be mistaken for reps.
 */

/** Torso closer to horizontal than vertical (plank, seen from the side). */
const torsoHorizontal = (shoulder: Pt, hip: Pt): boolean => Math.abs(shoulder.y - hip.y) < 1.2 * Math.abs(shoulder.x - hip.x);

/** Shoulders well above the hips. */
const torsoUpright = (shoulder: Pt, hip: Pt): boolean => hip.y - shoulder.y > 0.75 * dist(shoulder, hip);

/**
 * Height of the shoulders above the hips in shin lengths: about 1.2 standing,
 * dropping towards 0 as the torso hinges forward. The shin stays vertical, so
 * this works from the front as well as from the side.
 */
const torsoHeight = (shoulder: Pt, hip: Pt, knee: Pt, ankle: Pt): number => (hip.y - shoulder.y) / Math.max(dist(knee, ankle), 1e-6);

/* ---------- detectors ---------- */

/**
 * Push-ups: elbow angle. ~165° at lockout, ~80° at the bottom. Side view.
 * Only while in a plank: torso near horizontal, hands below the shoulders.
 */
const pushups: Detector = {
  label: 'elbow angle (in plank)',
  unit: '°',
  signal: (f) =>
    combine(sides(f, BODY_L, BODY_R, ([s, e, w, hip]) => (torsoHorizontal(s, hip) && w.y > s.y ? angle(s, e, w) : NaN)), 'min'),
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
 * Only while the chest is up: bending over to pick up the bell is not a squat.
 */
const squats: Detector = {
  label: 'hip height over knee / shin',
  unit: '',
  signal: (f) =>
    combine(
      sides(f, LEG_TORSO_L, LEG_TORSO_R, ([hip, knee, ankle, shoulder]) =>
        torsoHeight(shoulder, hip, knee, ankle) >= 0.6 ? (knee.y - hip.y) / Math.max(dist(knee, ankle), 1e-6) : NaN,
      ),
      'mean',
    ),
  lo: 0.4,
  hi: 0.75,
  countOn: 'hi',
  minRepMs: 800,
  step: 0.05,
  range: [-0.2, 1.3],
};

/**
 * Bicep curls: elbow angle of the more bent arm. ~165° hanging, ~40° at the top.
 * Only while standing upright with the elbow below the shoulder.
 */
const curls: Detector = {
  label: 'elbow angle (standing, elbow down)',
  unit: '°',
  signal: (f) =>
    combine(sides(f, BODY_L, BODY_R, ([s, e, w, hip]) => (torsoUpright(s, hip) && e.y > s.y ? angle(s, e, w) : NaN)), 'min'),
  lo: 70,
  hi: 140,
  countOn: 'lo',
  minRepMs: 700,
  step: 5,
  range: [20, 180],
};

/**
 * Overhead tricep extensions: elbow angle, only while the arm is overhead.
 * "Overhead" is tested on the elbow (above the shoulder) rather than the
 * wrist, because at the bottom of the rep the wrists drop behind the head.
 */
const triceps: Detector = {
  label: 'elbow angle (arms overhead)',
  unit: '°',
  signal: (f) => combine(sides(f, ARM_L, ARM_R, ([s, e, w]) => (e.y < s.y ? angle(s, e, w) : NaN)), 'min'),
  lo: 95,
  hi: 150,
  countOn: 'hi',
  minRepMs: 700,
  step: 5,
  range: [20, 180],
};

const REACH_L = [LM.lShoulder, LM.lWrist, LM.lHip] as const;
const REACH_R = [LM.rShoulder, LM.rWrist, LM.rHip] as const;

/** Wrist height relative to the shoulder, in torso lengths: 0 at shoulder level, about -1 at the hip. */
const wristVsShoulder = ([shoulder, wrist, hip]: Pt[]): number => (shoulder.y - wrist.y) / Math.max(dist(shoulder, hip), 1e-6);

/**
 * Swings: wrist height relative to the shoulder. Below the hips at the bottom,
 * near chest height at the top. Two-handed: when both wrists are visible they
 * must be together, so reaching or waving with one arm does not count.
 */
const swings: Detector = {
  label: 'wrist height vs shoulder / torso (hands together)',
  unit: '',
  signal: (f) => {
    const left = pts(f, REACH_L);
    const right = pts(f, REACH_R);
    if (left && right && dist(left[1], right[1]) > 0.7 * dist(left[0], left[2])) return NaN;
    return combine(sides(f, REACH_L, REACH_R, wristVsShoulder), 'mean');
  },
  dwellMs: 80,
  lo: -0.75,
  hi: -0.25,
  countOn: 'hi',
  minRepMs: 700,
  step: 0.05,
  range: [-1.6, 0.6],
};

/** Cleans: the working wrist travels from below the hip (about -1) to the rack position at the shoulder (about -0.15). */
const cleans: Detector = {
  label: 'wrist height vs shoulder / torso (higher hand)',
  unit: '',
  signal: (f) => combine(sides(f, REACH_L, REACH_R, wristVsShoulder), 'max'),
  dwellMs: 100,
  lo: -0.85,
  hi: -0.35,
  countOn: 'hi',
  minRepMs: 800,
  step: 0.05,
  range: [-1.6, 0.6],
};

/**
 * Rows: height of the pulling wrist relative to the hip, in torso lengths.
 * Hinged over with the arm hanging the wrist is well below the hip (about
 * -0.6); at the top of the row it reaches hip height (about 0).
 * Only while hinged forward: standing up with the bell does not count.
 */
const ROW_L = [LM.lShoulder, LM.lWrist, LM.lHip, LM.lKnee, LM.lAnkle] as const;
const ROW_R = [LM.rShoulder, LM.rWrist, LM.rHip, LM.rKnee, LM.rAnkle] as const;

const rows: Detector = {
  label: 'wrist height vs hip / torso (hinged, higher hand)',
  unit: '',
  signal: (f) =>
    combine(
      sides(f, ROW_L, ROW_R, ([shoulder, wrist, hip, knee, ankle]) =>
        torsoHeight(shoulder, hip, knee, ankle) < 1.0 ? (hip.y - wrist.y) / Math.max(dist(shoulder, hip), 1e-6) : NaN,
      ),
      'max',
    ),
  lo: -0.45,
  hi: -0.12,
  countOn: 'hi',
  minRepMs: 700,
  step: 0.05,
  range: [-1.2, 0.8],
};

/**
 * Pullovers (standing): the bell starts behind the head, is pulled up and over
 * and finishes at the chest, then goes back overhead. Signal: wrist height
 * relative to the shoulder, in torso lengths: about +0.3 behind the head,
 * higher on the way over, about -0.2 at the chest. Counted on arrival at the
 * chest. Only while standing upright with the hands together.
 */
const pullovers: Detector = {
  label: 'wrist height vs shoulder / torso (standing, hands together)',
  unit: '',
  signal: (f) => {
    const left = pts(f, REACH_L);
    const right = pts(f, REACH_R);
    if (left && right && dist(left[1], right[1]) > 0.7 * dist(left[0], left[2])) return NaN;
    return combine(
      sides(f, REACH_L, REACH_R, (p) => (torsoUpright(p[0], p[2]) ? wristVsShoulder(p) : NaN)),
      'mean',
    );
  },
  lo: -0.08,
  hi: 0.2,
  countOn: 'lo',
  minRepMs: 900,
  step: 0.05,
  range: [-1, 1.2],
};

/**
 * Halos: sideways position of the hands relative to the nose, in shoulder
 * widths, while the hands are above shoulder height. Positive = towards the
 * person's left shoulder (whether they face the camera or not).
 * One halo = the bell goes out to one side, behind the head, and reappears on
 * the other side; the counter credits it there and reports the starting side,
 * so circles in either direction count and are tallied per direction.
 */
const halos: Detector = {
  label: "hands towards left(+)/right(-) of nose / shoulder width",
  unit: '',
  signal: (f) => {
    const p = pts(f, [LM.nose, LM.lShoulder, LM.rShoulder, LM.lWrist, LM.rWrist]);
    if (!p) return null;
    const [nose, ls, rs, lw, rw] = p;
    if ((lw.y + rw.y) / 2 > (ls.y + rs.y) / 2) return NaN;
    const width = ls.x - rs.x;
    if (Math.abs(width) < 1e-6) return NaN;
    return ((lw.x + rw.x) / 2 - nose.x) / width;
  },
  lo: -0.25,
  hi: 0.25,
  countOn: 'cross',
  directions: { hi: 'L', lo: 'R' },
  minRepMs: 700,
  step: 0.05,
  range: [-1, 1],
};

/* ---------- catalogue ---------- */

const SIDE = 'Side-on to the camera works best.';
const FRONT = 'Face the camera, full body in frame.';

export const EXERCISES: ExerciseDef[] = [
  { id: 'rows', name: 'Rows', defaultReps: 5, confidence: 'medium', hint: SIDE, detector: rows },
  { id: 'cleans', name: 'Cleans', defaultReps: 5, confidence: 'medium', hint: FRONT, detector: cleans },
  { id: 'swings', name: 'Swings', defaultReps: 5, confidence: 'high', hint: SIDE, detector: swings },
  { id: 'squats', name: 'Goblet squats', defaultReps: 5, confidence: 'high', hint: FRONT, detector: squats },
  { id: 'curls', name: 'Bicep curls', defaultReps: 5, confidence: 'high', hint: FRONT, detector: curls },
  { id: 'triceps', name: 'Tricep extensions', defaultReps: 5, confidence: 'medium', hint: SIDE, detector: triceps },
  {
    id: 'pullovers',
    name: 'Pullovers',
    defaultReps: 5,
    confidence: 'medium',
    hint: FRONT,
    detector: pullovers,
  },
  { id: 'halos', name: 'Alternating halos', defaultReps: 10, confidence: 'medium', hint: FRONT, detector: halos },
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
