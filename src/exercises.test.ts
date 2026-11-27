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

/** Holds each pose for one second (10 fps) and returns how many reps the exercise's detector counts. */
function reps(id: string, poses: Pose[]): number {
  const det = getExercise(id).detector!;
  const counter = new RepCounter({ lo: det.lo, hi: det.hi, countOn: det.countOn, minRepMs: det.minRepMs, alpha: 1, dwellMs: det.dwellMs ?? 150, settleMs: 400 });
  let n = 0;
  let t = 0;
  for (const p of poses) {
    for (let i = 0; i < 10; i++, t += 100) {
      if (counter.update(det.signal(frame(p)), t)) n++;
    }
  }
  return n;
}

const cycle = (a: Pose, b: Pose, times: number): Pose[] => Array.from({ length: times }, () => [a, b]).flat();

describe('push-ups', () => {
  const top: Pose = { lShoulder: [0.3, 0.5], lElbow: [0.3, 0.6], lWrist: [0.3, 0.7], lHip: [0.6, 0.55] };
  const bottom: Pose = { lShoulder: [0.3, 0.62], lElbow: [0.38, 0.6], lWrist: [0.3, 0.7], lHip: [0.6, 0.64] };
  it('measures the elbow angle', () => {
    expect(signal('pushups', top)).toBeCloseTo(180, 0);
    expect(signal('pushups', bottom)).toBeLessThan(60);
  });
  it('counts on lockout', () => expect(reps('pushups', [top, ...cycle(bottom, top, 3)])).toBe(3));
  it('reports missing landmarks', () => expect(signal('pushups', { lShoulder: [0.3, 0.5] })).toBeNull());
  it('ignores arm movement while standing', () => {
    const armDown: Pose = { lShoulder: [0.5, 0.3], lElbow: [0.5, 0.45], lWrist: [0.5, 0.6], lHip: [0.5, 0.58] };
    const armBent: Pose = { ...armDown, lWrist: [0.52, 0.32] };
    expect(signal('pushups', armBent)).toBeNaN();
    expect(reps('pushups', [armDown, ...cycle(armBent, armDown, 3)])).toBe(0);
  });
});

describe('goblet squats', () => {
  const stand: Pose = { rShoulder: [0.5, 0.25], rHip: [0.5, 0.5], rKnee: [0.5, 0.7], rAnkle: [0.5, 0.9] };
  const deep: Pose = { rShoulder: [0.5, 0.45], rHip: [0.5, 0.68], rKnee: [0.45, 0.7], rAnkle: [0.5, 0.9] };
  it('measures hip height over the knee', () => {
    expect(signal('squats', stand)).toBeCloseTo(1, 1);
    expect(signal('squats', deep)).toBeLessThan(0.2);
  });
  it('counts on standing back up', () => expect(reps('squats', [stand, ...cycle(deep, stand, 5)])).toBe(5));
  it('ignores bending over to pick up the bell', () => {
    const bentOver: Pose = { rShoulder: [0.7, 0.62], rHip: [0.5, 0.66], rKnee: [0.47, 0.72], rAnkle: [0.5, 0.9] };
    expect(signal('squats', bentOver)).toBeNaN();
    expect(reps('squats', [stand, ...cycle(bentOver, stand, 3)])).toBe(0);
  });
  it('ignores a dip shorter than the dwell time', () => {
    const det = getExercise('squats').detector!;
    const c = new RepCounter({ lo: det.lo, hi: det.hi, countOn: det.countOn, minRepMs: det.minRepMs, alpha: 1, dwellMs: 150, settleMs: 400 });
    let n = 0;
    [stand, stand, stand, stand, stand, stand, deep, stand, stand, stand].forEach((p, i) => {
      if (c.update(det.signal(frame(p)), i * 100)) n++;
    });
    expect(n).toBe(0);
  });
});

