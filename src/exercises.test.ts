import { describe, expect, it } from 'vitest';
import { LM, getExercise, type Frame } from './exercises';
import { RepCounter } from './repCounter';

type Pose = Partial<Record<keyof typeof LM, [number, number]>>;

/** Builds a frame where only the named landmarks are visible. */
function frame(pose: Pose): Frame {
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  for (const [name, xy] of Object.entries(pose)) {
    lm[LM[name as keyof typeof LM]] = { x: xy![0], y: xy![1], z: 0, visibility: 1 };
  }
  return { lm, aspect: 1 };
}

const signal = (id: string, pose: Pose): number | null => getExercise(id).detector!.signal(frame(pose));

/** Holds each pose for one second and returns how many reps the exercise's detector counts. */
function reps(id: string, poses: Pose[]): number {
  const det = getExercise(id).detector!;
  const counter = new RepCounter({ lo: det.lo, hi: det.hi, countOn: det.countOn, minRepMs: det.minRepMs, alpha: 1 });
  let n = 0;
  poses.forEach((p, i) => {
    if (counter.update(det.signal(frame(p)), i * 1000)) n++;
  });
  return n;
}

const cycle = (a: Pose, b: Pose, times: number): Pose[] => Array.from({ length: times }, () => [a, b]).flat();

describe('push-ups', () => {
  const top: Pose = { lShoulder: [0.3, 0.5], lElbow: [0.3, 0.6], lWrist: [0.3, 0.7] };
  const bottom: Pose = { lShoulder: [0.3, 0.62], lElbow: [0.38, 0.6], lWrist: [0.3, 0.7] };
  it('measures the elbow angle', () => {
    expect(signal('pushups', top)).toBeCloseTo(180, 0);
    expect(signal('pushups', bottom)).toBeLessThan(60);
  });
  it('counts on lockout', () => expect(reps('pushups', [top, ...cycle(bottom, top, 3)])).toBe(3));
  it('reports missing landmarks', () => expect(signal('pushups', { lShoulder: [0.3, 0.5] })).toBeNull());
});

describe('goblet squats', () => {
  const stand: Pose = { rHip: [0.5, 0.5], rKnee: [0.5, 0.7], rAnkle: [0.5, 0.9] };
  const deep: Pose = { rHip: [0.5, 0.68], rKnee: [0.45, 0.7], rAnkle: [0.5, 0.9] };
  it('measures hip height over the knee', () => {
    expect(signal('squats', stand)).toBeCloseTo(1, 1);
    expect(signal('squats', deep)).toBeLessThan(0.2);
  });
  it('counts on standing back up', () => expect(reps('squats', [stand, ...cycle(deep, stand, 5)])).toBe(5));
});

describe('bicep curls', () => {
  const down: Pose = { lShoulder: [0.5, 0.3], lElbow: [0.5, 0.45], lWrist: [0.5, 0.6] };
  const up: Pose = { lShoulder: [0.5, 0.3], lElbow: [0.5, 0.45], lWrist: [0.52, 0.32] };
  it('counts at the top of the curl', () => expect(reps('curls', [down, ...cycle(up, down, 5)])).toBe(5));
  it('follows the working arm when the other one hangs still', () => {
    const idle: Pose = { rShoulder: [0.4, 0.3], rElbow: [0.4, 0.45], rWrist: [0.4, 0.6] };
    expect(reps('curls', [{ ...down, ...idle }, ...cycle({ ...up, ...idle }, { ...down, ...idle }, 3)])).toBe(3);
  });
});

describe('tricep extensions', () => {
  const locked: Pose = { lShoulder: [0.5, 0.3], lElbow: [0.5, 0.15], lWrist: [0.5, 0.02] };
  const bent: Pose = { lShoulder: [0.5, 0.3], lElbow: [0.5, 0.15], lWrist: [0.42, 0.2] };
  const armsDown: Pose = { lShoulder: [0.5, 0.3], lElbow: [0.5, 0.45], lWrist: [0.52, 0.32] };
  it('counts on lockout overhead', () => expect(reps('triceps', [locked, ...cycle(bent, locked, 5)])).toBe(5));
  it('ignores bent elbows below shoulder height', () => {
    expect(signal('triceps', armsDown)).toBeNaN();
    expect(reps('triceps', [locked, ...cycle(armsDown, locked, 3)])).toBe(0);
  });
});

describe('swings', () => {
  const top: Pose = { lShoulder: [0.5, 0.3], lHip: [0.5, 0.55], lWrist: [0.7, 0.3] };
  const bottom: Pose = { lShoulder: [0.6, 0.4], lHip: [0.45, 0.55], lWrist: [0.45, 0.65] };
  it('measures wrist height in torso lengths', () => {
    expect(signal('swings', top)).toBeCloseTo(0, 1);
    expect(signal('swings', bottom)).toBeLessThan(-1);
  });
  it('counts at the top of the swing', () => expect(reps('swings', [bottom, ...cycle(top, bottom, 5)])).toBe(5));
});

describe('cleans', () => {
  const hang: Pose = { rShoulder: [0.5, 0.3], rHip: [0.5, 0.55], rWrist: [0.5, 0.62] };
  const rack: Pose = { rShoulder: [0.5, 0.3], rHip: [0.5, 0.55], rWrist: [0.52, 0.33] };
  const waist: Pose = { rShoulder: [0.5, 0.3], rHip: [0.5, 0.55], rWrist: [0.52, 0.46] };
  it('counts when the bell reaches the rack position', () => expect(reps('cleans', [hang, ...cycle(rack, hang, 5)])).toBe(5));
  it('does not count a pull that stops at the waist', () => expect(reps('cleans', [hang, ...cycle(waist, hang, 3)])).toBe(0));
});
