/**
 * Workout screen: the state machine that walks through a sequence, plus its UI.
 *
 *   loading -> intro -> active -> (intro -> active)* -> roundDone -> rest -> intro ...
 *                                                                \-> finished
 *
 * The camera stays on the whole time; overlays simply cover it.
 */
import { doneBeep, goBeep, repBeep, speak, stopSpeaking, tickBeep, unlockAudio } from './audio';
import { clear, h, stepper } from './dom';
import { getExercise, type Detector, type ExerciseDef, type Landmark } from './exercises';
import { createFigure } from './figure';
import { PoseEngine, WakeLock } from './pose';
import { RepCounter } from './repCounter';
import { clamp, formatTime, saveSettings, type Sequence, type Settings, type Step } from './storage';

type Phase = 'loading' | 'intro' | 'active' | 'transition' | 'roundDone' | 'rest' | 'finished';

/** Body must be missing this long mid-set before the warning appears. */
const WARN_AFTER_MS = 1200;

/**
 * Skeleton colours. White = in position and being measured, amber = not in
 * position, red = joints missing. Green is reserved for the flash on a
 * counted rep, so it never suggests more certainty than there is.
 */
const SKELETON = { ok: '#f2f4f7', hold: '#ffb020', lost: '#ff5d5d' };

export class Workout {
  private seq: Sequence;
  private phase: Phase = 'loading';
  private round = 1;
  private stepIdx = 0;
  private reps = 0;
  private totalReps = 0;
  private paused = false;
  private startedAt = performance.now();

  private timerMs = 0;
  private onTimer: (() => void) | null = null;
  private lastTick = performance.now();
  private interval = 0;
  private transitionTimeout = 0;

  private counter: RepCounter | null = null;
  private detector: Detector | null = null;
  private lostSince: number | null = null;
  private track: 'lost' | 'hold' | 'ok' | null = null;

  private engine: PoseEngine;
  private wake = new WakeLock();
  private stopFigure: (() => void) | null = null;

  // DOM
  private el: HTMLElement;
  private stage: HTMLElement;
  private overlay = h('div', { class: 'overlay', hidden: true });
  private pauseLayer = h('div', { class: 'overlay pause-layer', hidden: true });
  private hudRound = h('div', { class: 'hud-round' });
  private hudName = h('div', { class: 'hud-name' });
  private repsEl = h('span', { class: 'reps-now' }, '0');
  private targetEl = h('span', { class: 'reps-target' });
  private modeTag = h('div', { class: 'mode-tag' });
  /** Per-direction tally for exercises that have one (halos). */
  private tallyEl = h('div', { class: 'tally', hidden: true });
  private tally: Record<string, number> = {};
  private warn = h('div', { class: 'warn', hidden: true, role: 'alert' });
  private debugEl = h('div', { class: 'debug', hidden: true });
  private debugUpdate: ((raw: number | null) => void) | null = null;
  private timerEl: HTMLElement | null = null;
  private plusBtn: HTMLButtonElement;
  private skipBtn: HTMLButtonElement;
  private doneBtn: HTMLButtonElement;
  private pauseBtn: HTMLButtonElement;

  constructor(
    root: HTMLElement,
    sequence: Sequence,
    private settings: Settings,
    private onExit: () => void,
  ) {
    this.seq = JSON.parse(JSON.stringify(sequence)) as Sequence;
    // Exercises switched off on the setup screen are left out of this workout.
    this.seq.steps = this.seq.steps.filter((s) => s.enabled !== false);

    const video = h('video', { class: 'cam', playsInline: true, muted: true, autoplay: true });
    video.setAttribute('playsinline', '');
    const canvas = h('canvas', { class: 'cam skeleton' });
    this.stage = h('div', { class: 'stage' }, video, canvas);
    this.engine = new PoseEngine(video, canvas);
    this.engine.onFrame = (lm, aspect, t) => this.handleFrame(lm, aspect, t);

    this.pauseBtn = h('button', { type: 'button', class: 'btn bar-btn', onclick: () => this.setPaused(true) }, '⏸', h('small', null, 'Pause / edit'));
    this.skipBtn = h('button', { type: 'button', class: 'btn bar-btn', onclick: () => this.skip() }, '⏭', h('small', null, 'Skip exercise'));
    this.doneBtn = h('button', { type: 'button', class: 'btn bar-btn done', hidden: true, onclick: () => this.completeStep() }, '✓', h('small', null, 'Done'));
    this.plusBtn = h('button', { type: 'button', class: 'btn bar-btn plus', onclick: () => this.addRep() }, '+1');

    this.el = h(
      'div',
      { class: 'workout' },
      this.stage,
      h('div', { class: 'hud-top' }, this.hudRound, this.hudName),
      h('div', { class: 'counter' }, this.repsEl, this.targetEl),
      this.tallyEl,
      this.modeTag,
      this.warn,
      this.debugEl,
      this.overlay,
      this.pauseLayer,
      h('div', { class: 'bar' }, this.pauseBtn, this.skipBtn, this.doneBtn, this.plusBtn),
    );
    clear(root);
    root.append(this.el);

    this.interval = window.setInterval(() => this.tick(), 100);
    document.addEventListener('keydown', this.onKey);
    void this.boot();
  }

