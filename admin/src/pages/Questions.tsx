import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { api, qs } from '../api';
import { Badge, Button, Card, Checkbox, Empty, ErrorBox, Input, Loading, PageHeader, Select, StatusBadge, Table, Td, formatDate } from '../components/ui';
import type { QuestionRow } from '../types';
import { useObjectiveIndex, useWorkingVersion } from '../version';

export function QuestionsPage() {
  const { versionId, detail } = useWorkingVersion();
  const objectives = useObjectiveIndex();
  const [params, setParams] = useSearchParams();
  const filters = {
    status: params.get('status') ?? '',
    objective_id: params.get('objective_id') ?? '',
    q: params.get('q') ?? '',
    needs_review: params.get('needs_review') === 'true',
  };
  const update = (patch: Partial<typeof filters>) => {
    const next = { ...filters, ...patch };
    const search = new URLSearchParams();
    if (next.status) search.set('status', next.status);
    if (next.objective_id) search.set('objective_id', next.objective_id);
    if (next.q) search.set('q', next.q);
    if (next.needs_review) search.set('needs_review', 'true');
    setParams(search, { replace: true });
  };

  const { data, error, isLoading } = useQuery({
    queryKey: ['questions', versionId, filters],
    queryFn: () =>
      api.get<{ questions: QuestionRow[] }>(
        `/admin/questions${qs({ exam_version_id: versionId, status: filters.status, objective_id: filters.objective_id, q: filters.q, needs_review: filters.needs_review || undefined })}`,
      ),
    enabled: !!versionId,
  });

  return (
    <>
      <PageHeader
        title="Question bank"
        subtitle={detail ? `${detail.exam?.title} · ${detail.version_label}. Draft → human review → publish. Published revisions are immutable.` : undefined}
        actions={
          <Link to="/questions/new">
            <Button variant="primary">New question</Button>
          </Link>
        }
      />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <Input
            aria-label="Search prompts"
            placeholder="Search prompts…"
            className="w-64"
            defaultValue={filters.q}
            onKeyDown={(e) => e.key === 'Enter' && update({ q: (e.target as HTMLInputElement).value })}
            onBlur={(e) => e.target.value !== filters.q && update({ q: e.target.value })}
          />
          <Select aria-label="Status" value={filters.status} onChange={(e) => update({ status: e.target.value, needs_review: false })}>
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="retired">Retired</option>
          </Select>
          <Select aria-label="Objective" className="max-w-xs" value={filters.objective_id} onChange={(e) => update({ objective_id: e.target.value })}>
            <option value="">All objectives</option>
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
          <Checkbox label="Needs review" checked={filters.needs_review} onChange={(e) => update({ needs_review: e.target.checked, status: '' })} />
          <span className="ml-auto text-xs text-muted">{data ? `${data.questions.length} revisions` : ''}</span>
        </div>
        {isLoading && <Loading />}
        <div className="p-3">
          <ErrorBox error={error} />
        </div>
        {data && (
          <Table
            head={['Question', 'Objective', 'Rev', 'Status', 'Review', 'Issues', 'Created']}
            empty={data.questions.length === 0 ? <div className="p-4"><Empty title="No questions match these filters" /></div> : undefined}
          >
            {data.questions.map((q) => {
              const o = objectives.get(q.objective_id);
              return (
                <tr key={q.id} className="hover:bg-bg/60">
                  <Td className="max-w-md">
                    <Link to={`/questions/${q.id}`} className="font-medium text-ink hover:text-primary">
                      {q.prompt}
                    </Link>
                    <div className="mt-0.5 font-mono text-xs text-muted">
                      {q.family_key}
                      {q.answer_type !== 'single' && <span className="ml-2 font-sans"><Badge tone="primary">{q.answer_type === 'multiple' ? 'multi-select' : q.answer_type === 'type' ? 'typed' : q.answer_type}</Badge></span>}
                    </div>
                  </Td>
                  <Td className="text-xs">
                    {o ? (
                      <>
                        <div>{o.title}</div>
                        <div className="text-muted">{o.domain}</div>
                      </>
                    ) : (
                      <span className="font-mono text-muted">{q.objective_id.slice(0, 8)}</span>
                    )}
                  </Td>
                  <Td className="tabular-nums">{q.revision}</Td>
                  <Td>
                    <StatusBadge status={q.status} />
                  </Td>
                  <Td>{q.status === 'draft' ? q.reviewed ? <Badge tone="success">approved</Badge> : <Badge tone="warning">needs review</Badge> : <span className="text-xs text-muted">—</span>}</Td>
                  <Td>{q.open_issues > 0 ? <Badge tone="danger">{q.open_issues} open</Badge> : <span className="text-xs text-muted">—</span>}</Td>
                  <Td className="text-xs whitespace-nowrap text-muted">{formatDate(q.created_at)}</Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </>
  );
}
