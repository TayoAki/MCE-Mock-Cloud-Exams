import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { ApiError } from '../api';

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');
export { cx };

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({ variant = 'secondary', size = 'md', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  const styles: Record<Variant, string> = {
    primary: 'bg-primary text-white hover:bg-primary-dark border-transparent',
    secondary: 'bg-surface text-ink border-border hover:bg-primary-tint',
    danger: 'bg-surface text-coral-ink border-coral/40 hover:bg-coral-tint',
    ghost: 'bg-transparent text-primary border-transparent hover:bg-primary-tint',
  };
  return (
    <button
      type="button"
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Card({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx('rounded-xl border border-border bg-surface', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'p-4' : undefined}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-semibold tracking-wide text-primary uppercase">{eyebrow}</div>}
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  const styles: Record<Tone, string> = {
    neutral: 'bg-bg text-muted border-border',
    primary: 'bg-primary-tint text-primary-dark border-primary/20',
    success: 'bg-mint text-success border-success/20',
    warning: 'bg-streak-tint text-[#8a5a00] border-streak/30',
    danger: 'bg-coral-tint text-coral-ink border-coral/30',
  };
  return <span className={cx('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap', styles[tone])}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const tone: Record<string, Tone> = {
    draft: 'warning',
    published: 'success',
    retired: 'neutral',
    planned: 'neutral',
    pilot: 'primary',
    active: 'success',
    open: 'danger',
    resolved: 'success',
    dismissed: 'neutral',
    passed: 'success',
    failed: 'danger',
    self_reported: 'neutral',
    evidence_received: 'warning',
    verified: 'success',
    completed: 'success',
    expired: 'warning',
    abandoned: 'neutral',
    paused: 'warning',
    archived: 'neutral',
  };
  return <Badge tone={tone[status] ?? 'neutral'}>{status.replace(/_/g, ' ')}</Badge>;
}

export function Field({ label, hint, error, children, className }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={cx('flex flex-col gap-1', className)}>
      <span className="text-xs font-medium text-ink">{label}</span>
      {children}
      {error ? <span className="text-xs text-coral-ink">{error}</span> : hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

const inputBase = 'rounded-lg border border-border bg-surface px-3 text-sm text-ink placeholder:text-muted/70 focus:border-primary focus:outline-none disabled:bg-bg';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputBase, 'h-9', props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputBase, 'h-9 pr-8', props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputBase, 'min-h-20 py-2 leading-relaxed', props.className)} />;
}

export function Checkbox({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" className="size-4 accent-primary" {...props} />
      {label}
    </label>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const apiError = error instanceof ApiError ? error : null;
  if (apiError?.status === 403 && apiError.code === 'insufficient_role') {
    return <div className="rounded-lg border border-coral/30 bg-coral-tint p-3 text-sm text-coral-ink">Staff only. This action needs a different role.</div>;
  }
  const problems = (apiError?.body.details?.problems as string[] | undefined) ?? (apiError?.body.details?.issues as { path: string; message: string }[] | undefined)?.map((i) => `${i.path}: ${i.message}`);
  const checks = apiError?.body.details?.checks as { key: string; ok: boolean; detail: string; blocking: boolean }[] | undefined;
  return (
    <div role="alert" className="rounded-lg border border-coral/30 bg-coral-tint p-3 text-sm text-coral-ink">
      <div className="font-medium">{apiError ? apiError.message : error instanceof Error ? error.message : 'Something went wrong'}</div>
      {apiError && <div className="mt-0.5 font-mono text-xs opacity-80">{apiError.code}</div>}
      {problems && problems.length > 1 && (
        <ul className="mt-2 list-disc pl-5 text-xs">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {checks && (
        <ul className="mt-2 list-disc pl-5 text-xs">
          {checks
            .filter((c) => !c.ok && c.blocking)
            .map((c) => (
              <li key={c.key}>{c.detail}</li>
            ))}
        </ul>
      )}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-muted" role="status">
      <span className="size-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
      {label}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
      <div className="text-sm font-medium">{title}</div>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'primary' | 'danger' }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={cx('mt-1 text-2xl font-semibold tabular-nums', tone === 'primary' && 'text-primary', tone === 'danger' && 'text-coral-ink')}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted">
            {head.map((h, i) => (
              <th key={i} className="px-4 py-2 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

export function Td({ children, className, middle }: { children?: ReactNode; className?: string; middle?: boolean }) {
  return <td className={cx('px-4 py-2.5', middle ? 'align-middle' : 'align-top', className)}>{children}</td>;
}

export function Modal({ title, open, onClose, children, footer, wide }: { title: string; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-4 pt-[6vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cx('flex max-h-[86vh] w-full flex-col rounded-xl border border-border bg-surface shadow-xl', wide ? 'max-w-3xl' : 'max-w-lg')}>
        <header className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button type="button" aria-label="Close" className="rounded p-1 text-muted hover:bg-bg" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">{children}</div>
        {footer && <footer className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function Ratio({ n, d, empty = 'No data yet' }: { n: number; d: number; empty?: string }) {
  if (d === 0) return <span className="text-muted">{empty}</span>;
  return (
    <span className="tabular-nums">
      {n}/{d} <span className="text-muted">({Math.round((n / d) * 100)}%)</span>
    </span>
  );
}

export function formatDate(iso: string | null | undefined, withTime = false) {
  if (!iso) return '—';
  const d = new Date(iso);
  return withTime
    ? d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function AdminOnlyNote() {
  return <span className="text-xs text-muted">Admin role required</span>;
}
