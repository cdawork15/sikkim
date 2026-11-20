import { test, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
async function check(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const violations = await page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: { run: () => Promise<{ violations: { id: string }[] }> };
      }
    ).axe;
    return (await axe.run()).violations.map((v) => v.id);
  });
  expect(violations).toEqual([]);
  await page.screenshot({
    path: test.info().outputPath(`${name}.png`),
    fullPage: true,
  });
}

test('all five hosts can be found, opened and linked back to their experiences', async ({
  page,
}) => {
  await page.goto('/explore?view=list');
  await page.getByRole('link', { name: 'Meet the hosts', exact: true }).click();
  await expect(page.locator('.host-card')).toHaveCount(5);
  await check(page, 'host-directory');
  for (const [category, name] of [
    ['hiking', 'Tashi'],
    ['culture', 'Pema'],
    ['food', 'Doma'],
    ['nature', 'Sonam'],
    ['wellness', 'Mingma'],
  ]) {
    await page.goto(`/hosts/${category}`);
    await expect(
      page.getByRole('heading', { name: `Meet ${name}`, exact: true }),
    ).toBeVisible();
    await expect(page.locator('.host-introduction')).toContainText(
      'This is an example profile',
    );
    await check(page, `host-${category}`);
    await page.locator('.experience-card .card-image a').first().click();
    await page.getByRole('link', { name: `Meet ${name}`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/hosts/${category}$`));
  }
  await page.goto('/hosts/missing');
  await expect(
    page.getByRole('heading', {
      name: 'This host profile is unavailable.',
    }),
  ).toBeVisible();
});
