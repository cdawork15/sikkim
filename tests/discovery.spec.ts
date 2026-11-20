import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('guest entry, categories, saved ideas and browser reload', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/welcome');
  await page.getByRole('button', { name: 'Continue as guest' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Sunrise in the Himalayas',
  );
  await page.getByRole('button', { name: 'Food & drink', exact: true }).click();
  await expect(page.locator('.experience-card')).toHaveCount(5);
  await page
    .getByRole('button', {
      name: 'Save Meet you at the momo table',
      exact: true,
    })
    .click();
  await page.getByRole('link', { name: /^Saved experiences/ }).click();
  await page.reload();
  await expect(page.locator('.experience-card')).toHaveCount(1);
  await page
    .getByRole('button', {
      name: 'Unsave Meet you at the momo table',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Make room for a little wonder.' }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('responsive layout, contrast and minimum control targets', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .locator('.discovery-hero > img')
    .evaluate((image: HTMLImageElement) => image.decode());
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const targets = page.locator(
    '.main-nav a, .save-button, .category-chip, .feature-controls button, .guest-link, .header-save, .header-search',
  );
  for (const target of await targets.all()) {
    if (!(await target.isVisible())) continue;
    const box = await target.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }
  // The new prototype places filters over a tall, full-width hero.
  if (page.viewportSize()!.width <= 680) {
    const hero = await page.locator('.discovery-hero').boundingBox();
    const filters = await page.locator('.category-nav').boundingBox();
    expect(hero!.x).toBe(0);
    expect(hero!.width).toBe(page.viewportSize()!.width);
    expect(filters!.y).toBeGreaterThan(hero!.y);
    expect(filters!.y + filters!.height).toBeLessThan(hero!.y + hero!.height);
    await page.locator('.experience-card').first().scrollIntoViewIfNeeded();
    await expect(page.locator('.experience-card').first()).toBeInViewport();
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const violations = await page.evaluate(async () => {
    const engine = (
      window as unknown as {
        axe: {
          run: () => Promise<{
            violations: { id: string; nodes: { target: string[] }[] }[];
          }>;
        };
      }
    ).axe;
    return (await engine.run()).violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map((node) => node.target),
    }));
  });
  expect(violations).toEqual([]);
  await page.locator('img').evaluateAll(async (images) => {
    await Promise.all(
      images.map(async (image) => {
        if (!(image instanceof HTMLImageElement)) return;
        image.loading = 'eager';
        await image.decode();
      }),
    );
  });
  await page.screenshot({
    path: test.info().outputPath('home.png'),
    fullPage: true,
  });
});

test('keyboard navigation and reduced motion remain usable', async ({
  page,
  browserName,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(
    page.getByRole('link', { name: 'Skip to content' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await page.goto('/explore?category=culture');
  await expect(page.locator('.experience-card')).toHaveCount(4);
  await page
    .getByRole('searchbox', { name: 'Search experiences' })
    .fill('unfindable');
  await expect(
    page.getByRole('heading', { name: 'A different trail, perhaps?' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Clear all filters' }).click();
  await expect(page.locator('.experience-card')).toHaveCount(4);
});

test('category listing sorting, load-more and history', async ({ page }) => {
  await page.goto('/explore?view=list');
  await page.getByLabel('Sort experiences').selectOption('price-low');
  await expect(page.locator('.experience-card h3').first()).toHaveText(
    'Ram Ghauri Sangralaya visit',
  );
  await page.getByRole('button', { name: 'Load more experiences' }).click();
  await expect(page.locator('.experience-card')).toHaveCount(30);
  await page.getByRole('button', { name: 'Culture', exact: true }).click();
  await expect(page.locator('.experience-card')).toHaveCount(4);
  await page.goBack();
  await expect(page.locator('.experience-card')).toHaveCount(30);
});

for (const route of ['/welcome', '/explore?view=list']) {
  test(`P01 ${route} layout and accessibility`, async ({ page }) => {
    await page.goto(route);
    await page.locator('img').evaluateAll(async (images) => {
      await Promise.all(
        images.map(async (image) => {
          if (!(image instanceof HTMLImageElement)) return;
          image.loading = 'eager';
          await image.decode();
        }),
      );
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
    const violations = await page.evaluate(async () => {
      const engine = (
        window as unknown as {
          axe: { run: () => Promise<{ violations: { id: string }[] }> };
        }
      ).axe;
      return (await engine.run()).violations.map((item) => item.id);
    });
    expect(violations).toEqual([]);
    await page.screenshot({
      path: test.info().outputPath('screen.png'),
      fullPage: true,
    });
  });
}

test('featured banner rotates, wraps and supports dot selection', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/');
  const title = page.locator('.discovery-hero h1');
  await page.locator('.discovery-hero').hover();
  await page.clock.fastForward(3000);
  await expect(title).toHaveText('Monastery Heritage Trail');
  await expect(
    page.getByRole('button', { name: 'Show Monastery Heritage Trail' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.clock.fastForward(3000);
  await expect(title).toHaveText('Taste a little of Sikkim');
  await page.clock.fastForward(3000);
  await expect(title).toHaveText('Sunrise in the Himalayas');
  await page
    .getByRole('button', { name: 'Show Monastery Heritage Trail' })
    .click();
  await expect(title).toHaveText('Monastery Heritage Trail');
  await page.locator('.header-search').focus();
  await page.mouse.move(0, 0);
  await page.clock.fastForward(3000);
  await expect(title).toHaveText('Taste a little of Sikkim');
});

test('featured banner pauses for focus and respects reduced motion', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Show Sunrise in the Himalayas' })
    .focus();
  await page.clock.fastForward(10000);
  await expect(page.locator('.discovery-hero h1')).toHaveText(
    'Sunrise in the Himalayas',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.header-search').focus();
  await page.clock.fastForward(10000);
  await expect(page.locator('.discovery-hero h1')).toHaveText(
    'Sunrise in the Himalayas',
  );
  await expect(
    page.getByRole('button', { name: 'Pause featured slideshow' }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Show Monastery Heritage Trail' })
    .click();
  await expect(page.locator('.discovery-hero h1')).toHaveText(
    'Monastery Heritage Trail',
  );
});

test('Home navigation stays above the filters and curated ideas show verification notes', async ({
  page,
}) => {
  await page.goto('/');
  const filters = await page.locator('.category-nav').boundingBox();
  const header = await page.locator('.site-header').boundingBox();
  expect(filters!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
  await expect(
    page
      .getByRole('region', { name: 'Pakyong discoveries' })
      .locator('.experience-card'),
  ).toHaveCount(12);
  await page.goto('/experiences/first-pot-namcheybong');
  await expect(
    page.getByRole('heading', { name: 'Throw Your First Pot', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'District curation status' }),
  ).toContainText('Group and tourism arrangements');
  await expect(
    page.getByRole('region', { name: 'District curation status' }),
  ).toContainText('No provider is confirmed or bookable');
});
