import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, qs } from '../api';
import { Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Select, StatusBadge, Table, Td, Textarea, formatDate } from '../components/ui';
import type { IssueRow, IssueStatus } from '../types';

export function IssuesPage() {
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') ?? 'open') as IssueStatus | 'all';
  const { data, error, isLoading } = useQuery({
    queryKey: ['issues', status],
    queryFn: () => api.get<{ issues: IssueRow[] }>(`/admin/issues${qs({ status: status === 'all' ? undefined : status })}`),
  });
  const [resolving, setResolving] = useState<{ issue: IssueRow; status: IssueStatus } | null>(null);

  return (
    <>
      <PageHeader
        title="Issue reports"
        subtitle="Reports from learners keep their attempt records. Fix a confirmed problem with a new revision, or retire the revision and repair affected aggregates."
        actions={
          <Select aria-label="Status filter" value={status} onChange={(e) => setParams({ status: e.target.value })}>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
            <option value="all">All</option>
          </Select>
        }
      />
      <Card padded={false}>
        {isLoading && <Loading />}
        <div className="px-3 pt-3">
          <ErrorBox error={error} />
        </div>
        {data && (
          <Table head={['Question', 'Reason', 'Learner note', 'Reported', 'Status', '']} empty={data.issues.length === 0 ? <div className="p-4"><Empty title={status === 'open' ? 'No open reports' : 'No reports'} /></div> : undefined}>
            {data.issues.map((i) => (
              <tr key={i.id}>
                <Td className="max-w-sm">
                  <Link to={`/questions/${i.question_version_id}`} className="font-medium hover:text-primary">
                    {i.question_prompt || i.question_version_id}
                  </Link>
                  <div className="mt-0.5 text-xs text-muted">Revision is {i.question_status}</div>
                </Td>
                <Td className="whitespace-nowrap">{i.reason.replace(/_/g, ' ')}</Td>
                <Td className="max-w-xs text-muted">{i.note || '—'}{i.resolution && <div className="mt-1 text-xs text-ink">Resolution: {i.resolution}</div>}</Td>
                <Td className="text-xs whitespace-nowrap text-muted">{formatDate(i.created_at)}</Td>
                <Td>
                  <StatusBadge status={i.status} />
                </Td>
                <Td className="text-right whitespace-nowrap">
                  {i.status === 'open' ? (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" onClick={() => setResolving({ issue: i, status: 'resolved' })}>
                        Resolve
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setResolving({ issue: i, status: 'dismissed' })}>
                        Dismiss
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setResolving({ issue: i, status: 'open' })}>
                      Reopen
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {resolving && <ResolveModal {...resolving} onClose={() => setResolving(null)} />}
    </>
  );
}

function ResolveModal({ issue, status, onClose }: { issue: IssueRow; status: IssueStatus; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [resolution, setResolution] = useState(issue.resolution);
  const save = useMutation({
    mutationFn: () => api.patch<IssueRow>(`/admin/issues/${issue.id}`, { status, resolution }),
    onSuccess: (row) => {
      // Update every cached filter view, then refetch so rows move between filters.
      queryClient.setQueriesData<{ issues: IssueRow[] }>({ queryKey: ['issues'] }, (old) => old && { issues: old.issues.map((i) => (i.id === row.id ? row : i)) });
      queryClient.invalidateQueries({ queryKey: ['issues'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      onClose();
    },
  });
  const verb = status === 'resolved' ? 'Resolve' : status === 'dismissed' ? 'Dismiss' : 'Reopen';
  return (
    <Modal
      open
      title={`${verb} report`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {verb}
          </Button>
        </>
      }
    >
      <p className="rounded-lg bg-bg p-3 text-sm">{issue.question_prompt}</p>
      <Field label="Resolution note" hint="Say what changed, e.g. “Clarified in revision 2” or why no change is needed.">
        <Textarea value={resolution} onChange={(e) => setResolution(e.target.value)} />
      </Field>
      <ErrorBox error={save.error} />
    </Modal>
  );
}
