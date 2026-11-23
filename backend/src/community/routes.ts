import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import type { Config } from '../config.js';
import type { Database } from '../db/database.js';
import { accountAccess } from '../accounts/access.js';
import { bearerToken } from '../accounts/model.js';
import { object, revision, uuid } from '../catalogue/model.js';
import {
  conflict,
  details,
  eventProperties,
  eventSchema,
  invalid,
  unavailable,
  type EventInput,
} from './model.js';
import { preparePhotos } from './photos.js';
import { publicEvent, read, select, type EventRow } from './events.js';
import {
  confirmedCount,
  promoteWaiting,
  registerCommunityGroups,
} from './groups.js';

const params = object({ id: uuid }, ['id']);
async function owned(
  client: PoolClient,
  id: string,
  userId: string,
  expected?: number,
) {
  const row = (
    await client.query<{ revision: number; status: string }>(
      'SELECT revision, status FROM public.community_events WHERE id=$1 AND owner_id=$2 FOR UPDATE',
      [id, userId],
    )
  ).rows[0];
  if (!row) throw unavailable();
  if (
    row.status !== 'published' ||
    (expected !== undefined && row.revision !== expected)
  )
    throw conflict();
}

export function registerCommunity(
  app: FastifyInstance,
  database: Database,
  config: Config,
) {
  const authenticated = accountAccess(database, config);
  registerCommunityGroups(app, database, config);
  app.get<{ Querystring: { after?: string } }>(
    '/v1/community/events',
    {
      schema: { querystring: object({ after: uuid }) },
    },
    async (request) =>
      database.transaction(async (client) => {
        const rows = (
          await client.query<EventRow>(
            `${select}
      WHERE u.status='active' AND ($1::uuid IS NULL OR e.id > $1)
      ORDER BY e.id LIMIT 101`,
            [request.query.after ?? null],
          )
        ).rows;
        const more = rows.length > 100;
        const page = rows.slice(0, 100);
        return {
          data: page.map(publicEvent),
          page: { nextCursor: more ? page.at(-1)!.id : null },
        };
      }),
  );
  app.get<{ Params: { id: string } }>(
    '/v1/community/events/:id',
    { schema: { params } },
    async (request) => ({
      data: await database.transaction((client) =>
        read(client, request.params.id),
      ),
    }),
  );
  app.get<{ Params: { id: string } }>(
    '/v1/community/photos/:id',
    { schema: { params } },
    async (request, reply) => {
      const photo = await database.transaction(
        async (client) =>
          (
            await client.query<{ content: Buffer }>(
              `SELECT p.content FROM public.community_photos p
       JOIN public.community_events e ON e.id=p.event_id JOIN public.users u ON u.id=e.owner_id
       WHERE p.id=$1 AND u.status='active'`,
              [request.params.id],
            )
          ).rows[0],
      );
      if (!photo) throw unavailable();
      return reply.type('image/webp').send(photo.content);
    },
  );
  const writeOptions = {
    bodyLimit: 810000,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  };
  async function save(
    token: string,
    input: EventInput,
    id?: string,
    expected?: number,
  ) {
    const value = details(input);
    // Authenticate before expensive decoding, then recheck ownership/session on commit.
    await authenticated(token, async (client, actor) => {
      if (id) await owned(client, id, actor.userId, expected);
    });
    const photos = await preparePhotos(input.images);
    return authenticated(token, async (client, actor) => {
      if (id) {
        await owned(client, id, actor.userId, expected);
        if (value.capacity < (await confirmedCount(client, id)))
          throw invalid(
            'Keep enough places for the people you have already confirmed.',
          );
      }
      const existing = id
        ? (
            await client.query<{ id: string; content: Buffer }>(
              'SELECT id, content FROM public.community_photos WHERE event_id=$1',
              [id],
            )
          ).rows
        : [];
      for (const photo of photos) {
        if (!photo.content) {
          const saved = existing.find((p) => p.id === photo.id);
          if (saved) photo.content = saved.content;
        }
        if (!photo.content) throw unavailable();
      }
      let eventId = id;
      if (eventId) {
        await client.query(
          'UPDATE public.community_events SET details=$2, revision=revision+1 WHERE id=$1',
          [eventId, value],
        );
        await client.query(
          'DELETE FROM public.community_photos WHERE event_id=$1',
          [eventId],
        );
      } else {
        eventId = (
          await client.query<{ id: string }>(
            'INSERT INTO public.community_events(owner_id, details) VALUES($1,$2) RETURNING id',
            [actor.userId, value],
          )
        ).rows[0]!.id;
      }
      for (const [position, photo] of photos.entries()) {
        await client.query(
          'INSERT INTO public.community_photos(id,event_id,position,content) VALUES($1,$2,$3,$4)',
          [photo.id, eventId, position, photo.content],
        );
      }
      // More places may let people on the waiting list in.
      await promoteWaiting(client, {
        id: eventId,
        details: value,
        status: 'published',
      });
      return read(client, eventId);
    });
  }
  app.post<{ Body: EventInput }>(
    '/v1/community/events',
    {
      ...writeOptions,
      schema: { body: eventSchema },
    },
    async (request, reply) =>
      reply.code(201).send({
        data: await save(
          bearerToken(request.headers.authorization),
          request.body,
        ),
      }),
  );
  app.put<{ Params: { id: string }; Body: EventInput & { revision: number } }>(
    '/v1/community/events/:id',
    {
      ...writeOptions,
      schema: {
        params,
        body: object({ ...eventProperties, revision }, [
          ...Object.keys(eventProperties),
          'revision',
        ]),
      },
    },
    async (request) => {
      const { revision: expected, ...input } = request.body;
      return {
        data: await save(
          bearerToken(request.headers.authorization),
          input,
          request.params.id,
          expected,
        ),
      };
    },
  );
  app.post<{ Params: { id: string }; Body: { revision: number } }>(
    '/v1/community/events/:id/cancel',
    {
      schema: { params, body: object({ revision }, ['revision']) },
    },
    async (request) => ({
      data: await authenticated(
        bearerToken(request.headers.authorization),
        async (client, actor) => {
          await owned(
            client,
            request.params.id,
            actor.userId,
            request.body.revision,
          );
          await client.query(
            "UPDATE public.community_events SET status='cancelled', revision=revision+1 WHERE id=$1",
            [request.params.id],
          );
          return read(client, request.params.id);
        },
      ),
    }),
  );
}
