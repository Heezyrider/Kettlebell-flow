import './style.css';
import { audioPrefs } from './audio';
import { clear, h, stepper } from './dom';
import { renderEditor } from './editor';
import { getExercise } from './exercises';
import { DIFFICULTY_LABELS, EASY_RUN, dayStreak, doneToday, loadHistory, removeHistory, shouldSuggestRound, type HistoryEntry } from './history';
import { formatTime, loadSequences, loadSettings, saveSequences, saveSettings, uid, type Sequence } from './storage';
import { Workout } from './workout';

const root = document.getElementById('app') as HTMLElement;
const sequences = loadSequences();
const settings = loadSettings();

function activeSequence(): Sequence {
  let seq = sequences.find((s) => s.id === settings.activeSequenceId);
  if (!seq) {
    seq = sequences[0];
    settings.activeSequenceId = seq.id;
  }
  return seq;
}

function toggle(label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
  const btn = h(
    'button',
    {
      type: 'button',
      class: `btn toggle${get() ? ' on' : ''}`,
      onclick: () => {
        set(!get());
        saveSettings(settings);
        btn.classList.toggle('on', get());
        btn.textContent = get() ? 'On' : 'Off';
      },
    },
    get() ? 'On' : 'Off',
  );
  return h('div', { class: 'field-row' }, h('span', { class: 'label' }, label), btn);
}

function slider(label: string, min: number, max: number, step: number, value: number, fmt: (v: number) => string, onChange: (v: number) => void): HTMLElement {
  const out = h('b', null, fmt(value));
  return h(
    'label',
    { class: 'field' },
    h('span', { class: 'label' }, label, ' ', out),
    h('input', {
      type: 'range',
      min,
      max,
      step,
      value,
      oninput: (e: Event) => {
        const v = Number((e.target as HTMLInputElement).value);
        out.textContent = fmt(v);
        onChange(v);
      },
    }),
  );
}

let showAllHistory = false;

function historyRow(e: HistoryEntry): HTMLElement {
  const date = new Date(e.at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return h(
    'li',
    { class: 'hist-row' },
    h('span', { class: 'hist-date' }, date),
    h('span', { class: 'hist-main' }, `${e.rounds}/${e.plannedRounds} rounds · ${e.reps} reps · ${e.minutes} min`),
    h('span', { class: `hist-rate${e.difficulty ? ` d${e.difficulty}` : ''}` }, e.difficulty ? `${e.difficulty}/6 ${DIFFICULTY_LABELS[e.difficulty - 1]}` : 'not rated'),
    showAllHistory &&
      h(
        'button',
        {
          type: 'button',
          class: 'btn icon danger',
          'aria-label': 'Delete entry',
          onclick: () => {
            if (!confirm('Delete this workout from the log?')) return;
            removeHistory(e.id);
            renderSetup();
          },
        },
        '✕',
      ),
  );
}

/** Streak, recent workouts and the "add a round" suggestion. */
function progressCard(seq: Sequence): HTMLElement {
  const history = loadHistory();
  const now = Date.now();
  const streak = dayStreak(history, now);
  const today = doneToday(history, now);
  const last = history[history.length - 1];
  const suggest = shouldSuggestRound(history, seq.id, seq.rounds) && settings.suggestionDismissedAt !== last?.id;
  const shown = (showAllHistory ? history : history.slice(-5)).slice().reverse();

  return h(
    'section',
    { class: 'card' },
    h(
      'div',
      { class: 'field-row' },
      h('span', { class: 'streak' }, h('b', null, streak), ' day streak'),
      h('span', { class: `today${today ? ' done' : ''}` }, today ? '✓ Done today' : 'Not done today'),
    ),
    suggest &&
      h(
        'div',
        { class: 'suggest' },
        h('p', null, `Your last ${EASY_RUN} workouts felt easy. Go from ${seq.rounds} to ${seq.rounds + 1} rounds?`),
        h(
          'div',
          { class: 'add-row' },
          h(
            'button',
            {
              type: 'button',
              class: 'btn primary',
              onclick: () => {
                seq.rounds += 1;
                saveSequences(sequences);
                renderSetup();
              },
            },
            'Add a round',
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'btn',
              onclick: () => {
                settings.suggestionDismissedAt = last?.id;
                saveSettings(settings);
                renderSetup();
              },
            },
            'Not now',
          ),
        ),
      ),
    history.length
      ? h('ul', { class: 'hist-list' }, shown.map(historyRow))
      : h('p', { class: 'muted small' }, 'No workouts logged yet. Finish one and rate it to start your log.'),
    history.length > 5 || showAllHistory
      ? h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onclick: () => {
              showAllHistory = !showAllHistory;
              renderSetup();
            },
          },
          showAllHistory ? 'Show recent only' : `Show all ${history.length} (and edit)`,
        )
      : null,
  );
}

