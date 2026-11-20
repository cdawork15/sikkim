import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, queryString } from './client';
import type { Account } from './types';

const user = {
  id: 'user-one',
  displayName: 'Test traveller',
  roles: ['traveller'],
} as Account;
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const session = (token = 'test-token', seconds = 1800) => ({
  accessToken: token,
  expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
  absoluteExpiresAt: new Date(Date.now() + 86400000).toISOString(),
  user,
});
const clients: ApiClient[] = [];
function client(fetcher: typeof fetch) {
  const result = new ApiClient('/v1', fetcher);
  clients.push(result);
  return result;
}
afterEach(() => {
  clients.forEach((value) => value.forget());
  clients.length = 0;
  vi.useRealTimers();
});

describe('API sessions and requests', () => {
  it('sends tokens only on private requests and never uses cookies', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(session()))
      .mockImplementation(async () => response(user));
    const api = client(fetcher);
    await api.login({
      email: 'traveller@example.com',
      password: 'A long test passphrase',
    });
    await api.request('/me', { private: true });
    await api.request('/home');
    expect(fetcher.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer test-token',
    });
    expect(fetcher.mock.calls[2]?.[1]?.headers).not.toHaveProperty(
      'Authorization',
    );
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      credentials: 'omit',
      cache: 'no-store',
    });
    expect(client(fetcher).getSnapshot().user).toBeNull();
  });
  it('rotates a near-expiry token once for concurrent requests', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path) => {
      if (String(path).endsWith('/login')) return response(session('old', 30));
      if (String(path).endsWith('/refresh')) return response(session('new'));
      return response(user);
    });
    const api = client(fetcher);
    await api.login({
      email: 'traveller@example.com',
      password: 'A long test passphrase',
    });
    await Promise.all([
      api.request('/me', { private: true }),
      api.request('/me/consents', { private: true }),
    ]);
    expect(
      fetcher.mock.calls.filter(([path]) => String(path).endsWith('/refresh')),
    ).toHaveLength(1);
    for (const [, options] of fetcher.mock.calls.slice(2))
      expect(options?.headers).toMatchObject({ Authorization: 'Bearer new' });
  });
  it('clears a rejected session without retrying a mutation', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(session()))
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'AUTH_REQUIRED',
              message: 'Sign in again.',
              requestId: 'request-1',
            },
          }),
          { status: 401 },
        ),
      );
    const api = client(fetcher);
    await api.login({
      email: 'traveller@example.com',
      password: 'A long test passphrase',
    });
    await expect(
      api.request('/me', {
        private: true,
        method: 'PATCH',
        body: { displayName: 'Changed' },
      }),
    ).rejects.toMatchObject({ status: 401, requestId: 'request-1' });
    expect(api.getSnapshot().user).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('ignores an old account response after sign-out even if transport ignores abort', async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(session()))
      .mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
    const api = client(fetcher);
    await api.login({
      email: 'traveller@example.com',
      password: 'A long test passphrase',
    });
    const pending = api.request('/me', { private: true });
    await Promise.resolve();
    api.forget();
    resolve(response(user));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(api.getSnapshot().user).toBeNull();
  });
  it('does not send a queued private mutation after the account changes', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(session()));
    const api = client(fetcher);
    await api.login({
      email: 'traveller@example.com',
      password: 'A long test passphrase',
    });
    const pending = api.request('/me/deletion-request', {
      method: 'POST',
      private: true,
    });
    api.forget();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('signs out locally when the network fails and explains the server uncertainty', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(session()))
      .mockRejectedValue(new TypeError('offline'));
    const api = client(fetcher);
    await api.login({
      email: 'traveller@example.com',
      password: 'A long test passphrase',
    });
    await api.logout(true);
    expect(api.getSnapshot().user).toBeNull();
    expect(api.getSnapshot().notice).toContain('could not confirm');
  });
  it('accepts empty 204 results and rejects malformed or failed responses', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response('<html>Unavailable</html>'))
      .mockRejectedValueOnce(new TypeError('offline'));
    const api = client(fetcher);
    expect(await api.request('/empty')).toEqual({ data: undefined });
    await expect(api.request('/bad')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    await expect(api.request('/offline')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });
  it('times out stalled requests and respects caller cancellation', async () => {
    vi.useFakeTimers();
    const api = client(
      (_path, options) =>
        new Promise((_resolve, reject) =>
          options?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Cancelled', 'AbortError')),
          ),
        ),
    );
    const timeout = expect(api.request('/slow')).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(12000);
    await timeout;
    const controller = new AbortController();
    const cancelled = expect(
      api.request('/cancel', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await cancelled;
  });
  it('rejects unauthenticated private requests before making a request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      client(fetcher).request('/me', { private: true }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(fetcher).not.toHaveBeenCalled();
    expect(queryString({ q: 'tea & walk', price: 0, empty: '' })).toBe(
      'price=0&q=tea+%26+walk',
    );
  });
});

it('uploads binary files and reads private previews without exposing tokens in URLs', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response(session()))
    .mockResolvedValueOnce(response({ state: 'processing' }, 202))
    .mockResolvedValueOnce(
      new Response('preview', { headers: { 'Content-Type': 'image/webp' } }),
    );
  const api = client(fetcher);
  await api.login({
    email: 'traveller@example.com',
    password: 'A long test passphrase',
  });
  const file = new Blob(['file bytes'], { type: 'video/mp4' });
  await api.request('/me/media/file/content?signature=test', {
    method: 'PUT',
    private: true,
    body: file,
  });
  expect(fetcher.mock.calls[1]?.[1]?.body).toBe(file);
  expect(fetcher.mock.calls[1]?.[1]?.headers).toMatchObject({
    'Content-Type': 'application/octet-stream',
    Authorization: 'Bearer test-token',
  });
  const preview = await api.request<Blob>(
    '/me/media/file/image?signature=test',
    { private: true, responseType: 'blob' },
  );
  expect(await preview.data.text()).toBe('preview');
  expect(
    fetcher.mock.calls.every(([url]) => !String(url).includes('test-token')),
  ).toBe(true);
});

it('registers with credentials and starts a revocable in-memory session', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(response(session(), 201));
  const api = client(fetcher);
  const input = {
    displayName: 'Pema',
    email: 'pema@example.com',
    password: 'A long mountain passphrase',
  };
  await api.register(input);
  expect(fetcher.mock.calls[0]?.[0]).toBe('/v1/auth/register');
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual(input);
  expect(fetcher.mock.calls[0]?.[1]?.headers).not.toHaveProperty(
    'Authorization',
  );
  expect(api.getSnapshot().user).toEqual(user);
  api.forget();
  expect(api.getSnapshot().user).toBeNull();
});

it('does not create a session after an unsuccessful password login', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        error: {
          code: 'LOGIN_FAILED',
          message: 'Email or password is incorrect.',
        },
      }),
      { status: 401 },
    ),
  );
  const api = client(fetcher);
  await expect(
    api.login({
      email: 'pema@example.com',
      password: 'An incorrect passphrase',
    }),
  ).rejects.toMatchObject({ code: 'LOGIN_FAILED' });
  expect(api.getSnapshot().user).toBeNull();
});
