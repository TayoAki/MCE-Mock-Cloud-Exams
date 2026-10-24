import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { api, qs } from '../api';
import { Card, Empty, ErrorBox, Input, Loading, PageHeader, Select, Table, Td, formatDate } from '../components/ui';
import type { AuditEntry } from '../types';

const ENTITY_TYPES = ['question_version', 'exam_version', 'lesson', 'issue_report', 'entitlement', 'exam_outcome', 'user'];

function entityLink(e: AuditEntry) {
  if (e.entity_type === 'question_version') return `/questions/${e.entity_id}`;
  if (e.entity_type === 'exam_version') return `/exam-versions/${e.entity_id}`;
  if (e.entity_type === 'entitlement' || e.entity_type === 'user') return `/learners/${e.entity_id}`;
  return null;
}

export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const entityType = params.get('entity_type') ?? '';
  const entityId = params.get('entity_id') ?? '';
  const { data, error, isLoading } = useQuery({
    queryKey: ['audit', entityType, entityId],
    queryFn: () => api.get<{ entries: AuditEntry[] }>(`/admin/audit${qs({ entity_type: entityType, entity_id: entityId })}`),
  });
  const set = (patch: Record<string, string>) => {
    const next = { entity_type: entityType, entity_id: entityId, ...patch };
    setParams(Object.fromEntries(Object.entries(next).filter(([, v]) => v)));
  };

  return (
    <>
      <PageHeader title="Audit log" subtitle="Content, access and verification changes made by staff. The latest 300 entries." />
      <Card padded={false}>
        <div className="flex flex-wrap gap-2 border-b border-border p-3">
          <Select aria-label="Entity type" value={entityType} onChange={(e) => set({ entity_type: e.target.value })}>
            <option value="">All entities</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
          <Input
            aria-label="Entity ID"
            placeholder="Entity ID (press Enter)"
            className="w-80 font-mono text-xs"
            defaultValue={entityId}
            onKeyDown={(e) => e.key === 'Enter' && set({ entity_id: (e.target as HTMLInputElement).value.trim() })}
          />
        </div>
        {isLoading && <Loading />}
        <div className="px-3 pt-3">
          <ErrorBox error={error} />
        </div>
        {data && (
          <Table head={['When', 'Actor', 'Entity', 'Action', 'Note']} empty={data.entries.length === 0 ? <div className="p-4"><Empty title="No audit entries" /></div> : undefined}>
            {data.entries.map((e) => {
              const href = entityLink(e);
              return (
                <tr key={e.id}>
                  <Td className="text-xs whitespace-nowrap text-muted">{formatDate(e.recorded_at, true)}</Td>
                  <Td className="whitespace-nowrap">{e.actor}</Td>
                  <Td className="text-xs whitespace-nowrap">
                    <div>{e.entity_type.replace(/_/g, ' ')}</div>
                    {href ? (
                      <Link to={href} className="font-mono text-primary hover:underline">
                        {e.entity_id.slice(0, 8)}
                      </Link>
                    ) : (
                      <span className="font-mono text-muted">{e.entity_id.slice(0, 8)}</span>
                    )}
                  </Td>
                  <Td className="font-medium whitespace-nowrap">{e.action.replace(/_/g, ' ')}</Td>
                  <Td className="max-w-md text-muted">
                    {e.note || '—'}
                    {Object.keys(e.details ?? {}).length > 0 && <div className="mt-0.5 truncate font-mono text-xs">{JSON.stringify(e.details)}</div>}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </>
  );
}