  /* ---------- lifecycle ---------- */

  private onKey = (e: KeyboardEvent): void => {
    if (e.code === 'Space' && !this.paused) {
      e.preventDefault();
      this.addRep();
    }
  };

  /** Starts the camera and loads the pose model. Called from the Start tap. */
  private async boot(): Promise<void> {
    unlockAudio();
    void this.wake.enable();
    this.applyMirror();
    const status = h('p', { class: 'ov-sub' }, 'Starting camera…');
    this.showOverlay(h('div', { class: 'ov-title' }, 'Getting ready'), status);
    let problem = '';
    try {
      await this.engine.startCamera(this.settings.facing);
    } catch (e) {
      problem = `Camera unavailable (${errText(e)}).`;
    }
    if (!problem) {
      status.textContent = 'Loading pose model…';
      try {
        await this.engine.loadModel();
        this.engine.start();
      } catch (e) {
        problem = `Pose model failed to load (${errText(e)}).`;
      }
    }
    if (this.phase !== 'loading') return; // user left meanwhile
    if (!problem) {
      this.startIntro(0);
      return;
    }
    this.showOverlay(
      h('div', { class: 'ov-title' }, 'Manual mode'),
      h('p', { class: 'ov-sub' }, `${problem} You can still run the workout: tap +1 for each rep or Done to move on.`),
      h('button', { type: 'button', class: 'btn primary big', onclick: () => this.startIntro(0) }, 'Continue'),
      h('button', { type: 'button', class: 'btn big', onclick: () => this.exit() }, 'Back'),
    );
  }

  private exit(): void {
    this.phase = 'finished';
    clearInterval(this.interval);
    clearTimeout(this.transitionTimeout);
    document.removeEventListener('keydown', this.onKey);
    this.stopFigure?.();
    stopSpeaking();
    this.engine.dispose();
    this.wake.disable();
    this.onExit();
  }

  private applyMirror(): void {
    this.stage.classList.toggle('mirror', this.settings.facing === 'user' && this.settings.mirror);
  }

  /* ---------- helpers ---------- */

  private get step(): Step {
    return this.seq.steps[this.stepIdx];
  }

  private get exercise(): ExerciseDef {
    return getExercise(this.step.exercise);
  }

  private cameraCounts(step: Step): boolean {
    return step.mode === 'camera' && !!getExercise(step.exercise).detector && this.engine.modelReady && this.engine.cameraReady;
  }

  private showOverlay(...content: (Node | string | null | false)[]): void {
    this.stopFigure?.();
    this.stopFigure = null;
    this.timerEl = null;
    clear(this.overlay);
    this.overlay.append(h('div', { class: 'ov-inner' }, ...content));
    this.overlay.hidden = false;
  }

  private hideOverlay(): void {
    this.stopFigure?.();
    this.stopFigure = null;
    this.timerEl = null;
    this.overlay.hidden = true;
    clear(this.overlay);
  }

  private setTimer(seconds: number, done: () => void): void {
    this.timerMs = seconds * 1000;
    this.onTimer = done;
    this.lastTick = performance.now();
  }

  private clearTimer(): void {
    this.onTimer = null;
  }

  private tick(): void {
    const now = performance.now();
    const dt = now - this.lastTick;
    this.lastTick = now;
    if (this.paused || !this.onTimer) return;
    const before = Math.ceil(this.timerMs / 1000);
    this.timerMs -= dt;
    const after = Math.ceil(this.timerMs / 1000);
    if (this.timerMs <= 0) {
      const done = this.onTimer;
      this.onTimer = null;
      done();
      return;
    }
    if (after !== before && after <= 3) tickBeep();
    this.renderTimer();
  }

