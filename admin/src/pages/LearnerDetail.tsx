import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { AdminOnlyNote, Badge, Button, Card, Checkbox, ErrorBox, Field, Input, Loading, Modal, PageHeader, Stat, StatusBadge, Table, Td, Textarea, cx, formatDate } from '../components/ui';
import { FEATURES, type FeatureKey, type LearnerDetail } from '../types';

export function LearnerDetailPage() {
  const { id = '' } = useParams();
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const key = ['learner', id];
  const { data, error, isLoading } = useQuery({ queryKey: key, queryFn: () => api.get<LearnerDetail>(`/admin/learners/${id}`) });
  const [granting, setGranting] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;
  const now = Date.now();
  const onSaved = (d: LearnerDetail) => queryClient.setQueryData(key, d);

  return (
    <>
      <PageHeader
        eyebrow={<Link to="/learners" className="hover:underline">Learners</Link>}
        title={
          <span className="flex items-center gap-2">
            {data.user.display_name} {data.user.is_guest ? <Badge>guest</Badge> : <Badge tone="primary">account</Badge>}
            {data.user.deletion_requested_at && <Badge tone="danger">deletion requested</Badge>}
          </span>
        }
        subtitle={`${data.user.email ?? 'No email'} · ${data.user.timezone}${data.user.pending_timezone ? ` → ${data.user.pending_timezone.zone} from ${formatDate(data.user.pending_timezone.effective_at, true)}` : ''} · ${data.user.daily_goal_minutes}-minute goal`}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Current streak" value={`${data.streak.current} ${data.streak.current === 1 ? 'day' : 'days'}`} sub={`Longest ${data.streak.longest} · last ${data.streak.last_study_date ?? 'never'}`} />
        <Stat label="XP (activity)" value={data.xp_total} sub="Measures activity, not readiness" />
        <Stat label="Enrollments" value={data.enrollments.length} />
        <Stat label="This week" value={<WeekDots week={data.streak.week} />} sub={data.streak.studied_today ? 'Studied today' : 'Not yet today'} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card
          title="Access"
          actions={
            isAdmin ? (
              <Button size="sm" onClick={() => setGranting(true)}>
                Grant access
              </Button>
            ) : (
              <AdminOnlyNote />
            )
          }
          padded={false}
        >
          {data.entitlements.length === 0 ? (
            <p className="p-4 text-sm text-muted">Free plan. Daily lessons, explanations, due reviews and basic progress.</p>
          ) : (
            <Table head={['Feature', 'Source', 'Ends', '']}>
              {data.entitlements.map((e) => {
                const active = !e.revoked_at && new Date(e.ends_at).getTime() > now && new Date(e.starts_at).getTime() <= now;
                return (
                  <tr key={e.id} className={cx(!active && 'text-muted')}>
                    <Td middle className="font-mono text-xs">{e.feature_key}</Td>
                    <Td middle>{e.source}</Td>
                    <Td middle className="text-xs">{e.revoked_at ? <Badge tone="danger">revoked</Badge> : formatDate(e.ends_at)}</Td>
                    <Td middle className="text-right">
                      {active && isAdmin && (
                        <Button size="sm" variant="danger" onClick={() => setRevoking(e.id)}>
                          Revoke
                        </Button>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>

        <Card title="Enrollments and outcomes" padded={false}>
          <Table head={['Exam version', 'Status', 'Exam date']}>
            {data.enrollments.map((e) => (
              <tr key={e.id}>
                <Td className="font-mono text-xs">
                  <Link to={`/exam-versions/${e.exam_version_id}`} className="hover:text-primary">
                    {e.exam_version_id.slice(0, 8)}
                  </Link>
                </Td>
                <Td>
                  <StatusBadge status={e.status} />
                </Td>
                <Td className="text-xs">{e.exam_date ?? '—'}</Td>
              </tr>
            ))}
          </Table>
          <div className="border-t border-border px-4 py-3 text-sm">
            {data.outcomes.length === 0 ? (
              <span className="text-muted">No exam outcomes reported.</span>
            ) : (
              data.outcomes.map((o) => (
                <div key={o.id} className="flex items-center justify-between py-1">
                  <span>
                    <StatusBadge status={o.result} /> <span className="text-xs text-muted">{formatDate(o.taken_at)}</span>
                  </span>
                  <StatusBadge status={o.verification_status} />
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <Card title="Recent sessions" className="mt-4" padded={false}>
        <Table head={['Started', 'Mode', 'Status', 'Score']}>
          {data.recent_sessions.map((s) => (
            <tr key={s.id}>
              <Td middle className="text-xs">{formatDate(s.started_at, true)}</Td>
              <Td middle className="capitalize">{s.mode}</Td>
              <Td middle>
                <StatusBadge status={s.status} />
              </Td>
              <Td middle className="tabular-nums">{s.correct === null ? <span className="text-muted">—</span> : `${s.correct}/${s.question_count}`}</Td>
            </tr>
          ))}
        </Table>
        {data.recent_sessions.length === 0 && <p className="p-4 text-sm text-muted">No sessions yet.</p>}
      </Card>

      {granting && <GrantModal userId={id} onClose={() => setGranting(false)} onSaved={onSaved} />}
      {revoking && <RevokeModal entitlementId={revoking} onClose={() => setRevoking(null)} onSaved={onSaved} />}
    </>
  );
}

function WeekDots({ week }: { week: LearnerDetail['streak']['week'] }) {
  return (
    <span className="flex gap-1.5 pt-1" aria-label={`${week.filter((d) => d.studied).length} study days this week`}>
      {week.map((d) => (
        <span
          key={d.date}
          title={d.date}
          className={cx('size-4 rounded-full border', d.studied ? 'border-streak bg-streak' : 'border-border bg-bg', d.is_today && 'ring-2 ring-primary/40')}
        />
      ))}
    </span>
  );
}

function GrantModal({ userId, onClose, onSaved }: { userId: string; onClose: () => void; onSaved: (d: LearnerDetail) => void }) {
  const [features, setFeatures] = useState<FeatureKey[]>([...FEATURES]);
  const [days, setDays] = useState(30);
  const [note, setNote] = useState('');
  const grant = useMutation({
    mutationFn: () => api.post<LearnerDetail>(`/admin/learners/${userId}/entitlements`, { features, days, note }),
    onSuccess: (d) => {
      onSaved(d);
      onClose();
    },
  });
  return (
    <Modal
      open
      title="Grant access"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!note.trim() || features.length === 0 || grant.isPending} onClick={() => grant.mutate()}>
            Grant
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">Support grants are dated, nonrenewing and recorded in the audit log. Store purchases should come from verified store events instead.</p>
      <div className="grid grid-cols-2 gap-2">
        {FEATURES.map((f) => (
          <Checkbox key={f} label={<span className="font-mono text-xs">{f}</span>} checked={features.includes(f)} onChange={() => setFeatures(features.includes(f) ? features.filter((x) => x !== f) : [...features, f])} />
        ))}
      </div>
      <Field label="Days">
        <Input type="number" min={1} max={366} value={days} onChange={(e) => setDays(Number(e.target.value))} />
      </Field>
      <Field label="Reason (required)">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Goodwill extension after an outage on 24 Oct." />
      </Field>
      <ErrorBox error={grant.error} />
    </Modal>
  );
}

function RevokeModal({ entitlementId, onClose, onSaved }: { entitlementId: string; onClose: () => void; onSaved: (d: LearnerDetail) => void }) {
  const [note, setNote] = useState('');
  const revoke = useMutation({
    mutationFn: () => api.post<LearnerDetail>(`/admin/entitlements/${entitlementId}/revoke`, { note }),
    onSuccess: (d) => {
      onSaved(d);
      onClose();
    },
  });
  return (
    <Modal
      open
      title="Revoke access"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={!note.trim() || revoke.isPending} onClick={() => revoke.mutate()}>
            Revoke
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">Revocation affects new sessions. A mock already admitted can still be finished. Store cancellations stay with the store.</p>
      <Field label="Reason (required)">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <ErrorBox error={revoke.error} />
    </Modal>
  );
}
