'use client';

import { useActionState, useEffect, useRef, useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

export type ActionState = {
  status: 'idle' | 'success' | 'error';
  message?: string;
  /** Optional link to show with a copy button (for invitation links). */
  link?: string;
};

export const idleState: ActionState = { status: 'idle' };

export function SubmitButton({ children, variant = 'primary', size, pendingText = 'جارٍ الحفظ…' }: { children: ReactNode; variant?: 'primary' | 'secondary' | 'danger'; size?: 'sm'; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''}`}>
      {pending ? pendingText : children}
    </button>
  );
}

export function CopyButton({ text, label = 'نسخ' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-secondary btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt('انسخ الرابط:', text);
        }
      }}
    >
      {copied ? 'تم النسخ ✓' : label}
    </button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (state.status === 'idle' || !state.message) return null;
  const tone = state.status === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800';
  return (
    <div role="status" className={`mt-3 rounded-lg border px-3 py-2 text-sm ${tone}`}>
      <div>{state.message}</div>
      {state.link ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="ltr block max-w-full overflow-x-auto rounded bg-white px-2 py-1 text-xs text-gray-700">{state.link}</code>
          <CopyButton text={state.link} label="نسخ الرابط" />
        </div>
      ) : null}
    </div>
  );
}

/** A form bound to a server action that returns ActionState; shows the result under the fields. */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, idleState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnSuccess && state.status === 'success') ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      <FormMessage state={state} />
    </form>
  );
}

/** A button that asks for confirmation before submitting its form. */
export function ConfirmButton({ children, message, variant = 'danger', size = 'sm' }: { children: ReactNode; message: string; variant?: 'primary' | 'secondary' | 'danger'; size?: 'sm' }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''}`}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}

/** Select that submits its GET form on change (with a button fallback when JavaScript is off). */
export function AutoSubmitSelect({ name, defaultValue, options, label }: { name: string; defaultValue: string; options: { value: string; label: string }[]; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-600">
      <span>{label}</span>
      <select name={name} defaultValue={defaultValue} className="field w-auto" onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="btn btn-secondary btn-sm">
          عرض
        </button>
      </noscript>
    </label>
  );
}