  private renderTimer(): void {
    if (!this.timerEl) return;
    const sec = Math.max(0, Math.ceil(this.timerMs / 1000));
    this.timerEl.textContent = this.phase === 'rest' ? formatTime(sec) : String(sec);
  }

  private updateHud(): void {
    const n = this.seq.steps.length;
    this.hudRound.textContent = `Round ${this.round}/${this.seq.rounds} · ${this.stepIdx + 1}/${n}`;
    this.hudName.textContent = this.exercise.name;
    this.repsEl.textContent = String(this.reps);
    this.targetEl.textContent = `/ ${this.step.reps}`;
    const playing = this.phase === 'active';
    this.plusBtn.disabled = !playing;
    this.skipBtn.disabled = !(playing || this.phase === 'intro');
    this.doneBtn.hidden = !(playing && !this.counter);
  }

  /* ---------- intro overlay ---------- */

  private startIntro(idx: number): void {
    this.phase = 'intro';
    this.stepIdx = idx;
    this.reps = 0;
    this.counter = null;
    this.detector = null;
    this.tally = {};
    this.tallyEl.hidden = true;
    this.warn.hidden = true;
    this.debugEl.hidden = true;
    // No pose inference behind the overlay: saves battery and keeps the countdown smooth.
    this.engine.detecting = false;
    this.engine.clearCanvas();
    this.updateHud();
    this.renderIntro();
    const ex = this.exercise;
    speak(`${idx === 0 ? `Round ${this.round}. ` : ''}${ex.name}, ${this.step.reps} reps`);
    this.setTimer(this.settings.delaySec, () => this.beginActive());
  }

  private renderIntro(): void {
    const ex = this.exercise;
    const step = this.step;
    const fig = createFigure(ex.id);
    const camera = this.cameraCounts(step);
    const next = this.seq.steps[this.stepIdx + 1];
    const timer = h('div', { class: 'ov-count' });
    this.showOverlay(
      h('div', { class: 'ov-kicker' }, `Round ${this.round}/${this.seq.rounds} · exercise ${this.stepIdx + 1}/${this.seq.steps.length}`),
      h('div', { class: 'ov-title' }, ex.name),
      h(
        'div',
        { class: 'ov-row' },
        fig.el,
        h(
          'div',
          { class: 'ov-side' },
          timer,
          h('div', { class: 'ov-reps-label' }, 'reps'),
          stepper({
            value: step.reps,
            min: 1,
            max: 99,
            onChange: (v) => {
              step.reps = v;
              this.updateHud();
            },
          }),
        ),
      ),
      h('p', { class: 'ov-sub' }, camera ? `📷 Camera counts. ${ex.hint}` : '✋ Manual: tap +1 for each rep, or Done.'),
      h('p', { class: 'ov-next' }, next ? `Then: ${getExercise(next.exercise).name}` : 'Last exercise of the round'),
      h('button', { type: 'button', class: 'btn primary big', onclick: () => this.beginActive() }, 'Start now'),
    );
    this.stopFigure = fig.stop;
    this.timerEl = timer;
    this.renderTimer();
  }

  /* ---------- counting ---------- */

  private beginActive(): void {
    if (this.phase !== 'intro') return;
    this.clearTimer();
    this.phase = 'active';
    this.hideOverlay();
    goBeep();

    const ex = this.exercise;
    const wantsCamera = this.step.mode === 'camera' && !!ex.detector;
    if (this.cameraCounts(this.step) && ex.detector) {
      const det = ex.detector;
      const th = this.settings.thresholds[ex.id] ?? { lo: det.lo, hi: det.hi };
      this.detector = det;
      this.counter = new RepCounter({
        lo: th.lo,
        hi: th.hi,
        countOn: det.countOn,
        minRepMs: det.minRepMs,
        dwellMs: det.dwellMs ?? 150,
        settleMs: 400,
      });
      this.track = null;
      this.engine.skeletonColor = SKELETON.hold;
      if (det.directions) {
        this.tally = { [det.directions.hi]: 0, [det.directions.lo]: 0 };
        this.renderTally();
      }
      // 0 = "never seen yet": warn on the first frame without a body.
      this.lostSince = 0;
      this.modeTag.textContent = '📷 looking for you…';
      this.modeTag.className = 'mode-tag';
      this.buildDebug(ex, det);
    } else {
      this.counter = null;
      this.detector = null;
      this.modeTag.textContent = wantsCamera ? '✋ camera unavailable — tap +1 or Done' : '✋ manual — tap +1 or Done';
      this.modeTag.className = 'mode-tag manual';
      this.debugEl.hidden = true;
      this.debugUpdate = null;
      this.engine.clearCanvas();
    }
    this.engine.detecting = !!this.counter;
    this.updateHud();
  }

