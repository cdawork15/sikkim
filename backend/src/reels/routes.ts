import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type { Database } from '../db/database.js';
import { bearerToken } from '../accounts/model.js';
import { idParams, noQuery, pageQuery } from '../media/model.js';
import { reelService, type ReelInput } from './service.js';

const uuid = { type: 'string', format: 'uuid' };

export function registerReels(
  app: FastifyInstance,
  database: Database,
  config: Config,
) {
  const service = reelService(database, config);
  // Public feed of approved reels shared by travellers, hosts and staff.
  app.get<{ Querystring: { after?: string } }>(
    '/v1/community-reels',
    { schema: { querystring: pageQuery } },
    (request) => service.feed(request.query.after),
  );
  app.get(
    '/v1/me/reels',
    { schema: { querystring: noQuery } },
    async (request) => ({
      data: await service.mine(bearerToken(request.headers.authorization)),
    }),
  );
  app.post<{ Body: ReelInput }>(
    '/v1/me/reels',
    {
      schema: {
        querystring: noQuery,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['assetId'],
          properties: {
            assetId: uuid,
            caption: { type: 'string', maxLength: 300 },
            place: { type: 'string', maxLength: 120 },
            experienceId: { anyOf: [uuid, { type: 'null' }] },
          },
        },
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
  app.delete<{ Params: { id: string } }>(
    '/v1/me/reels/:id',
    { schema: { querystring: noQuery, params: idParams } },
    async (request, reply) => {
      await service.remove(
        bearerToken(request.headers.authorization),
        request.params.id,
        request.id,
      );
      return reply.code(204).send();
    },
  );
}
