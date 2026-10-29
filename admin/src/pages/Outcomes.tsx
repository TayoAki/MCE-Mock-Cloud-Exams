import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { AdminOnlyNote, Card, Empty, ErrorBox, Loading, PageHeader, Select, StatusBadge, Table, Td, formatDate } from '../components/ui';
import type { OutcomeRow, VerificationStatus } from '../types';

export function OutcomesPage() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const { data, error, isLoading } = useQuery({ queryKey: ['outcomes'], queryFn: () => api.get<{ outcomes: OutcomeRow[] }>('/admin/outcomes') });
  const verify = useMutation({
    mutationFn: ({ id, status }: { id: string; status: VerificationStatus }) => api.patch(`/admin/outcomes/${id}`, { verification_status: status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['outcomes'] }),
  });

  return (
    <>
      <PageHeader
        title="Exam outcomes"
        subtitle="Learners report passes and failures themselves. Keep “passed” labelled self-reported unless evidence has been checked. Never treat graduation as churn."
        actions={!isAdmin && <AdminOnlyNote />}
      />
      <ErrorBox error={verify.error} />
      <Card padded={false}>
        {isLoading && <Loading />}
        <div className="px-3 pt-3">
          <ErrorBox error={error} />
        </div>
        {data && (
          <Table head={['Learner', 'Result', 'Taken', 'Verification']} empty={data.outcomes.length === 0 ? <div className="p-4"><Empty title="No outcomes reported yet" /></div> : undefined}>
            {data.outcomes.map((o) => (
              <tr key={o.id}>
                <Td middle>
                  <Link to={`/learners/${o.user_id}`} className="font-medium hover:text-primary">
                    {o.learner}
                  </Link>
                </Td>
                <Td middle>
                  <StatusBadge status={o.result} />
                </Td>
                <Td middle className="text-xs">{formatDate(o.taken_at)}</Td>
                <Td middle>
                  {isAdmin ? (
                    <Select
                      aria-label={`Verification for ${o.learner}`}
                      value={o.verification_status}
                      disabled={verify.isPending}
                      onChange={(e) => verify.mutate({ id: o.id, status: e.target.value as VerificationStatus })}
                    >
                      <option value="self_reported">self reported</option>
                      <option value="evidence_received">evidence received</option>
                      <option value="verified">verified</option>
                    </Select>
                  ) : (
                    <StatusBadge status={o.verification_status} />
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
