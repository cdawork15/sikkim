import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

async function checkPage(page: import('@playwright/test').Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const failures = await page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: { run: () => Promise<{ violations: { id: string }[] }> };
      }
    ).axe;
    return (await axe.run()).violations.map((item) => item.id);
  });
  expect(failures).toEqual([]);
}

test('essentials opens separate, accessible pages on every screen size', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/essentials');
  await expect(
    page.getByRole('heading', { name: 'Travel essentials.' }),
  ).toBeVisible();
  await expect(page.locator('.essentials-panel')).toHaveCount(0);
  await expect(page.locator('main input')).toHaveCount(0);
  await checkPage(page);
  await page.screenshot({
    path: test.info().outputPath('essentials-hub.png'),
    fullPage: true,
  });
  await page.locator('main').focus();
  for (const [id, label] of [
    ['permits', 'Permits'],
    ['transport', 'Taxis & transport'],
    ['bookings', 'My bookings'],
    ['help', 'Help & contacts'],
    ['updates', 'Travel updates'],
    ['before-you-go', 'Before you travel'],
  ] as const) {
    const link = page
      .locator('main')
      .getByRole('link', { name: new RegExp(label) });
    await expect(
      page.getByRole('heading', { name: 'Travel essentials.' }),
    ).toBeVisible();
    await expect(page.locator('main')).toBeFocused();
    await expect(link).toBeVisible();
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp('/essentials/' + id + '$'));
    await expect(
      page.getByRole('heading', { name: label, level: 1, exact: true }),
    ).toBeVisible();
    await expect(page.locator('main')).toBeFocused();
    await expect(page).toHaveTitle(label + ' — Sikkim Experiences');
    await expect(
      page
        .getByRole('navigation', { name: 'Main navigation' })
        .getByRole('link', { name: 'Essentials', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await checkPage(page);
    if (id === 'permits') {
      await expect(
        page.getByRole('link', {
          name: 'Official permit guidance',
          exact: false,
        }),
      ).toHaveAttribute('href', /^https:\/\/www\.sikkim\.gov\.in\//);
      await page.mouse.click(0, 0);
      await page.screenshot({
        path: test.info().outputPath('essentials-permits.png'),
        fullPage: true,
      });
    }
    if (id === 'help')
      await expect(
        page.getByRole('link', { name: 'Call emergency assistance on 112' }),
      ).toHaveAttribute('href', 'tel:112');
    await page.reload();
    await expect(
      page.getByRole('heading', { name: label, level: 1, exact: true }),
    ).toBeVisible();
    await page
      .getByRole('link', { name: 'All essentials', exact: true })
      .click();
    await expect(page).toHaveURL(/\/essentials$/);
  }
  await page.goto('/essentials/missing-guide');
  await expect(
    page.getByRole('heading', { name: 'This guide isn’t available.' }),
  ).toBeVisible();
  await page
    .getByRole('navigation', { name: 'More essentials' })
    .getByRole('link', { name: 'Permits', exact: true })
    .click();
  await page.goBack();
  await expect(
    page.getByRole('heading', { name: 'This guide isn’t available.' }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('retired planner links recover without deleting existing local data', async ({
  page,
  context,
}) => {
  await page.goto('/community');
  await page.waitForFunction(() =>
    localStorage.getItem('sikkim:community-trips:v1'),
  );
  const legacy = [{ id: 'old-trip', title: 'My old plan', days: [] }];
  await page.evaluate((trips) => {
    const key = 'sikkim:community-trips:v1';
    const state = JSON.parse(localStorage.getItem(key)!);
    state.trips = trips;
    localStorage.setItem(key, JSON.stringify(state));
  }, legacy);
  for (const path of [
    '/my-trip',
    '/my-trip/new?days=3',
    '/my-trip/samples/pakyong-culture',
    '/my-trip/old-trip',
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/essentials$/);
    await expect(
      page.getByRole('heading', { name: 'Travel essentials.' }),
    ).toBeVisible();
  }
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('sikkim:community-trips:v1')!).trips,
    ),
  ).toEqual(legacy);
  await context.setOffline(true);
  await page
    .getByRole('navigation', { name: 'Travel essentials sections' })
    .getByRole('link', { name: /Permits/ })
    .click();
  await expect(page).toHaveURL(/\/essentials\/permits$/);
  await expect(
    page.getByRole('heading', { name: 'Permits', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/External websites need an internet connection/),
  ).toBeVisible();
});

test('demo tickets and saved ideas remain separate and survive reload', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'sikkim:demo-bookings:v1',
      JSON.stringify([
        {
          reference: 'DEMO-11111111-1111-4111-8111-111111111111',
          experienceId: 'first-light',
          date: '2030-11-12',
          time: '06:00',
          participants: 1,
          createdAt: '2026-11-11T00:00:00Z',
        },
      ]),
    );
  });
  await page.goto('/essentials/bookings');
  await page
    .getByRole('link', { name: /Chase the first light.*Demo ticket/ })
    .click();
  await expect(
    page.getByRole('heading', { name: 'You’re in. Just for practice.' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Save experience', exact: true })
    .click();
  await page.getByRole('link', { name: /^Saved experiences/ }).click();
  await expect(page).toHaveURL(/\/saved$/);
  await page.reload();
  await expect(page.locator('.experience-card')).toHaveCount(1);
  await page.goBack();
  await expect(
    page.getByRole('heading', { name: 'You’re in. Just for practice.' }),
  ).toBeVisible();
});