  private handleFrame(lm: Landmark[] | null, aspect: number, t: number): void {
    if (this.phase !== 'active' || this.paused || !this.counter || !this.detector) return;
    const raw = lm ? this.detector.signal({ lm, aspect }) : null;
    if (raw === null) {
      // Joints this exercise needs are hidden or out of frame.
      if (this.lostSince === null) this.lostSince = t;
      if (t - this.lostSince >= WARN_AFTER_MS) {
        this.warn.textContent = 'Step back — full body not visible';
        this.warn.hidden = false;
        this.setTrack('lost');
      }
    } else {
      this.lostSince = null;
      this.warn.hidden = true;
      // NaN = visible, but not in the posture this exercise is counted in.
      this.setTrack(Number.isNaN(raw) ? 'hold' : 'ok');
      if (this.counter.update(raw, t)) {
        const side = this.counter.lastStartSide;
        if (this.detector.directions && side) {
          this.tally[this.detector.directions[side]]++;
          this.renderTally();
        }
        this.addRep();
      }
    }
    this.debugUpdate?.(raw);
  }

  private renderTally(): void {
    const manual = this.reps - Object.values(this.tally).reduce((a, b) => a + b, 0);
    const parts = Object.entries(this.tally).map(([side, n]) => `${side} ${n}`);
    if (manual > 0) parts.push(`+1 ${manual}`);
    this.tallyEl.textContent = parts.join('  ·  ');
    this.tallyEl.hidden = false;
  }

  /** Reflects the tracking state in the status tag and the skeleton colour. */
  private setTrack(state: 'lost' | 'hold' | 'ok'): void {
    this.engine.skeletonColor = SKELETON[state];
    if (state === this.track) return;
    this.track = state;
    this.modeTag.textContent = state === 'ok' ? '📷 in position' : state === 'hold' ? '📷 get into position' : '📷 not tracking';
    this.modeTag.className = `mode-tag ${state}`;
  }

  /** One rep, from the camera or from the +1 button. */
  private addRep(): void {
    if (this.phase !== 'active' || this.paused) return;
    this.reps++;
    this.totalReps++;
    this.engine.flashUntil = performance.now() + 350;
    this.repsEl.textContent = String(this.reps);
    this.repsEl.classList.remove('pulse');
    void this.repsEl.offsetWidth; // restart the CSS animation
    this.repsEl.classList.add('pulse');
    if (!this.tallyEl.hidden) this.renderTally();
    if (this.reps >= this.step.reps) this.completeStep();
    else repBeep();
  }

  private completeStep(): void {
    if (this.phase !== 'active') return;
    this.phase = 'transition';
    this.updateHud();
    doneBeep();
    this.transitionTimeout = window.setTimeout(() => this.advance(), 700);
  }

  private skip(): void {
    if (this.phase !== 'active' && this.phase !== 'intro') return;
    this.clearTimer();
    this.advance();
  }

  private advance(): void {
    this.warn.hidden = true;
    if (this.stepIdx + 1 < this.seq.steps.length) this.startIntro(this.stepIdx + 1);
    else this.roundDone();
  }

  /* ---------- between rounds ---------- */

  private roundDone(): void {
    this.counter = null;
    this.engine.detecting = false;
    this.engine.clearCanvas();
    this.debugEl.hidden = true;
    if (this.round >= this.seq.rounds) {
      this.finish();
      return;
    }
    this.phase = 'roundDone';
    this.updateHud();
    speak(`Round ${this.round} complete`);
    this.renderRoundDone();
  }

  private renderRoundDone(): void {
    this.showOverlay(
      h('div', { class: 'ov-kicker' }, `${this.seq.rounds - this.round} to go`),
      h('div', { class: 'ov-title' }, `Round ${this.round} complete`),
      h('button', { type: 'button', class: 'btn primary big', onclick: () => this.startRest() }, `Rest ${formatTime(this.seq.restSec)}`),
      h('button', { type: 'button', class: 'btn big', onclick: () => this.nextRound() }, 'Start next round now'),
      h('button', { type: 'button', class: 'btn big danger', onclick: () => this.finish() }, 'Finish'),
    );
  }

  private startRest(): void {
    this.phase = 'rest';
    this.updateHud();
    this.setTimer(this.seq.restSec, () => this.nextRound());
    this.renderRest();
  }

