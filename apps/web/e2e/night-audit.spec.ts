import { expect, test, type Page } from '@playwright/test';
import { addDays, api, auditSoon, bookViaApi, bookingIdByCode, createWorld, PASSWORD, uiLogin, type World } from './support';

const openBooking = async (page: Page, w: World, code: string): Promise<void> => {
  await page.goto(`/staff/frontdesk?hotel=${w.hotelId}`);
  await page.getByLabel('Search').fill(code);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: code }).click();
  await expect(page.getByTestId('status')).toBeVisible();
};

test('front desk: assign, check in, night audit charges the night, pay, check out; room goes to housekeeping and back to sale; a no-show is penalised', async ({ page, browser }) => {
  const w = await createWorld({ auditTime: auditSoon(), standardRooms: 2, label: 'audit' });
  const stay = await bookViaApi(w, w.standard.id, w.today, addDays(w.today, 2));
  const noShow = await bookViaApi(w, w.standard.id, w.today, addDays(w.today, 1));
  const maid = `maid-${w.hotelId.slice(0, 6)}@e2e.test`;
  const created = await api<{ id: string }>('POST', '/api/admin/staff', w.adminToken, { email: maid, name: 'E2E Maid', password: PASSWORD, roles: [{ hotelId: w.hotelId, role: 'housekeeper' }] });
  expect(created.status).toBe(201);
  for (const room of w.standard.rooms) await api('PUT', `/api/rooms/${room.id}/housekeeper`, w.adminToken, { housekeeperId: created.body.id });

  await uiLogin(page, 'chain-admin@hotels.test');
  await openBooking(page, w, stay.code);
  await page.getByTestId(`room-${w.standard.rooms[0].number}`).click();
  await page.getByTestId('check-in').click();
  await expect(page.getByTestId('status')).toHaveText('checked_in');

  // the night audit runs by itself at the hotel's audit time: one room night is charged, the no-show is marked
  const noShowId = await bookingIdByCode(w, noShow.code);
  await expect
    .poll(async () => (await api<{ status: string }>('GET', `/api/bookings/${noShowId}`, w.adminToken)).body.status, { timeout: 170_000, intervals: [3000] })
    .toBe('no_show');
  const noShowFolio = await api<{ lines: { category: string; amount: number }[] }>('GET', `/api/bookings/${noShowId}/folio`, w.adminToken);
  expect(noShowFolio.body.lines.filter((l) => l.category === 'penalty')).toEqual([expect.objectContaining({ amount: 10_000 })]);

  await openBooking(page, w, stay.code);
  await expect(page.getByTestId('balance')).toContainText('€100.00');
  // paying the balance and checking out early (one night is still unused)
  await page.getByLabel('Type').selectOption('payment');
  await page.getByLabel('Category').selectOption('card');
  await page.getByLabel('Amount (EUR)').fill('100');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('balance')).toContainText('€0.00');
  await page.getByTestId('check-out').click();
  await expect(page.getByTestId('status')).toHaveText('checked_out');

  // the room is dirty and in the housekeeper's list; she cleans it on a phone, the head inspects it
  const phone = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const mobile = await phone.newPage();
  await uiLogin(mobile, maid);
  await mobile.goto(`/staff/housekeeping?hotel=${w.hotelId}`);
  const card = mobile.getByTestId(`room-${w.standard.rooms[0].number}`);
  await expect(card).toContainText('dirty');
  expect(await mobile.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  const clean = card.getByRole('button', { name: 'Mark clean' });
  expect((await clean.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
  await clean.click();
  await expect(card).toContainText('clean');
  await phone.close();

  await page.goto(`/staff/housekeeping?hotel=${w.hotelId}`);
  await page.getByTestId(`room-${w.standard.rooms[0].number}`).getByRole('button', { name: /Inspected/ }).click();
  await expect(page.getByTestId(`room-${w.standard.rooms[0].number}`)).toContainText('inspected');

  // available for the next guest again
  const next = await bookViaApi(w, w.standard.id, addDays(w.today, 1), addDays(w.today, 2));
  await openBooking(page, w, next.code);
  await expect(page.getByTestId(`room-${w.standard.rooms[0].number}`)).toContainText('inspected');
});
