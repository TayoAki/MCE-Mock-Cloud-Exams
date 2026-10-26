import type { AnswerType, QuestionDetail, QuestionInput, QuestionOption } from '../types';
import { Button, Checkbox, Field, Input, Select, Textarea, cx } from './ui';

const LETTERS = 'ABCDEFGH';

export const ANSWER_TYPE_LABELS: Record<AnswerType, string> = {
  single: 'Single answer',
  multiple: 'Multiple answers (exact set)',
  order: 'Put in order (tap to sequence)',
  match: 'Match pairs',
  type: 'Typed or spoken answer',
};

export function emptyQuestion(): QuestionInput {
  return {
    prompt: '',
    answer_type: 'single',
    options: [
      { key: 'A', text: '' },
      { key: 'B', text: '' },
      { key: 'C', text: '' },
      { key: 'D', text: '' },
    ],
    correct_options: [],
    rationale: '',
    source_url: '',
    reviewed_notes: '',
    presentation: 'text',
  };
}

/** The editable form of a stored question: order steps in their correct order, match pairs aligned. */
export function toInput(q: QuestionDetail): QuestionInput {
  const base = { prompt: q.prompt, rationale: q.rationale, source_url: q.source_url, reviewed_notes: q.reviewed_notes, presentation: q.presentation ?? 'text', input_hint: q.input_hint };
  const text = new Map(q.options.map((o) => [o.key, o.text]));
  if (q.answer_type === 'order') {
    const steps = q.correct_options.map((k, i) => ({ key: LETTERS[i]!, text: text.get(k) ?? '' }));
    return { ...base, answer_type: 'order', options: steps, correct_options: steps.map((s) => s.key) };
  }
  if (q.answer_type === 'match') {
    const targets = new Map(q.match_targets.map((t) => [t.key, t.text]));
    const pairs = [...q.correct_options].sort().map((p) => p.split('='));
    return {
      ...base,
      answer_type: 'match',
      options: pairs.map(([l], i) => ({ key: LETTERS[i]!, text: text.get(l!) ?? '' })),
      match_targets: pairs.map(([, r], i) => ({ key: String(i + 1), text: targets.get(r!) ?? '' })),
      correct_options: pairs.map((_, i) => `${LETTERS[i]}=${i + 1}`),
    };
  }
  if (q.answer_type === 'type') return { ...base, answer_type: 'type', options: [], correct_options: [], accepted_answers: [...q.accepted_answers] };
  return { ...base, answer_type: q.answer_type, options: q.options.map((o) => ({ ...o })), correct_options: [...q.correct_options] };
}

/** Mirrors the server's structural publication checks so authors see problems early. */
export function questionProblems(q: QuestionInput): string[] {
  const problems: string[] = [];
  if (q.prompt.trim().length < 10) problems.push('The prompt needs at least 10 characters.');
  if (q.answer_type === 'type') {
    if (!(q.accepted_answers ?? []).some((a) => a.trim())) problems.push('Add at least one accepted answer.');
  } else {
    if (q.options.length < 2) problems.push('At least two options are required.');
    if (q.options.some((o) => !o.text.trim())) problems.push('Every option needs text.');
  }
  const correct = new Set(q.correct_options);
  if (q.answer_type === 'single' && correct.size !== 1) problems.push('A single-answer question needs exactly one correct option.');
  if (q.answer_type === 'multiple' && correct.size < 1) problems.push('A multiple-answer question needs at least one correct option.');
  if (q.answer_type === 'order' && (q.options.length < 3 || q.options.length > 8)) problems.push('An order question needs 3 to 8 steps.');
  if (q.answer_type === 'match' && (q.match_targets ?? []).some((t) => !t.text.trim())) problems.push('Every pair needs both sides.');
  if (!q.rationale.trim()) problems.push('A rationale is required; learners see it after every answer.');
  if (!/^https?:\/\/\S+$/.test(q.source_url)) problems.push('A source URL (http or https) is required.');
  return problems;
}