describe('bicep curls', () => {
  const down: Pose = { lShoulder: [0.5, 0.3], lElbow: [0.5, 0.45], lWrist: [0.5, 0.6], lHip: [0.5, 0.58] };
  const up: Pose = { ...down, lWrist: [0.52, 0.32] };
  it('counts at the top of the curl', () => expect(reps('curls', [down, ...cycle(up, down, 5)])).toBe(5));
  it('follows the working arm when the other one hangs still', () => {
    const idle: Pose = { rShoulder: [0.4, 0.3], rElbow: [0.4, 0.45], rWrist: [0.4, 0.6], rHip: [0.4, 0.58] };
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
  it('ignores one arm raised away from the other', () => {
    const both: Pose = { lShoulder: [0.55, 0.3], lHip: [0.55, 0.55], lWrist: [0.57, 0.6], rShoulder: [0.45, 0.3], rHip: [0.45, 0.55], rWrist: [0.43, 0.6] };
    const wave: Pose = { ...both, lWrist: [0.75, 0.25] };
    expect(signal('swings', wave)).toBeNaN();
    expect(reps('swings', [both, ...cycle(wave, both, 3)])).toBe(0);
  });
});

describe('cleans', () => {
  const hang: Pose = { rShoulder: [0.5, 0.3], rHip: [0.5, 0.55], rWrist: [0.5, 0.62] };
  const rack: Pose = { rShoulder: [0.5, 0.3], rHip: [0.5, 0.55], rWrist: [0.52, 0.33] };
  const waist: Pose = { rShoulder: [0.5, 0.3], rHip: [0.5, 0.55], rWrist: [0.52, 0.46] };
  it('counts when the bell reaches the rack position', () => expect(reps('cleans', [hang, ...cycle(rack, hang, 5)])).toBe(5));
  it('does not count a pull that stops at the waist', () => expect(reps('cleans', [hang, ...cycle(waist, hang, 3)])).toBe(0));
});

describe('rows', () => {
  const legs: Pose = { lKnee: [0.42, 0.7], lAnkle: [0.4, 0.9] };
  const hang: Pose = { ...legs, lShoulder: [0.6, 0.4], lHip: [0.4, 0.5], lWrist: [0.6, 0.65] };
  const pulled: Pose = { ...legs, lShoulder: [0.6, 0.4], lHip: [0.4, 0.5], lWrist: [0.5, 0.5] };
  it('measures wrist height against the hip', () => {
    expect(signal('rows', hang)).toBeLessThan(-0.6);
    expect(signal('rows', pulled)).toBeCloseTo(0, 1);
  });
  it('counts at the top of the pull', () => expect(reps('rows', [hang, ...cycle(pulled, hang, 5)])).toBe(5));
  it('ignores arm movement while standing upright', () => {
    const standing: Pose = { ...legs, lShoulder: [0.4, 0.25], lHip: [0.4, 0.5], lWrist: [0.4, 0.62] };
    const handUp: Pose = { ...standing, lWrist: [0.42, 0.45] };
    expect(signal('rows', handUp)).toBeNaN();
    expect(reps('rows', [standing, ...cycle(handUp, standing, 3)])).toBe(0);
  });
});

describe('pullovers', () => {
  const torso: Pose = { rShoulder: [0.5, 0.3], rHip: [0.5, 0.55] };
  const behindHead: Pose = { ...torso, rWrist: [0.48, 0.22] };
  const overhead: Pose = { ...torso, rWrist: [0.5, 0.08] };
  const chest: Pose = { ...torso, rWrist: [0.5, 0.36] };
  it('measures wrist height against the shoulder', () => {
    expect(signal('pullovers', behindHead)).toBeGreaterThan(0.2);
    expect(signal('pullovers', chest)).toBeLessThan(-0.08);
  });
  it('counts when the bell arrives at the chest', () => {
    expect(reps('pullovers', [behindHead, ...cycle(overhead, chest, 1), ...cycle(overhead, behindHead, 1), overhead, chest])).toBe(2);
    expect(reps('pullovers', [behindHead, ...cycle(chest, behindHead, 5)])).toBe(5);
  });
  it('does not count a pull that stops overhead', () => {
    expect(reps('pullovers', [behindHead, ...cycle(overhead, behindHead, 3)])).toBe(0);
  });
  it('is not in position unless standing upright', () => {
    expect(signal('pullovers', { rShoulder: [0.4, 0.8], rHip: [0.6, 0.8], rWrist: [0.4, 0.6] })).toBeNaN();
  });
});

describe('halos', () => {
  // Facing the camera: the person's left side is on the right of the image.
  const body: Pose = { nose: [0.5, 0.2], lShoulder: [0.58, 0.3], rShoulder: [0.42, 0.3] };
  const front: Pose = { ...body, lWrist: [0.52, 0.15], rWrist: [0.48, 0.15] };
  const toLeft: Pose = { ...body, lWrist: [0.6, 0.15], rWrist: [0.56, 0.15] };
  const toRight: Pose = { ...body, lWrist: [0.44, 0.15], rWrist: [0.4, 0.15] };
  const lowered: Pose = { ...body, lWrist: [0.6, 0.5], rWrist: [0.56, 0.5] };
  const viaLeft = [front, toLeft, front, toRight, front]; // "front" in the middle = bell behind the head
  const viaRight = [front, toRight, front, toLeft, front];
  it('signs the signal by body side, also when facing away', () => {
    expect(signal('halos', toLeft)).toBeGreaterThan(0.25);
    const mirror = (p: Pose): Pose => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, [1 - v![0], v![1]]])) as Pose;
    expect(signal('halos', mirror(toLeft))).toBeGreaterThan(0.25);
  });
  it('counts one rep per circle with alternating directions', () => {
    expect(reps('halos', [...viaLeft, ...viaRight, ...viaLeft, ...viaRight])).toBe(4);
  });
  it('counts one rep per circle in the same direction', () => {
    expect(reps('halos', [...viaLeft, ...viaLeft, ...viaLeft])).toBe(3);
  });
  it('ignores hands below shoulder height', () => {
    expect(signal('halos', lowered)).toBeNaN();
    expect(reps('halos', [front, lowered, front, lowered])).toBe(0);
  });
});
