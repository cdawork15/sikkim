import { expect, test, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { sampleEvents } from '../src/features/community/model';
const require = createRequire(import.meta.url);
const hostId = '11111111-1111-4111-8111-111111111111';
const experienceId = '22222222-2222-4222-8222-222222222222';
const policy = {
  cancellation: 'Cancel before the agreed date.',
  safety: 'Follow your guide.',
  participation: 'Suitable for adults.',
};
const experience = {
  id: experienceId,
  slug: 'forest-tea-walk',
  title: 'Forest tea walk',
  description: 'Walk through the forest and share a cup of tea.',
  areaCode: 'pakyong',
  area: 'Pakyong',
  durationMinutes: 90,
  pricePaise: 50025,
  currency: 'INR',
  accessibility: 'unknown',
  difficulty: 'easy',
  hostId,
  hostName: 'Local host',
  featuredRank: 1,
  categories: ['nature'],
  media: [],
  rating: null,
  availability: { status: 'not_connected', bookable: false },
  meetingPoint: 'Village square',
  minParticipants: 1,
  maxParticipants: 8,
  inclusions: ['Tea', 'Guide'],
  exclusions: ['Transport'],
  preparation: 'Bring water.',
  accessibilityNotes: 'Ask before travelling.',
  hostStory: 'Sharing local walks.',
  policy,
};
const testMedia = {
  id: hostId,
  kind: 'video',
  altText: 'Mountain landscape',
  place: 'Nathu La, Sikkim',
  credit: {
    author: 'Rajani Gairshail',
    sourceUrl: 'https://commons.wikimedia.org/',
    licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  },
  urls: {
    video: '/v1/media/' + hostId + '/video',
    poster: '/v1/media/' + hostId + '/poster',
    captions: '/v1/media/' + hostId + '/captions',
  },
};
const options = {
  areas: [{ code: 'pakyong', name: 'Pakyong' }],
  categories: [
    { code: 'nature', name: 'Nature' },
    { code: 'food', name: 'Food & drink' },
  ],
  bookingAvailable: false,
  mediaAvailable: false,
  dateFilteringAvailable: false,
};
const settings = {
  auth: { mode: 'password' },
  privacy: {
    version: 'demo-v1',
    choices: [
      { purpose: 'personalisation', label: 'Use my interests for suggestions' },
    ],
  },
  safety: { message: 'Test accounts are for local preview only.' },
  help: { contact: null },
};
async function fixture(
  page: Page,
  admin = false,
  chosenArea: string | null = null,
) {
  const calls: { method: string; path: string; body: any }[] = [];
  let user = {
    id: 'traveller-id',
    displayName: 'Test traveller',
    language: 'en',
    roles: admin ? ['admin', 'traveller'] : ['traveller'],
    isDemo: true,
    interests: ['nature'],
    preferences: {
      chosenArea,
      tripStart: null,
      tripDays: null,
      travellers: 1,
      pace: 'balanced',
      notificationsEnabled: false,
      showInParticipantList: false,
    },
  };
  let host: any = {
    id: hostId,
    userId: admin ? 'other-user' : user.id,
    publicName: 'Local host',
    story: 'Sharing local walks.',
    serviceAreas: ['Pakyong'],
    contactChoice: 'hidden',
    status: admin ? 'pending' : 'draft',
    revision: 1,
    isDemo: true,
    history: [],
  };
  let owned: any = {
    ...experience,
    area: 'pakyong',
    status: admin ? 'review' : 'draft',
    revision: 1,
    isDemo: false,
    sourceKind: 'direct',
    sourceReference: '',
    history: [],
  };
  let saved = false;
  let liked = false;
  let consents: any[] = [];
  let searches: any = { filters: {}, recent: [] };
  await page.route('**/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.slice(3);
    const method = request.method();
    const body = request.postDataJSON();
    calls.push({ method, path: path + url.search, body });
    let data: unknown;
    let nextCursor: string | null | undefined;
    if (path === '/community/events') {
      data = sampleEvents().map((event) => ({
        ...event,
        ownerId: 'other-host',
        revision: 1,
      }));
      nextCursor = null;
    } else if (path === '/me/experience-actions')
      data = [{ id: experienceId, saved, liked, likeCount: liked ? 1 : 0 }];
    else if (path === '/me/saved') {
      data = saved
        ? [{ id: experienceId, experience, unavailable: false }]
        : [];
      nextCursor = null;
    } else if (path.startsWith('/me/saved/experiences/')) {
      saved = method === 'PUT';
      return route.fulfill({ status: 204 });
    } else if (path.startsWith('/me/likes/experiences/')) {
      liked = method === 'PUT';
      return route.fulfill({ status: 204 });
    } else if (path === '/me/story-views') data = [];
    else if (path.endsWith('/seen')) return route.fulfill({ status: 204 });
    else if (path.startsWith('/media/')) {
      const variant = path.split('/').at(-1);
      return route.fulfill({
        path:
          variant === 'video'
            ? 'public/videos/nathu.mp4'
            : variant === 'captions'
              ? 'public/videos/nathu.vtt'
              : 'public/videos/nathu.webp',
        contentType:
          variant === 'video'
            ? 'video/mp4'
            : variant === 'captions'
              ? 'text/vtt'
              : 'image/webp',
      });
    } else if (path === '/reels') {
      data = [{ experience, media: testMedia }];
      nextCursor = null;
    } else if (path === '/stories') {
      data = [
        {
          id: hostId,
          title: 'Mountain morning',
          hostName: 'Tashi',
          cover: testMedia,
        },
      ];
      nextCursor = null;
    } else if (path === '/stories/' + hostId)
      data = {
        title: 'Mountain morning',
        hostName: 'Tashi',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        frames: [
          { caption: 'First view', media: testMedia },
          { caption: 'Second view', media: { ...testMedia, id: experienceId } },
        ],
      };
    else if (path === '/settings') data = settings;
    else if (path.startsWith('/health/')) data = { status: 'ok' };
    else if (path === '/auth/login' || path === '/auth/register')
      data = {
        user,
        accessToken: 'browser-test-token',
        expiresAt: new Date(Date.now() + 1800000).toISOString(),
      };
    else if (path.startsWith('/auth/logout'))
      return route.fulfill({ status: 204 });
    else if (path === '/me') {
      if (method === 'PATCH') user = { ...user, ...body };
      data = user;
    } else if (path === '/me/preferences') {
      user = { ...user, preferences: { ...user.preferences, ...body } };
      data = user;
    } else if (path === '/me/interests') {
      user = { ...user, interests: body.codes };
      data = user;
    } else if (path === '/interests')
      data = [
        { code: 'nature', label: 'Nature' },
        { code: 'food', label: 'Food & drink' },
      ];
    else if (path === '/me/consents') data = consents;
    else if (path.startsWith('/me/consents/')) {
      consents = [{ purpose: path.split('/').at(-1), ...body }];
      data = consents[0];
    } else if (path === '/me/export') data = { profile: user };
    else if (path === '/me/deletion-request') data = { status: 'pending' };
    else if (path === '/catalogue/options') data = options;
    else if (path === '/home')
      data = {
        rows: [
          {
            id: 'featured',
            title: 'Featured experiences',
            experiences: [experience],
          },
        ],
        availabilityConnected: false,
      };
    else if (path === '/experiences') {
      data = url.searchParams.get('cursor')
        ? [
            {
              ...experience,
              id: 'third',
              slug: 'second-walk',
              title: 'Second walk',
            },
          ]
        : [experience];
      nextCursor = url.searchParams.get('cursor') ? null : 'next-page';
    } else if (path === '/experiences/forest-tea-walk') data = experience;
    else if (path === '/search/suggestions')
      data = [
        { id: experienceId, slug: experience.slug, title: experience.title },
      ];
    else if (path === '/hosts') {
      data = [host];
      nextCursor = null;
    } else if (path === '/hosts/' + hostId) data = host;
    else if (path === '/hosts/' + hostId + '/experiences') {
      data = [experience];
      nextCursor = null;
    } else if (path === '/me/searches') data = searches;
    else if (path === '/me/search-filters') {
      searches.filters = body;
      data = body;
    } else if (path === '/me/recent-searches') {
      searches.recent = method === 'DELETE' ? [] : [{ query: body.q }];
      return route.fulfill({ status: 204 });
    } else if (path === '/me/host') {
      if (method === 'PUT')
        host = { ...host, ...body, revision: host.revision + 1 };
      data = host;
    } else if (path === '/me/host/submit') {
      host = { ...host, status: 'pending', revision: host.revision + 1 };
      data = host;
    } else if (path === '/me/experiences' && method === 'POST') {
      owned = { ...owned, ...body };
      data = owned;
    } else if (path === '/me/experiences') {
      data = [owned];
      nextCursor = null;
    } else if (path === '/me/experiences/' + experienceId) {
      if (method === 'PUT')
        owned = { ...owned, ...body, revision: owned.revision + 1 };
      data = owned;
    } else if (path === '/me/experiences/' + experienceId + '/submit') {
      owned = { ...owned, status: 'review', revision: owned.revision + 1 };
      data = owned;
    } else if (path === '/admin/hosts') {
      data = [host];
      nextCursor = null;
    } else if (path === '/admin/hosts/' + hostId) data = host;
    else if (path === '/admin/hosts/' + hostId + '/decisions') {
      host = { ...host, status: body.action, revision: host.revision + 1 };
      data = host;
    } else if (path === '/admin/experiences') {
      expect(url.searchParams.get('status')).toBe('review');
      data = [owned];
      nextCursor = null;
    } else if (path === '/admin/experiences/' + experienceId) data = owned;
    else if (path === '/admin/experiences/' + experienceId + '/decisions') {
      owned = { ...owned, status: body.action, revision: owned.revision + 1 };
      data = owned;
    } else
      return route.fulfill({
        status: 404,
        json: { error: { code: 'NOT_FOUND', message: 'Not found.' } },
      });
    await route.fulfill({
      json: {
        data,
        ...(nextCursor !== undefined ? { page: { nextCursor } } : {}),
      },
    });
  });
  return calls;
}
async function login(page: Page) {
  await page.goto('/welcome');
  await page.getByLabel('Email', { exact: true }).fill('traveller@example.com');
  await page
    .getByLabel('Password', { exact: true })
    .fill('A long test passphrase');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Your account', exact: true }),
  ).toBeVisible();
}
async function routeWithinApp(page: Page, path: string) {
  await page.evaluate((path) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

test('published catalogue, filters, pagination, details and hosts', async ({
  page,
}) => {
  const calls = await fixture(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Forest tea walk',
  );
  await page
    .getByRole('link', { name: 'Explore', exact: true })
    .first()
    .click();
  await expect(page.locator('.connected-reel')).toHaveCount(1);
  await page.getByRole('link', { name: 'Browse all', exact: true }).click();
  await page.locator('.browse-filters > summary').click();
  await page.getByLabel('Minimum price').fill('100.25');
  await page
    .getByRole('combobox', { name: 'Area', exact: true })
    .selectOption('pakyong');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page).toHaveURL(/minPricePaise=10025/);
  await expect(page.locator('.experience-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Show more' }).click();
  await expect(page.locator('.experience-card')).toHaveCount(2);
  await page
    .getByRole('link')
    .filter({ has: page.getByRole('heading', { name: 'Forest tea walk' }) })
    .click();
  await expect(
    page.getByRole('button', { name: 'Bookings aren’t open yet' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('heading', { name: '₹500.25 / person' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Local host', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Experiences with this host' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'All hosts' }).click();
  await expect(
    page.getByRole('heading', { name: 'Meet your hosts.' }),
  ).toBeVisible();
  expect(calls.some((call) => call.path.includes('cursor=next-page'))).toBe(
    true,
  );
  expect(errors).toEqual([]);
});

test('account edits, privacy, searches, export and logout remain server backed', async ({
  page,
}) => {
  const calls = await fixture(page);
  await login(page);
  await expect(page).toHaveTitle('Your account — Sikkim Experiences');
  await page.getByLabel('Name', { exact: true }).fill('Updated traveller');
  await page.getByLabel('Food & drink', { exact: true }).check();
  await page.getByLabel('Travellers', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.locator('.guest-link')).toContainText('Updated traveller');
  await expect(
    page.getByRole('status').filter({ hasText: 'Your profile is saved.' }),
  ).toBeVisible();
  await expect(page.getByLabel('Food & drink', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Travellers', { exact: true })).toHaveValue('3');
  await page.getByRole('button', { name: 'Save interests' }).click();
  await expect
    .poll(() => calls.find((call) => call.path === '/me/interests')?.body.codes)
    .toEqual(['nature', 'food']);
  await expect(
    page.getByRole('button', { name: 'Save interests' }),
  ).toBeEnabled();
  await expect(
    page.getByRole('status').filter({ hasText: 'Your interests are saved.' }),
  ).toBeVisible();
  await expect(page.getByLabel('Travellers', { exact: true })).toHaveValue('3');
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Your preferences are saved.' }),
  ).toBeVisible();
  await expect
    .poll(
      () =>
        calls.find((call) => call.path === '/me/preferences')?.body.travellers,
    )
    .toBe(3);
  await page.getByRole('link', { name: 'Explore', exact: true }).click();
  await page.getByRole('link', { name: 'Browse all', exact: true }).click();
  await page
    .getByRole('searchbox', { name: 'Search experiences' })
    .fill('Forest');
  await expect(page.locator('.api-suggestions')).toContainText(
    'Forest tea walk',
  );
  await page.getByRole('button', { name: 'Find experiences' }).click();
  await page.locator('.browse-saved > summary').click();
  expect(
    calls.some(
      (call) => call.method === 'POST' && call.path === '/me/recent-searches',
    ),
  ).toBe(false);
  await page.getByRole('button', { name: 'Save this search' }).click();
  await expect(page.getByText('Search saved.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save these filters' }).click();
  await expect(page.getByRole('main').getByRole('status')).toContainText(
    'Filters saved',
  );
  await page.getByRole('button', { name: 'Clear search history' }).click();
  await expect(
    page.getByRole('heading', { name: 'Recent searches' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset saved filters' }).click();
  await expect(page.getByRole('main').getByRole('status')).toContainText(
    'Saved filters cleared',
  );
  await page.locator('.guest-link').click();
  await page
    .getByRole('main')
    .getByRole('link', { name: 'Privacy & settings' })
    .click();
  await expect(page.getByText('Connected and ready.')).toBeVisible();
  await page.getByLabel('Use my interests for suggestions').click();
  await expect(
    page.getByLabel('Use my interests for suggestions'),
  ).toBeChecked();
  await expect(page.getByRole('main').getByRole('status').last()).toContainText(
    'Choice saved',
  );
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download my data' }).click();
  expect((await download).suggestedFilename()).toBe('sikkim-account.json');
  await page.getByRole('button', { name: 'Sign out everywhere' }).click();
  await expect(page.locator('.guest-link')).toContainText('Guest explorer');
  expect(calls.some((call) => call.path === '/auth/logout-all')).toBe(true);
  expect(
    await page.evaluate(() =>
      Object.values(localStorage).some((value) =>
        value.includes('browser-test-token'),
      ),
    ),
  ).toBe(false);
});

test('host profile, create and replace drafts, submission lock', async ({
  page,
}) => {
  const calls = await fixture(page);
  await login(page);
  await page.getByRole('link', { name: 'Host workspace' }).first().click();
  await page.getByLabel('Public name').fill('Forest guide');
  await page.getByRole('button', { name: 'Save host profile' }).click();
  await expect(page.getByLabel('Public name')).toHaveValue('Forest guide');
  await page
    .getByRole('button', { name: 'Submit saved profile for review' })
    .click();
  await expect(page.getByLabel('Public name')).toBeDisabled();
  await page
    .getByRole('link', { name: 'Your experiences', exact: true })
    .click();
  await page.getByRole('link', { name: 'Create experience' }).click();
  await page.getByLabel('Title', { exact: true }).fill('A new forest walk');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page).toHaveURL(new RegExp(experienceId));
  await page.getByLabel('Price per person').fill('750.50');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect
    .poll(
      () =>
        calls.find(
          (call) =>
            call.method === 'PUT' &&
            call.path === '/me/experiences/' + experienceId,
        )?.body.pricePaise,
    )
    .toBe(75050);
  await page
    .getByRole('button', { name: 'Submit saved experience for review' })
    .click();
  await expect(page.getByLabel('Title', { exact: true })).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Submit saved experience for review' }),
  ).toHaveCount(0);
});

test('reviewers see full submissions and send revision-checked decisions', async ({
  page,
}) => {
  const calls = await fixture(page, true);
  await login(page);
  await page.getByRole('link', { name: 'Review workspace' }).first().click();
  await page
    .getByRole('link')
    .filter({ has: page.getByRole('heading', { name: 'Local host' }) })
    .click();
  await page
    .getByRole('combobox', { name: 'Decision', exact: true })
    .selectOption('approved');
  await page.getByLabel('Approval valid until').fill('2099-01-01T12:00');
  await page.getByLabel('Reason', { exact: true }).fill('Test host reviewed.');
  await page.getByRole('button', { name: 'Record decision' }).click();
  await expect(page.locator('.api-notice').first()).toContainText('approved');
  await page.getByRole('link', { name: 'Review queue' }).click();
  await page
    .getByRole('combobox', { name: 'Review', exact: true })
    .selectOption('experiences');
  await page
    .getByRole('link')
    .filter({ has: page.getByRole('heading', { name: 'Forest tea walk' }) })
    .click();
  await page
    .getByRole('combobox', { name: 'Decision', exact: true })
    .selectOption('published');
  await page
    .getByLabel('Verification reference')
    .fill('test-provider-reference');
  await page.getByLabel('Reason', { exact: true }).fill('Listing checked.');
  await page.getByRole('button', { name: 'Record decision' }).click();
  await expect(page.locator('.api-notice').first()).toContainText('published');
  expect(
    calls.find((call) =>
      call.path.endsWith('/experiences/' + experienceId + '/decisions'),
    )?.body,
  ).toMatchObject({
    revision: 1,
    action: 'published',
    providerReference: 'test-provider-reference',
    featuredRank: null,
  });
});

test('errors never fall back to sample data, stale edits can be reloaded, account deletion is explicit', async ({
  page,
}) => {
  await fixture(page);
  await page.route('**/v1/home', (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: 'NOT_READY', message: 'Service is not ready.' } },
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Service is not ready');
  await expect(page.locator('.experience-card')).toHaveCount(0);
  await login(page);
  await routeWithinApp(page, '/hosting/experiences/' + experienceId);
  await page.route('**/v1/me/experiences/' + experienceId, (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({
          status: 409,
          json: {
            error: {
              code: 'EXPERIENCE_CHANGED',
              message: 'Reload the experience before trying again.',
            },
          },
        })
      : route.fallback(),
  );
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(
    page.getByRole('button', { name: 'Reload latest experience' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Reload latest experience' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.locator('.guest-link').click();
  await page
    .getByRole('main')
    .getByRole('link', { name: 'Privacy & settings' })
    .click();
  await expect(
    page.getByRole('button', { name: 'Request deletion' }),
  ).toBeDisabled();
  await page
    .getByLabel('I understand that this account will be disabled.')
    .check();
  await page.getByRole('button', { name: 'Request deletion' }).click();
  await expect(page.locator('.storage-notice')).toContainText('disabled');
});

test('responsive pages, access gates and accessibility', async ({
  page,
}, testInfo) => {
  // This checks fifteen pages with axe, including slower CI runners.
  test.slow();
  await fixture(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const path of [
    '/',
    '/explore',
    '/explore?view=list',
    '/essentials',
    '/essentials/permits',
    '/essentials/transport',
    '/essentials/bookings',
    '/essentials/help',
    '/essentials/updates',
    '/essentials/before-you-go',
    '/experiences/forest-tea-walk',
    '/hosting',
    '/review',
    '/welcome',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
    const violations = await page.evaluate(async () => {
      const axe = (
        window as unknown as {
          axe: {
            run: (
              context: Element,
              options: unknown,
            ) => Promise<{ violations: { id: string; impact: string }[] }>;
          };
        }
      ).axe;
      return (
        await axe.run(document.body, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
        })
      ).violations;
    });
    expect(violations, path).toEqual([]);
  }
  await page.goto('/');
  await page.screenshot({
    path: testInfo.outputPath('connected-home.png'),
    fullPage: true,
  });
  await login(page);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Make yourself at home.' }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('Community retains its design while using shared events and authenticated creation', async ({
  page,
}, testInfo) => {
  await fixture(page);
  await page.goto('/community');
  await expect(
    page.getByRole('heading', { name: 'What’s happening' }),
  ).toBeVisible();
  await expect(page.locator('.event-card').first()).toBeVisible();
  await expect(page.getByText('Community is on its way.')).toHaveCount(0);
  await expect(page.locator('.demo-caption')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('community-restored.png'),
    fullPage: true,
  });
  await page.getByRole('link', { name: 'Story from Tashi' }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Mountain morning',
  );
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.goto('/community/events/community-5');
  await expect(page.getByText('Joining is not open yet.')).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Edit event', exact: true }),
  ).toHaveCount(0);
  await page.goto('/community');
  await page.getByRole('link', { name: '+ Create', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Sign in required' }),
  ).toBeVisible();
  await login(page);
  await routeWithinApp(page, '/community/create');
  await expect(page.getByLabel('Title', { exact: true })).toBeVisible();
});

test('Home respects every category, honest labels and empty category results', async ({
  page,
}) => {
  await fixture(page);
  const item = { ...experience, categories: ['hiking', 'nature'] };
  await page.route('**/v1/home', (route) =>
    route.fulfill({
      json: {
        data: {
          rows: [
            { id: 'featured', title: 'Featured', experiences: [item] },
            { id: 'recommended', title: 'Explore', experiences: [item] },
          ],
        },
      },
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(item.title);
  await expect(
    page.getByRole('heading', { name: 'Explore Sikkim', exact: true }),
  ).toBeVisible();
  await expect(page.locator('img[src=""]')).toHaveCount(0);
  await expect(page.locator('.catalogue-label')).toHaveCount(0);
  await expect(
    page
      .getByRole('region', { name: 'Pakyong discoveries' })
      .getByRole('link', { name: 'See all' }),
  ).toHaveAttribute('href', '/explore?area=pakyong');
  await page.getByRole('button', { name: 'Nature', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(item.title);
  await page.goto('/?category=food');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'More experiences are on their way.',
  );
  await expect(page.locator('.discovery-hero')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show all experiences' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(item.title);
});

test('search history is optional and unavailable dates are explained', async ({
  page,
}) => {
  const calls = await fixture(page);
  await login(page);
  await page.route('**/v1/me/recent-searches', (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: { code: 'UNAVAILABLE', message: 'Search history unavailable.' },
      },
    }),
  );
  await page.getByRole('link', { name: 'Explore', exact: true }).click();
  await page.getByRole('link', { name: 'Browse all', exact: true }).click();
  await page.getByRole('searchbox').fill('Forest');
  await page.getByRole('button', { name: 'Find experiences' }).click();
  await expect(page).toHaveURL(/q=Forest/);
  await expect(page.locator('.experience-card')).toHaveCount(1);
  expect(
    calls.some(
      (call) => call.method === 'POST' && call.path === '/me/recent-searches',
    ),
  ).toBe(false);
  await page.locator('.browse-saved > summary').click();
  await page
    .getByRole('button', { name: 'Save this search', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'Search history unavailable.',
  );
  await expect(page.locator('.experience-card')).toHaveCount(1);
  await page.goto('/explore?date=2099-01-01');
  await expect(
    page.getByText(
      'Date availability is not connected yet. These results are not filtered by date.',
    ),
  ).toBeVisible();
});

test('failed option loading cannot silently clear account or experience areas', async ({
  page,
}) => {
  await fixture(page, false, 'Custom village');
  await page.route('**/v1/catalogue/options', (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: { code: 'UNAVAILABLE', message: 'Area options unavailable.' },
      },
    }),
  );
  await login(page);
  await expect(
    page.getByRole('combobox', { name: 'Preferred area', exact: true }),
  ).toHaveValue('Custom village');
  await expect(
    page.getByRole('button', { name: 'Save preferences' }),
  ).toBeDisabled();
  await page
    .getByRole('link', { name: 'Host workspace', exact: true })
    .first()
    .click();
  await page
    .getByRole('link', { name: 'Your experiences', exact: true })
    .click();
  await page
    .getByRole('link')
    .filter({ has: page.getByRole('heading', { name: experience.title }) })
    .click();
  await expect(
    page.getByRole('combobox', { name: 'Area', exact: true }),
  ).toHaveValue('pakyong');
  await expect(page.getByRole('button', { name: 'Save draft' })).toBeDisabled();
});

test('saved ideas and likes persist across navigation and another sign-in', async ({
  page,
}) => {
  const calls = await fixture(page);
  await login(page);
  await routeWithinApp(page, '/experiences/forest-tea-walk');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Saved', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Like 0', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Liked 1', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page
    .getByRole('link', { name: 'View saved experiences', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Forest tea walk' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Make yourself at home.' }),
  ).toBeVisible();
  await login(page);
  await routeWithinApp(page, '/saved');
  await expect(
    page.getByRole('heading', { name: 'Forest tea walk' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Remove from saved' }).click();
  await expect(
    page.getByRole('heading', { name: 'Forest tea walk' }),
  ).toHaveCount(0);
  expect(
    calls.some(
      (call) =>
        call.method === 'DELETE' && call.path.includes('/saved/experiences/'),
    ),
  ).toBe(true);
});

test('real reel controls, credits and Community stories stay in their own screens', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/explore');
  await expect(
    page.getByRole('link', { name: 'Reels', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.connected-reel video')).toBeVisible();
  await expect(page.locator('.connected-reel video')).toHaveJSProperty(
    'muted',
    false,
  );
  await page.getByRole('button', { name: 'Mute video', exact: true }).click();
  await expect(page.locator('.connected-reel video')).toHaveJSProperty(
    'muted',
    true,
  );
  await page.getByRole('button', { name: 'Unmute video', exact: true }).click();
  await expect(page.locator('.connected-reel video')).toHaveJSProperty(
    'muted',
    false,
  );
  await expect(page.locator('.media-credits')).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'About this media', exact: true }).first(),
  ).toHaveAttribute('href', '/credits?experience=forest-tea-walk');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.goto('/community');
  await page.getByRole('link', { name: 'Story from Tashi' }).click();
  await expect(
    page.getByRole('heading', { name: 'Mountain morning' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Second view')).toBeVisible();
  await page.route('**/v1/stories/' + experienceId, (route) =>
    route.fulfill({
      json: {
        data: {
          title: 'Another morning',
          hostName: 'Pema',
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          frames: [{ caption: 'A fresh start', media: testMedia }],
        },
      },
    }),
  );
  // Navigate within the mounted story route, as browser history can do.
  await page.evaluate((id) => {
    history.pushState(null, '', '/community/host-stories/' + id);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, experienceId);
  await expect(page.getByText('A fresh start')).toBeVisible();
  await expect(page.getByText('1 of 1', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Previous', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Next', exact: true }),
  ).toBeDisabled();
  await page.goto('/');
  await expect(page.locator('.story-rail')).toHaveCount(0);
});

test('reels respect reduced motion and keep actions above mobile navigation', async ({
  page,
  isMobile,
}) => {
  await fixture(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/explore');
  const video = page.locator('.connected-reel video');
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute('preload', 'none');
  await expect(video).toHaveJSProperty('paused', true);
  await expect(video).toHaveJSProperty('controls', true);
  const action = page.getByRole('link', {
    name: 'View experience',
    exact: true,
  });
  await expect(action).toBeVisible();
  if (isMobile) {
    const box = await action.boundingBox();
    expect(box!.y + box!.height).toBeLessThan(page.viewportSize()!.height - 80);
  }
});

test('Explore opens reels first and Browse all keeps search available', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/');
  await page
    .getByRole('link', { name: 'Explore', exact: true })
    .first()
    .click();
  await expect(page.locator('.connected-reel')).toHaveCount(1);
  await expect(page.getByRole('searchbox')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Share experience' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Hide captions' }).click();
  await expect(
    page.getByRole('button', { name: 'Show captions' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Browse all', exact: true }).click();
  await expect(page.getByRole('searchbox')).toBeVisible();
  await page.getByRole('button', { name: 'Find experiences' }).click();
  await expect(page.getByRole('searchbox')).toBeVisible();
  await page.getByRole('link', { name: 'Watch reels', exact: true }).click();
  await expect(page.locator('.connected-reel')).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight + 1,
    ),
  ).toBe(true);
});

test('Travel Essentials works for guests and never shows browser demo bookings', async ({
  page,
}) => {
  const calls = await fixture(page);
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
  for (const path of [
    '/essentials',
    '/my-trip/new',
    '/my-trip/samples/pakyong-culture',
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/essentials$/);
    await expect(
      page.getByRole('heading', { name: 'Travel essentials.' }),
    ).toBeVisible();
    await page.getByRole('link', { name: /My bookings/ }).click();
    await expect(page).toHaveURL(/\/essentials\/bookings$/);
    await expect(
      page.getByRole('heading', { name: 'Make yourself at home.' }),
    ).toBeVisible();
    await expect(page.locator('a[href^="/demo-bookings/"]')).toHaveCount(0);
  }
  expect(
    calls.some(
      (call) =>
        call.path.startsWith('/me/bookings') || call.path.startsWith('/trips'),
    ),
  ).toBe(false);
  await routeWithinApp(page, '/saved');
  await expect(page).toHaveURL(/\/saved$/);
  await expect(
    page.getByRole('link', { name: 'Sign in', exact: true }),
  ).toBeVisible();
});

test('Home rotates server banners every three seconds even while hovered', async ({
  page,
}) => {
  await fixture(page);
  await page.clock.install();
  const featured = [
    'Forest tea walk',
    'Mountain sunrise',
    'Local flavours',
  ].map((title, index) => ({
    ...experience,
    id: `featured-${index}`,
    slug: `featured-${index}`,
    title,
  }));
  await page.route('**/v1/home', (route) =>
    route.fulfill({
      json: {
        data: {
          rows: [{ id: 'featured', title: 'Featured', experiences: featured }],
          availabilityConnected: false,
        },
      },
    }),
  );
  await page.goto('/');
  const title = page.locator('.discovery-hero h1');
  await expect(title).toHaveText('Forest tea walk');
  await page.locator('.discovery-hero').hover();
  await page.clock.fastForward(3000);
  await expect(title).toHaveText('Mountain sunrise');
  await expect(
    page.getByRole('button', { name: 'Show Mountain sunrise', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.clock.fastForward(3000);
  await expect(title).toHaveText('Local flavours');
  await page.clock.fastForward(3000);
  await expect(title).toHaveText('Forest tea walk');
  const dot = page.getByRole('button', {
    name: 'Show Mountain sunrise',
    exact: true,
  });
  await dot.click();
  await page.clock.fastForward(6000);
  await expect(title).toHaveText('Mountain sunrise');
  await page.locator('.header-search').focus();
  await page.clock.fastForward(3000);
  await expect(title).toHaveText('Local flavours');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.discovery-hero-content')).toHaveAttribute(
    'aria-live',
    'polite',
  );
  await page.clock.fastForward(6000);
  await expect(title).toHaveText('Local flavours');
});

test('media sources live on a separate page and survive direct links', async ({
  page,
}) => {
  await fixture(page);
  const media = {
    ...testMedia,
    credit: {
      ...testMedia.credit,
      author: 'Local photographer',
      sourceUrl: 'https://example.org/approved-footage',
    },
  };
  const item = { ...experience, media: [media] };
  await page.route('**/v1/home', (route) =>
    route.fulfill({
      json: {
        data: {
          rows: [
            { id: 'featured', title: 'Featured', experiences: [item] },
            { id: 'recommended', title: 'Explore', experiences: [item] },
          ],
        },
      },
    }),
  );
  await page.route('**/v1/experiences/forest-tea-walk', (route) =>
    route.fulfill({ json: { data: item } }),
  );
  await page.route('**/v1/stories/credit-story', (route) =>
    route.fulfill({ json: { data: { frames: [{ media }] } } }),
  );
  await page.goto('/');
  await expect(page.locator('.discovery-hero')).toBeVisible();
  await expect(
    page.getByText('Video / photo credit', { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('.catalogue-label')).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'About our media', exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('.footer-media')).toHaveCount(0);
  if ((page.viewportSize()?.width ?? 0) <= 680) {
    await expect(page.locator('.site-footer')).toBeHidden();
  }
  for (const path of [
    '/credits',
    '/credits?experience=forest-tea-walk',
    '/credits?story=credit-story',
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole('heading', { name: 'About our media' }),
    ).toBeVisible();
    await expect(
      page.getByText('By Local photographer', { exact: true }),
    ).toHaveCount(1);
    await expect(
      page.locator('a[href="https://example.org/approved-footage"]'),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText('By Local photographer', { exact: true }),
    ).toHaveCount(1);
  }
});

test('password sign-up replaces shared travellers and returns to the requested page', async ({
  page,
}, testInfo) => {
  const calls = await fixture(page);
  await page.goto('/welcome?next=%2Fsaved');
  await expect(
    page.getByRole('button', { name: /Test traveller/ }),
  ).toHaveCount(0);
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
    'autocomplete',
    'current-password',
  );
  await page
    .getByRole('button', { name: 'Create an account', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Make yourself at home.' }),
  ).toBeVisible();
  await page.getByLabel('Your name').fill('Pema');
  await page.getByLabel('Email', { exact: true }).fill('pema@example.com');
  const password = page.getByLabel('Password', { exact: true });
  await expect(password).toHaveAttribute('autocomplete', 'new-password');
  await expect(password).toHaveAttribute('minlength', '8');
  await password.fill('Trail#8');
  expect(
    await password.evaluate(
      (input: HTMLInputElement) => input.validity.tooShort,
    ),
  ).toBe(true);
  await password.fill('Trail#82');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(password).toHaveAttribute('type', 'password');
  await page.screenshot({
    path: testInfo.outputPath('password-signup.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(page).toHaveURL(/\/saved$/);
  expect(calls.find((call) => call.path === '/auth/register')?.body).toEqual({
    displayName: 'Pema',
    email: 'pema@example.com',
    password: 'Trail#82',
  });
  expect(calls.some((call) => call.path === '/auth/demo')).toBe(false);
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Sign in required' }),
  ).toBeVisible();
});

test('password errors stay readable and repeat submissions are blocked', async ({
  page,
}, testInfo) => {
  await fixture(page);
  let attempts = 0;
  await page.route('**/v1/auth/login', async (route) => {
    attempts++;
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      status: 401,
      json: {
        error: {
          code: 'LOGIN_FAILED',
          message: 'Email or password is incorrect.',
        },
      },
    });
  });
  await page.goto('/welcome');
  await page.getByLabel('Email', { exact: true }).fill('pema@example.com');
  await page
    .getByLabel('Password', { exact: true })
    .fill('An incorrect passphrase');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Please wait…' }),
  ).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText(
    'Email or password is incorrect.',
  );
  expect(attempts).toBe(1);
  await expect(
    page.getByRole('button', { name: 'Sign in', exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath('password-error.png'),
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'Create an account', exact: true })
    .click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('password login rejects an external return destination', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/welcome?next=https%3A%2F%2Fexample.com');
  await page.getByLabel('Email', { exact: true }).fill('pema@example.com');
  await page
    .getByLabel('Password', { exact: true })
    .fill('A long mountain passphrase');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
});

test('local experience details remove fixture clutter without inventing confirmed arrangements', async ({
  page,
}) => {
  await fixture(page);
  const slug = 'preview-forest-tea-walk';
  await page.route('**/v1/experiences/' + slug, (route) =>
    route.fulfill({
      json: {
        data: {
          ...experience,
          slug,
          description:
            'Design preview only — not a real offer. A slow walk through the forest.',
          hostStory:
            'Fictional host for local design preview only. This is not a real provider.',
          meetingPoint:
            'Sample meeting point. Do not travel based on this preview.',
          inclusions: ['Sample local guide', 'Sample refreshments'],
        },
      },
    }),
  );
  await page.goto('/experiences/' + slug);
  await expect(
    page.getByText('A slow walk through the forest.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Sample local guide', { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/Design preview only|Fictional host|Sample meeting point/),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Bookings aren’t open yet' }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      'Host, meeting point and inclusions will be confirmed when bookings open.',
    ),
  ).toBeVisible();
  await page.goto('/experiences/forest-tea-walk');
  await expect(
    page.getByRole('heading', { name: 'Where to meet' }),
  ).toBeVisible();
});

test('host review is unavailable until verification is connected', async ({
  page,
}) => {
  const calls = await fixture(page);
  await page.route('**/v1/me/host', (route) =>
    route.fulfill({
      json: {
        data: {
          id: hostId,
          publicName: 'New host',
          story: 'Local walks.',
          serviceAreas: ['Pakyong'],
          contactChoice: 'hidden',
          status: 'draft',
          revision: 1,
          isDemo: false,
          realVerificationAvailable: false,
          history: [],
        },
      },
    }),
  );
  await login(page);
  await page.getByRole('link', { name: 'Host workspace' }).first().click();
  await expect(page).toHaveTitle('Host workspace — Sikkim Experiences');
  await expect(
    page.getByRole('button', { name: 'Verification isn’t available yet' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Save host profile' }),
  ).toBeEnabled();
  expect(calls.some((call) => call.path === '/me/host/submit')).toBe(false);
});

test('experience gallery keeps multiple photos and videos in one responsive viewer', async ({
  page,
}, testInfo) => {
  await fixture(page);
  const cover = {
    ...testMedia,
    id: 'cover',
    kind: 'image',
    placement: 'cover',
    altText: 'Mountain cover',
    urls: { image: testMedia.urls.poster },
  };
  const second = {
    ...cover,
    id: 'second',
    placement: 'gallery',
    altText: 'Second mountain photo',
  };
  await page.route('**/v1/experiences/forest-tea-walk', (route) =>
    route.fulfill({
      json: { data: { ...experience, media: [testMedia, cover, second] } },
    }),
  );
  await page.goto('/experiences/forest-tea-walk');
  const viewer = page.locator('.experience-gallery');
  await expect(
    viewer.getByRole('img', { name: 'Mountain cover' }),
  ).toBeVisible();
  await expect(viewer.locator('video')).toHaveCount(0);
  const initial = await viewer.boundingBox();
  expect(initial).not.toBeNull();
  const details = await page.locator('.api-detail > section').boundingBox();
  if (testInfo.project.name === 'api-desktop') {
    expect(Math.abs(details!.y - initial!.y)).toBeLessThan(5);
  } else {
    expect(initial!.height).toBeLessThan(400);
    expect(details!.y).toBeGreaterThan(initial!.y + initial!.height);
  }
  await page.getByRole('button', { name: 'Show video 2', exact: true }).click();
  await expect(viewer.locator('video')).toBeVisible();
  await expect(viewer.locator('video')).toHaveJSProperty('paused', true);
  await expect(viewer.locator('video')).toHaveJSProperty('muted', false);
  const videoSize = await viewer.boundingBox();
  expect(Math.abs(videoSize!.height - initial!.height)).toBeLessThan(2);
  await page.getByRole('button', { name: 'Next media', exact: true }).click();
  await expect(viewer.locator('video')).toHaveCount(0);
  await expect(
    viewer.getByRole('img', { name: 'Second mountain photo' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Next media', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Show photo 1', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page
    .getByRole('button', { name: 'Previous media', exact: true })
    .click();
  await expect(
    viewer.getByRole('img', { name: 'Second mountain photo' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('experience-gallery.png'),
    fullPage: true,
  });
});

test('Community publishes four photos for guests and other accounts with creator-only editing', async ({
  page,
}, testInfo) => {
  await fixture(page);
  let events: any[] = [];
  await page.route('**/v1/community/events**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET')
      return route.fulfill({
        json: { data: events, page: { nextCursor: null } },
      });
    const body = request.postDataJSON();
    const id = path.split('/').at(-1);
    if (request.method() === 'POST') {
      const event = {
        ...body,
        id: 'shared-event',
        ownerId: 'traveller-id',
        host: 'Test traveller',
        attendees: 0,
        revision: 1,
        mine: false,
        live: false,
        status: 'published',
        image: body.images[0],
      };
      events.push(event);
      return route.fulfill({ status: 201, json: { data: event } });
    }
    const event = {
      ...events.find((item) => item.id === id),
      ...body,
      image: body.images[0],
      revision: body.revision + 1,
    };
    events = events.map((item) => (item.id === id ? event : item));
    return route.fulfill({ json: { data: event } });
  });
  await login(page);
  await routeWithinApp(page, '/community/create');
  const input = page.getByLabel(/Add photos/);
  const files = [
    'public/images/forest.webp',
    'public/images/momos.webp',
    'public/images/monastery.webp',
    'public/images/himalayan-dawn.webp',
  ];
  await input.setInputFiles([...files, files[0]!]);
  await expect(page.getByRole('alert')).toContainText('up to 4 photos');
  await expect(page.locator('.event-photo-tile')).toHaveCount(0);
  await input.setInputFiles({
    name: 'broken.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('not an image'),
  });
  await expect(page.getByRole('alert')).toContainText('could not be opened');
  await input.setInputFiles(files);
  await expect(page.locator('.event-photo-tile')).toHaveCount(4);
  await expect(input).toBeDisabled();
  const selectedCover = await page
    .locator('.event-photo-tile > img')
    .nth(2)
    .getAttribute('src');
  expect(selectedCover).toMatch(/^data:image\/jpeg;base64,/);
  expect(selectedCover!.length).toBeLessThanOrEqual(200000);
  await page
    .getByRole('button', { name: 'Use photo 3 as cover', exact: true })
    .click();
  await expect(page.locator('.event-photo-tile > img').first()).toHaveAttribute(
    'src',
    selectedCover!,
  );
  await page
    .getByRole('button', { name: 'Remove photo 2', exact: true })
    .click();
  await expect(input).toBeEnabled();
  await input.setInputFiles(files[1]!);
  await expect(page.locator('.event-photo-tile')).toHaveCount(4);
  await page
    .getByLabel('Title', { exact: true })
    .fill('A village photo afternoon');
  await page
    .getByLabel('What will people do?')
    .fill('Explore the village and share stories over a warm cup of tea.');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('community-photo-picker.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Area', { exact: true }).fill('Pakyong');
  await page
    .getByLabel('Public meeting point')
    .fill('The public village square');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const capacity = page.getByLabel('Maximum participants');
  const price = page.getByLabel('Price per person');
  await capacity.fill('');
  await expect(capacity).toHaveValue('');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(capacity).toBeVisible();
  await capacity.pressSequentially('12');
  await expect(capacity).toHaveValue('12');
  await price.fill('');
  await expect(price).toHaveValue('');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(price).toBeVisible();
  await price.pressSequentially('250');
  await expect(price).toHaveValue('250');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('12 places · ₹250 per person')).toBeVisible();
  await page.getByRole('button', { name: 'Previous step' }).click();
  await expect(capacity).toHaveValue('12');
  await expect(price).toHaveValue('250');
  await price.fill('');
  await price.pressSequentially('0');
  await expect(price).toHaveValue('0');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('.community-photo-thumbnails button')).toHaveCount(
    4,
  );
  await page
    .getByRole('button', { name: 'Publish event', exact: true })
    .click();
  await page.getByRole('link', { name: 'Manage event', exact: true }).click();
  const path = new URL(page.url()).pathname;
  await expect(page.locator('.community-photo-gallery > img')).toHaveAttribute(
    'src',
    selectedCover!,
  );
  await page
    .getByRole('button', { name: 'View event photo 4', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'View event photo 4', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('link', { name: 'Edit event', exact: true }).click();
  await expect(page.locator('.event-photo-tile')).toHaveCount(4);
  await page
    .getByRole('button', { name: 'Remove photo 4', exact: true })
    .click();
  for (let step = 0; step < 3; step++)
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('.community-photo-thumbnails button')).toHaveCount(
    3,
  );
  await login(page);
  await routeWithinApp(page, path);
  await expect(page.locator('.community-photo-thumbnails button')).toHaveCount(
    3,
  );
  await expect(page.locator('.community-photo-gallery > img')).toHaveAttribute(
    'src',
    selectedCover!,
  );
  await routeWithinApp(page, '/community?tab=Created');
  await expect(
    page.getByRole('link', { name: 'A village photo afternoon', exact: true }),
  ).toBeVisible();
  await routeWithinApp(page, '/settings');
  await page.getByRole('button', { name: 'Sign out everywhere' }).click();
  await routeWithinApp(page, '/community?tab=Upcoming');
  await expect(
    page.getByRole('link', { name: 'A village photo afternoon', exact: true }),
  ).toBeVisible();
  await routeWithinApp(page, path);
  await expect(
    page.getByRole('heading', {
      name: 'A village photo afternoon',
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator('.community-photo-thumbnails button')).toHaveCount(
    3,
  );
  await expect(
    page.getByRole('link', { name: 'Edit event', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Cancel event', exact: true }),
  ).toHaveCount(0);
  await page.route('**/v1/auth/login', (route) =>
    route.fulfill({
      json: {
        data: {
          user: {
            id: 'second-viewer',
            displayName: 'Another traveller',
            roles: ['traveller'],
            language: 'en',
            interests: [],
            preferences: {},
          },
          accessToken: 'second-viewer-token',
          expiresAt: new Date(Date.now() + 1800000).toISOString(),
        },
      },
    }),
  );
  await login(page);
  await routeWithinApp(page, path + '/edit');
  await expect(
    page.getByRole('heading', { name: 'Event not found', exact: true }),
  ).toBeVisible();
  await routeWithinApp(page, '/community?tab=Upcoming');
  await expect(
    page.getByRole('link', { name: 'A village photo afternoon', exact: true }),
  ).toBeVisible();
  await routeWithinApp(page, path);
  await expect(
    page.getByRole('heading', {
      name: 'A village photo afternoon',
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator('.community-photo-thumbnails button')).toHaveCount(
    3,
  );
  await expect(
    page.getByRole('link', { name: 'Edit event', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Cancel event', exact: true }),
  ).toHaveCount(0);
});

test('Community keeps browser drafts and publishes them without losing the event', async ({
  page,
}) => {
  await fixture(page);
  await page.addInitScript(() => {
    const event = {
      id: 'local-draft',
      title: 'An older village walk',
      description: 'Meet in the village square for a relaxed walk.',
      host: 'You',
      area: 'Pakyong',
      meeting: 'Public village square',
      date: '2099-01-01',
      start: '16:00',
      end: '18:00',
      capacity: 10,
      attendees: 0,
      price: 0,
      interest: 'Nature',
      image: '/images/forest.webp',
      mine: true,
      status: 'published',
      live: false,
      approval: false,
    };
    if (!sessionStorage.getItem('draft-seeded')) {
      localStorage.setItem(
        'sikkim:community-trips:v1:account:traveller-id',
        JSON.stringify({
          events: [event],
          memberships: {},
          saved: [],
          seen: [],
          messages: [],
          trips: [],
        }),
      );
      sessionStorage.setItem('draft-seeded', 'yes');
    }
  });
  let shared: any[] = [];
  await page.route('**/v1/community/events**', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: { data: shared } });
    expect(route.request().method()).toBe('POST');
    const input = route.request().postDataJSON();
    expect(input.revision).toBeUndefined();
    const event = {
      ...input,
      id: 'published-draft',
      ownerId: 'traveller-id',
      revision: 1,
      host: 'Test traveller',
      attendees: 0,
      image: '/images/forest.webp',
      status: 'published',
      live: false,
      mine: false,
    };
    shared = [event];
    return route.fulfill({ status: 201, json: { data: event } });
  });
  await login(page);
  await routeWithinApp(page, '/community/events/local-draft');
  await expect(
    page.getByText('This event is saved only on this device.', {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Edit event', exact: true }).click();
  for (let step = 0; step < 3; step++)
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page
    .getByRole('button', { name: 'Publish event', exact: true })
    .click();
  await expect(page).toHaveURL(/community\/events\/published-draft$/);
  await expect(
    page.getByRole('heading', { name: 'An older village walk', exact: true }),
  ).toBeVisible();
  await routeWithinApp(page, '/community?tab=Created');
  await expect(
    page.getByRole('link', { name: 'An older village walk', exact: true }),
  ).toHaveCount(1);
  await page.goto('/community/events/published-draft');
  await expect(
    page.getByRole('heading', { name: 'An older village walk', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Edit event', exact: true }),
  ).toHaveCount(0);
});