/** Switching format keeps the prompt and rationale and starts the answer fields fresh. */
function convert(value: QuestionInput, answer_type: AnswerType): QuestionInput {
  const texts = value.options.map((o) => o.text);
  if (answer_type === 'single' || answer_type === 'multiple') {
    const options = (texts.length >= 2 ? texts : ['', '', '', '']).map((text, i) => ({ key: LETTERS[i]!, text }));
    const keep = value.answer_type === 'single' || value.answer_type === 'multiple' ? value.correct_options : [];
    return { ...value, answer_type, options, match_targets: undefined, accepted_answers: undefined, correct_options: answer_type === 'single' ? keep.slice(0, 1) : keep };
  }
  if (answer_type === 'order') {
    const options = (texts.length >= 3 ? texts : ['', '', '']).map((text, i) => ({ key: LETTERS[i]!, text }));
    return { ...value, answer_type, options, match_targets: undefined, accepted_answers: undefined, correct_options: options.map((o) => o.key) };
  }
  if (answer_type === 'match') {
    const options = (texts.length >= 2 ? texts.slice(0, 6) : ['', '', '']).map((text, i) => ({ key: LETTERS[i]!, text }));
    return { ...value, answer_type, options, match_targets: options.map((_, i) => ({ key: String(i + 1), text: '' })), accepted_answers: undefined, correct_options: options.map((o, i) => `${o.key}=${i + 1}`) };
  }
  return { ...value, answer_type, options: [], match_targets: undefined, correct_options: [], accepted_answers: [''] };
}

