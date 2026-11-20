import { expect, test, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

async function checkScreen(page: Page, name: string) {
  await page.locator('img').evaluateAll(async (images) => {
    await Promise.all(
      images.map(async (img) => {
        if (!(img instanceof HTMLImageElement)) return;
        img.loading = 'eager';
        await img.decode().catch(() => {});
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
    const axe = (
      window as unknown as {
        axe: {
          run: () => Promise<{
            violations: { id: string; nodes: { target: string[] }[] }[];
          }>;
        };
      }
    ).axe;
    return (await axe.run()).violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map((node) => node.target),
    }));
  });
  expect(violations).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: test.info().outputPath(`${name}.png`),
    fullPage: true,
  });
}

async function confirm(page: Page) {
  await page.getByRole('radio', { name: '06:00 4 places left' }).check();
  await page.getByRole('button', { name: 'Confirm demo booking' }).click();
  await expect(
    page.getByRole('heading', { name: 'You’re in. Just for practice.' }),
  ).toBeVisible();
}

test('Home to details to a persistent demo ticket', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page
    .getByRole('link', { name: 'Chase the first light', exact: true })
    .first()
    .click();
  await page.getByRole('button', { name: 'Show photo 2' }).click();
  await expect(
    page.getByRole('button', { name: 'Show photo 2' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Show photo 1' }).click();
  await page.getByText('Before you go', { exact: true }).click();
  await page.getByText('Cancellation rules', { exact: true }).click();
  await checkScreen(page, 'details');
  await page.getByRole('link', { name: 'Choose a date' }).click();
  await page.getByRole('radio', { name: '06:00 4 places left' }).check();
  await page.getByRole('button', { name: 'Add one person' }).click();
  await expect(page.locator('.price-summary strong')).toHaveText('₹1,300');
  await checkScreen(page, 'booking');
  await page.getByRole('button', { name: 'Confirm demo booking' }).click();
  const ticketURL = page.url();
  await expect(
    page.getByAltText(
      'QR code containing the demo ticket text; not valid for entry',
    ),
  ).toBeVisible();
  await checkScreen(page, 'ticket');
  await page.reload();
  await expect(page).toHaveURL(ticketURL);
  await expect(page.locator('.ticket-facts')).toContainText('₹1,300');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download demo ticket' }).click();
  expect((await download).suggestedFilename()).toMatch(/^DEMO-.*\.txt$/);
  await page.getByRole('button', { name: 'Save experience' }).click();
  await expect(
    page.getByRole('button', { name: 'Saved to your ideas', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('link', { name: 'View sample area on Google Maps' }),
  ).toHaveAttribute('href', /Pakyong/);
  expect(errors).toEqual([]);
});

test('full dates, unavailable times and invalid group sizes cannot be booked', async ({
  page,
}) => {
  await page.goto('/experiences/first-light/book');
  await page.getByRole('button', { name: 'Confirm demo booking' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Choose an available date and time',
  );
  await page.locator('input[name="date"]').nth(1).check();
  for (const radio of await page.locator('input[name="time"]').all())
    await expect(radio).toBeDisabled();
  await page.locator('input[name="date"]').nth(2).check();
  await expect(
    page.getByRole('status').filter({ hasText: 'No places' }),
  ).toContainText('No places');
  for (const radio of await page.locator('input[name="time"]').all())
    await expect(radio).toBeDisabled();
  await page.locator('input[name="date"]').first().check();
  await page.getByRole('radio', { name: '09:00 2 places left' }).check();
  for (const value of ['0', '-1', '1.5', '', '3']) {
    await page.getByLabel('How many people?').fill(value);
    await page.getByRole('button', { name: 'Confirm demo booking' }).click();
    await expect(page.getByRole('alert')).not.toBeEmpty();
    await expect(page).toHaveURL(/\/book$/);
  }
  await page.getByLabel('How many people?').fill('2');
  await page.getByRole('button', { name: 'Confirm demo booking' }).click();
  await expect(
    page.getByRole('heading', { name: 'You’re in. Just for practice.' }),
  ).toBeVisible();
});

test('storage refusal keeps the ticket usable for this visit', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Denied', 'SecurityError');
    };
  });
  await page.goto('/experiences/momo-table/book');
  await confirm(page);
  await expect(
    page.getByText('Your browser could not save this ticket.', {
      exact: false,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', {
      name: 'This demo ticket isn’t on this browser.',
    }),
  ).toBeVisible();
});

test('sharing denied falls back to copyable text and loaded booking works offline', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('Denied');
        },
      },
    });
  });
  await page.goto('/experiences/first-light/book');
  await context.setOffline(true);
  await confirm(page);
  await page.getByRole('button', { name: 'Share demo ticket' }).click();
  await expect(page.getByLabel('Copy your demo ticket')).toHaveValue(
    /Not a real reservation/,
  );
  await expect(page.getByLabel('Copy your demo ticket')).toHaveValue(
    /\/experiences\/first-light/,
  );
  await context.setOffline(false);
});

test('broken ticket data and unknown links recover cleanly', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem('sikkim:demo-bookings:v1', '{broken'),
  );
  await page.goto('/demo-bookings/missing');
  await expect(
    page.getByRole('link', { name: 'Browse experiences', exact: true }),
  ).toBeVisible();
  await page.goto('/experiences/missing/book');
  await expect(
    page.getByRole('heading', { name: 'We couldn’t find this experience.' }),
  ).toBeVisible();
  await page.goto('/experiences/first-light/book');
  await confirm(page);
});

test('keyboard booking, repeated submit and clipboard sharing', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as unknown as { copiedTicket: string }).copiedTicket = text;
        },
      },
    });
  });
  await page.goto('/experiences/first-light/book');
  const morning = page.getByRole('radio', { name: '06:00 4 places left' });
  await morning.focus();
  await page.keyboard.press('Space');
  await expect(morning).toBeChecked();
  await page.locator('form').evaluate((form) => {
    (form as HTMLFormElement).requestSubmit();
    (form as HTMLFormElement).requestSubmit();
  });
  await expect(
    page.getByRole('heading', { name: 'You’re in. Just for practice.' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('sikkim:demo-bookings:v1')!).length,
    ),
  ).toBe(1);
  await page.getByRole('button', { name: 'Share demo ticket' }).click();
  await expect(
    page.getByText('Demo ticket copied. Paste it into a message to share.'),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { copiedTicket: string }).copiedTicket,
    ),
  ).toContain('Not valid for entry');
});
