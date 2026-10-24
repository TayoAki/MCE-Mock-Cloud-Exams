import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { Button, ErrorBox, Field, Input } from '../components/ui';

export function LoginPage() {
  const { user, isStaff, signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (user && isStaff) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-10" />
          <div>
            <h1 className="text-lg font-semibold">CertPath backoffice</h1>
            <p className="text-sm text-muted">Content review and operations</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-border bg-surface p-5">
          <Field label="Email">
            <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ErrorBox error={error} />
          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        {import.meta.env.DEV && (
          <p className="mt-4 rounded-lg border border-dashed border-border p-3 text-xs text-muted">
            Development seed: <span className="font-mono">admin@certpath.dev</span> / <span className="font-mono">certpath-admin</span>
            <br />
            API: <span className="font-mono">{api.base}</span>
          </p>
        )}
      </div>
    </div>
  );
}
