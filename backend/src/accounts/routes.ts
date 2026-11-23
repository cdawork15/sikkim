import { normalizeEmail } from './password.js';
import { tokenHash } from './model.js';
import type { Credentials, Registration } from './password-auth.js';
import type { OtpDelivery, OtpRequest, OtpVerify } from './otp.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Config } from '../config.js';
import type { Database } from '../db/database.js';
import { accountService } from './service.js';
import { sessionCookie } from './session-cookie.js';
import {
  AccountError,
  bearerToken,
  consentPurposes,
  demoAccounts,
  demoPolicyVersion,
  interestCodes,
  type ConsentPurpose,
  type DemoAccount,
  type PreferencePatch,
  type ProfilePatch,
  unauthenticated,
} from './model.js';

const noQuery = { type: 'object', additionalProperties: false, properties: {} };
const object = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({ type: 'object', additionalProperties: false, properties, required });
const text = (maxLength: number) => ({
  type: 'string',
  minLength: 1,
  maxLength,
  pattern: '\\S',
});
const nullable = (schema: Record<string, unknown>) => ({
  anyOf: [schema, { type: 'null' }],
});
const token = (request: FastifyRequest) =>
  bearerToken(request.headers.authorization);
const noBody = async (request: FastifyRequest) => {
  if (request.body !== undefined && request.body !== null) {
    throw new AccountError(
      400,
      'INVALID_REQUEST',
      'This request does not accept a body.',
    );
  }
};

