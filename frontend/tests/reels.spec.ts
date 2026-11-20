import { expect, test, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

async function moveReel(page: Page, direction: number) {
  await page.locator('.reel-feed').focus();
  await page.keyboard.press(direction > 0 ? 'ArrowDown' : 'ArrowUp');
  await expect
    .poll(() =>
      page
        .locator('.reel-feed')
        .evaluate((el) =>
          Math.abs(
            el.scrollTop / el.clientHeight -
              Math.round(el.scrollTop / el.clientHeight),
          ),
        ),
    )
    .toBeLessThan(0.01);
}

async function checkScreen(page: Page, name: string) {
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
  await page.screenshot({
    path: test.info().outputPath(`${name}.png`),
    fullPage: true,
  });
}

test('real reel playback, sound, captions, preview and host links', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const videos: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('.mp4')) videos.push(request.url());
  });
  await page.goto('/explore');
  await expect
    .poll(() =>
      page
        .locator('video')
        .evaluate((video: HTMLVideoElement) => video.readyState),
    )
    .toBeGreaterThanOrEqual(3);
  const play = page.getByRole('button', { name: 'Play video', exact: true });
  if (await play.isVisible()) await play.click();
  await expect(
    page.getByRole('button', { name: 'Pause video', exact: true }),
  ).toBeVisible();
  await expect(page.locator('video')).toHaveJSProperty('muted', false);
  await page.getByRole('button', { name: 'Mute video' }).click();
  await expect(page.locator('video')).toHaveJSProperty('muted', true);
  await page.getByRole('button', { name: 'Turn sound on' }).click();
  await expect(page.locator('video')).toHaveJSProperty('muted', false);
  await page.getByRole('button', { name: 'Captions', exact: true }).click();
  expect(
    await page
      .locator('video')
      .evaluate((video: HTMLVideoElement) => video.textTracks[0]?.mode),
  ).toBe('hidden');
  await page.getByRole('button', { name: 'Captions', exact: true }).click();
  await page.getByRole('button', { name: 'Pause video', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Play video', exact: true }),
  ).toBeVisible();
  await checkScreen(page, 'reels');
  expect(new Set(videos.map((url) => url.split('/').pop()))).toEqual(
    new Set(['nathu.mp4']),
  );
  await page.getByRole('button', { name: 'Quick details' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText(
    'No verified reviews yet',
  );
  await checkScreen(page, 'preview');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Quick details' }),
  ).toBeFocused();
  await page.getByRole('link', { name: 'With Tashi' }).click();
  await expect(page.getByRole('heading', { name: 'Meet Tashi' })).toBeVisible();
  await checkScreen(page, 'host');
  expect(errors).toEqual([]);
});

test('likes and saves survive reload and saved ideas can be booked', async ({
  page,
}) => {
  await page.goto('/explore');
  await page.getByRole('button', { name: 'Like', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Liked', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('button', { name: 'Saved', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Essentials', exact: true })
    .click();
  await page.getByRole('link', { name: /^Saved experiences/ }).click();
  await page
    .getByRole('link', { name: 'Try booking for Chase the first light' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Book your spot' }),
  ).toBeVisible();
  await page.goto('/saved');
  await page
    .getByRole('button', { name: 'Unsave Chase the first light' })
    .click();
  await page.goto('/explore');
  await expect(
    page.getByRole('button', { name: 'Save', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
});

test('arrow keys, direct links, collection end and list view', async ({
  page,
}) => {
  await page.goto('/explore');
  await page.locator('.reel-slide:not([inert]) .reel-card').focus();
  await page.keyboard.press('ArrowDown');
  await expect(
    page.locator('.reel-slide:not([inert]) .reel-card h2'),
  ).toHaveText('A morning, a monastery');
  await page.reload();
  await expect(
    page.locator('.reel-slide:not([inert]) .reel-card h2'),
  ).toHaveText('A morning, a monastery');
  await moveReel(page, 1);
  await expect(
    page.locator('.reel-slide:not([inert]) .reel-card h2'),
  ).toHaveText('The art of doing a little less');
  await moveReel(page, 1);
  await expect(
    page.getByRole('heading', { name: 'You’re all caught up.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Watch again' }).click();
  await expect(
    page.locator('.reel-slide:not([inert]) .reel-card h2'),
  ).toHaveText('Chase the first light');
  await page.getByRole('link', { name: 'Browse all', exact: true }).click();
  await expect(
    page.getByRole('searchbox', { name: 'Search experiences' }),
  ).toBeVisible();
  await expect(page.locator('.experience-card')).toHaveCount(4);
});

test('reduced motion and data saving avoid downloading video until requested', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('.mp4')) requests.push(request.url());
  });
  await page.goto('/explore');
  await expect(
    page.getByText('Photo preview · Motion or data saving is on'),
  ).toBeVisible();
  await expect(page.locator('video')).toHaveCount(0);
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: 'Play video', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Pause video', exact: true }),
  ).toBeVisible();
  await moveReel(page, 1);
  await expect(page.locator('video')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: {
        saveData: true,
        effectiveType: '4g',
        addEventListener() {},
        removeEventListener() {},
      },
    }),
  );
  await page.reload();
  await expect(page.locator('video')).toHaveCount(0);
});

