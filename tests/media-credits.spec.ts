import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

test('browsing stays clear and bundled media sources remain accessible', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.catalogue-label')).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'About our media', exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('.footer-media')).toHaveCount(0);
  if ((page.viewportSize()?.width ?? 0) <= 680) {
    await expect(page.locator('.site-footer')).toBeHidden();
  }
  await page.goto('/credits');
  await expect(
    page.getByRole('heading', { name: 'About our media' }),
  ).toBeVisible();
  await expect(page.locator('.media-source-list li')).toHaveCount(3);
  await expect(
    page.getByRole('link', { name: 'Full bundled footage credits' }),
  ).toHaveAttribute('href', '/videos/CREDITS.txt');
  await page.reload();
  await expect(page.locator('.media-source-list li')).toHaveCount(3);
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
  await page.goto('/explore');
  await expect(page.getByText('Footage credit', { exact: true })).toHaveCount(
    0,
  );
  await page
    .getByRole('link', { name: 'About this media', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'About our media' }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.locator('.reels-page')).toBeVisible();
  await page.goto('/essentials');
  await expect(page.getByText('Photo credit', { exact: true })).toHaveCount(0);
});
