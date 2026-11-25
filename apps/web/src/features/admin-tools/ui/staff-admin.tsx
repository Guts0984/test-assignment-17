'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { roleSchema } from '@hotel/shared';
import { z } from 'zod';
import { useHotels } from '@/entities/hotel';
import { api, call } from '@/shared/api';
import { Button, Card, FormError, TextField } from '@/shared/ui';
import { applyFieldErrors, toApiError } from '@/shared/lib';

const formSchema = z.object({
  email: z.string().trim().email('Enter a valid e-mail'),
  name: z.string().trim().min(2, 'Enter a name'),
  password: z.string().min(8, 'At least 8 characters'),
  hotelId: z.string().uuid('Choose a hotel'),
  role: roleSchema,
});
type Values = z.infer<typeof formSchema>;

export const StaffAdmin = (): ReactNode => {
  const queryClient = useQueryClient();
  const hotels = useHotels();
  const staff = useQuery({ queryKey: ['staff'], queryFn: () => call(api.GET('/api/admin/staff')) });
  const form = useForm<Values>({ resolver: zodResolver(formSchema), defaultValues: { email: '', name: '', password: '', hotelId: '', role: 'frontdesk' } });
  const submit = form.handleSubmit(async (v) => {
    const r = await api.POST('/api/admin/staff', { body: { email: v.email, name: v.name, password: v.password, roles: [{ hotelId: v.hotelId, role: v.role }] } });
    if (r.data) {
      form.reset();
      return queryClient.invalidateQueries({ queryKey: ['staff'] });
    }
    const e = toApiError(r.error);
    if (!applyFieldErrors(e, form.setError)) form.setError('root', { message: e.message });
  });
  return (
    <Card>
      <h2 className="mb-2 text-lg font-semibold">Staff and roles</h2>
      <ul className="mb-3 max-h-56 divide-y divide-slate-100 overflow-auto text-sm" data-testid="staff-list">
        {staff.data?.staff.map((s) => (
          <li key={s.id} className="py-1">
            {s.name} · {s.email} · {s.roles.map((r) => `${r.role}${r.hotelId ? '' : ' (chain)'}`).join(', ')}
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="grid gap-2 sm:grid-cols-3 sm:items-end" noValidate>
        <TextField label="E-mail" type="email" error={form.formState.errors.email?.message} {...form.register('email')} />
        <TextField label="Name" error={form.formState.errors.name?.message} {...form.register('name')} />
        <TextField label="Password" type="password" error={form.formState.errors.password?.message} {...form.register('password')} />
        <div className="flex flex-col gap-1">
          <label htmlFor="staff-hotel" className="text-sm font-medium">Hotel</label>
          <select id="staff-hotel" className="rounded border border-slate-300 px-3 py-2" {...form.register('hotelId')}>
            <option value="">Choose…</option>
            {hotels.data?.map((h) => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
          {form.formState.errors.hotelId ? <p role="alert" className="text-sm text-red-600">{form.formState.errors.hotelId.message}</p> : null}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="staff-role" className="text-sm font-medium">Role</label>
          <select id="staff-role" className="rounded border border-slate-300 px-3 py-2" {...form.register('role')}>
            {roleSchema.options.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={form.formState.isSubmitting}>Add staff member</Button>
      </form>
      <FormError message={form.formState.errors.root?.message ?? null} />
    </Card>
  );
};
