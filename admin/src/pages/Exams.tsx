import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { AdminOnlyNote, Button, Card, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, StatusBadge, Table, Td } from '../components/ui';
import type { ExamRow, ExamStatus, VersionDetail } from '../types';

const EXAM_STATUSES: ExamStatus[] = ['planned', 'pilot', 'active', 'retired'];

export function ExamsPage() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const { data, error, isLoading } = useQuery({ queryKey: ['exams'], queryFn: () => api.get<{ exams: ExamRow[] }>('/admin/exams') });
  const [creatingFor, setCreatingFor] = useState<ExamRow | null>(null);

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ExamStatus }) => api.patch<ExamRow>(`/admin/exams/${id}`, { status }),
    onSuccess: (row) => queryClient.setQueryData<{ exams: ExamRow[] }>(['exams'], (old) => old && { exams: old.exams.map((e) => (e.id === row.id ? row : e)) }),
  });

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;

  return (
    <>
      <PageHeader
        title="Exams & blueprints"
        subtitle="Only pilot or active exams with a published version can enroll learners. Planned banks stay visible in the app but cannot start."
      />
      <ErrorBox error={setStatus.error} />
      <div className="space-y-4">
        {data.exams.map((exam) => (
          <Card
            key={exam.id}
            title={
              <span className="flex items-center gap-2">
                {exam.title} <span className="font-normal text-muted">{exam.subtitle}</span>
              </span>
            }
            actions={
              <>
                {isAdmin ? (
                  <Select
                    aria-label={`Status for ${exam.title}`}
                    value={exam.status}
                    disabled={setStatus.isPending}
                    onChange={(e) => setStatus.mutate({ id: exam.id, status: e.target.value as ExamStatus })}
                  >
                    {EXAM_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <StatusBadge status={exam.status} />
                )}
                <Button size="sm" disabled={!isAdmin} onClick={() => setCreatingFor(exam)} title={isAdmin ? undefined : 'Admin role required'}>
                  New version
                </Button>
              </>
            }
            padded={false}
          >
            {exam.versions.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted">No versions yet. A version needs a reviewed blueprint and enough reviewed content before it can be published.</p>
            ) : (
              <Table head={['Version', 'Effective from', 'Status', '']}>
                {exam.versions.map((v) => (
                  <tr key={v.id}>
                    <Td middle className="font-medium">{v.version_label}</Td>
                    <Td middle>{v.effective_from}</Td>
                    <Td middle>
                      <StatusBadge status={v.status} />
                    </Td>
                    <Td middle className="text-right">
                      <Link to={`/exam-versions/${v.id}`} className="text-sm font-medium text-primary hover:underline">
                        Open blueprint →
                      </Link>
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
            <div className="border-t border-border px-4 py-2 text-xs text-muted">
              Guide: <a className="text-primary hover:underline" href={exam.canonical_url} target="_blank" rel="noreferrer">{exam.canonical_url}</a>
              {!isAdmin && <span className="ml-3"><AdminOnlyNote /></span>}
            </div>
          </Card>
        ))}
      </div>
      {creatingFor && <CreateVersionModal exam={creatingFor} onClose={() => setCreatingFor(null)} />}
    </>
  );
}

function CreateVersionModal({ exam, onClose }: { exam: ExamRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState({ version_label: '', effective_from: new Date().toISOString().slice(0, 10), question_count: 45, duration_minutes: 90, guide_url: exam.canonical_url });
  const create = useMutation({
    mutationFn: () => api.post<VersionDetail>(`/admin/exams/${exam.id}/versions`, form),
    onSuccess: (detail) => {
      queryClient.setQueryData(['version', detail.id], detail);
      queryClient.invalidateQueries({ queryKey: ['exams'] });
      onClose();
      navigate(`/exam-versions/${detail.id}`);
    },
  });
  return (
    <Modal
      open
      title={`New ${exam.title} version`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={create.isPending || !form.version_label} onClick={() => create.mutate()}>
            Create draft version
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">Versions start as drafts. Pin the exact guide edition the blueprint was taken from.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Version label" className="col-span-2">
          <Input value={form.version_label} placeholder="guide-2027-01" onChange={(e) => setForm({ ...form, version_label: e.target.value })} />
        </Field>
        <Field label="Effective from">
          <Input type="date" value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} />
        </Field>
        <Field label="Exam questions">
          <Input type="number" min={1} value={form.question_count} onChange={(e) => setForm({ ...form, question_count: Number(e.target.value) })} />
        </Field>
        <Field label="Duration (minutes)">
          <Input type="number" min={1} value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })} />
        </Field>
        <Field label="Official guide URL" className="col-span-2">
          <Input type="url" value={form.guide_url} onChange={(e) => setForm({ ...form, guide_url: e.target.value })} />
        </Field>
      </div>
      <ErrorBox error={create.error} />
    </Modal>
  );
}
