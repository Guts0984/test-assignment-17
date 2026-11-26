import { expect, test } from '@playwright/test';
import { addDays, bookViaApi, createWorld, uiLogin } from './support';

test('the revenue manager opens the 60-day grid, sees a sold night, and a booking made elsewhere appears without a reload', async ({ page }) => {
  const w = await createWorld({ auditTime: '23:58', standardRooms: 3, label: 'grid' });
  await uiLogin(page, 'chain-admin@hotels.test');
  await page.goto(`/staff/revenue?hotel=${w.hotelId}`);
  const night = addDays(w.today, 3);
  const cell = page.getByTestId(`cell-Standard-${night}`);
  await expect(page.getByTestId('grid')).toBeVisible();
  await expect(cell).toContainText('sold 0');
  await bookViaApi(w, w.standard.id, night, addDays(night, 1));
  await expect(cell).toContainText('sold 1'); // pushed over the socket, no reload
});
