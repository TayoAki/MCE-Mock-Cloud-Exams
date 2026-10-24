import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api';
import { ProblemList, QuestionFields, emptyQuestion, questionProblems } from '../components/QuestionForm';
import { Button, Card, ErrorBox, Field, Input, PageHeader, Select } from '../components/ui';
import type { QuestionDetail } from '../types';
import { useWorkingVersion } from '../version';

export function NewQuestionPage() {
  const navigate = useNavigate();
  const { versionId, detail } = useWorkingVersion();
  const [question, setQuestion] = useState(emptyQuestion);
  const [meta, setMeta] = useState({ objective_id: '', family_key: '', difficulty: 1 });
  const [showProblems, setShowProblems] = useState(false);

  const problems = [
    ...(meta.objective_id ? [] : ['Choose the objective this family tests.']),
    ...(/^[a-z0-9][a-z0-9-]{1,79}$/.test(meta.family_key) ? [] : ['Family key: lowercase letters, digits and dashes (2–80 characters).']),
    ...questionProblems(question),
  ];

  const create = useMutation({
    mutationFn: () => api.post<QuestionDetail>('/admin/questions', { ...question, ...meta, exam_version_id: versionId }),
    onSuccess: (q) => navigate(`/questions/${q.id}`),
  });

  return (
    <>
      <PageHeader
        eyebrow={<Link to="/questions" className="hover:underline">Question bank</Link>}
        title="New question"
        subtitle={`Creates a new family with a draft revision in ${detail?.exam?.title ?? ''} · ${detail?.version_label ?? ''}. It stays hidden from learners until a reviewer approves it and it is published.`}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Question" className="lg:col-span-2">
          <QuestionFields value={question} onChange={setQuestion} />
        </Card>
        <div className="space-y-4">
          <Card title="Family">
            <div className="space-y-3">
              <Field label="Objective">
                <Select value={meta.objective_id} onChange={(e) => setMeta({ ...meta, objective_id: e.target.value })}>
                  <option value="">Choose…</option>
                  {detail?.domains.map((d) => (
                    <optgroup key={d.id} label={d.title}>
                      {d.objectives.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.title}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </Field>
              <Field label="Family key" hint="One family = one tested idea. Wording changes are new revisions, not new families.">
                <Input value={meta.family_key} placeholder="vacuum-retention-default" onChange={(e) => setMeta({ ...meta, family_key: e.target.value.toLowerCase() })} />
              </Field>
              <Field label="Difficulty">
                <Select value={meta.difficulty} onChange={(e) => setMeta({ ...meta, difficulty: Number(e.target.value) })}>
                  <option value={1}>1 · recall</option>
                  <option value={2}>2 · apply</option>
                  <option value={3}>3 · scenario</option>
                </Select>
              </Field>
            </div>
          </Card>
          {showProblems && <ProblemList problems={problems} />}
          <ErrorBox error={create.error} />
          <Button
            variant="primary"
            className="w-full"
            disabled={create.isPending}
            onClick={() => {
              setShowProblems(true);
              if (problems.length === 0) create.mutate();
            }}
          >
            {create.isPending ? 'Saving…' : 'Save draft'}
          </Button>
        </div>
      </div>
    </>
  );
}
