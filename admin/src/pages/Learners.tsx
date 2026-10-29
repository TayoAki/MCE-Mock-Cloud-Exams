import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { api, qs } from '../api';
import { Badge, Card, Empty, ErrorBox, Input, Loading, PageHeader, Table, Td, formatDate } from '../components/ui';
import type { Profile } from '../types';

export function LearnersPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const { data, error, isLoading } = useQuery({ queryKey: ['learners', q], queryFn: () => api.get<{ learners: Profile[] }>(`/admin/learners${qs({ q })}`) });

  return (
    <>
      <PageHeader title="Learners" subtitle="Support view. Guest profiles are durable accounts without credentials until the learner saves progress." />
      <Card padded={false}>
        <div className="border-b border-border p-3">
          <Input
            aria-label="Search learners"
            placeholder="Search by name, email or ID and press Enter"
            className="w-96"
            defaultValue={q}
            onKeyDown={(e) => e.key === 'Enter' && setParams((e.target as HTMLInputElement).value ? { q: (e.target as HTMLInputElement).value } : {})}
          />
        </div>
        {isLoading && <Loading />}
        <div className="px-3 pt-3">
          <ErrorBox error={error} />
        </div>
        {data && (
          <Table head={['Name', 'Email', 'Type', 'Timezone', 'Joined']} empty={data.learners.length === 0 ? <div className="p-4"><Empty title="No learners found" /></div> : undefined}>
            {data.learners.map((l) => (
              <tr key={l.id} className="hover:bg-bg/60">
                <Td>
                  <Link to={`/learners/${l.id}`} className="font-medium hover:text-primary">
                    {l.display_name}
                  </Link>
                </Td>
                <Td className="text-muted">{l.email ?? '—'}</Td>
                <Td>
                  <span className="flex gap-1">
                    {l.is_guest ? <Badge>guest</Badge> : <Badge tone="primary">account</Badge>}
                    {l.roles.filter((r) => r !== 'learner').map((r) => (
                      <Badge key={r} tone="warning">{r}</Badge>
                    ))}
                    {l.deletion_requested_at && <Badge tone="danger">deletion requested</Badge>}
                  </span>
                </Td>
                <Td className="text-xs">{l.timezone}</Td>
                <Td className="text-xs text-muted">{formatDate(l.created_at)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
