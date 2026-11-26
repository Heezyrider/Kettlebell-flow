/**
 * Animated stick-figure illustrations (original artwork, drawn in code).
 *
 * Each exercise is a list of keyframe poses; the figure loops through them
 * with eased interpolation. Coordinates live in a 120-wide box with the
 * ground at y = 110.
 */
type P = [number, number];

interface Pose {
  head: P;
  neck: P;
  hip: P;
  /** [elbow, hand] for each drawn arm. */
  arms: [P, P][];
  /** [knee, foot] for each drawn leg. */
  legs: [P, P][];
  /** Kettlebell centre. */
  kb: P;
}

const STAND_LEGS: [P, P][] = [
  [[57, 87], [55, 108]],
  [[61, 87], [64, 108]],
];
const FRONT_LEGS: [P, P][] = [
  [[54, 88], [50, 108]],
  [[66, 88], [70, 108]],
];
const HINGE_LEGS: [P, P][] = [
  [[59, 88], [55, 108]],
  [[62, 88], [63, 108]],
];

const FIGURES: Record<string, Pose[]> = {
  pushups: [
    { head: [21, 54], neck: [31, 61], hip: [69, 76], arms: [[[32, 84], [32, 107]]], legs: [[[89, 91], [108, 106]]], kb: [-99, -99] },
    { head: [20, 87], neck: [31, 92], hip: [69, 96], arms: [[[45, 82], [32, 107]]], legs: [[[89, 101], [108, 106]]], kb: [-99, -99] },
  ],
  squats: [
    {
      head: [60, 18], neck: [60, 30], hip: [60, 62],
      arms: [[[48, 46], [56, 40]], [[72, 46], [64, 40]]],
      legs: [[[52, 85], [48, 108]], [[68, 85], [72, 108]]],
      kb: [60, 46],
    },
    {
      head: [60, 42], neck: [60, 54], hip: [60, 82],
      arms: [[[48, 70], [56, 64]], [[72, 70], [64, 64]]],
      legs: [[[38, 86], [46, 108]], [[82, 86], [74, 108]]],
      kb: [60, 70],
    },
  ],
  curls: [
    { head: [60, 18], neck: [60, 30], hip: [60, 64], arms: [[[61, 48], [65, 66]]], legs: STAND_LEGS, kb: [66, 73] },
    { head: [60, 18], neck: [60, 30], hip: [60, 64], arms: [[[61, 48], [79, 50]]], legs: STAND_LEGS, kb: [85, 52] },
    { head: [60, 18], neck: [60, 30], hip: [60, 64], arms: [[[61, 48], [73, 35]]], legs: STAND_LEGS, kb: [78, 31] },
  ],
  triceps: [
    { head: [60, 22], neck: [60, 34], hip: [60, 66], arms: [[[64, 17], [64, 1]]], legs: STAND_LEGS, kb: [64, -6] },
    { head: [60, 22], neck: [60, 34], hip: [60, 66], arms: [[[64, 17], [52, 6]]], legs: STAND_LEGS, kb: [47, 2] },
    { head: [60, 22], neck: [60, 34], hip: [60, 66], arms: [[[64, 17], [49, 21]]], legs: STAND_LEGS, kb: [45, 27] },
  ],
  rows: [
    { head: [91, 45], neck: [82, 52], hip: [50, 68], arms: [[[83, 68], [84, 84]]], legs: HINGE_LEGS, kb: [84, 91] },
    { head: [91, 45], neck: [82, 52], hip: [50, 68], arms: [[[69, 52], [78, 66]]], legs: HINGE_LEGS, kb: [78, 73] },
  ],
  swings: [
    { head: [82, 42], neck: [74, 50], hip: [48, 70], arms: [[[64, 64], [53, 78]]], legs: HINGE_LEGS, kb: [47, 83] },
    { head: [71, 28], neck: [66, 38], hip: [53, 67], arms: [[[76, 49], [87, 60]]], legs: HINGE_LEGS, kb: [92, 65] },
    { head: [58, 19], neck: [58, 30], hip: [58, 64], arms: [[[73, 31], [89, 31]]], legs: HINGE_LEGS, kb: [96, 31] },
  ],
  cleans: [
    { head: [77, 35], neck: [70, 44], hip: [50, 70], arms: [[[71, 60], [70, 76]]], legs: HINGE_LEGS, kb: [70, 83] },
    { head: [65, 24], neck: [62, 34], hip: [55, 66], arms: [[[72, 46], [68, 61]]], legs: HINGE_LEGS, kb: [68, 68] },
    { head: [58, 19], neck: [58, 30], hip: [58, 64], arms: [[[63, 47], [67, 33]]], legs: HINGE_LEGS, kb: [73, 37] },
  ],
  pullovers: [
    { head: [30, 97], neck: [41, 99], hip: [78, 100], arms: [[[42, 81], [43, 63]]], legs: [[[94, 80], [106, 104]]], kb: [43, 56] },
    { head: [30, 97], neck: [41, 99], hip: [78, 100], arms: [[[31, 83], [20, 69]]], legs: [[[94, 80], [106, 104]]], kb: [16, 63] },
    { head: [30, 97], neck: [41, 99], hip: [78, 100], arms: [[[27, 86], [13, 90]]], legs: [[[94, 80], [106, 104]]], kb: [6, 91] },
  ],
  halos: [
    { head: [60, 26], neck: [60, 38], hip: [60, 68], arms: [[[45, 44], [56, 31]], [[75, 44], [64, 31]]], legs: FRONT_LEGS, kb: [60, 27] },
    { head: [60, 26], neck: [60, 38], hip: [60, 68], arms: [[[50, 26], [70, 14]], [[80, 34], [77, 18]]], legs: FRONT_LEGS, kb: [77, 12] },
    { head: [60, 26], neck: [60, 38], hip: [60, 68], arms: [[[46, 24], [57, 10]], [[74, 24], [63, 10]]], legs: FRONT_LEGS, kb: [60, 6] },
    { head: [60, 26], neck: [60, 38], hip: [60, 68], arms: [[[40, 34], [43, 18]], [[70, 26], [50, 14]]], legs: FRONT_LEGS, kb: [43, 12] },
  ],
};

const NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/**
 * Creates an animated figure for `exerciseId`. Call `stop()` when it is
 * removed from the page.
 */
export function createFigure(exerciseId: string): { el: SVGSVGElement; stop: () => void } {
  const frames = FIGURES[exerciseId] ?? FIGURES.squats;
  const root = svg('svg', { viewBox: '0 -14 120 130', class: 'figure', 'aria-hidden': 'true' });
  root.append(svg('line', { x1: 6, y1: 110, x2: 114, y2: 110, class: 'fig-ground' }));

  const first = frames[0];
  const bell = svg('g', { class: 'fig-bell' });
  bell.append(
    svg('path', { d: 'M-3.2,-4 C-5,-10.5 5,-10.5 3.2,-4', class: 'fig-bell-handle' }),
    svg('circle', { cx: 0, cy: 0.5, r: 5.6 }),
  );
  const torso = svg('polyline', { class: 'fig-limb' });
  const arms = first.arms.map(() => svg('polyline', { class: 'fig-limb' }));
  const legs = first.legs.map(() => svg('polyline', { class: 'fig-limb' }));
  const head = svg('circle', { r: 7, class: 'fig-head' });
  root.append(...legs, torso, head, bell, ...arms);

  const line = (el: SVGPolylineElement, points: P[]): void =>
    el.setAttribute('points', points.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '));

  const draw = (a: Pose, b: Pose, t: number): void => {
    const neck = lerp(a.neck, b.neck, t);
    const hip = lerp(a.hip, b.hip, t);
    const h = lerp(a.head, b.head, t);
    line(torso, [neck, hip]);
    head.setAttribute('cx', h[0].toFixed(1));
    head.setAttribute('cy', h[1].toFixed(1));
    arms.forEach((el, i) => line(el, [neck, lerp(a.arms[i][0], b.arms[i][0], t), lerp(a.arms[i][1], b.arms[i][1], t)]));
    legs.forEach((el, i) => line(el, [hip, lerp(a.legs[i][0], b.legs[i][0], t), lerp(a.legs[i][1], b.legs[i][1], t)]));
    const k = lerp(a.kb, b.kb, t);
    bell.setAttribute('transform', `translate(${k[0].toFixed(1)} ${k[1].toFixed(1)})`);
  };

  // Halos circle round and round; everything else plays out and back like a rep.
  // The animation shows how to do the movement, so it runs even when the
  // system asks for reduced motion (just slower).
  const loop = exerciseId === 'halos';
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const cycleMs = (loop ? 2600 : 2000) * (reduced ? 1.6 : 1);
  const last = frames.length - 1;
  let raf = 0;
  const start = performance.now();
  const tick = (now: number): void => {
    const phase = (Math.max(0, now - start) % cycleMs) / cycleMs;
    // Position along the keyframes: constant speed round a loop, eased out-and-back otherwise.
    const pos = loop ? phase * frames.length : ((1 - Math.cos(phase * 2 * Math.PI)) / 2) * last;
    const i = Math.min(Math.floor(pos), loop ? last : last - 1);
    draw(frames[i], frames[(i + 1) % frames.length], pos - i);
    raf = requestAnimationFrame(tick);
  };
  draw(frames[0], frames[1], 0);
  raf = requestAnimationFrame(tick);

  return { el: root, stop: () => cancelAnimationFrame(raf) };
}
