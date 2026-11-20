import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type { Database } from '../db/database.js';
import { bearerToken } from '../accounts/model.js';
import { object, text, uuid, revision, invalid } from '../catalogue/model.js';
import { idParams, noQuery, pageQuery, revisionBody } from './model.js';
import { contentService, type Frame, type Placement } from './content.js';

const storyFields = {
  title: text(120),
  frames: {
    type: 'array',
    maxItems: 8,
    items: object(
      {
        assetId: uuid,
        caption: { type: 'string', maxLength: 500 },
      },
      ['assetId', 'caption'],
    ),
  },
};

export function registerContent(
  app: FastifyInstance,
  database: Database,
  config: Config,
) {
  const service = contentService(database, config);
  for (const kind of ['stories', 'reels'] as const) {
    app.get<{ Querystring: { after?: string } }>(
      `/v1/${kind}`,
      {
        schema: { querystring: pageQuery },
      },
      (request) => service[kind](request.query.after),
    );
  }
  app.get<{ Params: { id: string } }>(
    '/v1/stories/:id',
    {
      schema: { params: idParams, querystring: noQuery },
    },
    async (request) => ({ data: await service.story(request.params.id) }),
  );
  app.get<{ Querystring: { after?: string } }>(
    '/v1/me/stories',
    {
      schema: { querystring: pageQuery },
    },
    (request) =>
      service.ownStories(
        bearerToken(request.headers.authorization),
        request.query.after,
      ),
  );
  app.get(
    '/v1/me/story-views',
    { schema: { querystring: noQuery } },
    async (request) => ({
      data: await service.views(bearerToken(request.headers.authorization)),
    }),
  );
  app.post<{ Body: { title: string; frames: Frame[] } }>(
    '/v1/me/stories',
    {
      schema: {
        querystring: noQuery,
        body: object(storyFields, ['title', 'frames']),
      },
    },
    async (request, reply) =>
      reply.code(201).send({
        data: await service.saveStory(
          bearerToken(request.headers.authorization),
          request.body.title,
          request.body.frames,
        ),
      }),
  );
  app.put<{
    Params: { id: string };
    Body: { revision: number; title: string; frames: Frame[] };
  }>(
    '/v1/me/stories/:id',
    {
      schema: {
        params: idParams,
        querystring: noQuery,
        body: object({ ...storyFields, revision }, [
          'title',
          'frames',
          'revision',
        ]),
      },
    },
    async (request) => ({
      data: await service.saveStory(
        bearerToken(request.headers.authorization),
        request.body.title,
        request.body.frames,
        request.params.id,
        request.body.revision,
      ),
    }),
  );
  for (const action of ['publish', 'hide'] as const) {
    app.post<{ Params: { id: string }; Body: { revision: number } }>(
      `/v1/me/stories/:id/${action}`,
      {
        schema: { params: idParams, querystring: noQuery, body: revisionBody },
      },
      async (request, reply) => {
        await service.publishStory(
          bearerToken(request.headers.authorization),
          request.params.id,
          request.body.revision,
          action === 'publish',
          request.id,
        );
        return reply.code(204).send();
      },
    );
  }
  app.put<{ Params: { id: string } }>(
    '/v1/me/stories/:id/seen',
    {
      schema: { params: idParams, querystring: noQuery },
      preValidation: async (request) => {
        if (request.body !== undefined) {
          throw invalid('This request does not accept a body.');
        }
      },
    },
    async (request, reply) => {
      await service.seen(
        bearerToken(request.headers.authorization),
        request.params.id,
      );
      return reply.code(204).send();
    },
  );
  app.get<{ Params: { id: string } }>(
    '/v1/me/experiences/:id/media',
    {
      schema: { params: idParams, querystring: noQuery },
    },
    async (request) => ({
      data: await service.placements(
        bearerToken(request.headers.authorization),
        request.params.id,
      ),
    }),
  );
  app.put<{
    Params: { id: string };
    Body: { revision: number; items: Placement[] };
  }>(
    '/v1/me/experiences/:id/media',
    {
      schema: {
        params: idParams,
        querystring: noQuery,
        body: object(
          {
            revision,
            items: {
              type: 'array',
              maxItems: 12,
              items: object(
                {
                  assetId: uuid,
                  purpose: {
                    type: 'string',
                    enum: ['gallery', 'cover', 'reel'],
                  },
                },
                ['assetId', 'purpose'],
              ),
            },
          },
          ['revision', 'items'],
        ),
      },
    },
    async (request) => ({
      data: await service.attach(
        bearerToken(request.headers.authorization),
        request.params.id,
        request.body.revision,
        request.body.items,
        request.id,
      ),
    }),
  );
}
