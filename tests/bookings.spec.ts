import { expect, test, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const experienceId = '22222222-2222-4222-8222-222222222222';
const bookingId = '33333333-3333-4333-8333-333333333333';
const slotId = '44444444-4444-4444-8444-444444444444';
const nextSlotId = '55555555-5555-4555-8555-555555555555';
const holdId = '66666666-6666-4666-8666-666666666666';
const startsAt = new Date(Date.now() + 48 * 3600000).toISOString();
const endsAt = new Date(Date.now() + 49 * 3600000).toISOString();
const slot = {
  id: slotId,
  startsAt,
  endsAt,
  timezone: 'Asia/Kolkata',
  bookingDeadline: startsAt,
  capacity: 4,
  availablePlaces: 4,
  pricePaise: 0,
  currency: 'INR',
  cancellationHours: 2,
  rescheduleHours: 2,
  status: 'open',
  revision: 1,
};
const policy = {
  id: experienceId,
  version: 1,
  cancellation: 'Cancel before your date’s deadline.',
  safety: 'Follow your guide.',
  participation: 'Bring walking shoes.',
};
const experience = {
  id: experienceId,
  slug: 'forest-walk',
  title: 'Forest walk with tea',
  description: 'A quiet morning in the forest.',
  areaCode: 'pakyong',
  area: 'Pakyong',
  durationMinutes: 60,
  pricePaise: 0,
  currency: 'INR',
  accessibility: 'unknown',
  difficulty: 'easy',
  hostId: experienceId,
  hostName: 'Pema',
  featuredRank: null,
  categories: ['nature'],
  media: [],
  rating: null,
  availability: { status: 'available', bookable: true },
  meetingPoint: 'Village square',
  minParticipants: 1,
  maxParticipants: 4,
  inclusions: ['Tea'],
  exclusions: [],
  preparation: 'Bring water.',
  accessibilityNotes: '',
  hostStory: 'Local guide.',
  policy,
};
const snapshot = {
  ...experience,
  slug: experience.slug,
  feesPaise: 0,
  totalPaise: 0,
  policy: { ...policy, cancellationHours: 2, rescheduleHours: 2 },
};

async function fixture(
  page: Page,
  options: {
    loseConfirmation?: boolean;
    loseHold?: boolean;
    expiredHold?: boolean;
    host?: boolean;
    soldOut?: boolean;
  } = {},
) {
  const calls: { path: string; body: any; method: string }[] = [];
  let confirmationLost = false;
  let holdLost = false;
  let booking: any;
  let ticketStatus = 'issued';
  let selected = { ...slot };
  const user = {
    id: 'traveller-id',
    displayName: 'Pema',
    language: 'en',
    roles: options.host ? ['host'] : ['traveller'],
    isDemo: false,
    interests: [],
    preferences: {
      chosenArea: null,
      tripStart: null,
      tripDays: null,
      travellers: 1,
      pace: 'balanced',
      notificationsEnabled: false,
      showInParticipantList: false,
    },
  };
  await page.route('**/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.slice(3);
    const method = request.method();
    const body = request.postDataJSON();
    calls.push({ path, body, method });
    const error = (code: string, message: string, status = 409) =>
      route.fulfill({ status, json: { error: { code, message } } });
    let data: unknown;
    let pageCursor: null | undefined;
    if (path === '/auth/login')
      data = {
        accessToken: 'booking-test-session',
        expiresAt: new Date(Date.now() + 1800000).toISOString(),
        absoluteExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        user,
      };
    else if (path === '/settings')
      data = {
        auth: { mode: 'password' },
        privacy: { version: null, choices: [] },
        help: { contact: null },
        safety: { message: '' },
      };
    else if (path === '/me') data = user;
    else if (path === '/me/experience-actions') data = [];
    else if (path === '/catalogue/options')
      data = {
        areas: [],
        categories: [],
        dateFilteringAvailable: true,
        bookingAvailable: true,
      };
    else if (path === '/experiences/forest-walk') data = experience;
    else if (path === `/me/experiences/${experienceId}`)
      data = {
        ...experience,
        status: 'published',
        revision: 1,
        isDemo: false,
        history: [],
      };
    else if (
      path === `/me/experiences/${experienceId}/slots` &&
      method === 'POST'
    )
      data = { ...selected, ...body };
    else if (path.endsWith('/slots') && method === 'GET') {
      data = [
        selected,
        {
          ...slot,
          id: nextSlotId,
          startsAt: new Date(Date.parse(startsAt) + 86400000).toISOString(),
          endsAt: new Date(Date.parse(endsAt) + 86400000).toISOString(),
        },
      ];
      pageCursor = null;
    } else if (path === `/me/slots/${slotId}`) {
      if (method === 'PUT')
        selected = {
          ...selected,
          ...body,
          availablePlaces: body.capacity,
          revision: 2,
        };
      data = { ...selected, experienceId };
    } else if (path === `/me/slots/${slotId}/cancel`) {
      selected = { ...selected, status: 'cancelled', revision: 2 };
      data = selected;
    } else if (path === `/me/slots/${slotId}/bookings`) {
      data = booking ? [{ ...booking, contactName: 'Pema', ticketStatus }] : [];
      pageCursor = null;
    } else if (path === '/me/check-ins') {
      if (ticketStatus === 'checked_in')
        return error('TICKET_INVALID', 'This ticket has already been used.');
      ticketStatus = 'checked_in';
      data = { reference: 'SK-TEST', quantity: 1 };
    } else if (path === '/me/seat-holds') {
      if (options.soldOut)
        return error(
          'SOLD_OUT',
          'There are not enough places left. Choose another date.',
        );
      if (options.loseHold && !holdLost) {
        holdLost = true;
        return route.abort();
      }
      data = {
        id: holdId,
        slotId: body.slotId,
        quantity: body.quantity,
        expiresAt: new Date(
          Date.now() + (options.expiredHold ? 500 : 600000),
        ).toISOString(),
        status: 'active',
      };
    } else if (path.endsWith('/release'))
      data = { id: holdId, status: 'released' };
    else if (path === '/me/bookings' && method === 'POST') {
      booking ??= {
        id: bookingId,
        reference: 'SK-TEST',
        experienceId,
        quantity: body.guests.length,
        status: 'confirmed',
        revision: 1,
        slot: selected,
        contactName: body.contactName,
        contactEmail: body.contactEmail,
        guests: body.guests,
        totalPaise: 0,
        currency: 'INR',
        snapshot,
        history: [],
      };
      if (options.loseConfirmation && !confirmationLost) {
        confirmationLost = true;
        return route.abort();
      }
      data = booking;
    } else if (path === '/me/bookings') {
      const status = url.searchParams.get('status');
      data =
        booking && (status === 'cancelled') === (booking.status === 'cancelled')
          ? [
              {
                ...booking,
                title: experience.title,
                startsAt: booking.slot.startsAt,
                endsAt: booking.slot.endsAt,
                timezone: 'Asia/Kolkata',
              },
            ]
          : [];
      pageCursor = null;
    } else if (path === `/me/bookings/${bookingId}/cancel`) {
      booking = {
        ...booking,
        status: 'cancelled',
        revision: booking.revision + 1,
      };
      ticketStatus = 'revoked';
      data = booking;
    } else if (path === `/me/bookings/${bookingId}/reschedule`) {
      booking = {
        ...booking,
        revision: booking.revision + 1,
        slot: {
          ...slot,
          id: body.slotId,
          startsAt: new Date(Date.parse(startsAt) + 86400000).toISOString(),
          endsAt: new Date(Date.parse(endsAt) + 86400000).toISOString(),
        },
      };
      data = booking;
    } else if (path === `/me/bookings/${bookingId}/ticket`)
      data = {
        reference: 'SK-TEST',
        status: ticketStatus,
        verificationToken: ticketStatus === 'issued' ? 'a'.repeat(64) : null,
        shareText: 'Forest walk · Village square',
      };
    else if (path === `/me/bookings/${bookingId}`) {
      if (!booking)
        return error('NOT_FOUND', 'This booking is not available.', 404);
      data = booking;
    } else return error('NOT_FOUND', 'This endpoint is not available.', 404);
    return route.fulfill({
      status:
        method === 'POST' && ['/me/bookings', '/me/seat-holds'].includes(path)
          ? 201
          : 200,
      json: {
        data,
        ...(pageCursor !== undefined
          ? { page: { nextCursor: pageCursor } }
          : {}),
      },
    });
  });
  return calls;
}
async function signIn(page: Page, next = '/experiences/forest-walk/book') {
  await page.goto('/welcome?next=' + encodeURIComponent(next));
  await page.getByLabel('Email', { exact: true }).fill('pema@example.com');
  await page.getByLabel('Password', { exact: true }).fill('Trail#82');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(next);
}
async function holdPlaces(page: Page, quantity = 1) {
  await page.getByLabel('Number of people').fill(String(quantity));
  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Your places are reserved for now.' }),
  ).toBeVisible();
}
async function fillGuests(page: Page, quantity = 1) {
  await page.getByLabel('Contact email').fill('pema@example.com');
  for (let i = 1; i < quantity; i++)
    await page
      .getByLabel('Guest ' + (i + 1) + ' name')
      .fill('Guest ' + (i + 1));
  await page.getByRole('checkbox').check();
}
async function book(page: Page, quantity = 1) {
  await holdPlaces(page, quantity);
  await fillGuests(page, quantity);
  await page
    .getByRole('button', { name: 'Confirm free booking', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'You’re going.' }),
  ).toBeVisible();
}
async function navigate(page: Page, path: string) {
  await page.evaluate((path) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

test('free booking, private ticket, date change, cancellation and booking history', async ({
  page,
}, testInfo) => {
  const calls = await fixture(page);
  await signIn(page);
  await book(page, 2);
  await expect(
    page.getByAltText('Your private booking ticket QR code'),
  ).toBeVisible();
  await expect(
    page.getByText('2 people · Pema, Guest 2', { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('booking-ticket.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const violations = await page.evaluate(async () => {
    const result = await (window as any).axe.run();
    return result.violations.filter((item: any) =>
      ['serious', 'critical'].includes(item.impact),
    );
  });
  expect(violations).toEqual([]);
  await page.getByRole('button', { name: 'Change date', exact: true }).click();
  await page.getByRole('radio').last().check();
  await page.getByLabel('Reason', { exact: true }).fill('A better date');
  await page
    .getByRole('button', { name: 'Confirm new date', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Find another date.' }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Cancel booking', exact: true })
    .click();
  await page.getByLabel('Reason', { exact: true }).fill('Plans changed');
  await page
    .getByRole('button', { name: 'Yes, cancel booking', exact: true })
    .click();
  await expect(page.getByText('This ticket has been cancelled.')).toBeVisible();
  await expect(
    page.getByAltText('Your private booking ticket QR code'),
  ).toHaveCount(0);
  await page.getByRole('link', { name: 'My bookings', exact: true }).click();
  await page.getByRole('button', { name: 'Cancelled', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: experience.title }),
  ).toBeVisible();
  const confirmations = calls.filter(
    (call) => call.path === '/me/bookings' && call.method === 'POST',
  );
  expect(confirmations).toHaveLength(1);
  expect(confirmations[0]!.body.guests).toHaveLength(2);
});
test('a lost confirmation is retried with exactly the same details and hold', async ({
  page,
}) => {
  const calls = await fixture(page, { loseConfirmation: true });
  await signIn(page);
  await holdPlaces(page);
  await fillGuests(page);
  await page
    .getByRole('button', { name: 'Confirm free booking', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('reach the service');
  await expect(page.getByLabel('Contact email')).toBeDisabled();
  await page
    .getByRole('button', { name: 'Retry confirmation', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'You’re going.' }),
  ).toBeVisible();
  const requests = calls.filter(
    (call) => call.path === '/me/bookings' && call.method === 'POST',
  );
  expect(requests).toHaveLength(2);
  expect(requests[0]!.body).toEqual(requests[1]!.body);
});
test('a lost seat hold reuses its request key', async ({ page }) => {
  const calls = await fixture(page, { loseHold: true });
  await signIn(page);
  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Number of people')).toBeDisabled();
  await page
    .getByRole('button', { name: 'Retry reservation', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Your places are reserved for now.' }),
  ).toBeVisible();
  const requests = calls.filter((call) => call.path === '/me/seat-holds');
  expect(requests[0]!.body).toEqual(requests[1]!.body);
});
test('expired holds require a new date and sold-out errors never show a ticket', async ({
  page,
}) => {
  await fixture(page, { expiredHold: true });
  await signIn(page);
  await holdPlaces(page);
  await expect(
    page.getByRole('button', { name: 'Confirm free booking', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Change date or group', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Who’s coming?' }),
  ).toBeVisible();
});
test('a competing booking shows the sold-out response without confirming', async ({
  page,
}) => {
  const calls = await fixture(page, { soldOut: true });
  await signIn(page);
  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('not enough places');
  expect(
    calls.some(
      (call) => call.path === '/me/bookings' && call.method === 'POST',
    ),
  ).toBe(false);
});
test('host dates, capacity controls and check-in use private endpoints', async ({
  page,
}, testInfo) => {
  const calls = await fixture(page, { host: true });
  await signIn(page, '/hosting/experiences/' + experienceId + '/dates');
  await page.getByText('Add a date', { exact: true }).click();
  const start = new Date(Date.now() + 96 * 3600000).toISOString().slice(0, 16);
  const deadline = new Date(Date.now() + 90 * 3600000)
    .toISOString()
    .slice(0, 16);
  await page.getByLabel('Start date & time (IST)').fill(start);
  await page.getByLabel('Bookings close (IST)').fill(deadline);
  await page.getByRole('button', { name: 'Add date', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Date added' }),
  ).toContainText('Date added');
  await page
    .getByRole('link', { name: /Manage date & guests/ })
    .first()
    .click();
  await expect(
    page.getByRole('heading', { name: 'Ready to welcome your guests.' }),
  ).toBeVisible();
  await page.getByLabel('Places', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Save date settings' }).click();
  await expect(page.getByLabel('Places', { exact: true })).toHaveValue('3');
  await page.getByLabel('Ticket code', { exact: true }).fill('a'.repeat(64));
  await page.getByRole('button', { name: 'Check in group' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Checked in' }),
  ).toContainText('Checked in 1 person');
  await page.screenshot({
    path: testInfo.outputPath('booking-host.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    calls.find(
      (call) =>
        call.path === `/me/experiences/${experienceId}/slots` &&
        call.method === 'POST',
    )!.body.timezone,
  ).toBe('Asia/Kolkata');
});
test('private booking links require sign-in after refresh and never restore browser demo tickets', async ({
  page,
}) => {
  await fixture(page);
  await signIn(page);
  await book(page);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Make yourself at home.' }),
  ).toBeVisible();
  await expect(
    page.getByAltText('Your private booking ticket QR code'),
  ).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    'SK-TEST',
  );
});
test('unowned booking details show an error without leaking a ticket', async ({
  page,
}) => {
  await fixture(page);
  await signIn(page);
  await navigate(page, '/essentials/bookings/' + bookingId);
  await expect(page.getByRole('alert')).toContainText('not available');
  await expect(
    page.getByAltText('Your private booking ticket QR code'),
  ).toHaveCount(0);
});