export function registerAccounts(
  app: FastifyInstance,
  database: Database,
  config: Config,
  deliver?: OtpDelivery,
) {
  const service = accountService(database, config, deliver);
  const cookie = sessionCookie(config);
  // Every successful sign-in also stores the session in the HttpOnly cookie.
  const signedIn = <
    T extends { accessToken: string; absoluteExpiresAt: unknown },
  >(
    reply: FastifyReply,
    session: T,
  ) => {
    cookie.set(reply, session.accessToken, session.absoluteExpiresAt);
    return session;
  };
  app.get('/v1/interests', { schema: { querystring: noQuery } }, async () => ({
    data: await service.interests(),
  }));
  app.get('/v1/settings', { schema: { querystring: noQuery } }, async () => ({
    data: {
      auth: {
        // 'otp' when sign-in codes can be sent; password sign-in stays available.
        mode: config.otp.delivery === 'disabled' ? 'password' : 'otp',
        otpChannels:
          config.otp.delivery === 'disabled' ? [] : ['email', 'phone'],
        passwordSignInAvailable: true,
        realSignInAvailable: true,
        emailVerificationAvailable: false,
        passwordRecoveryAvailable: false,
        guestBrowsing: true,
      },
      languages: {
        content: ['en'],
        preferences: ['en', 'hi', 'ne'],
        fallback: 'en',
      },
      locationRequired: false,
      privacy: {
        demo: true,
        version: config.demoAuth ? demoPolicyVersion : null,
        permanentDeletionAvailable: false,
        choices: config.demoAuth
          ? [
              {
                purpose: 'personalisation',
                labelKey: 'privacy.personalisation',
                label: 'Use my interests for suggestions',
                defaultAccepted: false,
              },
              {
                purpose: 'marketing',
                labelKey: 'privacy.marketing',
                label: 'Send me optional offers and updates',
                defaultAccepted: false,
              },
            ]
          : [],
      },
      help: { status: 'not_configured', contact: null },
      safety: {
        noticeKey: 'safety.demoOnly',
        message:
          'Demo experiences are not verified offers or confirmed bookings.',
      },
    },
  }));

  const password = { type: 'string', minLength: 8, maxLength: 128 };
  const credentials = {
    email: { type: 'string', minLength: 3, maxLength: 254, format: 'email' },
    password,
  };
  const loginCredentials = {
    ...credentials,
    phone: { type: 'string', minLength: 6, maxLength: 20 },
  };
  const accountLimit = app.createRateLimit({
    max: 10,
    timeWindow: '15 minutes',
    // Limit by the account being tried, whether named by email or mobile digits.
    keyGenerator: (request) => {
      const body = request.body as Credentials;
      return tokenHash(
        body.email
          ? normalizeEmail(body.email)
          : 'phone:' + (body.phone ?? '').replace(/\D/g, '').slice(-10),
      );
    },
  });
  const passwordOptions = {
    config: { rateLimit: false as const },
    // Reuse the same IP limiter across both endpoints. The email check runs
    // after validation, using an independent counter rather than a second hook.
    onRequest: app.rateLimit({ max: 10, timeWindow: '1 minute' }),
    preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
      const result = await accountLimit(request);
      if (!result.isAllowed && result.isExceeded) {
        reply.header('retry-after', result.ttlInSeconds);
        throw new AccountError(
          429,
          'RATE_LIMITED',
          'Too many requests. Try again shortly.',
        );
      }
    },
  };
  app.post<{ Body: Registration }>(
    '/v1/auth/register',
    {
      ...passwordOptions,
      schema: {
        querystring: noQuery,
        body: object({ ...credentials, displayName: text(80) }, [
          'displayName',
          'email',
          'password',
        ]),
      },
    },
    async (request, reply) =>
      reply.code(201).send({
        data: signedIn(reply, await service.register(request.body, request.id)),
      }),
  );
  // Passwordless sign-in and sign-up with a one-time code by email or SMS.
  const otpLimit = {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  };
  app.post<{ Body: OtpRequest }>(
    '/v1/auth/otp/request',
    {
      ...otpLimit,
      schema: {
        querystring: noQuery,
        body: object(
          {
            channel: { type: 'string', enum: ['email', 'phone'] },
            destination: { type: 'string', minLength: 3, maxLength: 254 },
          },
          ['channel', 'destination'],
        ),
      },
    },
    async (request, reply) =>
      reply.code(202).send({ data: await service.requestCode(request.body) }),
  );
  app.post<{ Body: OtpVerify }>(
    '/v1/auth/otp/verify',
    {
      ...otpLimit,
      schema: {
        querystring: noQuery,
        body: object(
          {
            challengeId: { type: 'string', format: 'uuid' },
            code: { type: 'string', pattern: '^[0-9]{6}$' },
            displayName: text(80),
          },
          ['challengeId', 'code'],
        ),
      },
    },
    async (request, reply) => ({
      data: signedIn(reply, await service.verifyCode(request.body, request.id)),
    }),
  );
  app.post<{ Body: Credentials }>(
    '/v1/auth/login',
    {
      ...passwordOptions,
      schema: {
        querystring: noQuery,
        body: object(loginCredentials, ['password']),
      },
    },
    async (request, reply) => ({
      data: signedIn(reply, await service.login(request.body, request.id)),
    }),
  );
  app.put<{ Body: { currentPassword?: string; newPassword: string } }>(
    '/v1/me/password',
    {
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
      schema: {
        querystring: noQuery,
        body: object({ currentPassword: password, newPassword: password }, [
          'newPassword',
        ]),
      },
    },
    async (request) => ({
      data: await service.setPassword(
        bearerToken(request.headers.authorization),
        request.body,
        request.id,
      ),
    }),
  );

  if (config.demoAuth) {
    app.post<{ Body: { account: DemoAccount } }>(
      '/v1/auth/demo',
      {
        schema: {
          querystring: noQuery,
          body: object({ account: { type: 'string', enum: demoAccounts } }, [
            'account',
          ]),
        },
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      },
      async (request, reply) => {
        if (
          !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(
            request.raw.socket.remoteAddress ?? '',
          ) ||
          (request.headers.origin &&
            !config.origins.includes(request.headers.origin))
        ) {
          throw new AccountError(
            403,
            'FORBIDDEN',
            'Demo sign-in is only available locally.',
          );
        }
        return reply.code(201).send({
          data: signedIn(
            reply,
            await service.demoSession(request.body.account, request.id),
          ),
        });
      },
    );
  }

  app.post(
    '/v1/auth/refresh',
    { schema: { querystring: noQuery }, preValidation: noBody },
    async (request, reply) => ({
      data: signedIn(reply, await service.refresh(token(request), request.id)),
    }),
  );
  // After a reload the page has no token: the HttpOnly cookie restores it.
  app.post(
    '/v1/auth/resume',
    {
      schema: { querystring: noQuery },
      preValidation: noBody,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const saved = cookie.read(request);
      try {
        if (!saved) throw unauthenticated();
        return {
          data: signedIn(reply, await service.resume(saved, request.id)),
        };
      } catch (error) {
        if (error instanceof AccountError && error.statusCode === 401)
          cookie.clear(reply);
        throw error;
      }
    },
  );
  app.post(
    '/v1/auth/logout',
    { schema: { querystring: noQuery }, preValidation: noBody },
    async (request, reply) => {
      cookie.clear(reply);
      await service.logout(token(request), false, request.id);
      return reply.code(204).send();
    },
  );
  app.post(
    '/v1/auth/logout-all',
    { schema: { querystring: noQuery }, preValidation: noBody },
    async (request, reply) => {
      cookie.clear(reply);
      await service.logout(token(request), true, request.id);
      return reply.code(204).send();
    },
  );
  app.get('/v1/me', { schema: { querystring: noQuery } }, async (request) => ({
    data: await service.me(token(request)),
  }));
  app.patch<{ Body: ProfilePatch }>(
    '/v1/me',
    {
      schema: {
        querystring: noQuery,
        body: {
          ...object({
            displayName: text(80),
            language: { type: 'string', enum: ['en', 'hi', 'ne'] },
          }),
          minProperties: 1,
        },
      },
    },
    async (request) => ({
      data: await service.updateProfile(
        token(request),
        request.body,
        request.id,
      ),
    }),
  );
  app.patch<{ Body: PreferencePatch }>(
    '/v1/me/preferences',
    {
      schema: {
        querystring: noQuery,
        body: {
          ...object({
            chosenArea: nullable(text(80)),
            tripStart: nullable({
              type: 'string',
              pattern: '^\\d{4}-\\d{2}-\\d{2}$',
            }),
            tripDays: nullable({ type: 'integer', minimum: 2, maximum: 10 }),
            travellers: { type: 'integer', minimum: 1, maximum: 10 },
            pace: { type: 'string', enum: ['slow', 'balanced'] },
            notificationsEnabled: { type: 'boolean' },
            showInParticipantList: { type: 'boolean' },
          }),
          minProperties: 1,
        },
      },
    },
    async (request) => ({
      data: await service.updatePreferences(
        token(request),
        request.body,
        request.id,
      ),
    }),
  );
  app.put<{ Body: { codes: string[] } }>(
    '/v1/me/interests',
    {
      schema: {
        querystring: noQuery,
        body: object(
          {
            codes: {
              type: 'array',
              uniqueItems: true,
              maxItems: interestCodes.length,
              items: { type: 'string', enum: interestCodes },
            },
          },
          ['codes'],
        ),
      },
    },
    async (request) => ({
      data: await service.updateInterests(
        token(request),
        request.body.codes,
        request.id,
      ),
    }),
  );
  app.get(
    '/v1/me/consents',
    { schema: { querystring: noQuery } },
    async (request) => ({ data: await service.consents(token(request)) }),
  );
  app.put<{
    Params: { purpose: ConsentPurpose };
    Body: { accepted: boolean; version: string };
  }>(
    '/v1/me/consents/:purpose',
    {
      schema: {
        querystring: noQuery,
        params: object({ purpose: { type: 'string', enum: consentPurposes } }, [
          'purpose',
        ]),
        body: object({ accepted: { type: 'boolean' }, version: text(40) }, [
          'accepted',
          'version',
        ]),
      },
    },
    async (request) => ({
      data: await service.consent(
        token(request),
        request.params.purpose,
        request.body.accepted,
        request.body.version,
        request.id,
      ),
    }),
  );
  app.get(
    '/v1/me/export',
    { schema: { querystring: noQuery } },
    async (request, reply) => {
      const data = await service.exportAccount(token(request), request.id);
      return reply
        .header(
          'content-disposition',
          'attachment; filename="sikkim-account.json"',
        )
        .send({ data });
    },
  );
  app.post(
    '/v1/me/deletion-request',
    { schema: { querystring: noQuery }, preValidation: noBody },
    async (request, reply) =>
      reply.code(202).send({
        data: await service.requestDeletion(token(request), request.id),
      }),
  );
}
