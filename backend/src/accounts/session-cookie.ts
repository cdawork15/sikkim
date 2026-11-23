import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';

// Keeps a browser signed in across reloads until the person signs out.
// The cookie is HttpOnly (page scripts cannot read it), SameSite=Strict (other
// sites cannot send it) and scoped to /v1/auth, so it only ever reaches the
// sign-in endpoints. Every other request still uses the in-memory bearer token.
export const sessionCookieName = 'sx_session';
const path = '/v1/auth';

export function sessionCookie(config: Config) {
  const attributes = (maxAge: number) =>
    [
      `Path=${path}`,
      `Max-Age=${maxAge}`,
      'HttpOnly',
      'SameSite=Strict',
      ...(config.session.cookieSecure ? ['Secure'] : []),
    ].join('; ');
  return {
    set(reply: FastifyReply, token: string, absoluteExpiresAt: unknown) {
      const ends = new Date(String(absoluteExpiresAt)).getTime();
      const maxAge = Math.max(0, Math.floor((ends - Date.now()) / 1000));
      reply.header(
        'set-cookie',
        `${sessionCookieName}=${token}; ${attributes(maxAge)}`,
      );
    },
    clear(reply: FastifyReply) {
      reply.header('set-cookie', `${sessionCookieName}=; ${attributes(0)}`);
    },
    read(request: FastifyRequest): string | undefined {
      for (const part of (request.headers.cookie ?? '').split(';')) {
        const [name, ...value] = part.trim().split('=');
        if (name === sessionCookieName) {
          const token = value.join('=');
          return /^[A-Za-z0-9_-]{20,200}$/.test(token) ? token : undefined;
        }
      }
      return undefined;
    },
  };
}