test('video failure, denied sharing and blocked storage have useful fallbacks', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error('denied');
    };
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('denied');
        },
      },
    });
  });
  await page.route('**/*.mp4', (route) => route.abort());
  await page.goto('/explore');
  await expect(
    page.getByText('Video unavailable · Photo preview'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Share experience' }).click();
  await expect(page.getByLabel('Experience link')).toHaveValue(
    /\/experiences\/first-light$/,
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Saved', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      'Your saves will stay for this visit. Browser storage is unavailable.',
    ),
  ).toBeVisible();
  await page.unroute('**/*.mp4');
  await page.getByRole('button', { name: 'Retry video' }).click();
  await expect(
    page.getByRole('button', { name: 'Pause video', exact: true }),
  ).toBeVisible();
});

test('vertical touch scrolling snaps to the next reel and plays only that video', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Native swipe injection uses Chromium CDP; physical iPhone swipe remains a manual check.',
  );
  await page.goto('/explore');
  const client = await page.context().newCDPSession(page);
  const box = (await page.locator('.reel-feed').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.65;
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y }],
  });
  for (let step = 1; step <= 8; step++) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y - (box.height * 0.6 * step) / 8 }],
    });
    await page.waitForTimeout(30);
  }
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await expect(page).toHaveURL(/reel=monastery-mornings/);
  await expect(page.locator('video')).toHaveCount(1);
  await expect(page.locator('video')).toHaveAttribute(
    'src',
    '/videos/enchey.mp4',
  );
  await expect(
    page.getByRole('button', { name: 'Save', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await expect
    .poll(() =>
      page
        .locator('.reel-feed')
        .evaluate((el) => Math.abs(el.scrollTop - el.clientHeight)),
    )
    .toBeLessThan(2);
  await moveReel(page, -1);
  await expect(page.locator('video')).toHaveAttribute(
    'src',
    '/videos/nathu.mp4',
  );
  await client.detach();
});

test('mouse wheel scrolls the feed without moving the surrounding page', async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(
    browserName === 'webkit' && isMobile,
    'Mobile WebKit does not support mouse-wheel injection.',
  );
  await page.goto('/explore');
  await page.locator('.reel-feed').hover();
  const height = await page
    .locator('.reel-feed')
    .evaluate((el) => el.clientHeight);
  await page.mouse.wheel(0, height);
  await expect(page).toHaveURL(/reel=monastery-mornings/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.mouse.wheel(0, -height);
  await expect(page.locator('video')).toHaveAttribute(
    'src',
    '/videos/nathu.mp4',
  );
});

test('background and offline states stop video, while share links remain usable', async ({
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
        writeText: async (value: string) => {
          (window as unknown as { sharedLink: string }).sharedLink = value;
        },
      },
    });
  });
  await page.goto('/explore');
  await expect
    .poll(() =>
      page
        .locator('video')
        .evaluate((video: HTMLVideoElement) => video.readyState),
    )
    .toBeGreaterThanOrEqual(3);
  const play = page.getByRole('button', { name: 'Play video', exact: true });
  if (await play.isVisible()) await play.click();
  await expect(
    page.getByRole('button', { name: 'Pause video', exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect
    .poll(() =>
      page.locator('video').evaluate((video: HTMLVideoElement) => video.paused),
    )
    .toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(
    page.getByRole('button', { name: 'Pause video', exact: true }),
  ).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText('Offline · Photo preview')).toBeVisible();
  await expect(page.locator('video')).toHaveCount(0);
  await page.getByRole('button', { name: 'Share experience' }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { sharedLink: string }).sharedLink,
    ),
  ).toContain('/experiences/first-light');
  await context.setOffline(false);
});

test('slow video shows loading and recovers to a retryable photo preview', async ({
  page,
}) => {
  await page.clock.install();
  await page.route('**/*.mp4', () => {
    /* Keep the media request pending to simulate a stalled connection. */
  });
  await page.goto('/explore');
  await page.getByRole('button', { name: 'Play video', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Loading preview' }),
  ).toBeVisible();
  await page.clock.fastForward(8100);
  await expect(
    page.getByRole('button', { name: 'Retry video', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'Video unavailable' }),
  ).toBeVisible();
  await page.unroute('**/*.mp4');
  await page.clock.resume();
  await page.getByRole('button', { name: 'Retry video', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Pause video', exact: true }),
  ).toBeVisible();
});