  private renderRest(): void {
    const timer = h('div', { class: 'ov-count rest' });
    const first = this.seq.steps[0];
    this.showOverlay(
      h('div', { class: 'ov-kicker' }, `Rest before round ${this.round + 1}/${this.seq.rounds}`),
      timer,
      h('p', { class: 'ov-next' }, `Next: ${getExercise(first.exercise).name} × ${first.reps}`),
      h(
        'div',
        { class: 'ov-buttons' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn big',
            onclick: () => {
              this.timerMs += 30000;
              this.renderTimer();
            },
          },
          '+30 s',
        ),
        h('button', { type: 'button', class: 'btn primary big', onclick: () => this.nextRound() }, 'Start now'),
      ),
      h('button', { type: 'button', class: 'btn big danger', onclick: () => this.finish() }, 'Finish'),
    );
    this.timerEl = timer;
    this.renderTimer();
  }

  private nextRound(): void {
    if (this.phase !== 'roundDone' && this.phase !== 'rest' && this.phase !== 'finished') return;
    this.clearTimer();
    this.round++;
    this.startIntro(0);
  }

  private finish(): void {
    this.clearTimer();
    this.phase = 'finished';
    this.engine.detecting = false;
    this.updateHud();
    const mins = Math.round((performance.now() - this.startedAt) / 60000);
    speak('Workout complete');
    this.showOverlay(
      h('div', { class: 'ov-title' }, 'Workout complete'),
      h('p', { class: 'ov-sub' }, `${this.totalReps} reps · ${mins} min`),
      h('button', { type: 'button', class: 'btn primary big', onclick: () => this.exit() }, 'Finish'),
      h(
        'button',
        {
          type: 'button',
          class: 'btn big',
          onclick: () => {
            this.seq.rounds = Math.max(this.seq.rounds, this.round + 1);
            this.nextRound();
          },
        },
        'One more round',
      ),
    );
  }

  /* ---------- pause + quick edits ---------- */

  private setPaused(paused: boolean): void {
    if (this.phase === 'loading' || this.phase === 'finished') return;
    this.paused = paused;
    this.pauseLayer.hidden = !paused;
    this.pauseBtn.disabled = paused;
    if (paused) {
      stopSpeaking();
      this.renderPause();
      return;
    }
    clear(this.pauseLayer);
    // Quick edits may have changed what the current overlay shows.
    if (this.phase === 'intro') {
      const left = this.timerMs;
      this.timerMs = Math.min(left, this.settings.delaySec * 1000);
      this.renderIntro();
    } else if (this.phase === 'roundDone' || this.phase === 'rest') {
      if (this.round >= this.seq.rounds) this.finish();
      else if (this.phase === 'roundDone') this.renderRoundDone();
      else this.renderRest();
    } else if (this.phase === 'active') {
      if (this.reps >= this.step.reps) this.completeStep();
      if (this.counter && this.detector) this.buildDebug(this.exercise, this.detector);
    }
    this.updateHud();
  }

  private renderPause(): void {
    const s = this.settings;
    const rows: HTMLElement[] = [];
    const row = (label: string, control: HTMLElement): void => {
      rows.push(h('div', { class: 'edit-row' }, h('span', { class: 'edit-label' }, label), control));
    };

    if (this.phase === 'active') {
      row(
        `Now: ${this.exercise.name}`,
        stepper({ value: this.step.reps, min: Math.max(1, this.reps), max: 99, onChange: (v) => (this.step.reps = v) }),
      );
    }
    // "Upcoming" = the exercise on the overlay, else the one after the current, else round start.
    const upIdx = this.phase === 'intro' ? this.stepIdx : this.phase === 'active' || this.phase === 'transition' ? this.stepIdx + 1 : 0;
    const up = this.seq.steps[upIdx] ?? (this.round < this.seq.rounds ? this.seq.steps[0] : undefined);
    if (up) {
      row(`Next: ${getExercise(up.exercise).name}`, stepper({ value: up.reps, min: 1, max: 99, onChange: (v) => (up.reps = v) }));
    }
    row(
      'Next-exercise delay',
      stepper({
        value: s.delaySec,
        min: 3,
        max: 10,
        format: (v) => `${v} s`,
        onChange: (v) => {
          s.delaySec = v;
          saveSettings(s);
        },
      }),
    );
    row('Rounds', stepper({ value: this.seq.rounds, min: this.round, max: 30, onChange: (v) => (this.seq.rounds = v) }));
    row(
      'Debug signal',
      h(
        'button',
        {
          type: 'button',
          class: `btn toggle${s.debug ? ' on' : ''}`,
          onclick: (e: Event) => {
            s.debug = !s.debug;
            saveSettings(s);
            const b = e.currentTarget as HTMLElement;
            b.classList.toggle('on', s.debug);
            b.textContent = s.debug ? 'On' : 'Off';
          },
        },
        s.debug ? 'On' : 'Off',
      ),
    );

    clear(this.pauseLayer);
    this.pauseLayer.append(
      h(
        'div',
        { class: 'ov-inner' },
        h('div', { class: 'ov-title' }, 'Paused'),
        h('div', { class: 'edit-list' }, ...rows),
        h('button', { type: 'button', class: 'btn primary big', onclick: () => this.setPaused(false) }, 'Resume'),
        h('button', { type: 'button', class: 'btn big danger', onclick: () => this.exit() }, 'End workout'),
      ),
    );
  }

  /* ---------- debug panel ---------- */

  private buildDebug(ex: ExerciseDef, det: Detector): void {
    const counter = this.counter;
    if (!this.settings.debug || !counter) {
      this.debugEl.hidden = true;
      this.debugUpdate = null;
      return;
    }
    const s = this.settings;
    const [min, max] = det.range;
    const pct = (v: number): string => `${clamp(((v - min) / (max - min)) * 100, 0, 100)}%`;
    const fmt = (v: number): string => (det.step < 1 ? v.toFixed(2) : v.toFixed(0)) + det.unit;

    const value = h('span', { class: 'dbg-value' }, '–');
    const info = h('span', { class: 'dbg-info' });
    const loMark = h('i', { class: 'dbg-mark lo' });
    const hiMark = h('i', { class: 'dbg-mark hi' });
    const dot = h('i', { class: 'dbg-dot' });
    const loTxt = h('b', null);
    const hiTxt = h('b', null);

    const apply = (lo: number, hi: number, persist: boolean): void => {
      counter.setThresholds(lo, hi);
      loMark.style.left = pct(lo);
      hiMark.style.left = pct(hi);
      loTxt.textContent = `lo ${fmt(lo)}`;
      hiTxt.textContent = `hi ${fmt(hi)}`;
      if (persist) {
        s.thresholds[ex.id] = { lo, hi };
        saveSettings(s);
      }
    };
    const round = (v: number): number => Math.round(v / det.step) * det.step;
    const nudge = (which: 'lo' | 'hi', dir: number): void => {
      let { lo, hi } = counter.cfg;
      if (which === 'lo') lo = Math.min(round(lo + dir * det.step), hi - det.step);
      else hi = Math.max(round(hi + dir * det.step), lo + det.step);
      apply(lo, hi, true);
    };
    const btn = (label: string, fn: () => void): HTMLElement => h('button', { type: 'button', class: 'btn dbg-btn', onclick: fn }, label);

    clear(this.debugEl);
    this.debugEl.append(
      h('div', { class: 'dbg-head' }, h('span', null, `${det.label} · counts on ${det.countOn}`), value),
      h('div', { class: 'dbg-bar' }, loMark, hiMark, dot),
      h('div', { class: 'dbg-ctl' }, btn('−', () => nudge('lo', -1)), loTxt, btn('+', () => nudge('lo', 1)), btn('−', () => nudge('hi', -1)), hiTxt, btn('+', () => nudge('hi', 1))),
      h(
        'div',
        { class: 'dbg-foot' },
        info,
        btn('reset', () => {
          delete s.thresholds[ex.id];
          saveSettings(s);
          apply(det.lo, det.hi, false);
        }),
      ),
    );
    apply(counter.cfg.lo, counter.cfg.hi, false);
    this.debugEl.hidden = false;

    this.debugUpdate = (raw) => {
      const v = counter.value;
      const state = raw === null ? 'not visible' : Number.isNaN(raw) ? 'not in position' : `zone ${counter.zone ?? '–'}`;
      value.textContent = v === null ? '–' : fmt(v);
      if (v !== null) dot.style.left = pct(v);
      info.textContent = `${state} · ${this.engine.fps} fps · ${this.engine.delegate ?? ''}`;
    };
  }
}

function errText(e: unknown): string {
  if (e instanceof DOMException && e.name === 'NotAllowedError') return 'permission denied';
  if (e instanceof DOMException && e.name === 'NotFoundError') return 'no camera found';
  return e instanceof Error ? e.message : String(e);
}
