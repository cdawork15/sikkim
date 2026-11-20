import { expect, test, type Page } from '@playwright/test';
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
  const failures = await page.evaluate(async () => {
    const engine = (
      window as unknown as {
        axe: {
          run: () => Promise<{
            violations: { id: string; nodes: { target: string[] }[] }[];
          }>;
        };
      }
    ).axe;
    return (await engine.run()).violations.map((v) => ({
      id: v.id,
      targets: v.nodes.map((n) => n.target),
    }));
  });
  expect(failures).toEqual([]);
  await page.screenshot({
    path: test.info().outputPath(`${name}.png`),
    fullPage: true,
  });
}
async function createEvent(page: Page) {
  await page.goto('/community/create');
  await page.getByLabel('Title', { exact: true }).fill('Tea with new friends');
  await page
    .getByLabel('What will people do?')
    .fill('Share tea and stories with a small group of travellers.');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Area', { exact: true }).fill('Pakyong');
  await page.getByLabel('Public meeting point').fill('Sample public square');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Maximum participants').fill('6');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Save event on this device' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your event is saved on this device' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Manage event' }).click();
}
test('community filters, stories, saves, full events and approval', async ({
  page,
}) => {
  await page.goto('/community');
  await check(page, 'community');
  await page.getByRole('link', { name: 'Story from Tashi' }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Sunset tea',
  );
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('link', { name: 'View event', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Sunset tea on the ridge', exact: true }),
  ).toBeVisible();
  await page.goto('/community?tab=Popular');
  await page
    .getByRole('button', {
      name: 'Save event A little clay, a little creativity',
      exact: true,
    })
    .click();
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  await expect(page.locator('.event-card')).toHaveCount(1);
  await page
    .getByRole('link', {
      name: 'A little clay, a little creativity',
      exact: true,
    })
    .click();
  await page.getByRole('button', { name: 'Join waiting list' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'waiting list' }),
  ).toContainText('waiting list');
  await page.goto('/community/events/community-5');
  await page.getByRole('button', { name: 'Request to join' }).click();
  await page.getByRole('button', { name: 'Simulate host approval' }).click();
  await expect(
    page.getByRole('link', { name: 'Open group chat' }),
  ).toBeVisible();
  await page.goto('/community/events/community-2');
  await page.getByRole('button', { name: 'Try joining' }).click();
  await page.getByRole('button', { name: 'Continue without payment' }).click();
  await expect(
    page.getByRole('link', { name: 'Open group chat' }),
  ).toBeVisible();
});
test('create, edit, persist and cancel an event', async ({ page }) => {
  await page.goto('/community/create');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('title');
  await createEvent(page);
  const url = page.url();
  await check(page, 'created-event');
  await page.getByRole('link', { name: 'Edit event' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Tea and local stories');
  for (let i = 0; i < 3; i++)
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Tea and local stories', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cancel event', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'cancelled' }),
  ).toContainText('cancelled');
  await page.goto(`${url}/chat`);
  await expect(
    page.getByRole('heading', { name: 'Join this event to open chat' }),
  ).toBeVisible();
  await page.goto('/community?tab=Created');
  await expect(page.locator('.event-card')).toHaveCount(1);
  await expect(page.locator('.event-badge')).toContainText('Cancelled');
});
test('participant chat persists and leaving removes access', async ({
  page,
}) => {
  await page.goto('/community/events/community-1/chat');
  await expect(
    page.getByRole('heading', { name: 'Join this event to open chat' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'View event', exact: true }).click();
  await page.getByRole('button', { name: 'Join free event' }).click();
  await page.getByRole('link', { name: 'Open group chat' }).click();
  await page
    .getByLabel('Message', { exact: true })
    .fill('Looking forward to the demo!');
  await page.getByRole('button', { name: 'Save message' }).click();
  await page.reload();
  await expect(page.getByRole('log')).toContainText(
    'Looking forward to the demo!',
  );
  await check(page, 'chat');
  await page.getByRole('link', { name: 'Back to event' }).click();
  await page.getByRole('button', { name: 'Leave event', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm leave' }).click();
  await page.goto('/community/events/community-1/chat');
  await expect(
    page.getByRole('heading', { name: 'Join this event to open chat' }),
  ).toBeVisible();
});

test('blocked storage, damaged data and unknown links recover', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem('sikkim:community-trips:v1', '{"trips":"broken"}'),
  );
  await page.goto('/community');
  await expect(
    page.getByRole('status').filter({ hasText: 'collection has been reset' }),
  ).toBeVisible();
  await page.goto('/community/events/missing');
  await expect(
    page.getByRole('heading', { name: 'Event not found' }),
  ).toBeVisible();
  await page.addInitScript(() =>
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('blocked');
      },
    }),
  );
  await page.goto('/community/events/community-1');
  await page.getByRole('button', { name: 'Join free event' }).click();
  await page.getByRole('link', { name: 'Open group chat' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Community changes' }),
  ).toBeVisible();
  await expect(page.getByLabel('Message', { exact: true })).toBeVisible();
});

test('loaded Community demo keeps chat usable offline', async ({
  page,
  context,
}) => {
  await page.goto('/community/events/community-1');
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Join free event' }).click();
  await page.getByRole('link', { name: 'Open group chat' }).click();
  await page.getByLabel('Message', { exact: true }).fill('Offline demo note');
  await page.getByRole('button', { name: 'Save message' }).click();
  await expect(page.getByRole('log')).toContainText('Offline demo note');
  await context.setOffline(false);
});

test('host manages requests, full capacity and waiting guests', async ({
  page,
}) => {
  await createEvent(page);
  await page
    .getByRole('button', { name: 'Simulate a guest joining', exact: true })
    .click({ clickCount: 1 });
  for (let i = 0; i < 6; i++)
    await page
      .getByRole('button', { name: 'Simulate a guest joining', exact: true })
      .click();
  const management = page.locator('.event-management');
  const waiting = management.locator('section').filter({
    has: page.getByRole('heading', { name: 'Waiting list', exact: true }),
  });
  await expect(waiting).toContainText('Sample guest 7');
  await page
    .getByRole('button', { name: 'Remove Sample guest 1', exact: true })
    .click();
  await expect(waiting).not.toContainText('Sample guest 7');
  await expect(management).toContainText('6 participants');
  await page.reload();
  await expect(management).toContainText('6 participants');
  await page.getByRole('link', { name: 'Edit event', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Ask the host to approve joining').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page
    .getByRole('button', { name: 'Simulate a join request', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Approve Sample guest 8', exact: true })
    .click();
  await expect(waiting).toContainText('Sample guest 8');
  await page.getByRole('button', { name: 'Try notifying everyone' }).click();
  await expect(management.getByRole('status')).toContainText(
    'No notification was sent',
  );
  await check(page, 'host-management');
});

test('expired saved events leave Upcoming but remain in saved history', async ({
  page,
}) => {
  await page.goto('/community');
  await page.waitForFunction(() =>
    localStorage.getItem('sikkim:community-trips:v1'),
  );
  const title = await page.evaluate(() => {
    const key = 'sikkim:community-trips:v1';
    const state = JSON.parse(localStorage.getItem(key)!);
    const event = state.events[1];
    event.date = '2000-01-01';
    state.saved = [event.id];
    localStorage.setItem(key, JSON.stringify(state));
    return event.title as string;
  });
  await page.reload();
  await expect(
    page.locator('.event-card').filter({ hasText: title }),
  ).toHaveCount(0);
  await expect(page.locator('.event-card')).toHaveCount(8);
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  await expect(
    page.locator('.event-card').filter({ hasText: title }),
  ).toHaveCount(1);
});
