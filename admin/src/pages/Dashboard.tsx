import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../api';
import { Card, ErrorBox, Loading, PageHeader, Ratio, Stat, Table, Td } from '../components/ui';
import type { Overview, ReminderTemplateStat } from '../types';

/** The reminder bandit's arms, best converting first. Rates under 20 sends are too noisy to read much into. */
function ReminderCard() {
  const { data } = useQuery({ queryKey: ['reminders'], queryFn: () => api.get<{ templates: ReminderTemplateStat[] }>('/admin/reminders') });
  if (!data) return null;
  const rows = [...data.templates].sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.sent - a.sent);
  return (
    <Card title="Reminder wording (bandit)" className="mt-4" padded={false}>
      <Table head={['Template', 'Example', 'Sent', 'Studied within 6h', 'Rate']}>
        {rows.map((t) => (
          <tr key={t.key}>
            <Td className="font-mono text-xs">
              {t.key}
              {t.urgent ? <span className="ml-1 text-muted">· saver</span> : null}
            </Td>
            <Td>
              <div className="font-medium">{t.example.title}</div>
              <div className="text-xs text-muted">{t.example.body}</div>
            </Td>
            <Td className="tabular-nums">{t.sent}</Td>
            <Td className="tabular-nums">{t.converted}</Td>
            <Td className="tabular-nums">{t.rate === null ? '—' : `${Math.round(t.rate * 100)}%${t.sent < 20 ? ' (few sends)' : ''}`}</Td>
          </tr>
        ))}
      </Table>
      <p className="px-4 py-3 text-xs text-muted">
        Each reminder's wording is picked per learner by Thompson sampling over these templates, using everyone's results as a prior and the learner's own history on top. Recently used wording is penalised so it doesn't repeat. Only templates whose facts are true for the learner compete.
      </p>
    </Card>
  );
}

export function DashboardPage() {
  const { data, error, isLoading } = useQuery({ queryKey: ['overview'], queryFn: () => api.get<Overview>('/admin/overview') });
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;

  const q = data.questions_by_status;
  const passed = data.outcomes.filter((o) => o.result === 'passed').reduce((s, o) => s + o.count, 0);
  const attempted = data.outcomes.reduce((s, o) => s + o.count, 0);
  const verifiedPasses = data.outcomes.filter((o) => o.result === 'passed' && o.verification_status === 'verified').reduce((s, o) => s + o.count, 0);

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`Last ${data.window_days} days. Activity means qualifying study sessions, not app opens or XP.`}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Weekly active study" value={<Ratio n={data.weekly_active_study.learners} d={data.weekly_active_study.of_total} />} sub="Learners with a qualifying session / all learners" />
        <Stat label="Activation" value={<Ratio n={data.activation.activated} d={data.activation.cohort} empty="No new learners" />} sub="First lesson within 24h / new learners" />
        <Stat label="Study days credited" value={data.study_days_credited} sub={`${data.answers_submitted} answers submitted`} />
        <Stat label="Open issue reports" value={data.open_issues} tone={data.open_issues > 0 ? 'danger' : undefined} sub={<Link className="text-primary hover:underline" to="/issues">Review queue →</Link>} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Question bank">
          <dl className="grid grid-cols-3 gap-2 text-center">
            {(['published', 'draft', 'retired'] as const).map((s) => (
              <div key={s} className="rounded-lg bg-bg p-3">
                <dt className="text-xs text-muted capitalize">{s}</dt>
                <dd className="text-xl font-semibold tabular-nums">{q[s] ?? 0}</dd>
              </div>
            ))}
          </dl>
          <Link to="/questions?needs_review=true" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">
            Drafts awaiting review →
          </Link>
        </Card>

        <Card title="Sessions started by mode" padded={false}>
          {data.sessions_by_mode.length === 0 ? (
            <p className="p-4 text-sm text-muted">No sessions in this window.</p>
          ) : (
            <Table head={['Mode', 'Sessions']}>
              {data.sessions_by_mode.map((r) => (
                <tr key={r.mode}>
                  <Td className="capitalize">{r.mode}</Td>
                  <Td className="tabular-nums">{r.sessions}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Plans and outcomes">
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">New learners</dt>
              <dd className="tabular-nums">{data.new_learners} <span className="text-muted">of {data.learners_total}</span></dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Plus previews started</dt>
              <dd className="tabular-nums">{data.preview_starts}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Reported passes</dt>
              <dd>
                <Ratio n={passed} d={attempted} empty="None reported" />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Verified passes</dt>
              <dd className="tabular-nums">{verifiedPasses}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted">Outcomes are self-reported unless verified, and reflect only learners who chose to report.</p>
        </Card>
      </div>

      <ReminderCard />

      <Card title="Events (staging store)" className="mt-4" padded={false}>
        {data.events.length === 0 ? (
          <p className="p-4 text-sm text-muted">No events recorded in this window.</p>
        ) : (
          <div className="grid grid-cols-2 gap-x-8 px-4 py-2 md:grid-cols-3">
            {data.events.map((e) => (
              <div key={e.event} className="flex justify-between border-b border-border py-1.5 text-sm last:border-0">
                <span className="font-mono text-xs">{e.event}</span>
                <span className="tabular-nums">{e.count}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
