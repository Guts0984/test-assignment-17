'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { confirmHoldSchema } from '@hotel/shared';
import type { z } from 'zod';
import { managedBookingKey } from '@/entities/booking';
import { api } from '@/shared/api';
import { Button, FormError, TextField } from '@/shared/ui';
import { applyFieldErrors, toApiError } from '@/shared/lib';

type Values = z.infer<typeof confirmHoldSchema>;

export const ConfirmForm = ({ token, disabled }: { token: string; disabled: boolean }): ReactNode => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useForm<Values>({ resolver: zodResolver(confirmHoldSchema), defaultValues: { guestName: '', guestEmail: '', guestPhone: '' } });
  const submit = form.handleSubmit(async (values) => {
    const r = await api.POST('/api/holds/{token}/confirm', { params: { path: { token } }, body: values });
    if (r.data) {
      await queryClient.invalidateQueries({ queryKey: managedBookingKey(token) });
      router.replace(`/manage/${token}`);
      return;
    }
    const e = toApiError(r.error);
    if (!applyFieldErrors(e, form.setError)) form.setError('root', { message: e.message });
  });
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <TextField label="Full name" autoComplete="name" error={form.formState.errors.guestName?.message} {...form.register('guestName')} />
      <TextField label="Email" type="email" autoComplete="email" error={form.formState.errors.guestEmail?.message} {...form.register('guestEmail')} />
      <TextField label="Phone" type="tel" autoComplete="tel" error={form.formState.errors.guestPhone?.message} {...form.register('guestPhone')} />
      <FormError message={form.formState.errors.root?.message ?? null} />
      <Button type="submit" disabled={disabled || form.formState.isSubmitting}>
        Confirm booking
      </Button>
    </form>
  );
};
