import type { Account, Envelope, Session } from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
  ) {
    super(message);
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  private?: boolean;
  signal?: AbortSignal;
  responseType?: 'blob';
};
type Snapshot = { user: Account | null; generation: number; notice: string };

export class ApiClient {
  private token: string | null = null;
  private expires = 0;
  private refreshTask: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending = new Set<AbortController>();
  private listeners = new Set<() => void>();
  private snapshot: Snapshot = { user: null, generation: 0, notice: '' };

  constructor(
    private base = '/v1',
    private fetcher: typeof fetch = (...args) => fetch(...args),
  ) {
    if (!base.startsWith('/') && !/^https?:\/\//.test(base))
      throw new Error('Invalid API base URL');
    if (base.startsWith('//')) throw new Error('Invalid API base URL');
    this.base = base.replace(/\/$/, '');
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;

  private emit(next: Snapshot) {
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }

  forget(notice = '') {
    this.token = null;
    this.expires = 0;
    clearTimeout(this.timer);
    this.refreshTask = null;
    this.pending.forEach((controller) => controller.abort());
    this.pending.clear();
    this.emit({ user: null, generation: this.snapshot.generation + 1, notice });
  }

  updateUser(user: Account) {
    if (this.snapshot.user?.id === user.id)
      this.emit({ ...this.snapshot, user });
  }

  private scheduleRefresh() {
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        void this.ensureFresh().catch(() => {
          if (this.token && Date.now() < this.expires) {
            this.timer = setTimeout(() => this.scheduleRefresh(), 30000);
          }
        });
      },
      Math.max(1000, this.expires - Date.now() - 60000),
    );
  }

  login(credentials: { email: string; password: string }) {
    return this.authenticate('/auth/login', credentials);
  }

  register(credentials: {
    displayName: string;
    email: string;
    password: string;
  }) {
    return this.authenticate('/auth/register', credentials);
  }

  private async authenticate(
    path: string,
    credentials: { email: string; password: string },
  ) {
    this.forget();
    const generation = this.snapshot.generation;
    const result = await this.raw<Session>(path, {
      method: 'POST',
      body: credentials,
    });
    if (generation !== this.snapshot.generation)
      throw new DOMException('Cancelled', 'AbortError');
    const session = result.data;
    if (
      typeof session.accessToken !== 'string' ||
      !Number.isFinite(Date.parse(session.expiresAt)) ||
      typeof session.user?.id !== 'string'
    ) {
      throw new ApiError(
        0,
        'INVALID_RESPONSE',
        'The sign-in response could not be read. Please try again.',
      );
    }
    this.token = session.accessToken;
    this.expires = Date.parse(session.expiresAt);
    this.emit({ user: session.user, generation, notice: '' });
    this.scheduleRefresh();
    return session.user;
  }

  private async ensureFresh() {
    if (!this.token)
      throw new ApiError(401, 'AUTH_REQUIRED', 'Sign in to continue.');
    if (Date.now() >= this.expires) {
      this.forget('Your session expired. Please sign in again.');
      throw new ApiError(
        401,
        'AUTH_REQUIRED',
        'Your session expired. Please sign in again.',
      );
    }
    if (this.expires - Date.now() > 60000 && !this.refreshTask) return;
    if (this.refreshTask) return this.refreshTask;
    const token = this.token;
    const generation = this.snapshot.generation;
    const task = this.raw<Omit<Session, 'user'>>(
      '/auth/refresh',
      { method: 'POST', private: true },
      token,
    )
      .then(({ data }) => {
        if (generation !== this.snapshot.generation || this.token !== token)
          return;
        if (
          typeof data.accessToken !== 'string' ||
          !Number.isFinite(Date.parse(data.expiresAt))
        ) {
          this.forget('Please sign in again.');
          throw new ApiError(
            0,
            'INVALID_RESPONSE',
            'The renewed session could not be read.',
          );
        }
        this.token = data.accessToken;
        this.expires = Date.parse(data.expiresAt);
        this.scheduleRefresh();
      })
      .catch((error: unknown) => {
        if (
          error instanceof ApiError &&
          error.status === 401 &&
          generation === this.snapshot.generation
        ) {
          this.forget('Your session ended. Please sign in again.');
        }
        throw error;
      })
      .finally(() => {
        if (this.refreshTask === task) this.refreshTask = null;
      });
    this.refreshTask = task;
    return task;
  }

