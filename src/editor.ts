/** Sequence editor: add, remove, reorder exercises; reps; camera or manual. Changes save immediately. */
import { clear, h, stepper } from './dom';
import { EXERCISES, cameraByDefault, getExercise } from './exercises';
import { makeStep, saveSequences, uid, type Sequence, type Settings } from './storage';

export function renderEditor(
  root: HTMLElement,
  sequences: Sequence[],
  settings: Settings,
  seqId: string,
  onClose: (activeId: string) => void,
): void {
  const seq = sequences.find((s) => s.id === seqId) ?? sequences[0];
  const save = (): void => saveSequences(sequences);
  const list = h('div', { class: 'step-list' });

  const renderSteps = (): void => {
    clear(list);
    if (!seq.steps.length) list.append(h('p', { class: 'muted' }, 'No exercises yet. Add one below.'));
    seq.steps.forEach((step, i) => {
      const ex = getExercise(step.exercise);
      const move = (dir: number): void => {
        const j = i + dir;
        if (j < 0 || j >= seq.steps.length) return;
        [seq.steps[i], seq.steps[j]] = [seq.steps[j], seq.steps[i]];
        save();
        renderSteps();
      };
      const select = h(
        'select',
        {
          class: 'input',
          'aria-label': 'Exercise',
          onchange: (e: Event) => {
            const next = getExercise((e.target as HTMLSelectElement).value);
            step.exercise = next.id;
            step.reps = next.defaultReps;
            step.mode = cameraByDefault(next) ? 'camera' : 'manual';
            save();
            renderSteps();
          },
        },
        EXERCISES.map((e) => h('option', { value: e.id, selected: e.id === ex.id }, e.name)),
      );
      const canCamera = !!ex.detector;
      const modeBtn = h(
        'button',
        {
          type: 'button',
          class: `btn toggle${step.mode === 'camera' && canCamera ? ' on' : ''}`,
          disabled: !canCamera,
          title: canCamera ? `Camera confidence: ${ex.confidence}` : 'No camera counter for this exercise',
          onclick: () => {
            step.mode = step.mode === 'camera' ? 'manual' : 'camera';
            save();
            renderSteps();
          },
        },
        step.mode === 'camera' && canCamera ? '📷 Camera' : '✋ Manual',
      );
      list.append(
        h(
          'div',
          { class: 'step-row' },
          h(
            'div',
            { class: 'step-move' },
            h('button', { type: 'button', class: 'btn icon', disabled: i === 0, 'aria-label': 'Move up', onclick: () => move(-1) }, '↑'),
            h('button', { type: 'button', class: 'btn icon', disabled: i === seq.steps.length - 1, 'aria-label': 'Move down', onclick: () => move(1) }, '↓'),
          ),
          h(
            'div',
            { class: 'step-main' },
            select,
            h(
              'div',
              { class: 'step-controls' },
              stepper({
                value: step.reps,
                min: 1,
                max: 99,
                onChange: (v) => {
                  step.reps = v;
                  save();
                },
              }),
              modeBtn,
            ),
            canCamera ? h('small', { class: `conf ${ex.confidence}` }, `camera confidence: ${ex.confidence}`) : h('small', { class: 'conf none' }, 'manual only'),
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'btn icon danger',
              'aria-label': 'Remove exercise',
              onclick: () => {
                seq.steps.splice(i, 1);
                save();
                renderSteps();
              },
            },
            '✕',
          ),
        ),
      );
    });
  };

  const addSelect = h('select', { class: 'input', 'aria-label': 'Exercise to add' }, EXERCISES.map((e) => h('option', { value: e.id }, e.name)));

  clear(root);
  root.append(
    h(
      'div',
      { class: 'screen' },
      h(
        'header',
        { class: 'topbar' },
        h('button', { type: 'button', class: 'btn', onclick: () => onClose(seq.id) }, '← Done'),
        h('h1', null, 'Edit sequence'),
      ),
      h(
        'label',
        { class: 'card field' },
        h('span', { class: 'label' }, 'Name'),
        h('input', {
          class: 'input',
          type: 'text',
          value: seq.name,
          maxLength: 40,
          oninput: (e: Event) => {
            seq.name = (e.target as HTMLInputElement).value.trim() || 'Untitled';
            save();
          },
        }),
      ),
      list,
      h(
        'div',
        { class: 'card add-row' },
        addSelect,
        h(
          'button',
          {
            type: 'button',
            class: 'btn primary',
            onclick: () => {
              seq.steps.push(makeStep(addSelect.value));
              save();
              renderSteps();
            },
          },
          '+ Add',
        ),
      ),
      h(
        'div',
        { class: 'card add-row' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onclick: () => {
              const copy: Sequence = JSON.parse(JSON.stringify(seq));
              copy.id = uid();
              copy.name = `${seq.name} copy`;
              copy.steps.forEach((s) => (s.id = uid()));
              sequences.push(copy);
              save();
              renderEditor(root, sequences, settings, copy.id, onClose);
            },
          },
          'Duplicate',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn danger',
            disabled: sequences.length <= 1,
            onclick: () => {
              if (!confirm(`Delete "${seq.name}"?`)) return;
              sequences.splice(sequences.indexOf(seq), 1);
              save();
              onClose(sequences[0].id);
            },
          },
          'Delete sequence',
        ),
      ),
    ),
  );
  renderSteps();
}
