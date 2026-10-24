import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import type { Overview } from '../types';
import { useWorkingVersion } from '../version';
import { Badge, Select, cx } from './ui';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/exams', label: 'Exams & blueprints' },
  { to: '/questions', label: 'Question bank' },
  { to: '/issues', label: 'Issue reports', badge: 'issues' as const },
  { to: '/learners', label: 'Learners' },
  { to: '/outcomes', label: 'Exam outcomes' },
  { to: '/audit', label: 'Audit log' },
  { to: '/staff', label: 'Staff' },
];

export function Layout() {
  const { user, isAdmin, signOut } = useAuth();
  const { exams, versionId, setVersionId } = useWorkingVersion();
  const workingExam = exams.find((e) => e.versions.some((v) => v.id === versionId));
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api.get<Overview>('/admin/overview'), staleTime: 60_000 });
  const openIssues = overview.data?.open_issues ?? 0;

  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex items-center gap-2 px-5 py-4">
          <img src="/favicon.svg" alt="" className="size-7" />
          <div>
            <div className="text-sm font-semibold leading-tight">CertPath</div>
            <div className="text-xs text-muted">Content & operations</div>
          </div>
        </div>
        <div className="px-3 pb-3">
          <label className="mb-1 block px-2 text-xs font-medium text-muted" htmlFor="working-version">
            Working exam version
          </label>
          <Select id="working-version" className="w-full text-xs" value={versionId ?? ''} onChange={(e) => setVersionId(e.target.value)}>
            {exams
              .filter((exam) => exam.versions.length > 0)
              .map((exam) => (
                <optgroup key={exam.id} label={exam.title}>
                  {exam.versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.version_label}
                      {v.status !== 'published' ? ` (${v.status})` : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
          </Select>
          {workingExam && <div className="mt-1 px-2 text-xs text-muted">{workingExam.title}</div>}
        </div>
        <nav className="flex-1 space-y-0.5 px-3" aria-label="Main">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cx('flex items-center justify-between rounded-lg px-3 py-2 text-sm', isActive ? 'bg-primary-tint font-medium text-primary-dark' : 'text-ink hover:bg-bg')
              }
            >
              {item.label}
              {item.badge === 'issues' && openIssues > 0 && <Badge tone="danger">{openIssues}</Badge>}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-border px-5 py-4">
          <div className="truncate text-sm font-medium">{user?.display_name}</div>
          <div className="truncate text-xs text-muted">{user?.email}</div>
          <div className="mt-2 flex items-center justify-between">
            <Badge tone={isAdmin ? 'primary' : 'neutral'}>{isAdmin ? 'admin' : 'reviewer'}</Badge>
            <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-8 py-6">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
