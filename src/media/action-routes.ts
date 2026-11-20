import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type { Database } from '../db/database.js';
import { bearerToken } from '../accounts/model.js';
import { invalid, object } from '../catalogue/model.js';
import { idParams, noQuery, pageQuery } from './model.js';
import { experienceActions } from './actions.js';

export function registerExperienceActions(
  app: FastifyInstance,
  database: Database,
  config: Config,
) {
  const service = experienceActions(database, config);
  app.get<{ Querystring: { after?: string } }>(
    '/v1/me/saved',
    { schema: { querystring: pageQuery } },
    (request) =>
      service.saved(
        bearerToken(request.headers.authorization),
        request.query.after,
      ),
  );
  app.get<{ Querystring: { ids: string } }>(
    '/v1/me/experience-actions',
    {
      schema: {
        querystring: object(
          {
            ids: {
              type: 'string',
              maxLength: 1849,
              pattern: '^[0-9a-fA-F-]{36}(,[0-9a-fA-F-]{36}){0,49}$',
            },
          },
          ['ids'],
        ),
      },
    },
    async (request) => {
      const ids = [...new Set(request.query.ids.split(','))];
      if (
        ids.some(
          (id) => !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id),
        )
      ) {
        throw invalid();
      }
      return {
        data: await service.states(
          bearerToken(request.headers.authorization),
          ids,
        ),
      };
    },
  );
  for (const [path, kind] of [
    ['saved', 'saved'],
    ['likes', 'liked'],
  ] as const) {
    for (const method of ['PUT', 'DELETE'] as const) {
      app.route<{ Params: { id: string } }>({
        method,
        url: `/v1/me/${path}/experiences/:id`,
        schema: { params: idParams, querystring: noQuery },
        preValidation: async (request) => {
          if (request.body !== undefined) {
            throw invalid('This request does not accept a body.');
          }
        },
        handler: async (request, reply) => {
          await service.set(
            bearerToken(request.headers.authorization),
            request.params.id,
            kind,
            method === 'PUT',
          );
          return reply.code(204).send();
        },
      });
    }
  }
}
