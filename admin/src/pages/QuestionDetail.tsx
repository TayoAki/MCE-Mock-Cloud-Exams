import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { ANSWER_TYPE_LABELS, AnswerPreview, ProblemList, QuestionFields, questionProblems, toInput } from '../components/QuestionForm';
import { Badge, Button, Card, Checkbox, ErrorBox, Field, Loading, Modal, PageHeader, Ratio, StatusBadge, Textarea, cx, formatDate } from '../components/ui';
import { FIXTURE_REVIEWER_ID, type QuestionDetail } from '../types';
import { useVersionObjectives, useWorkingVersion } from '../version';

export function QuestionDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const { versionId: workingVersionId, setVersionId } = useWorkingVersion();
  const queryClient = useQueryClient();
  const key = ['question', id];
  const { data: q, error, isLoading } = useQuery({ queryKey: key, queryFn: () => api.get<QuestionDetail>(`/admin/questions/${id}`) });
  const { detail: version, objectives } = useVersionObjectives(q?.exam_version_id);
  const [editor, setEditor] = useState<'edit' | 'revision' | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [retireOpen, setRetireOpen] = useState(false);

  const onSaved = (detail: QuestionDetail) => {
    queryClient.setQueryData(['question', detail.id], detail);
    queryClient.invalidateQueries({ queryKey: ['questions'] });
    queryClient.invalidateQueries({ queryKey: ['overview'] });
    queryClient.invalidateQueries({ queryKey: ['version'] });
  };
  const publish = useMutation({ mutationFn: () => api.post<QuestionDetail>(`/admin/questions/${id}/publish`), onSuccess: onSaved });

  if (isLoading) return <Loading />;
  if (error || !q) return <ErrorBox error={error} />;

  const objective = objectives.get(q.objective_id);
  // Audit entries carry display names; reuse them for the created/reviewed rows.
  const names = new Map(q.audit.map((a) => [a.actor_id, a.actor]));
  const actorName = (actorId: string | null) =>
    !actorId ? '—' : actorId === FIXTURE_REVIEWER_ID ? 'Seed fixture' : actorId === user?.id ? 'You' : (names.get(actorId) ?? <span className="font-mono">{actorId.slice(0, 8)}</span>);
  const fixtureReview = q.reviewed_by === FIXTURE_REVIEWER_ID;
  const latest = q.revisions[0];

  return (
    <>
      <PageHeader
        eyebrow={<Link to="/questions" className="hover:underline">Question bank</Link>}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{q.family_key}</span>
            <span className="text-base font-normal text-muted">revision {q.revision}</span>
            <StatusBadge status={q.status} />
            {q.answer_type !== 'single' && <Badge tone="primary">{ANSWER_TYPE_LABELS[q.answer_type].split(' (')[0]}</Badge>}
            {q.presentation === 'listen' && <Badge tone="primary">listening</Badge>}
            {q.story_id && <Badge>story</Badge>}
          </span>
        }
        subtitle={
          <>
            {objective ? `${objective.domain} · ${objective.title}` : 'Loading objective…'}
            {version && (
              <>
                {' · '}
                <Link to={`/exam-versions/${version.id}`} className="text-primary hover:underline">
                  {version.exam?.title} {version.version_label}
                </Link>
                {workingVersionId !== version.id && (
                  <button type="button" className="ml-2 text-xs font-medium text-primary hover:underline" onClick={() => setVersionId(version.id)}>
                    Make working version
                  </button>
                )}
              </>
            )}
          </>
        }
        actions={
          <>
            {q.status === 'draft' && (
              <>
                <Button onClick={() => setEditor('edit')}>Edit draft</Button>
                <Button onClick={() => setReviewOpen(true)} disabled={q.reviewed}>
                  {q.reviewed ? 'Review approved' : 'Approve review'}
                </Button>
                <Button
                  variant="primary"
                  disabled={!q.reviewed || publish.isPending}
                  title={q.reviewed ? undefined : 'A reviewer must approve this draft first'}
                  onClick={() => publish.mutate()}
                >
                  Publish
                </Button>
              </>
            )}
            {q.status !== 'draft' && latest?.id === q.id && <Button onClick={() => setEditor('revision')}>New revision</Button>}
            {q.status !== 'retired' && (
              <Button variant="danger" onClick={() => setRetireOpen(true)}>
                Retire
              </Button>
            )}
          </>
        }
      />
      <ErrorBox error={publish.error} />
      {fixtureReview && (
        <div className="mb-4 rounded-lg border border-streak/40 bg-streak-tint px-4 py-2.5 text-sm text-[#6b4600]">
          <strong>Dev fixture — not subject-matter approval.</strong> This item was marked reviewed by the seed so the app can be exercised. It still needs independent expert review before real learners rely on it.
        </div>
      )}
      {q.status === 'draft' && latest && latest.id !== q.id && (
        <div className="mb-4 text-sm text-muted">A newer revision exists.</div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Question">
            <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{q.prompt}</p>
            <AnswerPreview q={q} />
          </Card>
          <Card title="Reviewed rationale">
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{q.rationale}</p>
            <a href={q.source_url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm break-all text-primary hover:underline">
              {q.source_url}
            </a>
            {q.reviewed_notes && (
              <div className="mt-3 rounded-lg bg-bg p-3 text-xs text-muted">
                <span className="font-medium text-ink">Reviewer notes:</span> {q.reviewed_notes}
              </div>
            )}
          </Card>
          <Card title={`Learner issue reports (${q.issues.length})`} padded={false}>
            {q.issues.length === 0 ? (
              <p className="p-4 text-sm text-muted">No reports for this revision.</p>
            ) : (
              <ul className="divide-y divide-border">
                {q.issues.map((i) => (
                  <li key={i.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
                    <div>
                      <span className="font-medium">{i.reason.replace(/_/g, ' ')}</span>
                      {i.note && <p className="text-muted">{i.note}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge status={i.status} />
                      <span className="text-xs text-muted">{formatDate(i.created_at)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Status">
            <dl className="space-y-2 text-sm">
              <Row label="Created">{formatDate(q.created_at, true)} · {actorName(q.created_by)}</Row>
              <Row label="Reviewed">{q.reviewed_at ? <>{formatDate(q.reviewed_at, true)} · {actorName(q.reviewed_by)}</> : <Badge tone="warning">not reviewed</Badge>}</Row>
              <Row label="Published">{formatDate(q.published_at, true)}</Row>
              <Row label="Difficulty">{q.difficulty}</Row>
              <Row label="Graded attempts">
                <Ratio n={q.attempts.correct} d={q.attempts.total} empty="None yet" />
              </Row>
            </dl>
          </Card>
          <Card title="Revisions" padded={false}>
            <ul className="divide-y divide-border">
              {q.revisions.map((r) => (
                <li key={r.id}>
                  <Link to={`/questions/${r.id}`} className={cx('flex items-center justify-between px-4 py-2 text-sm hover:bg-bg', r.id === q.id && 'bg-primary-tint/60')}>
                    <span>Revision {r.revision}</span>
                    <span className="flex items-center gap-2">
                      <StatusBadge status={r.status} />
                      <span className="text-xs text-muted">{formatDate(r.created_at)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Audit trail" padded={false}>
            <ol className="divide-y divide-border">
              {q.audit.map((a, i) => (
                <li key={i} className="px-4 py-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{a.action.replace(/_/g, ' ')}</span>
                    <span className="text-xs text-muted">{formatDate(a.recorded_at, true)}</span>
                  </div>
                  <div className="text-xs text-muted">{actorName(a.actor_id)}{a.note && ` — ${a.note}`}</div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      {editor && <EditorModal mode={editor} question={q} onClose={() => setEditor(null)} onSaved={onSaved} />}
      {reviewOpen && <ReviewModal id={q.id} onClose={() => setReviewOpen(false)} onSaved={onSaved} />}
      {retireOpen && <RetireModal question={q} onClose={() => setRetireOpen(false)} onSaved={onSaved} />}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function EditorModal({ mode, question, onClose, onSaved }: { mode: 'edit' | 'revision'; question: QuestionDetail; onClose: () => void; onSaved: (q: QuestionDetail) => void }) {
  const navigate = useNavigate();
  const [value, setValue] = useState(() => toInput(question));
  const [touched, setTouched] = useState(false);
  const problems = questionProblems(value);
  const save = useMutation({
    mutationFn: () =>
      mode === 'edit' ? api.put<QuestionDetail>(`/admin/questions/${question.id}`, value) : api.post<QuestionDetail>(`/admin/questions/${question.id}/revisions`, value),
    onSuccess: (q) => {
      onSaved(q);
      onClose();
      if (mode === 'revision') navigate(`/questions/${q.id}`);
    },
  });
  return (
    <Modal
      wide
      open
      title={mode === 'edit' ? 'Edit draft' : `New revision of ${question.family_key}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={save.isPending}
            onClick={() => {
              setTouched(true);
              if (problems.length === 0) save.mutate();
            }}
          >
            {mode === 'edit' ? 'Save draft' : 'Create draft revision'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">
        {mode === 'edit'
          ? 'Saving clears any earlier review approval; the draft must be reviewed again before publishing.'
          : 'The current published revision stays live until this draft is reviewed and published. Sessions already in progress keep the revision they were assigned.'}
      </p>
      <QuestionFields value={value} onChange={setValue} />
      {touched && <ProblemList problems={problems} />}
      <ErrorBox error={save.error} />
    </Modal>
  );
}

function ReviewModal({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: (q: QuestionDetail) => void }) {
  const [note, setNote] = useState('');
  const review = useMutation({
    mutationFn: () => api.post<QuestionDetail>(`/admin/questions/${id}/review`, { note }),
    onSuccess: (q) => {
      onSaved(q);
      onClose();
    },
  });
  return (
    <Modal
      open
      title="Approve review"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={review.isPending} onClick={() => review.mutate()}>
            Approve
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">Confirm you checked the objective mapping, the current guide, the exact answer key, ambiguity and the explanation against the source.</p>
      <Field label="Review note (recorded in the audit trail)">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Checked against the VACUUM reference; key and rationale match." />
      </Field>
      <ErrorBox error={review.error} />
    </Modal>
  );
}

function RetireModal({ question, onClose, onSaved }: { question: QuestionDetail; onClose: () => void; onSaved: (q: QuestionDetail) => void }) {
  const [note, setNote] = useState('');
  const [invalidate, setInvalidate] = useState(false);
  const [result, setResult] = useState<number | null>(null);
  const retire = useMutation({
    mutationFn: () => api.post<QuestionDetail>(`/admin/questions/${question.id}/retire`, { note, invalidate_attempts: invalidate }),
    onSuccess: (q) => {
      onSaved(q);
      if (invalidate) setResult(q.repaired_enrollments ?? 0);
      else onClose();
    },
  });
  return (
    <Modal
      open
      title={`Retire revision ${question.revision}`}
      onClose={onClose}
      footer={
        result === null ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="danger" disabled={!note.trim() || retire.isPending} onClick={() => retire.mutate()}>
              Retire{invalidate && ' and repair'}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        )
      }
    >
      {result !== null ? (
        <p className="text-sm">Retired. Past attempts were excluded from scored aggregates and {result} enrollment{result === 1 ? '' : 's'} were recomputed. XP is activity and was not changed.</p>
      ) : (
        <>
          <p className="text-sm text-muted">New sessions will stop assigning this revision. Sessions already in progress keep it. Learners' attempt history is kept.</p>
          <Field label="Reason (required, recorded in the audit trail)">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Two options are defensible after the guide update." />
          </Field>
          <Checkbox label="Invalidate past attempts on this revision" checked={invalidate} onChange={(e) => setInvalidate(e.target.checked)} />
          {invalidate && (
            <div className="rounded-lg border border-coral/30 bg-coral-tint p-3 text-xs text-coral-ink">
              This excludes {question.attempts.total} graded attempt{question.attempts.total === 1 ? '' : 's'} from coverage and accuracy for every affected learner and recomputes their objective
              progress. Use it when the key or wording was wrong, not for routine updates. It cannot be undone from here.
            </div>
          )}
          <ErrorBox error={retire.error} />
        </>
      )}
    </Modal>
  );
}
