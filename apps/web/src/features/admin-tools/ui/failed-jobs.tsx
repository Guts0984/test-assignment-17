'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api, call } from '@/shared/api';
import { Button, Card, FormError } from '@/shared/ui';
import { toApiError, useAction } from '@/shared/lib';

/** Jobs that used up their attempts. The administrator can run them again by hand. */
export const FailedJobs = (): ReactNode => {
  const queryClient = useQueryClient();
  const jobs = useQuery({ queryKey: ['failed-jobs'], queryFn: () => call(api.GET('/api/admin/jobs/failed')), refetchInterval: 5000 });
  const action = useAction();
  return (
    <Card>
      <h2 className="mb-2 text-lg font-semibold">Failed background jobs</h2>
      <FormError message={action.error ?? (jobs.error ? toApiError(jobs.error).message : null)} />
      {jobs.data?.jobs.length === 0 ? <p className="text-slate-600">Nothing failed.</p> : null}
      <ul className="divide-y divide-slate-100" data-testid="failed-jobs">
        {jobs.data?.jobs.map((j) => (
          <li key={`${j.queue}:${j.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="text-sm">
              <strong>{j.queue}</strong> · {j.name} · {j.id} · {j.attemptsMade} attempts
              <div className="text-red-700">{j.failedReason}</div>
            </div>
            <Button variant="ghost" disabled={action.busy} onClick={() => void action.run(() => api.POST('/api/admin/jobs/{queue}/{jobId}/retry', { params: { path: { queue: j.queue, jobId: j.id } } }), () => queryClient.invalidateQueries({ queryKey: ['failed-jobs'] }))}>
              Run again
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
};
