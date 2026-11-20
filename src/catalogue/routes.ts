import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type { Database } from '../db/database.js';
import { bearerToken } from '../accounts/model.js';
import { catalogueService } from './service.js';
import {
  draftProperties,
  filterProperties,
  invalid,
  listSchema,
  object,
  revision,
  text,
  uuid,
  type Draft,
  type Filters,
  type Query,
  type Review,
} from './model.js';

const noQuery = object({});
const idParams = object({ id: uuid }, ['id']);
const privateQuery = object({
  after: uuid,
  status: {
    type: 'string',
    enum: ['draft', 'review', 'published', 'rejected', 'hidden'],
  },
});

export function registerCatalogue(
  app: FastifyInstance,
  database: Database,
  config: Config,
) {
  const service = catalogueService(database, config);

  app.get(
    '/v1/catalogue/options',
    { schema: { querystring: noQuery } },
    async () => ({ data: await service.options() }),
  );
  app.get('/v1/home', { schema: { querystring: noQuery } }, async () => ({
    data: await service.home(),
  }));
  app.get<{ Querystring: Query }>(
    '/v1/experiences',
    { schema: { querystring: listSchema } },
    (request) => service.list(request.query),
  );
  app.get<{ Params: { slug: string } }>(
    '/v1/experiences/:slug',
    {
      schema: {
        querystring: noQuery,
        params: object(
          { slug: { type: 'string', maxLength: 180, pattern: '^[a-z0-9-]+$' } },
          ['slug'],
        ),
      },
    },
    async (request) => ({ data: await service.detail(request.params.slug) }),
  );
  app.get<{ Params: { id: string }; Querystring: Query }>(
    '/v1/hosts/:id/experiences',
    {
      schema: { params: idParams, querystring: listSchema },
    },
    (request) => service.list(request.query, request.params.id),
  );
  app.get<{ Querystring: { q: string } }>(
    '/v1/search/suggestions',
    {
      schema: { querystring: object({ q: text(120) }, ['q']) },
    },
    async (request) => ({ data: await service.suggestions(request.query.q) }),
  );

  app.post<{ Body: Draft }>(
    '/v1/me/experiences',
    {
      schema: {
        querystring: noQuery,
        body: object(draftProperties, ['title']),
      },
    },
    async (request, reply) =>
      reply.code(201).send({
        data: await service.create(
          bearerToken(request.headers.authorization),
          request.body,
          request.id,
        ),
      }),
  );
  app.put<{ Params: { id: string }; Body: Draft & { revision: number } }>(
    '/v1/me/experiences/:id',
    {
      schema: {
        params: idParams,
        querystring: noQuery,
        body: object({ ...draftProperties, revision }, ['title', 'revision']),
      },
    },
    async (request) => ({
      data: await service.update(
        bearerToken(request.headers.authorization),
        request.params.id,
        request.body.revision,
        request.body,
        request.id,
      ),
    }),
  );
  app.post<{ Params: { id: string }; Body: { revision: number } }>(
    '/v1/me/experiences/:id/submit',
    {
      schema: {
        params: idParams,
        querystring: noQuery,
        body: object({ revision }, ['revision']),
      },
    },
    async (request) => ({
      data: await service.submit(
        bearerToken(request.headers.authorization),
        request.params.id,
        request.body.revision,
        request.id,
      ),
    }),
  );

  for (const [prefix, admin] of [
    ['me', false],
    ['admin', true],
  ] as const) {
    app.get<{ Querystring: { after?: string; status?: string } }>(
      `/v1/${prefix}/experiences`,
      {
        schema: { querystring: privateQuery },
      },
      (request) =>
        service.privateList(
          bearerToken(request.headers.authorization),
          request.query.after,
          request.query.status,
          admin,
        ),
    );
    app.get<{ Params: { id: string } }>(
      `/v1/${prefix}/experiences/:id`,
      {
        schema: { querystring: noQuery, params: idParams },
      },
      async (request) => ({
        data: await service.privateDetail(
          bearerToken(request.headers.authorization),
          request.params.id,
          admin,
        ),
      }),
    );
  }

  app.post<{ Params: { id: string }; Body: Review }>(
    '/v1/admin/experiences/:id/decisions',
    {
      schema: {
        querystring: noQuery,
        params: idParams,
        body: object(
          {
            revision,
            action: {
              type: 'string',
              enum: ['published', 'rejected', 'hidden'],
            },
            reason: text(1000),
            providerReference: text(1000),
            sourceVerified: { type: 'boolean' },
            featuredRank: {
              anyOf: [
                { type: 'integer', minimum: 0, maximum: 1000 },
                { type: 'null' },
              ],
            },
          },
          ['revision', 'action', 'reason'],
        ),
      },
    },
    async (request) => ({
      data: await service.decide(
        bearerToken(request.headers.authorization),
        request.params.id,
        request.body,
        request.id,
      ),
    }),
  );

  app.get(
    '/v1/me/searches',
    { schema: { querystring: noQuery } },
    async (request) => ({
      data: await service.searches(bearerToken(request.headers.authorization)),
    }),
  );
  app.put<{ Body: Partial<Filters> }>(
    '/v1/me/search-filters',
    {
      schema: {
        querystring: noQuery,
        body: object({
          ...filterProperties,
          minPricePaise: { type: 'integer', minimum: 0, maximum: 2147483647 },
          maxPricePaise: { type: 'integer', minimum: 0, maximum: 2147483647 },
        }),
      },
    },
    async (request) => ({
      data: await service.saveFilters(
        bearerToken(request.headers.authorization),
        request.body,
        request.id,
      ),
    }),
  );
  app.post<{ Body: { q: string } }>(
    '/v1/me/recent-searches',
    {
      schema: { querystring: noQuery, body: object({ q: text(120) }, ['q']) },
    },
    async (request, reply) => {
      await service.remember(
        bearerToken(request.headers.authorization),
        request.body.q,
      );
      return reply.code(204).send();
    },
  );
  app.delete(
    '/v1/me/recent-searches',
    {
      schema: { querystring: noQuery },
      preValidation: async (request) => {
        if (request.body !== undefined) {
          throw invalid('This request does not accept a body.');
        }
      },
    },
    async (request, reply) => {
      await service.clearSearches(
        bearerToken(request.headers.authorization),
        request.id,
      );
      return reply.code(204).send();
    },
  );
}
