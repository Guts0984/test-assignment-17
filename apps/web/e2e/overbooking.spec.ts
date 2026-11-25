import { expect, test } from '@playwright/test';
import { addDays, bookViaApi, createWorld, stubSend, uiLogin } from './support';

test('a channel booking on a sold night is accepted as overbooking, shown to the front desk, and upgraded at check-in', async ({ page }) => {
  const w = await createWorld({ auditTime: '23:58', standardRooms: 1, upperRooms: 1, label: 'overbooking' });
  const web = await bookViaApi(w, w.standard.id, w.today, addDays(w.today, 1));
  const sent = await stubSend({ hotelId: w.hotelId, roomTypeId: w.standard.id, checkIn: w.today, checkOut: addDays(w.today, 1), count: 1 });
  expect(sent.status).toBeLessThan(300);

  await uiLogin(page, 'chain-admin@hotels.test');
  await page.goto(`/staff/frontdesk?hotel=${w.hotelId}&view=overbooked`);
  // the channel event is applied by the worker after the api answered 202: reload until the booking is listed
  const channelBooking = page.getByRole('link').filter({ hasText: /^BK/ }).first();
  await expect(async () => {
    await page.reload();
    await expect(channelBooking).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 60_000 });
  await expect(page.getByText(web.code)).toHaveCount(0);
  await channelBooking.click();

  await expect(page.getByTestId('overbooking-notice')).toBeVisible();
  await page.getByTestId(`room-${w.upper.rooms[0].number}`).click();
  await expect(page.getByTestId('overbooking-notice')).toHaveCount(0);
  await page.getByTestId('check-in').click();
  await expect(page.getByTestId('status')).toHaveText('checked_in');
});
