// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import { DemoApp as App } from './DemoApp';
import { SAVED_KEY } from './lib/storage';

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const browserStorage = (
    globalThis as unknown as { jsdom: { window: Window } }
  ).jsdom.window.localStorage;
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get: () => browserStorage,
  });
  window.localStorage.clear();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function render(path = '/') {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    ),
  );
}

async function click(selector: string) {
  const target = container.querySelector<HTMLElement>(selector);
  expect(target, selector).not.toBeNull();
  await act(async () => target!.click());
}

describe('P01 app journeys', () => {
  it('enters as a guest and exposes all four navigation destinations', async () => {
    await render('/welcome');
    expect(container.querySelector('h1')?.textContent).toContain(
      'Arrive curious.',
    );
    await click('.welcome-copy button');
    expect(container.querySelector('h1')?.textContent).toContain(
      'Sunrise in the Himalayas',
    );
    expect(
      [...container.querySelectorAll('.main-nav a')].map(
        (link) => link.textContent,
      ),
    ).toEqual(['Home', 'Explore', 'Community', 'Essentials']);
    expect(container.querySelector('main')).toBe(document.activeElement);
  });

  it('filters Home and supports shareable category links', async () => {
    await render('/?category=food');
    expect(container.querySelectorAll('.experience-card')).toHaveLength(5);
    expect(container.querySelector('.experience-card h3')?.textContent).toBe(
      'Meet you at the momo table',
    );
    expect(container.querySelector('h1')?.textContent).toBe(
      'Meet you at the momo table',
    );
    expect(
      container
        .querySelector('.hero-actions .button-primary')
        ?.getAttribute('href'),
    ).toBe('/experiences/momo-table/book');
    await click('.reset-button');
    expect(container.querySelectorAll('.discovery-section')).toHaveLength(4);
    expect(
      container.querySelector('[aria-label="Pakyong discoveries"]'),
    ).not.toBeNull();
  });

  it('lets visitors control featured stories', async () => {
    await render();
    await click('[aria-label="Show Monastery Heritage Trail"]');
    expect(container.querySelector('h1')?.textContent).toContain(
      'Monastery Heritage Trail',
    );
    expect(
      container
        .querySelector('.discovery-hero-content a')
        ?.getAttribute('href'),
    ).toBe('/experiences/monastery-mornings');
  });

  it('saves, restores and removes ideas across navigation', async () => {
    window.localStorage.setItem(SAVED_KEY, '["momo-table"]');
    await render();
    await click('[aria-label="Save Chase the first light"]');
    expect(JSON.parse(window.localStorage.getItem(SAVED_KEY)!)).toEqual([
      'momo-table',
      'first-light',
    ]);
    await click('.header-save');
    expect(container.querySelectorAll('.experience-card')).toHaveLength(2);
    await click('[aria-label="Unsave Chase the first light"]');
    await click('[aria-label="Unsave Meet you at the momo table"]');
    expect(container.querySelector('.empty-state')?.textContent).toContain(
      'Make room for a little wonder.',
    );
  });

  it('handles search with no results and clears filters', async () => {
    await render('/explore?category=culture&q=unfindable');
    expect(container.querySelector('.empty-state h2')?.textContent).toBe(
      'A different trail, perhaps?',
    );
    await click('.empty-state button');
    expect(container.querySelectorAll('.experience-card')).toHaveLength(4);
  });

  it('opens an experience preview without offering a real booking', async () => {
    await render('/experiences/first-light');
    expect(container.querySelector('h1')?.textContent).toBe(
      'Chase the first light',
    );
    expect(container.querySelector('.prototype-note')?.textContent).toContain(
      'experience is an example',
    );
    await click('.preview-copy button');
    expect(
      container.querySelector('.preview-copy button')?.textContent,
    ).toContain('Saved to your ideas');
  });

  it.each(['/experiences/missing', '/unknown'])(
    'recovers from unknown routes: %s',
    async (path) => {
      await render(path);
      expect(container.querySelector('.empty-state a')).not.toBeNull();
      expect(container.querySelector('.fatal-error')).toBeNull();
    },
  );

  it('continues browsing when localStorage access is denied', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    await render();
    await click('[aria-label="Save Chase the first light"]');
    expect(container.querySelector('.storage-notice')?.textContent).toContain(
      'for this visit',
    );
    expect(
      container.querySelector('[aria-label="Unsave Chase the first light"]'),
    ).not.toBeNull();
  });

  it('replaces a failed card image with an accessible fallback', async () => {
    await render();
    await act(async () =>
      container
        .querySelector('.card-image img')!
        .dispatchEvent(new Event('error')),
    );
    expect(
      container.querySelector('.image-fallback')?.getAttribute('role'),
    ).toBe('img');
    expect(
      container.querySelector('.image-fallback')?.getAttribute('aria-label'),
    ).toContain('Concept artwork');
  });

  it('passes DOM accessibility rules on Home', async () => {
    await render();
    const result = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(
      result.violations.map((violation) => ({
        id: violation.id,
        description: violation.description,
      })),
    ).toEqual([]);
  });
});
