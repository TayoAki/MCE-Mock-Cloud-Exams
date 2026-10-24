import type { QuestionInput, QuestionOption } from '../types';
import { Button, Field, Input, Select, Textarea, cx } from './ui';

const LETTERS = 'ABCDEFGH';

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
  };
}

/** Mirrors the server's structural publication checks so authors see problems early. */
export function questionProblems(q: QuestionInput): string[] {
  const problems: string[] = [];
  if (q.prompt.trim().length < 10) problems.push('The prompt needs at least 10 characters.');
  if (q.options.length < 2) problems.push('At least two options are required.');
  if (q.options.some((o) => !o.text.trim())) problems.push('Every option needs text.');
  const correct = new Set(q.correct_options);
  if (q.answer_type === 'single' && correct.size !== 1) problems.push('A single-answer question needs exactly one correct option.');
  if (q.answer_type === 'multiple' && correct.size < 1) problems.push('A multiple-answer question needs at least one correct option.');
  if ([...correct].some((k) => !q.options.some((o) => o.key === k))) problems.push('Correct options must be among the options.');
  if (!q.rationale.trim()) problems.push('A rationale is required; learners see it after every answer.');
  if (!/^https?:\/\/\S+$/.test(q.source_url)) problems.push('A source URL (http or https) is required.');
  return problems;
}

export function QuestionFields({ value, onChange }: { value: QuestionInput; onChange: (q: QuestionInput) => void }) {
  const set = (patch: Partial<QuestionInput>) => onChange({ ...value, ...patch });
  const relabel = (options: QuestionOption[]) => options.map((o, i) => ({ ...o, key: LETTERS[i]! }));

  const toggleCorrect = (key: string) => {
    if (value.answer_type === 'single') return set({ correct_options: [key] });
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

  return (
    <div className="space-y-4">
      <Field label="Prompt" hint="Original wording only. Never use recalled live exam questions.">
        <Textarea rows={3} value={value.prompt} onChange={(e) => set({ prompt: e.target.value })} />
      </Field>

      <Field label="Answer type" className="max-w-xs">
        <Select
          value={value.answer_type}
          onChange={(e) => {
            const answer_type = e.target.value as QuestionInput['answer_type'];
            set({ answer_type, correct_options: answer_type === 'single' ? value.correct_options.slice(0, 1) : value.correct_options });
          }}
        >
          <option value="single">Single answer</option>
          <option value="multiple">Multiple answers (exact set)</option>
        </Select>
      </Field>

      <fieldset>
        <legend className="mb-1 text-xs font-medium">Options — mark the correct {value.answer_type === 'single' ? 'one' : 'ones'}</legend>
        <div className="space-y-2">
          {value.options.map((o, i) => {
            const correct = value.correct_options.includes(o.key);
            return (
              <div key={i} className={cx('flex items-center gap-2 rounded-lg border p-1.5 pl-2', correct ? 'border-success/40 bg-mint/50' : 'border-border')}>
                <label className="flex items-center gap-1.5 text-xs font-medium" title="Correct">
                  <input
                    type={value.answer_type === 'single' ? 'radio' : 'checkbox'}
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
