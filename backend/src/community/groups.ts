import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import type { Config } from '../config.js';
import type { Database } from '../db/database.js';
import { accountAccess } from '../accounts/access.js';
import { AccountError, bearerToken } from '../accounts/model.js';
import { object, text, uuid } from '../catalogue/model.js';
import { eventTimes, publicEvent, select, type EventRow } from './events.js';
import { invalid, unavailable, type EventInput } from './model.js';

// Group membership and group chat for Community events.
//
// Who can chat: the host, and members the host has confirmed. On events that
// need approval every member is confirmed by the host. On free events without
// approval the host has chosen to confirm everyone who joins while places
// remain; later joiners wait and move up when a place frees.

type Status = 'requested' | 'confirmed' | 'waiting' | 'declined' | 'left';
type LockedEvent = {
  id: string;
  owner_id: string;
  status: string;
  details: Omit<EventInput, 'images'>;
};
const closed = (message: string, code = 'EVENT_CLOSED') =>
  new AccountError(409, code, message);
const forbidden = () =>
  new AccountError(
    403,
    'CHAT_NOT_ALLOWED',
    'Group chat is open to the host and confirmed members only.',
  );

// Every membership change and every chat post takes this row lock first, so
// capacity checks cannot race and message ids commit in order.
async function lockEvent(client: PoolClient, id: string) {
  const row = (
    await client.query<LockedEvent>(
      `SELECT e.id, e.owner_id, e.status, e.details FROM public.community_events e
       JOIN public.users u ON u.id=e.owner_id
       WHERE e.id=$1 AND u.status='active' FOR UPDATE OF e`,
      [id],
    )
  ).rows[0];
  if (!row) throw unavailable();
  return row;
}
async function memberStatus(
  client: PoolClient,
  eventId: string,
  userId: string,
) {
  return (
    (
      await client.query<{ status: Status }>(
        'SELECT status FROM public.community_members WHERE event_id=$1 AND user_id=$2',
        [eventId, userId],
      )
    ).rows[0]?.status ?? null
  );
}
export async function confirmedCount(client: PoolClient, eventId: string) {
  return (
    await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM public.community_members WHERE event_id=$1 AND status='confirmed'",
      [eventId],
    )
  ).rows[0]!.count;
}
async function setStatus(
  client: PoolClient,
  eventId: string,
  userId: string,
  status: Status,
  decidedBy: string | null = null,
) {
  await client.query(
    `INSERT INTO public.community_members(event_id,user_id,status,decided_by)
     VALUES($1,$2,$3,$4)
     ON CONFLICT (event_id,user_id) DO UPDATE
       SET status=EXCLUDED.status, decided_by=EXCLUDED.decided_by, updated_at=clock_timestamp()`,
    [eventId, userId, status, decidedBy],
  );
}
// Free events without approval: fill open places from the waiting list, oldest first.
export async function promoteWaiting(
  client: PoolClient,
  event: Pick<LockedEvent, 'id' | 'details' | 'status'>,
) {
  if (event.details.approval || event.status !== 'published') return;
  const open =
    event.details.capacity - (await confirmedCount(client, event.id));
  if (open <= 0) return;
  await client.query(
    `UPDATE public.community_members SET status='confirmed', updated_at=clock_timestamp()
     WHERE (event_id,user_id) IN (
       SELECT event_id,user_id FROM public.community_members
       WHERE event_id=$1 AND status='waiting' ORDER BY updated_at, user_id LIMIT $2)`,
    [event.id, open],
  );
}
function membership(event: LockedEvent, userId: string, status: Status | null) {
  const host = event.owner_id === userId;
  return {
    eventId: event.id,
    role: host
      ? 'host'
      : status && ['requested', 'confirmed', 'waiting'].includes(status)
        ? 'member'
        : null,
    status: host ? 'confirmed' : status,
    canChat: host || status === 'confirmed',
  };
}
async function requireChat(
  client: PoolClient,
  eventId: string,
  userId: string,
) {
  const event = await lockEvent(client, eventId);
  const status = await memberStatus(client, eventId, userId);
  if (!membership(event, userId, status).canChat) throw forbidden();
  return event;
}
async function requireHost(
  client: PoolClient,
  eventId: string,
  userId: string,
) {
  const event = await lockEvent(client, eventId);
  if (event.owner_id !== userId) throw unavailable();
  return event;
}
async function members(client: PoolClient, eventId: string) {
  return (
    await client.query(
      `SELECT m.user_id AS "userId", u.display_name AS name, m.status,
         m.updated_at AS "updatedAt"
       FROM public.community_members m JOIN public.users u ON u.id=m.user_id
       WHERE m.event_id=$1 AND m.status IN ('requested','confirmed','waiting')
         AND u.status='active'
       ORDER BY m.updated_at, m.user_id LIMIT 200`,
      [eventId],
    )
  ).rows;
}
const messageColumns = `m.id::text AS id, m.body, m.created_at AS "createdAt",
  u.display_name AS author, (m.author_id=$2) AS mine,
  (m.author_id=e.owner_id) AS host`;

