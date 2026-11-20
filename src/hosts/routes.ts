import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type { Database } from '../db/database.js';
import { bearerToken } from '../accounts/model.js';
import { hostService, type HostDraft, type Decision } from './service.js';
const object = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({ type: 'object', additionalProperties: false, properties, required });
const noQuery = object({});
const text = (maxLength: number) => ({
  type: 'string',
  minLength: 1,
  maxLength,
  pattern: '\\S',
});
const revision = { type: 'integer', minimum: 0, maximum: 2147483646 };
const idParams = object({ id: { type: 'string', format: 'uuid' } }, ['id']);

export function registerHosts(
  app: FastifyInstance,
  database: Database,
  config: Config,
) {
  const service = hostService(database, config);
  app.get('/v1/me/host', { schema: { querystring: noQuery } }, async (req) => ({
    data: await service.me(bearerToken(req.headers.authorization)),
  }));
  app.put<{ Body: HostDraft }>(
    '/v1/me/host',
    {
      schema: {
        querystring: noQuery,
        body: {
          ...object(
            {
              revision,
              publicName: text(80),
              story: text(2000),
              serviceAreas: {
                type: 'array',
                maxItems: 10,
                uniqueItems: true,
                items: text(80),
              },
              contactChoice: { enum: ['hidden', 'in_app'], type: 'string' },
            },
            ['revision'],
          ),
          minProperties: 2,
        },
      },
    },
    async (req) => ({
      data: await service.draft(
        bearerToken(req.headers.authorization),
        req.body,
        req.id,
      ),
    }),
  );
  app.post<{ Body: { revision: number } }>(
    '/v1/me/host/submit',
    {
      schema: {
        querystring: noQuery,
        body: object({ revision }, ['revision']),
      },
    },
    async (req) => ({
      data: await service.submit(
        bearerToken(req.headers.authorization),
        req.body.revision,
        req.id,
      ),
    }),
  );
  app.get<{ Querystring: { status?: string; after?: string } }>(
    '/v1/admin/hosts',
    {
      schema: {
        querystring: object({
          status: {
            type: 'string',
            enum: ['draft', 'pending', 'approved', 'rejected', 'suspended'],
          },
          after: { type: 'string', format: 'uuid' },
        }),
      },
    },
    async (req) =>
      service.reviewList(
        bearerToken(req.headers.authorization),
        req.query.status ?? 'pending',
        req.query.after,
      ),
  );
  app.get<{ Params: { id: string } }>(
    '/v1/admin/hosts/:id',
    { schema: { querystring: noQuery, params: idParams } },
    async (req) => ({
      data: await service.reviewDetail(
        bearerToken(req.headers.authorization),
        req.params.id,
      ),
    }),
  );
  app.post<{ Params: { id: string }; Body: Decision }>(
    '/v1/admin/hosts/:id/decisions',
    {
      schema: {
        querystring: noQuery,
        params: idParams,
        body: object(
          {
            revision,
            action: {
              type: 'string',
              enum: ['approved', 'rejected', 'suspended'],
            },
            reason: text(1000),
            expiresAt: { type: 'string', format: 'date-time' },
          },
          ['revision', 'action', 'reason'],
        ),
      },
    },
    async (req) => ({
      data: await service.decide(
        bearerToken(req.headers.authorization),
        req.params.id,
        req.body,
        req.id,
      ),
    }),
  );
  app.get<{ Querystring: { after?: string } }>(
    '/v1/hosts',
    {
      schema: {
        querystring: object({ after: { type: 'string', format: 'uuid' } }),
      },
    },
    async (req) => service.publicList(req.query.after),
  );
  app.get<{ Params: { id: string } }>(
    '/v1/hosts/:id',
    { schema: { querystring: noQuery, params: idParams } },
    async (req) => ({ data: await service.publicDetail(req.params.id) }),
  );
}