function ListEditor({ items, onChange, min, max, label, addLabel, reorder }: { items: string[]; onChange: (items: string[]) => void; min: number; max: number; label: (i: number) => string; addLabel: string; reorder?: boolean }) {
  const move = (i: number, by: number) => {
    const next = [...items];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    onChange(next);
  };
  return (
    <div className="space-y-2">
      {items.map((text, i) => (
        <div key={i} className="flex items-center gap-2 rounded-lg border border-border p-1.5 pl-2">
          <span className="w-6 font-mono text-xs font-medium">{label(i)}</span>
          <Input className="flex-1" value={text} aria-label={`${label(i)} text`} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
          {reorder && (
            <>
              <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${label(i)} up`}>
                ↑
              </Button>
              <Button size="sm" variant="ghost" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${label(i)} down`}>
                ↓
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" disabled={items.length <= min} onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`Remove ${label(i)}`}>
            Remove
          </Button>
        </div>
      ))}
      <Button size="sm" disabled={items.length >= max} onClick={() => onChange([...items, ''])}>
        {addLabel}
      </Button>
    </div>
  );
}

export function QuestionFields({ value, onChange }: { value: QuestionInput; onChange: (q: QuestionInput) => void }) {
  const set = (patch: Partial<QuestionInput>) => onChange({ ...value, ...patch });
  const relabel = (options: QuestionOption[]) => options.map((o, i) => ({ ...o, key: LETTERS[i]! }));
  const type = value.answer_type;

  const toggleCorrect = (key: string) => {
    if (type === 'single') return set({ correct_options: [key] });
    set({ correct_options: value.correct_options.includes(key) ? value.correct_options.filter((k) => k !== key) : [...value.correct_options, key].sort() });
  };

  const removeOption = (index: number) => {
    const removedKey = value.options[index]!.key;
    const remaining = value.options.filter((_, i) => i !== index);
    const keyMap = new Map(remaining.map((o, i) => [o.key, LETTERS[i]!]));
    set({
      options: relabel(remaining),
      correct_options: value.correct_options.filter((k) => k !== removedKey).map((k) => keyMap.get(k)!).filter(Boolean),
    });
  };

  const setSteps = (steps: string[]) => {
    const options = steps.map((text, i) => ({ key: LETTERS[i]!, text }));
    set({ options, correct_options: options.map((o) => o.key) });
  };

  const setPairs = (pairs: [string, string][]) =>
    set({
      options: pairs.map(([l], i) => ({ key: LETTERS[i]!, text: l })),
      match_targets: pairs.map(([, r], i) => ({ key: String(i + 1), text: r })),
      correct_options: pairs.map((_, i) => `${LETTERS[i]}=${i + 1}`),
    });
  const pairs: [string, string][] = value.options.map((o, i) => [o.text, value.match_targets?.[i]?.text ?? '']);

  return (
    <div className="space-y-4">
      <Field label="Prompt" hint="Original wording only. Never use recalled live exam questions.">
        <Textarea rows={3} value={value.prompt} onChange={(e) => set({ prompt: e.target.value })} />
      </Field>

      <div className="flex flex-wrap items-end gap-4">
        <Field label="Answer type" className="w-72">
          <Select value={type} onChange={(e) => onChange(convert(value, e.target.value as AnswerType))}>
            {(Object.keys(ANSWER_TYPE_LABELS) as AnswerType[]).map((t) => (
              <option key={t} value={t}>
                {ANSWER_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Checkbox
          label="Listening question: read the prompt aloud and hide its text until asked"
          checked={value.presentation === 'listen'}
          onChange={(e) => set({ presentation: e.target.checked ? 'listen' : 'text' })}
        />
      </div>
      {type === 'order' || type === 'match' || type === 'type' ? (
        <p className="text-xs text-muted">This format is for practice. Mocks and timed quizzes use only single and multiple answer questions, like the real exam.</p>
      ) : null}

      {type === 'single' || type === 'multiple' ? (
        <fieldset>
          <legend className="mb-1 text-xs font-medium">Options — mark the correct {type === 'single' ? 'one' : 'ones'}</legend>
          <div className="space-y-2">
            {value.options.map((o, i) => {
              const correct = value.correct_options.includes(o.key);
              return (
                <div key={i} className={cx('flex items-center gap-2 rounded-lg border p-1.5 pl-2', correct ? 'border-success/40 bg-mint/50' : 'border-border')}>
                  <label className="flex items-center gap-1.5 text-xs font-medium" title="Correct">
                    <input
                      type={type === 'single' ? 'radio' : 'checkbox'}
                      name="correct"
                      className="size-4 accent-success"
                      checked={correct}
                      onChange={() => toggleCorrect(o.key)}
                      aria-label={`Option ${o.key} is correct`}
                    />
                    <span className="w-4 font-mono">{o.key}</span>
                  </label>
                  <Input
                    className="flex-1"
                    value={o.text}
                    aria-label={`Option ${o.key} text`}
                    onChange={(e) => set({ options: value.options.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })}
                  />
                  <Button size="sm" variant="ghost" disabled={value.options.length <= 2} onClick={() => removeOption(i)} aria-label={`Remove option ${o.key}`}>
                    Remove
                  </Button>
                </div>
              );
            })}
          </div>
          <Button size="sm" className="mt-2" disabled={value.options.length >= 8} onClick={() => set({ options: relabel([...value.options, { key: 'X', text: '' }]) })}>
            Add option
          </Button>
        </fieldset>
      ) : null}

      {type === 'order' ? (
        <fieldset>
          <legend className="mb-1 text-xs font-medium">Steps in the correct order. Learners see them shuffled.</legend>
          <ListEditor items={value.options.map((o) => o.text)} onChange={setSteps} min={3} max={8} label={(i) => `${i + 1}.`} addLabel="Add step" reorder />
        </fieldset>
      ) : null}

      {type === 'match' ? (
        <fieldset>
          <legend className="mb-1 text-xs font-medium">Pairs. Learners see the right-hand column shuffled.</legend>
          <div className="space-y-2">
            {pairs.map(([l, r], i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-border p-1.5 pl-2">
                <Input className="flex-1" value={l} aria-label={`Pair ${i + 1} item`} placeholder="Term" onChange={(e) => setPairs(pairs.map((p, j) => (j === i ? [e.target.value, p[1]] : p)))} />
                <span className="text-muted">→</span>
                <Input className="flex-[1.4]" value={r} aria-label={`Pair ${i + 1} match`} placeholder="What it matches" onChange={(e) => setPairs(pairs.map((p, j) => (j === i ? [p[0], e.target.value] : p)))} />
                <Button size="sm" variant="ghost" disabled={pairs.length <= 2} onClick={() => setPairs(pairs.filter((_, j) => j !== i))} aria-label={`Remove pair ${i + 1}`}>
                  Remove
                </Button>
              </div>
            ))}
          </div>
          <Button size="sm" className="mt-2" disabled={pairs.length >= 6} onClick={() => setPairs([...pairs, ['', '']])}>
            Add pair
          </Button>
        </fieldset>
      ) : null}

      {type === 'type' ? (
        <>
          <fieldset>
            <legend className="mb-1 text-xs font-medium">Accepted answers. The first is shown as the answer. Case, spacing, punctuation and small typos are forgiven.</legend>
            <ListEditor items={value.accepted_answers ?? ['']} onChange={(accepted_answers) => set({ accepted_answers })} min={1} max={10} label={(i) => `${i + 1}.`} addLabel="Add accepted answer" />
          </fieldset>
          <Field label="Input hint" hint="Shown in the empty answer box, e.g. “Type the command”." className="max-w-md">
            <Input value={value.input_hint ?? ''} maxLength={80} onChange={(e) => set({ input_hint: e.target.value })} />
          </Field>
        </>
      ) : null}

      <Field label="Reviewed rationale" hint="Shown after every graded answer and used as the AI explainer's source of truth.">
        <Textarea rows={3} value={value.rationale} onChange={(e) => set({ rationale: e.target.value })} />
      </Field>
      <Field label="Source URL">
        <Input type="url" value={value.source_url} placeholder="https://docs.databricks.com/…" onChange={(e) => set({ source_url: e.target.value })} />
      </Field>
      <Field label="Reviewer notes (private)">
        <Textarea rows={2} value={value.reviewed_notes ?? ''} onChange={(e) => set({ reviewed_notes: e.target.value })} />
      </Field>
    </div>
  );
}

/** Read-only view of a question's answer, in its format. */
export function AnswerPreview({ q }: { q: QuestionDetail }) {
  const text = new Map(q.options.map((o) => [o.key, o.text]));
  if (q.answer_type === 'order') {
    return (
      <ol className="mt-4 space-y-2">
        {q.correct_options.map((k, i) => (
          <li key={k} className="flex items-start gap-3 rounded-lg border border-success/40 bg-mint/60 px-3 py-2">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-success font-mono text-xs font-semibold text-white">{i + 1}</span>
            <span className="flex-1 text-sm">{text.get(k)}</span>
          </li>
        ))}
      </ol>
    );
  }
  if (q.answer_type === 'match') {
    const targets = new Map(q.match_targets.map((t) => [t.key, t.text]));
    return (
      <ul className="mt-4 space-y-2">
        {[...q.correct_options].sort().map((p) => (
          <li key={p} className="grid grid-cols-[1fr_auto_1.4fr] items-start gap-2 rounded-lg border border-border px-3 py-2 text-sm">
            <span className="font-medium">{text.get(p.split('=')[0]!)}</span>
            <span className="text-muted">→</span>
            <span>{targets.get(p.split('=')[1]!)}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (q.answer_type === 'type') {
    return (
      <div className="mt-4 space-y-1 text-sm">
        <div className="text-xs font-medium text-muted">Accepted answers{q.input_hint ? ` · hint “${q.input_hint}”` : ''}</div>
        <div className="flex flex-wrap gap-2">
          {q.accepted_answers.map((a) => (
            <span key={a} className="rounded-md border border-success/40 bg-mint/60 px-2 py-1 font-mono text-xs">
              {a}
            </span>
          ))}
        </div>
      </div>
    );
  }
  return (
    <ul className="mt-4 space-y-2">
      {q.options.map((o) => {
        const correct = q.correct_options.includes(o.key);
        return (
          <li key={o.key} className={cx('flex items-start gap-3 rounded-lg border px-3 py-2', correct ? 'border-success/40 bg-mint/60' : 'border-border')}>
            <span className={cx('flex size-6 shrink-0 items-center justify-center rounded-md font-mono text-xs font-semibold', correct ? 'bg-success text-white' : 'bg-bg text-muted')}>{o.key}</span>
            <span className="flex-1 text-sm">{o.text}</span>
            {correct && <span className="text-xs font-medium text-success">Correct</span>}
          </li>
        );
      })}
    </ul>
  );
}

export function ProblemList({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null;
  return (
    <ul className="list-disc space-y-0.5 rounded-lg border border-streak/40 bg-streak-tint py-2 pr-3 pl-7 text-xs text-[#6b4600]">
      {problems.map((p) => (
        <li key={p}>{p}</li>
      ))}
    </ul>
  );
}
