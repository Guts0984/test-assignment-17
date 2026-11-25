import { expect, test } from '@playwright/test';
import { addDays, createWorld, stubState, workerLog } from './support';

test('guest finds a room, holds it, confirms, gets the email, and the channel sees less availability', async ({ page }) => {
  const w = await createWorld({ auditTime: '23:58', standardRooms: 3, label: 'guest' });
  const checkIn = addDays(w.today, 10);
  const checkOut = addDays(w.today, 12);
  await page.goto(`/?hotelId=${w.hotelId}&checkIn=${checkIn}&checkOut=${checkOut}&guests=2`);
  await expect(page.getByTestId('results')).toBeVisible();
  await expect(page.getByText('3 left')).toBeVisible();
  await page.getByTestId('book-Standard').click();

  await expect(page.getByTestId('countdown')).toContainText('Room held for');
  await page.getByLabel('Full name').fill('Anna Kowalska');
  await page.getByLabel('Email').fill('anna@example.test');
  // errors appear next to the field they belong to
  await page.getByLabel('Phone').fill('abc');
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(page.locator('#guestPhone-error')).toBeVisible();
  await page.getByLabel('Phone').fill('+351 912 345 678');
  await page.getByRole('button', { name: 'Confirm booking' }).click();

  await expect(page).toHaveURL(/\/manage\//);
  await expect(page.getByTestId('booking-status')).toHaveText('confirmed');
  const code = (await page.getByTestId('booking-code').innerText()).replace('Booking ', '').split(' ·')[0].trim();
  const manageUrl = page.url();

  // the email (logged by the worker) carries the number and the manage link
  await expect.poll(() => workerLog(3), { timeout: 60_000 }).toContain(manageUrl.split('/manage/')[1]);
  expect(workerLog(3)).toContain(code);

  // the channel stub sees one room less on the booked nights
  await expect
    .poll(async () => (await stubState()).roomTypes.find((r) => r.roomTypeId === w.standard.id)?.nights.find((n) => n.night === checkIn)?.available, { timeout: 60_000 })
    .toBe(2);

  // the link opens the booking again, with the cancellation preview
  await page.goto(manageUrl);
  await expect(page.getByTestId('cancel-preview')).toContainText('Free cancellation until');
});
