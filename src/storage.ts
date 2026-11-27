import { EXERCISES, cameraByDefault, getExercise } from './exercises';

export type Mode = 'camera' | 'manual';

export interface Step {
  id: string;
  exercise: string;
  reps: number;
  mode: Mode;
  /** false = switched off on the setup screen and left out of the workout. */
  enabled?: boolean;
}

export interface Sequence {
  id: string;
  name: string;
  steps: Step[];
  rounds: number;
  restSec: number;
}

export interface Settings {
  activeSequenceId: string;
  /** Length of the "next exercise" overlay, seconds (3..10). */
  delaySec: number;
  facing: 'user' | 'environment';
  mirror: boolean;
  voice: boolean;
  beep: boolean;
  debug: boolean;
  /** Per-exercise threshold overrides set in debug mode. */
  thresholds: Record<string, { lo: number; hi: number }>;
  /** Id of the last log entry when "Not now" was tapped on the add-a-round suggestion. */
  suggestionDismissedAt?: string;
}

const SEQ_KEY = 'kbflow.sequences.v1';
const SET_KEY = 'kbflow.settings.v1';
const HALO_KEY = 'kbflow.migrated.haloCamera';
const PULLOVER_KEY = 'kbflow.migrated.pulloverCamera';

export const uid = (): string => Math.random().toString(36).slice(2, 10);

export function makeStep(exerciseId: string, reps?: number): Step {
  const ex = getExercise(exerciseId);
  return { id: uid(), exercise: ex.id, reps: reps ?? ex.defaultReps, mode: cameraByDefault(ex) ? 'camera' : 'manual' };
}

export function defaultSequence(): Sequence {
  return {
    id: 'default',
    name: 'Kettlebell Flow',
    steps: EXERCISES.map((e) => makeStep(e.id)),
    rounds: 5,
    restSec: 150,
  };
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked (private mode): the app still works for this session */
  }
}

export function loadSequences(): Sequence[] {
  const list = read<Sequence[]>(SEQ_KEY);
  if (Array.isArray(list) && list.length) {
    // One-off: halos gained a usable camera counter, so saved sequences switch to it.
    if (!read<boolean>(HALO_KEY)) {
      list.forEach((seq) => seq.steps.forEach((s) => s.exercise === 'halos' && (s.mode = 'camera')));
      write(SEQ_KEY, list);
      write(HALO_KEY, true);
    }
    // One-off: pullovers became a standing exercise with a camera counter.
    if (!read<boolean>(PULLOVER_KEY)) {
      list.forEach((seq) => seq.steps.forEach((s) => s.exercise === 'pullovers' && (s.mode = 'camera')));
      write(SEQ_KEY, list);
      write(PULLOVER_KEY, true);
    }
    return list;
  }
  write(HALO_KEY, true);
  write(PULLOVER_KEY, true);
  const fresh = [defaultSequence()];
  write(SEQ_KEY, fresh);
  return fresh;
}

export function saveSequences(list: Sequence[]): void {
  write(SEQ_KEY, list);
}

export function loadSettings(): Settings {
  const defaults: Settings = {
    activeSequenceId: 'default',
    delaySec: 5,
    facing: 'user',
    mirror: true,
    voice: true,
    beep: true,
    debug: false,
    thresholds: {},
  };
  return { ...defaults, ...(read<Partial<Settings>>(SET_KEY) ?? {}) };
}

export function saveSettings(s: Settings): void {
  write(SET_KEY, s);
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
