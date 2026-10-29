import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import type { ExamRow, VersionDetail } from './types';

const KEY = 'certpath.admin.version';

interface VersionState {
  versionId: string | null;
  setVersionId: (id: string) => void;
  exams: ExamRow[];
  detail: VersionDetail | undefined;
}

const VersionContext = createContext<VersionState | null>(null);

function stored() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** The exam version the question bank and lesson tools are scoped to. */
export function VersionProvider({ children }: { children: ReactNode }) {
  const [versionId, setVersion] = useState<string | null>(stored);
  const exams = useQuery({ queryKey: ['exams'], queryFn: () => api.get<{ exams: ExamRow[] }>('/admin/exams') });
  const allVersions = useMemo(() => exams.data?.exams.flatMap((e) => e.versions) ?? [], [exams.data]);

  useEffect(() => {
    if (!exams.data) return;
    if (versionId && allVersions.some((v) => v.id === versionId)) return;
    const first = allVersions.find((v) => v.status === 'published') ?? allVersions[0];
    if (first) setVersion(first.id);
  }, [exams.data, allVersions, versionId]);

  const detail = useQuery({
    queryKey: ['version', versionId],
    queryFn: () => api.get<VersionDetail>(`/admin/exam-versions/${versionId}`),
    enabled: !!versionId,
  });

  const value = useMemo<VersionState>(
    () => ({
      versionId,
      setVersionId: (id) => {
        setVersion(id);
        try {
          localStorage.setItem(KEY, id);
        } catch {
          // ignore
        }
      },
      exams: exams.data?.exams ?? [],
      detail: detail.data,
    }),
    [versionId, exams.data, detail.data],
  );
  return <VersionContext.Provider value={value}>{children}</VersionContext.Provider>;
}

export function useWorkingVersion() {
  const ctx = useContext(VersionContext);
  if (!ctx) throw new Error('useWorkingVersion must be used inside VersionProvider');
  return ctx;
}

function indexObjectives(detail: VersionDetail | undefined) {
  const map = new Map<string, { title: string; code: string; domain: string; domainId: string }>();
  for (const d of detail?.domains ?? []) for (const o of d.objectives) map.set(o.id, { title: o.title, code: o.code, domain: d.title, domainId: d.id });
  return map;
}

/** Version detail for any version id, cached under the same key the version page uses. */
export function useVersionDetail(versionId: string | null | undefined) {
  return useQuery({
    queryKey: ['version', versionId],
    queryFn: () => api.get<VersionDetail>(`/admin/exam-versions/${versionId}`),
    enabled: !!versionId,
  });
}

export function useVersionObjectives(versionId: string | null | undefined) {
  const { data } = useVersionDetail(versionId);
  return { detail: data, objectives: useMemo(() => indexObjectives(data), [data]) };
}

/** objective id → { title, code, domain } for the working version. */
export function useObjectiveIndex() {
  const { detail } = useWorkingVersion();
  return useMemo(() => indexObjectives(detail), [detail]);
}
