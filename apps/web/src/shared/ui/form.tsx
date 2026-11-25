import type { InputHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export const TextField = forwardRef<HTMLInputElement, FieldProps>(function TextField({ label, error, id, ...rest }, ref) {
  const fieldId = id ?? rest.name;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={fieldId}
        ref={ref}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : undefined}
        className={`rounded border px-3 py-2 ${error ? 'border-red-500' : 'border-slate-300'}`}
        {...rest}
      />
      {error ? (
        <p id={`${fieldId}-error`} role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
});

export const Button = ({ children, variant = 'primary', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }): ReactNode => {
  const style = variant === 'primary' ? 'bg-slate-900 text-white' : variant === 'danger' ? 'bg-red-600 text-white' : 'border border-slate-300 bg-white text-slate-900';
  return (
    <button {...rest} className={`rounded px-4 py-2 font-medium disabled:opacity-50 ${style} ${rest.className ?? ''}`}>
      {children}
    </button>
  );
};

export const FormError = ({ message }: { message: string | null }): ReactNode =>
  message ? (
    <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
    </p>
  ) : null;

export const Card = ({ children, className = '' }: { children: ReactNode; className?: string }): ReactNode => (
  <section className={`rounded border border-slate-200 bg-white p-4 shadow-sm ${className}`}>{children}</section>
);
