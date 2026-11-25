'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema } from '@hotel/shared';
import type { z } from 'zod';
import { api } from '@/shared/api';
import { Button, FormError, TextField } from '@/shared/ui';
import { applyFieldErrors, saveSession, toApiError } from '@/shared/lib';

type Values = z.infer<typeof loginSchema>;

const HOME: Record<string, string> = { revenue: '/staff/revenue', frontdesk: '/staff/frontdesk', housekeeper: '/staff/housekeeping', head_housekeeper: '/staff/housekeeping', admin: '/staff/admin' };

export const LoginForm = (): ReactNode => {
  const router = useRouter();
  const form = useForm<Values>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });
  const submit = form.handleSubmit(async (values) => {
    const r = await api.POST('/api/auth/login', { body: values });
    if (r.data) {
      saveSession(r.data);
      router.replace(HOME[r.data.staff.roles[0]?.role ?? 'admin'] ?? '/staff/revenue');
      return;
    }
    const e = toApiError(r.error);
    if (!applyFieldErrors(e, form.setError)) form.setError('root', { message: e.code === 'RATE_LIMITED' ? 'Too many failed attempts. Try again later.' : e.message });
  });
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <TextField label="Email" type="email" autoComplete="username" error={form.formState.errors.email?.message} {...form.register('email')} />
      <TextField label="Password" type="password" autoComplete="current-password" error={form.formState.errors.password?.message} {...form.register('password')} />
      <FormError message={form.formState.errors.root?.message ?? null} />
      <Button type="submit" disabled={form.formState.isSubmitting}>
        Sign in
      </Button>
    </form>
  );
};
