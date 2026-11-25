import { expect, test } from '@playwright/test';
import { addDays, api, bookViaApi, bookingIdByCode, createWorld } from './support';

test('cancelling after the free deadline shows the penalty first and puts it on the guest account once', async ({ page }) => {
  const w = await createWorld({ auditTime: '23:58', standardRooms: 2, label: 'cancel' });
  const b = await bookViaApi(w, w.standard.id, addDays(w.today, 1), addDays(w.today, 3));
  await page.goto(`/manage/${b.token}`);
  await expect(page.getByTestId('cancel-preview')).toContainText('Cancelling now costs €100.00');
  await page.getByTestId('cancel').click();
  await page.getByTestId('confirm-cancel').click();
  await expect(page.getByTestId('booking-status')).toHaveText('cancelled');
  await expect(page.getByText('Penalty charged: €100.00')).toBeVisible();

  const id = await bookingIdByCode(w, b.code);
  const folio = await api<{ balance: number; lines: { category: string; amount: number }[] }>('GET', `/api/bookings/${id}/folio`, w.adminToken);
  expect(folio.body.lines.filter((l) => l.category === 'penalty')).toHaveLength(1);
  expect(folio.body.balance).toBe(10_000);
});