function renderSetup(): void {
  const seq = activeSequence();
  const edit = (id: string): void =>
    renderEditor(root, sequences, settings, id, (activeId) => {
      settings.activeSequenceId = activeId;
      saveSettings(settings);
      renderSetup();
    });

  const facingBtn = (value: 'user' | 'environment', label: string): HTMLElement =>
    h(
      'button',
      {
        type: 'button',
        class: `btn seg${settings.facing === value ? ' on' : ''}`,
        onclick: () => {
          settings.facing = value;
          saveSettings(settings);
          renderSetup();
        },
      },
      label,
    );

  clear(root);
  root.append(
    h(
      'div',
      { class: 'screen' },
      h('header', { class: 'topbar' }, h('h1', null, 'Kettlebell Flow')),

      progressCard(seq),

      h(
        'section',
        { class: 'card' },
        h('span', { class: 'label' }, 'Sequence'),
        h(
          'div',
          { class: 'add-row' },
          h(
            'select',
            {
              class: 'input',
              'aria-label': 'Sequence',
              onchange: (e: Event) => {
                settings.activeSequenceId = (e.target as HTMLSelectElement).value;
                saveSettings(settings);
                renderSetup();
              },
            },
            sequences.map((s) => h('option', { value: s.id, selected: s.id === seq.id }, s.name)),
          ),
          h('button', { type: 'button', class: 'btn', onclick: () => edit(seq.id) }, 'Edit'),
          h(
            'button',
            {
              type: 'button',
              class: 'btn',
              onclick: () => {
                const fresh: Sequence = { id: uid(), name: 'New sequence', steps: [], rounds: 3, restSec: 120 };
                sequences.push(fresh);
                saveSequences(sequences);
                edit(fresh.id);
              },
            },
            'New',
          ),
        ),
        h(
          'div',
          { class: 'seq-preview' },
          seq.steps.map((s) => {
            const ex = getExercise(s.exercise);
            const on = s.enabled !== false;
            return h(
              'button',
              {
                type: 'button',
                class: `btn seq-item${on ? '' : ' off'}`,
                'aria-pressed': String(on),
                onclick: () => {
                  s.enabled = !on;
                  saveSequences(sequences);
                  renderSetup();
                },
              },
              h('span', { class: 'seq-check' }, on ? '✓' : ''),
              h('span', { class: 'seq-name' }, h('b', null, s.reps), ` ${ex.name}`),
              h('span', { class: 'muted' }, s.mode === 'camera' && ex.detector ? '📷' : '✋'),
            );
          }),
        ),
        h('p', { class: 'muted small' }, 'Tap an exercise to skip it for this workout · 📷 camera counts · ✋ tap to count'),
      ),

      h(
        'section',
        { class: 'card' },
        h(
          'div',
          { class: 'field-row' },
          h('span', { class: 'label' }, 'Rounds'),
          stepper({
            value: seq.rounds,
            min: 1,
            max: 30,
            onChange: (v) => {
              seq.rounds = v;
              saveSequences(sequences);
            },
          }),
        ),
        slider('Rest between rounds', 30, 300, 15, seq.restSec, formatTime, (v) => {
          seq.restSec = v;
          saveSequences(sequences);
        }),
        slider('"Next exercise" delay', 3, 10, 1, settings.delaySec, (v) => `${v} s`, (v) => {
          settings.delaySec = v;
          saveSettings(settings);
        }),
      ),

      h(
        'section',
        { class: 'card' },
        h('div', { class: 'field-row' }, h('span', { class: 'label' }, 'Camera'), h('div', { class: 'segmented' }, facingBtn('user', 'Front'), facingBtn('environment', 'Back'))),
        toggle('Mirror front camera', () => settings.mirror, (v) => (settings.mirror = v)),
        toggle('Voice announcements', () => settings.voice, (v) => (settings.voice = audioPrefs.voice = v)),
        toggle('Beeps', () => settings.beep, (v) => (settings.beep = audioPrefs.beep = v)),
        toggle('Debug mode (live signal + thresholds)', () => settings.debug, (v) => (settings.debug = v)),
      ),

      h(
        'p',
        { class: 'tip' },
        '📱 Prop the phone 2–3 m away, about hip height, so your whole body — head to feet — is in the picture. Turn the volume up.',
      ),

      h('p', { class: 'muted small' }, `Build ${__BUILD__}`),

      h(
        'div',
        { class: 'start-wrap' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn primary start',
            disabled: !seq.steps.some((s) => s.enabled !== false),
            onclick: () => new Workout(root, seq, settings, renderSetup),
          },
          'Start workout',
        ),
      ),
    ),
  );
}

audioPrefs.voice = settings.voice;
audioPrefs.beep = settings.beep;
renderSetup();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}