  async request<T>(
    path: string,
    options: RequestOptions = {},
  ): Promise<Envelope<T>> {
    if (!options.private) return this.raw<T>(path, options);
    const generation = this.snapshot.generation;
    await this.ensureFresh();
    if (generation !== this.snapshot.generation || !this.token) {
      throw new DOMException('Session changed', 'AbortError');
    }
    const token = this.token!;
    try {
      const result = await this.raw<T>(path, options, token);
      if (generation !== this.snapshot.generation)
        throw new DOMException('Session changed', 'AbortError');
      return result;
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 401 &&
        generation === this.snapshot.generation
      ) {
        if (this.token && this.token !== token) {
          try {
            const result = await this.raw<T>(path, options, this.token);
            if (generation !== this.snapshot.generation)
              throw new DOMException('Session changed', 'AbortError');
            return result;
          } catch (retryError) {
            if (
              retryError instanceof ApiError &&
              retryError.status === 401 &&
              generation === this.snapshot.generation
            )
              this.forget('Your session ended. Please sign in again.');
            throw retryError;
          }
        }
        this.forget('Your session ended. Please sign in again.');
      }
      throw error;
    }
  }

  async logout(all = false) {
    const generation = this.snapshot.generation;
    let notice = all
      ? 'You have signed out of all sessions.'
      : 'You have signed out.';
    try {
      await this.request(all ? '/auth/logout-all' : '/auth/logout', {
        method: 'POST',
        private: true,
      });
    } catch {
      notice =
        'This browser is signed out, but we could not confirm sign-out on the server.';
    } finally {
      if (generation === this.snapshot.generation) this.forget(notice);
    }
  }

  private async raw<T>(
    path: string,
    options: RequestOptions,
    token?: string,
  ): Promise<Envelope<T>> {
    if (!path.startsWith('/') || path.startsWith('//'))
      throw new Error('Invalid API path');
    const controller = new AbortController();
    const cancel = () => controller.abort();
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) controller.abort();
    if (options.private) this.pending.add(controller);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 12000);
    try {
      const response = await this.fetcher(this.base + path, {
        method: options.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          ...(options.body !== undefined
            ? {
                'Content-Type':
                  options.body instanceof Blob
                    ? 'application/octet-stream'
                    : 'application/json',
              }
            : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(options.body !== undefined
          ? {
              body:
                options.body instanceof Blob
                  ? options.body
                  : JSON.stringify(options.body),
            }
          : {}),
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (response.status === 204) return { data: undefined as T };
      if (response.ok && options.responseType === 'blob') {
        return { data: (await response.blob()) as T };
      }
      let body;
      try {
        body = await response.json();
      } catch {
        throw new ApiError(
          response.status,
          'INVALID_RESPONSE',
          'The service returned an unreadable response. Please try again.',
        );
      }
      if (!response.ok) {
        throw new ApiError(
          response.status,
          typeof body?.error?.code === 'string'
            ? body.error.code
            : 'REQUEST_FAILED',
          typeof body?.error?.message === 'string'
            ? body.error.message
            : 'The request could not be completed.',
          body?.error?.requestId,
        );
      }
      if (!body || !Object.hasOwn(body, 'data'))
        throw new ApiError(
          response.status,
          'INVALID_RESPONSE',
          'The service returned an incomplete response.',
        );
      return body as Envelope<T>;
    } catch (error) {
      if (timedOut)
        throw new ApiError(
          0,
          'TIMEOUT',
          'This is taking longer than expected. Please try again.',
        );
      if (error instanceof ApiError || controller.signal.aborted) throw error;
      throw new ApiError(
        0,
        'NETWORK_ERROR',
        'We couldn’t reach the service. Check your connection and try again.',
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
      this.pending.delete(controller);
    }
  }
}

export function queryString(
  values: Record<string, string | number | undefined | null>,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== null && value !== '')
      params.set(key, String(value));
  params.sort();
  return params.toString();
}