const params = object({ id: uuid }, ['id']);
const memberParams = object({ id: uuid, userId: uuid }, ['id', 'userId']);
const empty = object({});

export function registerCommunityGroups(
  app: FastifyInstance,
  database: Database,
  config: Config,
) {
  const authenticated = accountAccess(database, config);
  const as = <T>(
    authorization: string | undefined,
    operation: (client: PoolClient, userId: string) => Promise<T>,
  ) =>
    authenticated(bearerToken(authorization), (client, actor) =>
      operation(client, actor.userId),
    );

  app.get<{ Params: { id: string } }>(
    '/v1/community/events/:id/membership',
    { schema: { params, querystring: empty } },
    async (request) => ({
      data: await as(request.headers.authorization, async (client, userId) => {
        const event = await lockEvent(client, request.params.id);
        return membership(
          event,
          userId,
          await memberStatus(client, event.id, userId),
        );
      }),
    }),
  );

  app.post<{ Params: { id: string } }>(
    '/v1/community/events/:id/join',
    {
      schema: { params, body: empty },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request) => ({
      data: await as(request.headers.authorization, async (client, userId) => {
        const event = await lockEvent(client, request.params.id);
        if (event.owner_id === userId) throw invalid('You host this event.');
        const current = await memberStatus(client, event.id, userId);
        if (
          current === 'requested' ||
          current === 'confirmed' ||
          current === 'waiting'
        )
          return membership(event, userId, current);
        if (current === 'declined')
          throw closed(
            'The host has not confirmed you for this event.',
            'MEMBERSHIP_DECLINED',
          );
        if (event.status !== 'published')
          throw closed('This event is cancelled. Joining is closed.');
        if (eventTimes(event.details).end <= Date.now())
          throw closed('This event has ended.');
        if (event.details.price > 0)
          throw closed(
            'Paid events can’t be joined yet.',
            'PAYMENT_UNAVAILABLE',
          );
        const next: Status = event.details.approval
          ? 'requested'
          : (await confirmedCount(client, event.id)) < event.details.capacity
            ? 'confirmed'
            : 'waiting';
        await setStatus(client, event.id, userId, next);
        return membership(event, userId, next);
      }),
    }),
  );

  app.post<{ Params: { id: string } }>(
    '/v1/community/events/:id/leave',
    { schema: { params, body: empty } },
    async (request) => ({
      data: await as(request.headers.authorization, async (client, userId) => {
        const event = await lockEvent(client, request.params.id);
        const current = await memberStatus(client, event.id, userId);
        if (
          current === 'requested' ||
          current === 'confirmed' ||
          current === 'waiting'
        ) {
          await setStatus(client, event.id, userId, 'left');
          if (current === 'confirmed') await promoteWaiting(client, event);
          return membership(event, userId, 'left');
        }
        return membership(event, userId, current);
      }),
    }),
  );

  app.get<{ Params: { id: string } }>(
    '/v1/community/events/:id/members',
    { schema: { params, querystring: empty } },
    async (request) => ({
      data: await as(request.headers.authorization, async (client, userId) => {
        await requireHost(client, request.params.id, userId);
        return members(client, request.params.id);
      }),
    }),
  );

  app.post<{ Params: { id: string; userId: string } }>(
    '/v1/community/events/:id/members/:userId/confirm',
    { schema: { params: memberParams, body: empty } },
    async (request) => ({
      data: await as(request.headers.authorization, async (client, userId) => {
        const event = await requireHost(client, request.params.id, userId);
        if (event.status !== 'published')
          throw closed('This event is cancelled.');
        const current = await memberStatus(
          client,
          event.id,
          request.params.userId,
        );
        if (
          current !== 'requested' &&
          current !== 'waiting' &&
          current !== 'confirmed'
        )
          throw unavailable();
        if (current !== 'confirmed') {
          if (
            (await confirmedCount(client, event.id)) >= event.details.capacity
          )
            throw closed(
              'All places are taken. Add places or remove someone first.',
              'EVENT_FULL',
            );
          await setStatus(
            client,
            event.id,
            request.params.userId,
            'confirmed',
            userId,
          );
        }
        return members(client, event.id);
      }),
    }),
  );

  app.post<{ Params: { id: string; userId: string } }>(
    '/v1/community/events/:id/members/:userId/decline',
    { schema: { params: memberParams, body: empty } },
    async (request) => ({
      data: await as(request.headers.authorization, async (client, userId) => {
        const event = await requireHost(client, request.params.id, userId);
        const current = await memberStatus(
          client,
          event.id,
          request.params.userId,
        );
        if (
          current !== 'requested' &&
          current !== 'waiting' &&
          current !== 'confirmed'
        )
          throw unavailable();
        await setStatus(
          client,
          event.id,
          request.params.userId,
          'declined',
          userId,
        );
        if (current === 'confirmed') await promoteWaiting(client, event);
        return members(client, event.id);
      }),
    }),
  );

  app.get<{ Params: { id: string }; Querystring: { after?: string } }>(
    '/v1/community/events/:id/messages',
    {
      schema: {
        params,
        querystring: object({
          after: { type: 'string', pattern: '^[0-9]{1,18}$' },
        }),
      },
    },
    async (request) => ({
      data: await as(request.headers.authorization, async (client, userId) => {
        await requireChat(client, request.params.id, userId);
        const after = request.query.after ?? null;
        // First load: the latest 100 messages. Then: everything after the last id seen.
        const rows = (
          await client.query(
            after === null
              ? `SELECT * FROM (SELECT ${messageColumns}
                   FROM public.community_messages m
                   JOIN public.community_events e ON e.id=m.event_id
                   JOIN public.users u ON u.id=m.author_id
                   WHERE m.event_id=$1
                   ORDER BY m.id DESC LIMIT 100) latest ORDER BY id::bigint`
              : `SELECT ${messageColumns}
                   FROM public.community_messages m
                   JOIN public.community_events e ON e.id=m.event_id
                   JOIN public.users u ON u.id=m.author_id
                   WHERE m.event_id=$1 AND m.id>$3::bigint
                   ORDER BY m.id LIMIT 100`,
            after === null
              ? [request.params.id, userId]
              : [request.params.id, userId, after],
          )
        ).rows;
        return rows;
      }),
    }),
  );

  app.post<{ Params: { id: string }; Body: { body: string } }>(
    '/v1/community/events/:id/messages',
    {
      schema: { params, body: object({ body: text(1000) }, ['body']) },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) =>
      reply.code(201).send({
        data: await as(
          request.headers.authorization,
          async (client, userId) => {
            const event = await requireChat(client, request.params.id, userId);
            if (event.status !== 'published')
              throw closed(
                'This event is cancelled. The group chat is read-only.',
              );
            const id = (
              await client.query<{ id: string }>(
                `INSERT INTO public.community_messages(event_id,author_id,body)
               VALUES($1,$2,$3) RETURNING id::text`,
                [event.id, userId, request.body.body.trim()],
              )
            ).rows[0]!.id;
            return (
              await client.query(
                `SELECT ${messageColumns} FROM public.community_messages m
               JOIN public.community_events e ON e.id=m.event_id
               JOIN public.users u ON u.id=m.author_id
               WHERE m.event_id=$1 AND m.id=$3::bigint`,
                [event.id, userId, id],
              )
            ).rows[0];
          },
        ),
      }),
  );

  // Everything the signed-in person hosts or has joined, for the Community tab.
  app.get(
    '/v1/me/community',
    { schema: { querystring: empty } },
    async (request) => ({
      data: await as(request.headers.authorization, async (client, userId) => {
        const rows = (
          await client.query<EventRow & { memberStatus: Status | null }>(
            `${select.replace('SELECT ', 'SELECT mine.status AS "memberStatus", ')}
             LEFT JOIN public.community_members mine
               ON mine.event_id=e.id AND mine.user_id=$1
             WHERE u.status='active' AND (e.owner_id=$1
               OR mine.status IN ('requested','confirmed','waiting'))
             ORDER BY e.details->>'date' DESC, e.id LIMIT 100`,
            [userId],
          )
        ).rows;
        return rows.map((row) => {
          const event = publicEvent(row);
          const host = row.ownerId === userId;
          const status = host ? 'confirmed' : row.memberStatus;
          return {
            event,
            role: host ? 'host' : 'member',
            status,
            canChat: host || status === 'confirmed',
          };
        });
      }),
    }),
  );
}
