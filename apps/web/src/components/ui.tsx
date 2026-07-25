import * as React from 'react';

export function Button({
  className = '',
  variant = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
}): React.ReactElement {
  const styles = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300',
    secondary: 'border border-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800',
    danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
  }[variant];
  return (
    <button
      className={`rounded px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${styles} ${className}`}
      {...props}
    />
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>): React.ReactElement {
  return (
    <input
      className="w-full rounded border border-gray-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-600"
      {...props}
    />
  );
}

export function Textarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
): React.ReactElement {
  return (
    <textarea
      className="w-full rounded border border-gray-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-600"
      {...props}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>): React.ReactElement {
  return (
    <select
      className="rounded border border-gray-300 bg-transparent px-2 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-600"
      {...props}
    />
  );
}

export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </label>
  );
}

export function Card({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div className={`rounded-lg border border-gray-200 p-4 dark:border-gray-700 ${className}`}>
      {children}
    </div>
  );
}

export function Alert({
  kind = 'error',
  children,
}: {
  kind?: 'error' | 'success';
  children: React.ReactNode;
}): React.ReactElement {
  const styles =
    kind === 'error'
      ? 'border-red-300 bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300'
      : 'border-green-300 bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300';
  return <div className={`rounded border px-3 py-2 text-sm ${styles}`} role="alert">{children}</div>;
}

export function Spinner({ label = 'Loading…' }: { label?: string }): React.ReactElement {
  return <p className="py-8 text-center text-sm opacity-70">{label}</p>;
}
