/** Workout log: one entry per finished workout, with a 1-6 difficulty rating. */

export interface HistoryEntry {
  id: string;
  /** When the workout finished (ms since epoch). */
  at: number;
  sequenceId: string;
  sequenceName: string;
  /** Rounds completed / rounds planned at the time. */
  rounds: number;
  plannedRounds: number;
  reps: number;
  minutes: number;
  /** 1 = very easy ... 6 = maximum effort; absent when the rating was skipped. */
  difficulty?: number;
}

export const DIFFICULTY_LABELS = ['Very easy', 'Easy', 'Moderate', 'Hard', 'Very hard', 'Max effort'];

/** Ratings at or below this count as "easy". */
export const EASY_MAX = 2;
/** This many easy workouts in a row trigger the "add a round" suggestion. */
export const EASY_RUN = 3;

const KEY = 'kbflow.history.v1';

export function loadHistory(): HistoryEntry[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as HistoryEntry[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function addHistory(entry: HistoryEntry): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...loadHistory(), entry]));
  } catch {
    /* storage unavailable: the workout still happened */
  }
}

export function removeHistory(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadHistory().filter((e) => e.id !== id)));
  } catch {
    /* ignore */
  }
}

/** Local calendar day number, so "today" follows the phone's time zone. */
const dayOf = (ms: number): number => {
  const d = new Date(ms);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
};

export function doneToday(history: HistoryEntry[], now: number): boolean {
  return history.some((e) => dayOf(e.at) === dayOf(now));
}

/** Consecutive days with a workout, ending today (or yesterday if today is still open). */
export function dayStreak(history: HistoryEntry[], now: number): number {
  const days = new Set(history.map((e) => dayOf(e.at)));
  let day = dayOf(now);
  if (!days.has(day)) day--;
  let streak = 0;
  while (days.has(day)) {
    streak++;
    day--;
  }
  return streak;
}

/**
 * True when the last EASY_RUN workouts of this sequence were all done in full
 * at the current number of rounds and all rated easy. Adding a round changes
 * the round count, so the suggestion only returns after EASY_RUN more easy
 * workouts at the new level.
 */
export function shouldSuggestRound(history: HistoryEntry[], sequenceId: string, currentRounds: number): boolean {
  const recent = history.filter((e) => e.sequenceId === sequenceId).slice(-EASY_RUN);
  return (
    recent.length === EASY_RUN &&
    recent.every(
      (e) => e.difficulty !== undefined && e.difficulty <= EASY_MAX && e.plannedRounds === currentRounds && e.rounds >= e.plannedRounds,
    )
  );
}
