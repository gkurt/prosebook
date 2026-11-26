import { expect, test } from '@playwright/test';
import { copy } from 'prosebook/test';

// Every text is found by key, so the catalog's words can change without a test changing with them.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('names the shop and greets the shopper', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(copy.t('app.title'));
  // The name is the app's to choose: any name matches.
  await expect(page.getByRole('heading', { name: copy.match('app.greeting') })).toBeVisible();
});

test('counts the cart as it changes', async ({ page }) => {
  await expect(page.getByText(copy.match('cart.items', { count: 2 }))).toBeVisible();
  await page.getByRole('button', { name: copy.t('cart.add') }).click();
  await expect(page.getByText(copy.match('cart.items', { count: 3 }))).toBeVisible();
  await expect(page.getByText(copy.match('cart.total', { amount: 13.5 }))).toBeVisible();
  await page.getByRole('button', { name: copy.t('cart.remove') }).click();
  await expect(page.getByText(copy.match('cart.items', { count: 0 }))).toBeVisible();
  await expect(page.getByRole('button', { name: copy.t('cart.checkout') })).toBeDisabled();
});

test('says how long delivery takes at the speed chosen', async ({ page }) => {
  await expect(page.getByText(copy.match('cart.shipping', { speed: 'standard' }))).toBeVisible();
  await page.getByLabel(copy.t('cart.express')).check();
  await expect(page.getByText(copy.match('cart.shipping', { days: 1, speed: 'express' }))).toBeVisible();
});

test('reads German once switched', async ({ page }) => {
  const de = copy.in('de');
  await page.getByRole('combobox').selectOption('de');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(de.t('app.title'));
  await expect(page.getByText(de.match('cart.items', { count: 2 }))).toBeVisible();
  await expect(page.getByRole('button', { name: de.t('cart.checkout') })).toBeVisible();
});

test('finds text a few characters off with a distance', async ({ page }) => {
  // A page built from a catalog a little older or newer than the test's: here, its words edited in place.
  const checkout = page.getByRole('button', { name: copy.t('cart.checkout') });
  await checkout.evaluate((button) => {
    button.textContent = button.textContent.replace(' ', '');
  });
  await expect(page.getByRole('button', { name: copy.match('cart.checkout') })).toHaveCount(0);
  await expect(page.getByRole('button', { name: copy.match('cart.checkout', {}, { distance: 1 }) })).toBeVisible();

  const items = page.getByText(copy.match('cart.items', { count: 2 }));
  await items.evaluate((p) => {
    p.textContent = p.textContent.replace('your cart', 'the cart');
  });
  await expect(page.getByText(copy.match('cart.items', { count: 2 }, { distance: 2 }))).toHaveCount(0);
  await expect(page.getByText(copy.match('cart.items', { count: 2 }, { distance: 4 }))).toBeVisible();
});
