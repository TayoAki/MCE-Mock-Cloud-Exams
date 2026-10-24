import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { AdminOnlyNote, Badge, Button, Card, Checkbox, ErrorBox, Field, Input, Loading, PageHeader, Table, Td, formatDate } from '../components/ui';
import type { StaffRow } from '../types';

export function StaffPage() {
  const { isAdmin, user } = useAuth();
  const { data, error, isLoading } = useQuery({ queryKey: ['staff'], queryFn: () => api.get<{ staff: StaffRow[] }>('/admin/staff') });

  return (
    <>
      <PageHeader
        title="Staff"
        subtitle="Reviewers author, review and publish content. Admins also manage blueprints, access and outcome verification. Staff accounts are created here, never self-registered."
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Accounts" className="lg:col-span-2" padded={false}>
          {isLoading && <Loading />}
          <div className="px-3 pt-3">
            <ErrorBox error={error} />
          </div>
          {data && (
            <Table head={['Name', 'Email', 'Role', 'Since']}>
              {data.staff.map((s) => (
                <tr key={s.id}>
                  <Td middle className="font-medium">
                    {s.display_name} {s.id === user?.id && <span className="text-xs font-normal text-muted">(you)</span>}
                  </Td>
                  <Td middle className="text-muted">{s.email ?? '—'}</Td>
                  <Td middle>{s.roles.includes('admin') ? <Badge tone="primary">admin</Badge> : <Badge>reviewer</Badge>}</Td>
                  <Td middle className="text-xs text-muted">{formatDate(s.created_at)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        {isAdmin ? (
          <CreateStaff />
        ) : (
          <Card title="Add staff">
            <AdminOnlyNote />
          </Card>
        )}
      </div>
    </>
  );
}

function CreateStaff() {
  const queryClient = useQueryClient();
  const empty = { email: '', display_name: '', password: '', admin: false };
  const [form, setForm] = useState(empty);
  const [created, setCreated] = useState<StaffRow | null>(null);
  const create = useMutation({
    mutationFn: () => api.post<StaffRow>('/admin/staff', form),
    onSuccess: (row) => {
      queryClient.setQueryData<{ staff: StaffRow[] }>(['staff'], (old) => old && { staff: [...old.staff, row] });
      setCreated(row);
      setForm(empty);
    },
  });
  const tooShort = form.password.length > 0 && form.password.length < 12;

  function submit(e: FormEvent) {
    e.preventDefault();
    setCreated(null);
    create.mutate();
  }

  return (
    <Card title="Add staff">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Display name">
          <Input required maxLength={60} value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
        </Field>
        <Field label="Email">
          <Input type="email" required autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Initial password" hint="At least 12 characters. Share it privately; the person should change it after first sign-in." error={tooShort ? 'Use at least 12 characters.' : null}>
          <Input type="password" required minLength={12} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <Checkbox label="Admin (blueprints, access grants, outcome verification)" checked={form.admin} onChange={(e) => setForm({ ...form, admin: e.target.checked })} />
        <ErrorBox error={create.error} />
        {created && (
          <div role="status" className="rounded-lg border border-success/30 bg-mint p-3 text-sm text-success">
            Created {created.display_name} as {created.roles.includes('admin') ? 'admin' : 'reviewer'}.
          </div>
        )}
        <Button type="submit" variant="primary" className="w-full" disabled={create.isPending || tooShort}>
          {create.isPending ? 'Creating…' : 'Create staff account'}
        </Button>
      </form>
    </Card>
  );
}
