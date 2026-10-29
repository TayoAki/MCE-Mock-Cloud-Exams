import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { Badge, Button, Card, Checkbox, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, StatusBadge, cx } from '../components/ui';
import type { DomainRow, FamilyRow, LessonRow, UnitRow, VersionDetail } from '../types';
import { useWorkingVersion } from '../version';

export function ExamVersionPage() {
  const { id = '' } = useParams();
  const { isAdmin } = useAuth();
  const { setVersionId, versionId } = useWorkingVersion();
  const queryClient = useQueryClient();
  const key = ['version', id];
  const { data, error, isLoading } = useQuery({ queryKey: key, queryFn: () => api.get<VersionDetail>(`/admin/exam-versions/${id}`) });

  const [domainForm, setDomainForm] = useState<Partial<DomainRow> | null>(null);
  const [objectiveForm, setObjectiveForm] = useState<{ id?: string; domain_id: string; code: string; title: string } | null>(null);
  const [unitForm, setUnitForm] = useState<Partial<UnitRow> | null>(null);
  const [lessonForm, setLessonForm] = useState<{ unitId: string; lesson?: LessonRow } | null>(null);

  const onDetail = (detail: VersionDetail) => {
    queryClient.setQueryData(key, detail);
    queryClient.invalidateQueries({ queryKey: ['exams'] });
  };
  const publish = useMutation({ mutationFn: () => api.post<VersionDetail>(`/admin/exam-versions/${id}/publish`), onSuccess: onDetail });
  const removeDomain = useMutation({
    mutationFn: (domainId: string) => api.delete<VersionDetail>(`/admin/exam-versions/${id}/domains/${domainId}`),
    onSuccess: onDetail,
  });
  const removeObjective = useMutation({
    mutationFn: (objectiveId: string) => api.delete<VersionDetail>(`/admin/exam-versions/${id}/objectives/${objectiveId}`),
    onSuccess: onDetail,
  });
  const lessonStatus = useMutation({
    mutationFn: ({ lessonId, status }: { lessonId: string; status: 'published' | 'retired' | 'draft' }) => api.post<VersionDetail>(`/admin/lessons/${lessonId}/status`, { status }),
    onSuccess: onDetail,
  });

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;

  const draft = data.status === 'draft';
  const weightTotal = data.domains.reduce((s, d) => s + d.weight_percent, 0);
  const objectives = data.domains.flatMap((d) => d.objectives.map((o) => ({ ...o, domain: d.title })));
  const blockers = data.readiness.checks.filter((c) => c.blocking && !c.ok);

  return (
    <>
      <PageHeader
        eyebrow={<Link to="/exams" className="hover:underline">{data.exam?.title ?? 'Exam'} · Exams & blueprints</Link>}
        title={
          <span className="flex items-center gap-2">
            {data.version_label} <StatusBadge status={data.status} />
          </span>
        }
        subtitle={`Effective ${data.effective_from} · ${data.question_count} questions · ${data.duration_minutes} minutes`}
        actions={
          <>
            {versionId !== data.id && <Button onClick={() => setVersionId(data.id)}>Use as working version</Button>}
            <Link to={`/questions`} onClick={() => setVersionId(data.id)}>
              <Button>Question bank</Button>
            </Link>
            {draft && (
              <Button
                variant="primary"
                disabled={!isAdmin || !data.readiness.ready || publish.isPending}
                title={!isAdmin ? 'Admin role required' : !data.readiness.ready ? 'Resolve blocking checks first' : undefined}
                onClick={() => {
                  if (confirm('Publish this blueprint? Published blueprints are immutable; later changes need a new version.')) publish.mutate();
                }}
              >
                Publish version
              </Button>
            )}
          </>
        }
      />
      <ErrorBox error={publish.error ?? lessonStatus.error ?? removeDomain.error ?? removeObjective.error} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Readiness" className="lg:col-span-1">
          <ul className="space-y-2.5">
            {data.readiness.checks.map((c) => (
              <li key={c.key} className="flex gap-2.5 text-sm">
                <span
                  aria-label={c.ok ? 'Passed' : c.blocking ? 'Blocking' : 'Warning'}
                  className={cx(
                    'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                    c.ok ? 'bg-mint text-success' : c.blocking ? 'bg-coral-tint text-coral-ink' : 'bg-streak-tint text-[#8a5a00]',
                  )}
                >
                  {c.ok ? '✓' : c.blocking ? '!' : '–'}
                </span>
                <div>
                  <div className="font-medium">{c.key.replace(/_/g, ' ')}</div>
                  <div className="text-xs text-muted">{c.detail}</div>
                  {!c.ok && <div className="mt-0.5 text-xs">{c.blocking ? <Badge tone="danger">blocks publishing</Badge> : <Badge tone="warning">warning</Badge>}</div>}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted">
            {data.readiness.published_questions} published questions. {draft && blockers.length > 0 && `${blockers.length} blocking check${blockers.length > 1 ? 's' : ''} remaining.`}
          </p>
        </Card>

        <Card
          title={
            <span className="flex items-center gap-2">
              Blueprint
              <Badge tone={Math.abs(weightTotal - 100) < 1e-6 ? 'success' : 'danger'}>weights total {weightTotal}%</Badge>
            </span>
          }
          actions={
            draft && (
              <Button size="sm" disabled={!isAdmin} title={isAdmin ? undefined : 'Admin role required'} onClick={() => setDomainForm({ sort_order: data.domains.length + 1, weight_percent: 0 })}>
                Add domain
              </Button>
            )
          }
          className="lg:col-span-2"
          padded={false}
        >
          {!draft && <p className="border-b border-border bg-bg px-4 py-2 text-xs text-muted">Published blueprints are immutable. Create a new version to change domains or objectives.</p>}
          <div className="divide-y divide-border">
            {data.domains.map((d) => (
              <div key={d.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="w-10 text-right font-semibold tabular-nums">{d.weight_percent}%</span>
                    <span className="truncate font-medium">{d.title}</span>
                    <span className="font-mono text-xs text-muted">{d.code}</span>
                  </div>
                  {draft && (
                    <div className="flex shrink-0 gap-1">
                      <Button size="sm" variant="ghost" disabled={!isAdmin} onClick={() => setDomainForm(d)}>
                        Edit
                      </Button>
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-coral-ink hover:bg-coral-tint"
                          disabled={removeDomain.isPending}
                          title={d.objectives.length ? 'Remove or move its objectives first' : undefined}
                          onClick={() => {
                            removeObjective.reset();
                            if (confirm(`Delete the domain "${d.title}"? Its ${d.weight_percent}% weight will need to be reassigned.`)) removeDomain.mutate(d.id);
                          }}
                        >
                          Delete
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setObjectiveForm({ domain_id: d.id, code: `${d.code}.`, title: '' })}>
                        Add objective
                      </Button>
                    </div>
                  )}
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(d.weight_percent, 100)}%` }} />
                </div>
                <ul className="mt-2 space-y-1 pl-12">
                  {d.objectives.map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate">
                        {o.title} <span className="font-mono text-xs text-muted">{o.code}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-xs">
                        <Link to={`/questions?objective_id=${o.id}`} className="text-muted hover:text-primary">
                          <span className={cx('tabular-nums', o.published === 0 && 'text-coral-ink')}>{o.published} published</span>
                          {o.drafts > 0 && <span> · {o.drafts} drafts</span>}
                        </Link>
                        {draft && (
                          <button type="button" className="text-primary hover:underline" onClick={() => setObjectiveForm({ id: o.id, domain_id: d.id, code: o.code, title: o.title })}>
                            Edit
                          </button>
                        )}
                        {draft && isAdmin && (
                          <button
                            type="button"
                            className="text-coral-ink hover:underline"
                            aria-label={`Delete objective ${o.title}`}
                            onClick={() => {
                              removeDomain.reset();
                              if (confirm(`Delete the objective "${o.title}"? This is only possible when no questions or lessons use it.`)) removeObjective.mutate(o.id);
                            }}
                          >
                            Delete
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                  {d.objectives.length === 0 && <li className="text-xs text-coral-ink">No objectives mapped yet.</li>}
                </ul>
              </div>
            ))}
            {data.domains.length === 0 && <p className="px-4 py-6 text-sm text-muted">No domains yet. Import the current exam guide's domains and weights.</p>}
          </div>
        </Card>
      </div>

      <Card
        title="Learning path"
        className="mt-4"
        actions={<Button size="sm" onClick={() => setUnitForm({ sort_order: data.units.length + 1 })}>Add unit</Button>}
        padded={false}
      >
        <div className="divide-y divide-border">
          {data.units.map((u) => (
            <div key={u.id} className="px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-primary uppercase">Unit {u.sort_order}</span>
                  <span className="ml-2 font-medium">{u.title}</span>
                  {u.subtitle && <span className="ml-2 text-sm text-muted">{u.subtitle}</span>}
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setUnitForm(u)}>
                    Edit unit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setLessonForm({ unitId: u.id })}>
                    Add lesson
                  </Button>
                </div>
              </div>
              <ul className="mt-2 grid gap-2 md:grid-cols-2">
                {u.lessons.map((l) => (
                  <li key={l.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{l.title}</span>
                          {l.kind !== 'learn' && <Badge tone="primary">{l.kind}</Badge>}
                          <StatusBadge status={l.status} />
                        </div>
                        <div className="mt-0.5 text-xs text-muted">
                          {l.summary || 'No summary'} · {l.question_count} questions per session · pool of {l.pool_family_ids.length}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setLessonForm({ unitId: u.id, lesson: l })}>
                          Edit
                        </button>
                        {l.status !== 'published' ? (
                          <button type="button" className="text-xs font-medium text-success hover:underline" onClick={() => lessonStatus.mutate({ lessonId: l.id, status: 'published' })}>
                            Publish
                          </button>
                        ) : (
                          <button type="button" className="text-xs font-medium text-coral-ink hover:underline" onClick={() => confirm(`Retire "${l.title}"? Learners will no longer see it on the path.`) && lessonStatus.mutate({ lessonId: l.id, status: 'retired' })}>
                            Retire
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
                {u.lessons.length === 0 && <li className="text-sm text-muted">No lessons yet.</li>}
              </ul>
            </div>
          ))}
          {data.units.length === 0 && <p className="px-4 py-6 text-sm text-muted">No units yet.</p>}
        </div>
      </Card>

      {domainForm && <DomainModal versionId={id} initial={domainForm} onClose={() => setDomainForm(null)} onSaved={onDetail} />}
      {objectiveForm && <ObjectiveModal versionId={id} initial={objectiveForm} domains={data.domains} onClose={() => setObjectiveForm(null)} onSaved={onDetail} />}
      {unitForm && <UnitModal versionId={id} initial={unitForm} onClose={() => setUnitForm(null)} onSaved={onDetail} />}
      {lessonForm && (
        <LessonModal versionId={id} units={data.units} objectives={objectives} unitId={lessonForm.unitId} lesson={lessonForm.lesson} onClose={() => setLessonForm(null)} onSaved={onDetail} />
      )}
    </>
  );
}

interface ModalProps<T> {
  versionId: string;
  initial: T;
  onClose: () => void;
  onSaved: (d: VersionDetail) => void;
}

function DomainModal({ versionId, initial, onClose, onSaved }: ModalProps<Partial<DomainRow>>) {
  const [form, setForm] = useState({ code: initial.code ?? '', title: initial.title ?? '', weight_percent: initial.weight_percent ?? 0, sort_order: initial.sort_order ?? 1 });
  const save = useMutation({
    mutationFn: () => api.post<VersionDetail>(`/admin/exam-versions/${versionId}/domains`, { ...(initial.id && { id: initial.id }), ...form }),
    onSuccess: (d) => {
      onSaved(d);
      onClose();
    },
  });
  return (
    <Modal open title={initial.id ? 'Edit domain' : 'Add domain'} onClose={onClose} footer={<SaveFooter onClose={onClose} onSave={() => save.mutate()} busy={save.isPending} />}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Title" className="col-span-2">
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Code">
          <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        </Field>
        <Field label="Weight (%)" hint="All domain weights must total 100 to publish.">
          <Input type="number" min={0} max={100} step={0.5} value={form.weight_percent} onChange={(e) => setForm({ ...form, weight_percent: Number(e.target.value) })} />
        </Field>
        <Field label="Order in guide" hint="Ties in mock allocation go to the later domain.">
          <Input type="number" min={1} value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
        </Field>
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

function ObjectiveModal({ versionId, initial, domains, onClose, onSaved }: ModalProps<{ id?: string; domain_id: string; code: string; title: string }> & { domains: DomainRow[] }) {
  const [form, setForm] = useState(initial);
  const save = useMutation({
    mutationFn: () => api.post<VersionDetail>(`/admin/exam-versions/${versionId}/objectives`, form),
    onSuccess: (d) => {
      onSaved(d);
      onClose();
    },
  });
  return (
    <Modal open title={initial.id ? 'Edit objective' : 'Add objective'} onClose={onClose} footer={<SaveFooter onClose={onClose} onSave={() => save.mutate()} busy={save.isPending} />}>
      <Field label="Domain">
        <Select value={form.domain_id} onChange={(e) => setForm({ ...form, domain_id: e.target.value })}>
          {domains.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Title">
        <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </Field>
      <Field label="Code" hint="Unique within this version, e.g. ingestion.auto-loader">
        <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
      </Field>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

function UnitModal({ versionId, initial, onClose, onSaved }: ModalProps<Partial<UnitRow>>) {
  const [form, setForm] = useState({ title: initial.title ?? '', subtitle: initial.subtitle ?? '', sort_order: initial.sort_order ?? 1 });
  const save = useMutation({
    mutationFn: () => api.post<VersionDetail>(`/admin/exam-versions/${versionId}/units`, { ...(initial.id && { id: initial.id }), ...form }),
    onSuccess: (d) => {
      onSaved(d);
      onClose();
    },
  });
  return (
    <Modal open title={initial.id ? 'Edit unit' : 'Add unit'} onClose={onClose} footer={<SaveFooter onClose={onClose} onSave={() => save.mutate()} busy={save.isPending} />}>
      <Field label="Title">
        <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </Field>
      <Field label="Subtitle">
        <Input value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} />
      </Field>
      <Field label="Order on the path">
        <Input type="number" min={1} value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
      </Field>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

function LessonModal({
  versionId,
  units,
  objectives,
  unitId,
  lesson,
  onClose,
  onSaved,
}: {
  versionId: string;
  units: UnitRow[];
  objectives: { id: string; title: string; code: string; domain: string }[];
  unitId: string;
  lesson?: LessonRow;
  onClose: () => void;
  onSaved: (d: VersionDetail) => void;
}) {
  const unit = units.find((u) => u.id === unitId);
  const [form, setForm] = useState({
    unit_id: unitId,
    title: lesson?.title ?? '',
    summary: lesson?.summary ?? '',
    kind: lesson?.kind ?? ('learn' as LessonRow['kind']),
    question_count: lesson?.question_count ?? 5,
    sort_order: lesson?.sort_order ?? (unit?.lessons.length ?? 0) + 1,
    objective_ids: lesson?.objective_ids ?? [],
    pool_family_ids: lesson?.pool_family_ids ?? [],
  });
  const families = useQuery({ queryKey: ['families', versionId], queryFn: () => api.get<{ families: FamilyRow[] }>(`/admin/exam-versions/${versionId}/families`) });
  const byId = useMemo(() => new Map((families.data?.families ?? []).map((f) => [f.id, f])), [families.data]);
  const candidates = (families.data?.families ?? []).filter((f) => form.objective_ids.length === 0 || form.objective_ids.includes(f.objective_id));

  const save = useMutation({
    mutationFn: () => api.post<VersionDetail>(`/admin/exam-versions/${versionId}/lessons`, { ...(lesson && { id: lesson.id }), ...form }),
    onSuccess: (d) => {
      onSaved(d);
      onClose();
    },
  });

  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const move = (index: number, delta: number) => {
    const next = [...form.pool_family_ids];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    setForm({ ...form, pool_family_ids: next });
  };
  const unpublishedInPool = form.pool_family_ids.filter((f) => byId.get(f) && !byId.get(f)!.has_published).length;

  return (
    <Modal wide open title={lesson ? `Edit lesson: ${lesson.title}` : 'Add lesson'} onClose={onClose} footer={<SaveFooter onClose={onClose} onSave={() => save.mutate()} busy={save.isPending} />}>
      <div className="grid grid-cols-6 gap-3">
        <Field label="Title" className="col-span-3">
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Unit" className="col-span-3">
          <Select value={form.unit_id} onChange={(e) => setForm({ ...form, unit_id: e.target.value })}>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.sort_order}. {u.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Summary shown on the path" className="col-span-6">
          <Input value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
        </Field>
        <Field label="Kind" className="col-span-2" hint="Checkpoints prefer families the learner has not seen.">
          <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as LessonRow['kind'] })}>
            <option value="learn">learn</option>
            <option value="checkpoint">checkpoint</option>
            <option value="review">review</option>
          </Select>
        </Field>
        <Field label="Questions per session" className="col-span-2" hint="Five keeps the daily goal small.">
          <Input type="number" min={1} max={50} value={form.question_count} onChange={(e) => setForm({ ...form, question_count: Number(e.target.value) })} />
        </Field>
        <Field label="Order in unit" className="col-span-2">
          <Input type="number" min={1} value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
        </Field>
      </div>

      <div>
        <div className="mb-1 text-xs font-medium">Objectives</div>
        <div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-border p-2">
          {objectives.map((o) => (
            <Checkbox key={o.id} label={<span className="text-xs">{o.title}</span>} checked={form.objective_ids.includes(o.id)} onChange={() => setForm({ ...form, objective_ids: toggle(form.objective_ids, o.id) })} />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="mb-1 text-xs font-medium">Available families {form.objective_ids.length > 0 && <span className="text-muted">(filtered by objectives)</span>}</div>
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
            {families.isLoading && <Loading />}
            {candidates.map((f) => (
              <label key={f.id} className="flex cursor-pointer gap-2 rounded p-1 hover:bg-bg">
                <input type="checkbox" className="mt-0.5 accent-primary" checked={form.pool_family_ids.includes(f.id)} onChange={() => setForm({ ...form, pool_family_ids: toggle(form.pool_family_ids, f.id) })} />
                <span className="min-w-0 text-xs">
                  <span className="font-mono">{f.family_key}</span> {!f.has_published && <Badge tone="warning">no published revision</Badge>}
                  <span className="block truncate text-muted">{f.prompt}</span>
                </span>
              </label>
            ))}
            {!families.isLoading && candidates.length === 0 && <p className="p-2 text-xs text-muted">No families for these objectives yet.</p>}
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs font-medium">Pool order ({form.pool_family_ids.length})</div>
          <ol className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
            {form.pool_family_ids.map((fid, i) => (
              <li key={fid} className="flex items-center gap-2 rounded bg-bg px-2 py-1 text-xs">
                <span className="w-5 text-muted tabular-nums">{i + 1}.</span>
                <span className="min-w-0 flex-1 truncate font-mono">{byId.get(fid)?.family_key ?? fid}</span>
                <button type="button" aria-label="Move up" disabled={i === 0} className="px-1 disabled:opacity-30" onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button type="button" aria-label="Move down" disabled={i === form.pool_family_ids.length - 1} className="px-1 disabled:opacity-30" onClick={() => move(i, 1)}>
                  ↓
                </button>
              </li>
            ))}
            {form.pool_family_ids.length === 0 && <li className="p-2 text-xs text-muted">Pick families on the left. Learn lessons assign them in this order.</li>}
          </ol>
          {unpublishedInPool > 0 && <p className="mt-1 text-xs text-[#8a5a00]">{unpublishedInPool} pooled families have no published revision and will be skipped.</p>}
        </div>
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

function SaveFooter({ onClose, onSave, busy }: { onClose: () => void; onSave: () => void; busy: boolean }) {
  return (
    <>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={busy} onClick={onSave}>
        {busy ? 'Saving…' : 'Save'}
      </Button>
    </>
  );
}

