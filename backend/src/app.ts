import { registerCommunity } from './community/routes.js';
import { registerContent } from './media/content-routes.js';
import { registerMedia } from './media/routes.js';
import { registerExperienceActions } from './media/action-routes.js';
import { registerCatalogue } from './catalogue/routes.js';
import { registerBookings } from './bookings/routes.js';
import { registerHosts } from './hosts/routes.js';
import { registerAdmin } from './admin/routes.js';
import { anthropicAssistant, type LeadAssistant } from './ai/assistant.js';
import { registerReels } from './reels/routes.js';
import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { Config } from './config.js';
import { createDatabase, type Database } from './db/database.js';
import { registerAccounts } from './accounts/routes.js';
import { AccountError } from './accounts/model.js';
import type { OtpDelivery } from './accounts/otp.js';
import { sesDelivery } from './accounts/ses.js';

const errorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message', 'requestId'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        requestId: { type: 'string', format: 'uuid' },
      },
    },
  },
};
const healthSchema = {
  querystring: { type: 'object', additionalProperties: false, properties: {} },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['data'],
      properties: {
        data: {
          type: 'object',
          additionalProperties: false,
          required: ['status'],
          properties: { status: { type: 'string', enum: ['ok'] } },
        },
      },
    },
    '4xx': errorSchema,
    '5xx': errorSchema,
  },
};

export async function buildApp(
  config: Config,
  options: {
    database?: Database;
    logStream?: Writable;
    rateLimitMax?: number;
    otpDelivery?: OtpDelivery;
    assistant?: LeadAssistant | null;
  } = {},
) {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      ...(options.logStream ? { stream: options.logStream } : {}),
      serializers: {
        req: (req) => ({ method: req.method }),
        res: (res) => ({ statusCode: res.statusCode }),
        err: () => ({
          type: 'InternalError',
          message: 'Internal error',
          stack: '',
        }),
      },
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
      ],
    },
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    trustProxy: config.trustProxy.length ? config.trustProxy : false,
    bodyLimit: 16 * 1024,
    requestTimeout: 10000,
    ajv: {
      customOptions: {
        removeAdditional: false,
        coerceTypes: false,
        useDefaults: false,
      },
    },
  });
  const database =
    options.database ??
    createDatabase(config, () =>
      app.log.error(
        { event: 'database_connection_error' },
        'Database connection failed',
      ),
    );
  const failure = (code: string, message: string, requestId: string) => ({
    error: { code, message, requestId },
  });

  app.addHook('onRequest', async (request, reply) => {
    reply
      .header('x-request-id', request.id)
      .header('cache-control', 'no-store');
    const invalidPreflight =
      request.method === 'OPTIONS' &&
      (!request.headers.origin ||
        !request.headers['access-control-request-method']);
    const bodyOnRead =
      ['GET', 'HEAD'].includes(request.method) &&
      (Number(request.headers['content-length'] ?? 0) > 0 ||
        Boolean(request.headers['transfer-encoding']));
    if (invalidPreflight || bodyOnRead) {
      return reply
        .code(400)
        .send(
          failure(
            'INVALID_REQUEST',
            'Check the request fields and try again.',
            request.id,
          ),
        );
    }
  });
  await app.register(helmet);
  await app.register(cors, {
    origin: config.origins,
    credentials: false,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Range'],
    exposedHeaders: ['X-Request-Id', 'Content-Range', 'Accept-Ranges'],
  });
  await app.register(rateLimit, {
    max: options.rateLimitMax ?? config.requestsPerMinute,
    timeWindow: '1 minute',
    errorResponseBuilder: (request) => ({
      statusCode: 429,
      ...failure(
        'RATE_LIMITED',
        'Too many requests. Try again shortly.',
        request.id,
      ),
    }),
  });
  app.setNotFoundHandler((request, reply) =>
    reply
      .code(404)
      .send(failure('NOT_FOUND', 'This endpoint does not exist.', request.id)),
  );
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AccountError) {
      return reply
        .code(error.statusCode)
        .send(failure(error.code, error.message, request.id));
    }
    const candidate =
      error &&
      typeof error === 'object' &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    const status = candidate >= 400 && candidate < 500 ? candidate : 500;
    const errors: Record<number, [string, string]> = {
      400: ['INVALID_REQUEST', 'Check the request fields and try again.'],
      413: ['REQUEST_TOO_LARGE', 'The request is too large.'],
      415: ['UNSUPPORTED_MEDIA_TYPE', 'Use the supported request format.'],
      429: ['RATE_LIMITED', 'Too many requests. Try again shortly.'],
    };
    const [code, message] =
      errors[status] ??
      (status < 500
        ? ['INVALID_REQUEST', 'The request could not be accepted.']
        : ['INTERNAL_ERROR', 'Something went wrong. Try again later.']);
    if (status === 500) {
      request.log.error({ event: 'request_failed' }, 'Request failed');
    }
    reply.code(status).send(failure(code!, message!, request.id));
  });
  app.get(
    '/v1/health/live',
    { schema: healthSchema, config: { rateLimit: false } },
    async () => ({ data: { status: 'ok' } }),
  );
  app.get(
    '/v1/health/ready',
    { schema: healthSchema },
    async (request, reply) => {
      try {
        await database.ready();
        return { data: { status: 'ok' } };
      } catch {
        request.log.warn(
          { event: 'database_not_ready' },
          'Database unavailable or migrations/permissions are not ready',
        );
        return reply
          .code(503)
          .send(
            failure(
              'NOT_READY',
              'Service is not ready. Try again shortly.',
              request.id,
            ),
          );
      }
    },
  );
  registerExperienceActions(app, database, config);
  // Local development prints sign-in codes to the server log. Production
  // needs an email/SMS provider (see README) before OTP_DELIVERY is enabled.
  const otpDelivery: OtpDelivery =
    options.otpDelivery ??
    (config.otp.delivery === 'email'
      ? sesDelivery(config.otp.fromAddress!, config.otp.region!, app.log)
      : async ({ channel, destination, code }) => {
          app.log.info(
            { event: 'otp_dev_code', channel, destination, code },
            'Development sign-in code',
          );
        });
  registerAccounts(app, database, config, otpDelivery);
  registerHosts(app, database, config);
  // The CRM AI assistant is off unless AI_PROVIDER is set (tests inject one).
  const assistant =
    options.assistant !== undefined
      ? options.assistant
      : config.ai.provider === 'anthropic'
        ? anthropicAssistant(config.ai)
        : null;
  registerAdmin(app, database, config, assistant);
  registerReels(app, database, config);
  registerCatalogue(app, database, config);
  registerBookings(app, database, config);
  registerCommunity(app, database, config);
  registerContent(app, database, config);
  const closeMedia = registerMedia(app, database, config);
  app.addHook('onClose', async () => {
    await closeMedia();
    await database.close();
  });
  return app;
}
